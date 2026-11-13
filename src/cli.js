// Orchestration: parse args, admit inputs, merge, compute, render, emit.
// Module dependencies are injectable for tests; by default they are
// loaded lazily via dynamic import.

import { parseArgs } from './args.js';
import { NAME, VERSION } from './version.js';
import { LIMITS } from './security/limits.js';
import { limitExceeded } from './errors.js';

const INPUT_KINDS = new Set([
  'input_unreadable',
  'invalid_json',
  'invalid_snapshot',
  'limit_exceeded',
  'credential_detected',
]);

export const MARKER_NAME = '.joons-mcp-tool-catalog-output';
const MAX_INPUT_FILES = 100;

export const HELP_TEXT = `${NAME} ${VERSION}

Usage:
  ${NAME} build <snapshot>... --out DIR [--force] [--format terminal|json|markdown] [--quiet]
  ${NAME} search <snapshot>... --query TEXT [--details] [--format terminal|json|markdown]
  ${NAME} list <snapshot>... [--details] [--format terminal|json|markdown]
  ${NAME} collisions <snapshot>... [--details] [--format terminal|json|markdown]
  ${NAME} validate <snapshot>... [--quiet]
  ${NAME} --help | --version

Options:
  --out DIR     output directory for build (required by build)
  --force       reuse a non-empty output directory without the marker
  --format FMT  report format: terminal (default), json, markdown
  --quiet       suppress the terminal success report (build, validate)
  --details     include redacted input-derived names in the report
  --query TEXT  search query (required by search)
`;

export const VERSION_TEXT = `${NAME} ${VERSION}\n`;

async function defaultDeps() {
  const [read, snapshot, credentials, redact, safeDir, merge, collisions, search, catalog, report, rjson, rterminal, rmarkdown] = await Promise.all([
    import('./input/read.js'),
    import('./input/snapshot.js'),
    import('./security/credentials.js'),
    import('./security/redact.js'),
    import('./security/safe-dir.js'),
    import('./catalog/merge.js'),
    import('./catalog/collisions.js'),
    import('./catalog/search.js'),
    import('./output/catalog.js'),
    import('./output/report.js'),
    import('./render/json.js'),
    import('./render/terminal.js'),
    import('./render/markdown.js'),
  ]);
  return {
    readSnapshotFile: read.readSnapshotFile,
    validateSnapshot: snapshot.validateSnapshot,
    scanForCredential: credentials.scanForCredential,
    redactText: redact.redactText,
    prepareOutputDir: safeDir.prepareOutputDir,
    writeAtomic: safeDir.writeAtomic,
    mergeSnapshots: merge.mergeSnapshots,
    findCollisions: collisions.findCollisions,
    searchTools: search.searchTools,
    listServers: search.listServers,
    makeCatalog: catalog.makeCatalog,
    makeReport: report.makeReport,
    renderCatalogJson: rjson.renderCatalogJson,
    renderReportJson: rjson.renderReportJson,
    renderReportTerminal: rterminal.renderReportTerminal,
    renderCatalogMarkdown: rmarkdown.renderCatalogMarkdown,
    renderReportMarkdown: rmarkdown.renderReportMarkdown,
  };
}

function writeErr(stderr, kind) {
  try {
    stderr.write(`${NAME}: ${kind}\n`);
  } catch {
    // stderr EPIPE and similar are ignored by design.
  }
}

// Returns 'epipe' on stdout EPIPE, otherwise throws.
function writeOut(stdout, text) {
  try {
    stdout.write(text);
    return 'ok';
  } catch (err) {
    if (err && err.code === 'EPIPE') return 'epipe';
    throw err;
  }
}

function renderReport(deps, format, report) {
  if (format === 'json') return deps.renderReportJson(report);
  if (format === 'markdown') return deps.renderReportMarkdown(report);
  return deps.renderReportTerminal(report);
}

function asOutputError(err) {
  if (err && err.kind === 'output_error') return err;
  const e = new Error('output_error');
  e.kind = 'output_error';
  return e;
}

async function runCommand(parsed, deps, stdout, stderr) {
  const { command, snapshots, options } = parsed;

  if (snapshots.length > MAX_INPUT_FILES) {
    writeErr(stderr, 'limit_exceeded');
    return 2;
  }

  // Input phase: one bad input rejects the whole invocation. The 64 MiB
  // aggregate raw-byte cap is enforced here, before any merge or output.
  const values = new Array(snapshots.length);
  const sha256s = new Array(snapshots.length);
  let totalBytes = 0;
  for (let i = 0; i < snapshots.length; i += 1) {
    const { value, sha256, bytes } = await deps.readSnapshotFile(snapshots[i]);
    totalBytes += typeof bytes === 'number' ? bytes : 0;
    if (totalBytes > LIMITS.MAX_TOTAL_BYTES) throw limitExceeded();
    values[i] = deps.validateSnapshot(value) ?? value;
    sha256s[i] = sha256;
  }

  // Compute phase.
  const merged = deps.mergeSnapshots(values);
  const order = values.map((v, i) => i).sort((a, b) => {
    const na = values[a].server.name;
    const nb = values[b].server.name;
    if (na < nb) return -1;
    if (na > nb) return 1;
    return a - b;
  });
  const ordinalSha256 = order.map((i) => String(sha256s[i]).slice(0, 12));
  const collisions = deps.findCollisions(merged.tools);
  let matches = [];
  let total = 0;
  if (command === 'search') {
    const result = deps.searchTools(merged.tools, options.query);
    matches = result.matches;
    total = result.total;
  }

  // Output phase.
  if (command === 'build') {
    const catalog = deps.makeCatalog('build', merged, {
      collisions,
      sha256s: ordinalSha256,
      matches,
      total,
    });
    try {
      await deps.prepareOutputDir(options.out, snapshots, options.force === true);
      const writeOptions = { inputs: snapshots };
      await deps.writeAtomic(options.out, 'catalog.json', deps.renderCatalogJson(catalog), writeOptions);
      await deps.writeAtomic(options.out, 'catalog.md', deps.renderCatalogMarkdown(catalog), writeOptions);
      await deps.writeAtomic(options.out, MARKER_NAME, '', writeOptions);
    } catch (err) {
      throw asOutputError(err);
    }
  }

  const report = deps.makeReport(command, merged, { collisions, matches, total }, { details: options.details === true });
  const text = renderReport(deps, options.format, report);
  const quiet = options.quiet === true && (command === 'build' || command === 'validate');
  if (!(quiet && options.format === 'terminal')) {
    if (writeOut(stdout, text) === 'epipe') {
      writeErr(stderr, 'output_error');
      return 4;
    }
  }
  return 0;
}

// argv: token array. io: { stdout, stderr, deps } all optional.
// Returns the process exit code; never throws.
export async function main(argv = process.argv.slice(2), io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  try {
    const parsed = parseArgs(argv);
    if (parsed.help) {
      if (writeOut(stdout, HELP_TEXT) === 'epipe') {
        writeErr(stderr, 'output_error');
        return 4;
      }
      return 0;
    }
    if (parsed.version) {
      if (writeOut(stdout, VERSION_TEXT) === 'epipe') {
        writeErr(stderr, 'output_error');
        return 4;
      }
      return 0;
    }
    const deps = io.deps ?? (await defaultDeps());
    return await runCommand(parsed, deps, stdout, stderr);
  } catch (err) {
    const kind = err && typeof err.kind === 'string' ? err.kind : 'internal_error';
    if (kind === 'usage_error') {
      writeErr(stderr, 'usage_error');
      return 3;
    }
    if (kind === 'output_error') {
      writeErr(stderr, 'output_error');
      return 4;
    }
    writeErr(stderr, INPUT_KINDS.has(kind) ? kind : 'internal_error');
    return 2;
  }
}
