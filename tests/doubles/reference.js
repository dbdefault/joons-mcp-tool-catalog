// Local test doubles for the module interfaces.
// Faithful but compact reference implementations of the CONTRACT behavior,
// used only inside W4 tests so cli.js orchestration can be exercised
// end-to-end before the real modules land.

import {
  existsSync, lstatSync, mkdirSync, openSync, closeSync, readFileSync,
  readdirSync, renameSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

export class RefError extends Error {
  constructor(kind) {
    super(kind);
    this.kind = kind;
  }
}

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOOLS_PER_SNAPSHOT = 10000;
const MAX_COLLISION_ENTRIES = 10000;
const MAX_MATCHES = 1000;
const MAX_TEXT = 100000;
const MAX_DEPTH = 64;
const MAX_NODES = 500000;
const MAX_ARRAY = 100000;
const NAME_MAX = 1000;
const DETAILS_MAX = 200;
const MARKER = '.joons-mcp-tool-catalog-output';
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);

const CONTROL_RE = /[\u0000-\u001F\u007F-\u009F]/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

// ---------------------------------------------------------------- credential

const CRED_TOKEN_RES = [
  /gh[po-u]_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /sk-[A-Za-z0-9]{16,}/,
  /AKIA[0-9A-Z]{16}/,
  /xox[bapors]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
  /Bearer\s+\S+/,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
];
const CRED_PAIR_RE = /(?:(?:password|passwd|secret|token|apikey|api_key|api-key|authorization|credential|cookie|session|privatekey|private_key))(?:\s*[=:]\s*|"?\s*":\s*"?)([^\s",}]{8,})/i;

function normalizedForms(text) {
  const forms = [text];
  try {
    forms.push(decodeURIComponent(text));
  } catch {
    // malformed encoding: treat as opaque, keep original only
  }
  return forms;
}

export function scanForCredential(text) {
  if (typeof text !== 'string' || text === '') return false;
  for (const form of normalizedForms(text)) {
    for (const re of CRED_TOKEN_RES) {
      if (re.test(form)) return true;
    }
    if (CRED_PAIR_RE.test(form)) return true;
  }
  return false;
}

// ------------------------------------------------------------------ redact

function truncateCodePoints(text, max) {
  let out = '';
  let n = 0;
  for (const ch of text) {
    if (n >= max) return `${out}...`;
    out += ch;
    n += 1;
  }
  return out;
}

export function redactText(text, { maxLength = DETAILS_MAX } = {}) {
  if (typeof text !== 'string') return text;
  let out = text;
  out = out.replace(/[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069\u061C\u2028\u2029\u001B]/g, '');
  out = out.replace(/[a-z][a-z0-9+.-]{1,15}:\/\/\S+/g, '[URL]');
  out = out.replace(/(?:[A-Za-z]:[\\/][^\s]+|\\\\[^\s]+|\/(?:[^\s/]+[/\\])+\S*|~\/\S+)/g, '[PATH]');
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[EMAIL]');
  out = out.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[IP]');
  out = out.replace(CRED_PAIR_RE, (m, p1) => m.slice(0, m.length - p1.length) + '[MASKED]');
  out = out.replace(/Bearer\s+\S+/g, 'Bearer [MASKED]');
  out = out.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED]');
  out = out.replace(/[A-Za-z0-9_+/=-]{24,}/g, '[REDACTED]');
  out = truncateCodePoints(out, maxLength);
  return out;
}

// -------------------------------------------------------------------- read

export function readSnapshotFile(filePath) {
  let st;
  try {
    st = statSync(filePath);
  } catch {
    throw new RefError('input_unreadable');
  }
  if (!st.isFile()) throw new RefError('input_unreadable');
  if (st.size > MAX_FILE_BYTES) throw new RefError('limit_exceeded');
  let buf;
  try {
    buf = readFileSync(filePath);
  } catch {
    throw new RefError('input_unreadable');
  }
  if (buf.length !== st.size || buf.length > MAX_FILE_BYTES) throw new RefError('limit_exceeded');
  let sha256;
  try {
    sha256 = createHash('sha256').update(buf).digest('hex');
  } catch {
    throw new RefError('input_unreadable');
  }
  let text = buf.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new RefError('invalid_json');
  }
  return { value, sha256 };
}

// --------------------------------------------------------------- validation

function walkReserved(value, depth) {
  if (depth > MAX_DEPTH) throw new RefError('limit_exceeded');
  if (Array.isArray(value)) {
    for (const item of value) walkReserved(item, depth + 1);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (RESERVED.has(key)) throw new RefError('invalid_snapshot');
      walkReserved(value[key], depth + 1);
    }
  }
}

function fail() {
  throw new RefError('invalid_snapshot');
}

export function validateSnapshot(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail();
  const rootKeys = Object.keys(value);
  for (const k of rootKeys) {
    if (!['format', 'schemaVersion', 'createdAt', 'tool', 'label', 'server', 'tools', 'stats'].includes(k)) fail();
  }
  if (value.format !== 'joons-mcp-diff/snapshot') fail();
  if (value.schemaVersion !== 1) fail();
  if (typeof value.createdAt !== 'string' || !ISO_RE.test(value.createdAt)) fail();
  if (value.label !== null && typeof value.label !== 'string') fail();

  const tool = value.tool;
  if (tool === null || typeof tool !== 'object' || Array.isArray(tool)) fail();
  const toolKeys = Object.keys(tool);
  if (toolKeys.length !== 2 || !toolKeys.includes('name') || !toolKeys.includes('version')) fail();
  if (typeof tool.name !== 'string' || typeof tool.version !== 'string') fail();

  const server = value.server;
  if (server === null || typeof server !== 'object' || Array.isArray(server)) fail();
  const serverKeys = Object.keys(server);
  if (serverKeys.length !== 3 || !serverKeys.includes('name') || !serverKeys.includes('version') || !serverKeys.includes('protocolVersion')) fail();
  if (typeof server.name !== 'string' || typeof server.version !== 'string' || typeof server.protocolVersion !== 'string') fail();

  if (!Array.isArray(value.tools)) fail();
  if (value.tools.length > MAX_TOOLS_PER_SNAPSHOT) throw new RefError('limit_exceeded');
  const seenNames = new Set();
  for (const entry of value.tools) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) fail();
    const keys = Object.keys(entry);
    for (const k of keys) {
      if (!['name', 'title', 'description', 'inputSchema', 'outputSchema', 'annotations'].includes(k)) fail();
    }
    for (const req of ['name', 'title', 'description', 'inputSchema', 'outputSchema', 'annotations']) {
      if (!keys.includes(req)) fail();
    }
    const name = entry.name;
    if (typeof name !== 'string' || name === '' || name.length > NAME_MAX || CONTROL_RE.test(name)) fail();
    if (seenNames.has(name)) fail();
    seenNames.add(name);
    if (entry.title !== null && typeof entry.title !== 'string') fail();
    if (entry.description !== null && typeof entry.description !== 'string') fail();
    if (entry.annotations !== null && (typeof entry.annotations !== 'object' || Array.isArray(entry.annotations))) fail();
    if (typeof entry.inputSchema === 'undefined') fail();
  }

  const stats = value.stats;
  if (stats === null || typeof stats !== 'object' || Array.isArray(stats)) fail();
  const statsKeys = Object.keys(stats);
  for (const k of statsKeys) {
    if (!['toolCount', 'pages', 'duplicateNames'].includes(k)) fail();
  }
  if (typeof stats.toolCount !== 'number' || !Number.isSafeInteger(stats.toolCount)) fail();
  if (stats.toolCount !== value.tools.length) fail();
  if (typeof stats.pages !== 'number' || !Number.isSafeInteger(stats.pages) || stats.pages < 0) fail();
  if (statsKeys.includes('duplicateNames')) {
    if (!Array.isArray(stats.duplicateNames)) fail();
    for (const d of stats.duplicateNames) if (typeof d !== 'string') fail();
  }

  walkReserved(value, 0);

  // Credential-shaped identifiers: refuse the whole snapshot.
  if (scanForCredential(server.name)) throw new RefError('credential_detected');
  for (const entry of value.tools) {
    if (scanForCredential(entry.name)) throw new RefError('credential_detected');
  }
  return value;
}

// ------------------------------------------------------------------- merge

const TRIM_CHARS = /^[\p{White_Space}\p{Cc}\p{Cf}]+|[\p{White_Space}\p{Cc}\p{Cf}]+$/gu;
export function weakKey(name) {
  return name.normalize('NFC').replace(TRIM_CHARS, '').toLowerCase();
}

export function mergeSnapshots(values) {
  const order = values.map((v, i) => i).sort((a, b) => {
    const na = values[a].server.name;
    const nb = values[b].server.name;
    if (na < nb) return -1;
    if (na > nb) return 1;
    return a - b;
  });
  const servers = order.map((inputIndex, k) => ({
    server: `server-${k + 1}`,
    inputIndex,
    tools: values[inputIndex].tools.length,
  }));
  const serverOrdinal = new Map();
  for (let k = 0; k < order.length; k += 1) serverOrdinal.set(order[k], k + 1);
  const flat = [];
  values.forEach((value, inputIndex) => {
    value.tools.forEach((entry, index) => {
      flat.push({
        serverOrdinal: serverOrdinal.get(inputIndex),
        index,
        name: entry.name,
        title: entry.title,
        description: entry.description,
      });
    });
  });
  flat.sort((a, b) => {
    if (a.name < b.name) return -1;
    if (a.name > b.name) return 1;
    if (a.serverOrdinal !== b.serverOrdinal) return a.serverOrdinal - b.serverOrdinal;
    return a.index - b.index;
  });
  const tools = flat.map((t, k) => ({
    tool: `tool-${k + 1}`,
    server: `server-${t.serverOrdinal}`,
    name: t.name,
    title: t.title,
    description: t.description,
    index: t.index,
  }));
  return { servers, tools };
}

export function listServers(tools) {
  const counts = new Map();
  for (const t of tools) {
    counts.set(t.server, (counts.get(t.server) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([server, n]) => ({ server, tools: n }));
}

// --------------------------------------------------------------- collisions

export function findCollisions(tools) {
  const colliding = new Set();
  const byName = new Map();
  for (const t of tools) {
    if (!byName.has(t.name)) byName.set(t.name, []);
    byName.get(t.name).push(t);
  }
  const exact = [];
  for (const [name, group] of byName) {
    const servers = new Set(group.map((t) => t.server));
    if (servers.size >= 2) {
      exact.push({ kind: 'exact', name, tools: group.map((t) => t.tool).sort() });
      for (const t of group) colliding.add(t.tool);
    }
  }
  const byKey = new Map();
  for (const t of tools) {
    const key = weakKey(t.name);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(t);
  }
  const weak = [];
  for (const [key, group] of byKey) {
    const servers = new Set(group.map((t) => t.server));
    const names = new Set(group.map((t) => t.name));
    if (servers.size >= 2 && names.size >= 2) {
      weak.push({ kind: 'weak', key, tools: group.map((t) => t.tool).sort() });
      for (const t of group) colliding.add(t.tool);
    }
  }
  const cmpTools = (a, b) => {
    for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
      if (a[i] < b[i]) return -1;
      if (a[i] > b[i]) return 1;
    }
    return a.length - b.length;
  };
  exact.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : cmpTools(a.tools, b.tools)));
  weak.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : cmpTools(a.tools, b.tools)));
  const entries = [...exact, ...weak];
  if (entries.length > MAX_COLLISION_ENTRIES) throw new RefError('limit_exceeded');
  return { entries, collidingTools: colliding.size };
}

// -------------------------------------------------------------------- search

export function searchTools(tools, query) {
  const trimmed = String(query).replace(TRIM_CHARS, '');
  const collapsed = trimmed.replace(/[\p{White_Space}\p{Cc}\p{Cf}]+/gu, ' ');
  const tokens = collapsed.toLowerCase().split(' ').filter((t) => t !== '');
  const matched = [];
  for (const t of tools) {
    const name = (t.name ?? '').toLowerCase();
    const title = (t.title ?? '').toLowerCase();
    const description = (t.description ?? '').toLowerCase();
    let score = 0;
    let ok = true;
    for (const tok of tokens) {
      let found = false;
      if (name.includes(tok)) { score += 100; found = true; }
      if (title.includes(tok)) { score += 10; found = true; }
      if (description.includes(tok)) { score += 1; found = true; }
      if (!found) { ok = false; break; }
    }
    if (ok && tokens.length > 0) {
      matched.push({ tool: t.tool, server: t.server, name: t.name, score });
    }
  }
  matched.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.name < b.name) return -1;
    if (a.name > b.name) return 1;
    if (a.server !== b.server) return a.server < b.server ? -1 : 1;
    return a.tool < b.tool ? -1 : a.tool > b.tool ? 1 : 0;
  });
  const total = matched.length;
  return { matches: matched.slice(0, MAX_MATCHES), total };
}

// ----------------------------------------------------- catalog and reports

const TOOL_IDENTITY = Object.freeze({ name: 'joons-mcp-tool-catalog', version: '0.1.0' });

function redactOrNull(text, counter) {
  if (text === null) return null;
  const out = redactText(text);
  if (out !== text) counter.count += 1;
  return out;
}

export function makeCatalog(command, merged, extra) {
  const redactions = { count: 0 };
  const collisionSet = new Set();
  for (const entry of extra.collisions.entries ?? []) {
    for (const ord of entry.tools) collisionSet.add(ord);
  }
  const servers = merged.servers.map((s, i) => ({
    server: s.server,
    sha256: extra.sha256s[i],
    tools: s.tools,
  }));
  const tools = merged.tools.map((t) => ({
    tool: t.tool,
    server: t.server,
    name: t.name,
    title: redactOrNull(t.title, redactions),
    description: redactOrNull(t.description, redactions),
    collides: collisionSet.has(t.tool),
  }));
  const collisions = (extra.collisions.entries ?? []).map((e) => ({
    kind: e.kind,
    ...(e.kind === 'exact' ? { name: e.name } : { key: e.key }),
    tools: e.tools,
  }));
  return {
    format: 'joons-mcp-tool-catalog/catalog',
    schemaVersion: 1,
    tool: { ...TOOL_IDENTITY },
    command,
    counts: {
      servers: merged.servers.length,
      tools: merged.tools.length,
      collisions: collisions.length,
      collidingTools: extra.collisions.collidingTools ?? 0,
      redactions: redactions.count,
    },
    servers,
    tools,
    collisions,
    matches: [],
  };
}

export function makeReport(command, merged, extra, { details = false } = {}) {
  const redactions = { count: 0 };
  const collisions = (extra.collisions.entries ?? []).map((e) => {
    const base = { kind: e.kind, tools: e.tools };
    if (details) {
      base.name = redactText(e.kind === 'exact' ? e.name : e.key);
    }
    return base;
  });
  const matches = extra.matches.map((m) => {
    const base = { tool: m.tool, server: m.server, score: m.score };
    if (details) base.name = redactText(m.name ?? '');
    return base;
  });
  const servers = merged.servers.map((s) => {
    const base = { server: s.server, tools: s.tools };
    return base;
  });
  return {
    format: 'joons-mcp-tool-catalog/report',
    schemaVersion: 1,
    tool: { ...TOOL_IDENTITY },
    command,
    status: 'PASS',
    mode: { details },
    counts: {
      servers: merged.servers.length,
      tools: merged.tools.length,
      collisions: collisions.length,
      collidingTools: extra.collisions.collidingTools ?? 0,
      matches: extra.total ?? 0,
      redactions: redactions.count,
    },
    servers,
    collisions,
    matches,
    problems: [],
  };
}

// ----------------------------------------------------------------- rendering

export function renderCatalogJson(catalog) {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

export function renderReportJson(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function renderReportTerminal(report) {
  const lines = [];
  lines.push(`${TOOL_IDENTITY.name} ${TOOL_IDENTITY.version} ${report.command} report`);
  lines.push('status: PASS');
  if (report.mode && report.mode.details) lines.push('details: may contain internal names');
  lines.push(`servers: ${report.counts.servers}`);
  lines.push(`tools: ${report.counts.tools}`);
  lines.push(`collisions: ${report.counts.collisions}`);
  lines.push(`collidingTools: ${report.counts.collidingTools}`);
  lines.push(`matches: ${report.counts.matches}`);
  lines.push(`redactions: ${report.counts.redactions}`);
  for (const s of report.servers) {
    lines.push(`server ${s.server}: ${s.tools} tools`);
  }
  for (const c of report.collisions) {
    const label = c.name !== undefined ? ` ${c.name}` : '';
    lines.push(`collision ${c.kind}${label}: ${c.tools.join(', ')}`);
  }
  for (const m of report.matches) {
    const label = m.name !== undefined ? ` name "${m.name}"` : '';
    lines.push(`match ${m.tool} (${m.server}) score ${m.score}${label}`);
  }
  return `${lines.join('\n')}\n`;
}

function mdEscape(text) {
  return String(text).replace(/([\\`*_[\]{}()#+.!|>~-])/g, '\\$1');
}

export function renderCatalogMarkdown(catalog) {
  const lines = [];
  lines.push('# Tool Catalog');
  lines.push('');
  lines.push(`- format: \`${catalog.format}\``);
  lines.push(`- schemaVersion: ${catalog.schemaVersion}`);
  lines.push(`- command: \`${catalog.command}\``);
  lines.push('');
  lines.push('## Counts');
  lines.push('');
  lines.push(`- servers: ${catalog.counts.servers}`);
  lines.push(`- tools: ${catalog.counts.tools}`);
  lines.push(`- collisions: ${catalog.counts.collisions}`);
  lines.push(`- collidingTools: ${catalog.counts.collidingTools}`);
  lines.push(`- redactions: ${catalog.counts.redactions}`);
  lines.push('');
  lines.push('## Servers');
  lines.push('');
  for (const s of catalog.servers) {
    lines.push(`- \`${s.server}\` (${s.sha256}): ${s.tools} tools`);
  }
  lines.push('');
  lines.push('## Tools');
  lines.push('');
  for (const t of catalog.tools) {
    const title = t.title === null ? '' : ` - ${mdEscape(t.title)}`;
    const flag = t.collides ? ' (collides)' : '';
    lines.push(`- \`${t.tool}\` [\`${t.server}\`] **${mdEscape(t.name)}**${title}${flag}`);
  }
  lines.push('');
  lines.push('## Collisions');
  lines.push('');
  if (catalog.collisions.length === 0) lines.push('- none');
  for (const c of catalog.collisions) {
    const label = c.kind === 'exact' ? `name \`${mdEscape(c.name)}\`` : `key \`${mdEscape(c.key)}\``;
    lines.push(`- ${c.kind} (${label}): ${c.tools.map((t) => `\`${t}\``).join(', ')}`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

export function renderReportMarkdown(report) {
  const lines = [];
  lines.push(`# ${TOOL_IDENTITY.name} ${TOOL_IDENTITY.version} - ${report.command} report`);
  lines.push('');
  lines.push('- status: PASS');
  if (report.mode && report.mode.details) lines.push('- details: may contain internal names');
  lines.push(`- servers: ${report.counts.servers}`);
  lines.push(`- tools: ${report.counts.tools}`);
  lines.push(`- collisions: ${report.counts.collisions}`);
  lines.push(`- collidingTools: ${report.counts.collidingTools}`);
  lines.push(`- matches: ${report.counts.matches}`);
  lines.push(`- redactions: ${report.counts.redactions}`);
  lines.push('');
  for (const s of report.servers) {
    lines.push(`- server \`${s.server}\`: ${s.tools} tools`);
  }
  for (const c of report.collisions) {
    const label = c.name !== undefined ? `: "${mdEscape(c.name)}"` : '';
    lines.push(`- collision ${c.kind}${label} - ${c.tools.map((t) => `\`${t}\``).join(', ')}`);
  }
  for (const m of report.matches) {
    const label = m.name !== undefined ? ` - "${mdEscape(m.name)}"` : '';
    lines.push(`- match \`${m.tool}\` (\`${m.server}\`) score ${m.score}${label}`);
  }
  return `${lines.join('\n')}\n`;
}

// ------------------------------------------------------------ output safety

function pathComponents(p) {
  const out = [];
  let cur = p;
  while (cur !== path.dirname(cur)) {
    out.unshift(path.basename(cur));
    cur = path.dirname(cur);
  }
  out.unshift(cur);
  return out.filter((c) => c !== '' && c !== '.');
}

function samePath(a, b) {
  const ca = pathComponents(a);
  const cb = pathComponents(b);
  if (ca.length > cb.length) return false;
  for (let i = 0; i < ca.length; i += 1) {
    if (ca[i].toLowerCase() !== cb[i].toLowerCase()) return false;
  }
  return true;
}

const MACOS_ALLOWED_LINKS = new Set(['/var', '/tmp', '/etc']);

export function prepareOutputDir(dir, inputPaths, force = false) {
  if (typeof dir !== 'string' || dir === '') throw new RefError('output_error');
  const resolved = path.resolve(dir);
  const isMac = process.platform === 'darwin';

  // Walk existing components; reject symlinks/junctions except macOS system links.
  const parts = pathComponents(resolved);
  let current = path.isAbsolute(resolved) ? path.parse(resolved).root : parts[0];
  const rest = path.isAbsolute(resolved) ? parts.slice(1) : parts.slice(1);
  for (const component of rest) {
    current = path.join(current, component);
    let st;
    try {
      st = lstatSync(current);
    } catch {
      continue; // does not exist yet
    }
    if (st.isSymbolicLink()) {
      if (isMac && MACOS_ALLOWED_LINKS.has(current)) continue;
      throw new RefError('output_error');
    }
    if (st.isDirectory()) continue;
    throw new RefError('output_error'); // existing non-directory component
  }

  if (existsSync(resolved)) {
    const st = statSync(resolved);
    if (!st.isDirectory()) throw new RefError('output_error');
  }

  // Containment: output must not equal an input parent or contain an input.
  for (const input of inputPaths) {
    const absInput = path.resolve(input);
    const inputDir = path.dirname(absInput);
    if (samePath(resolved, inputDir) || samePath(resolved, absInput)) {
      throw new RefError('output_error');
    }
    if (samePath(resolved, absInput) || isInside(absInput, resolved)) {
      throw new RefError('output_error');
    }
  }

  const markerPath = path.join(resolved, MARKER);
  if (existsSync(resolved) && readdirSync(resolved).length > 0) {
    let markerOk = false;
    try {
      const mst = lstatSync(markerPath);
      markerOk = mst.isFile();
    } catch {
      markerOk = false;
    }
    if (!markerOk && !force) throw new RefError('output_error');
  }

  try {
    mkdirSync(resolved, { recursive: true });
  } catch {
    throw new RefError('output_error');
  }
  // Recheck marker must not be a directory or symlink.
  if (existsSync(markerPath)) {
    let mst;
    try {
      mst = lstatSync(markerPath);
    } catch {
      throw new RefError('output_error');
    }
    if (!mst.isFile() || mst.isSymbolicLink()) throw new RefError('output_error');
  }
  for (const name of ['catalog.json', 'catalog.md', MARKER]) {
    const p = path.join(resolved, name);
    if (existsSync(p)) {
      let st;
      try {
        st = lstatSync(p);
      } catch {
        throw new RefError('output_error');
      }
      if (!st.isFile() || st.isSymbolicLink() || !st.isFile()) throw new RefError('output_error');
    }
  }
  return resolved;
}

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function writeAtomic(dir, name, bytes) {
  const resolved = path.resolve(dir);
  const dest = path.join(resolved, name);
  let fd;
  const tmp = path.join(resolved, `.tmp-${randomBytes(8).toString('hex')}-${name}`);
  try {
    fd = openSync(tmp, 'wx');
    writeFileSync(fd, typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes);
    closeSync(fd);
    fd = undefined;
    renameSync(tmp, dest);
  } catch {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* ignore */ }
    }
    try { unlinkSync(tmp); } catch { /* ignore */ }
    throw new RefError('output_error');
  }
  return dest;
}

// ------------------------------------------------------------- dep factory

export function makeReferenceDeps() {
  return {
    readSnapshotFile,
    validateSnapshot,
    scanForCredential,
    redactText,
    mergeSnapshots,
    findCollisions,
    searchTools,
    listServers,
    makeCatalog,
    makeReport,
    renderCatalogJson,
    renderCatalogMarkdown,
    renderReportJson,
    renderReportTerminal,
    renderReportMarkdown,
    prepareOutputDir,
    writeAtomic,
  };
}
