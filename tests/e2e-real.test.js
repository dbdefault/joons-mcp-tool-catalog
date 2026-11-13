// REAL end-to-end tests: spawn the actual bin/joons-mcp-tool-catalog.js
// in a separate process with NO injected doubles. Regression evidence for
// RR-01/RT-01: the production wiring must work for all five commands.
// Self-contained: node:test + built-ins only; temp dirs are cleaned up.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, statSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const BIN = fileURLToPath(new URL('../bin/joons-mcp-tool-catalog.js', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const ALPHA = path.join(FIXTURES, 'alpha.json');
const BETA = path.join(FIXTURES, 'beta.json');
const GAMMA = path.join(FIXTURES, 'gamma.json');
const BAD_FORMAT = path.join(FIXTURES, 'bad-format.json');
const CREDENTIAL = path.join(FIXTURES, 'credential-name.json');

async function cli(args, options = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [BIN, ...args],
      { timeout: 60000, ...options }
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    if (error && typeof error.code === 'number') {
      return { code: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
    }
    throw error;
  }
}

function tmpdir_helper(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'w4-real-e2e-'));
  t.after(() => { rmSync(dir, { recursive: true, force: true }); });
  return dir;
}

test('real process: validate exits 0 for a valid snapshot', async () => {
  const r = await cli(['validate', ALPHA]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /status: PASS/);
  assert.equal(r.stderr, '');
});

test('real process: list/search/collisions exit 0 with valid JSON reports', async () => {
  const l = await cli(['list', ALPHA, BETA, GAMMA, '--format', 'json']);
  assert.equal(l.code, 0);
  const list = JSON.parse(l.stdout);
  assert.equal(list.format, 'joons-mcp-tool-catalog/report');
  assert.equal(list.command, 'list');
  assert.equal(list.status, 'PASS');
  assert.equal(list.counts.servers, 3);
  assert.equal(list.counts.tools, 8);
  assert.equal(list.servers.length, 3);
  assert.ok(!('sha256' in list.servers[0]), 'reports never carry sha256');

  const s = await cli(['search', ALPHA, BETA, GAMMA, '--query', 'weather', '--format', 'json']);
  assert.equal(s.code, 0);
  const search = JSON.parse(s.stdout);
  assert.equal(search.command, 'search');
  assert.equal(search.counts.matches, 2);
  assert.equal(search.matches.length, 2);

  const c = await cli(['collisions', ALPHA, BETA, GAMMA, '--format', 'json']);
  assert.equal(c.code, 0);
  const collisions = JSON.parse(c.stdout);
  assert.equal(collisions.counts.collisions, 3);
  assert.deepEqual(collisions.collisions.map((x) => x.kind), ['exact', 'exact', 'weak']);
});

test('real process: build writes catalog.json, catalog.md and zero-byte marker', async (t) => {
  const out = tmpdir_helper(t);
  const r = await cli(['build', ALPHA, BETA, GAMMA, '--out', out]);
  assert.equal(r.code, 0);
  assert.deepEqual(readdirSync(out).sort(), [
    '.joons-mcp-tool-catalog-output',
    'catalog.json',
    'catalog.md',
  ]);
  const marker = path.join(out, '.joons-mcp-tool-catalog-output');
  assert.equal(statSync(marker).size, 0);
  const catalog = JSON.parse(readFileSync(path.join(out, 'catalog.json'), 'utf8'));
  assert.equal(catalog.format, 'joons-mcp-tool-catalog/catalog');
  assert.equal(catalog.command, 'build');
  assert.match(catalog.servers[0].sha256, /^[0-9a-f]{12}$/);
  assert.ok(!('name' in catalog.servers[0]));
  const md = readFileSync(path.join(out, 'catalog.md'), 'utf8');
  assert.ok(!md.includes('\r'));
});

test('real process: build is byte-identical across two separate processes', async (t) => {
  const out1 = tmpdir_helper(t);
  const out2 = tmpdir_helper(t);
  const r1 = await cli(['build', ALPHA, BETA, GAMMA, '--out', out1]);
  const r2 = await cli(['build', GAMMA, BETA, ALPHA, '--out', out2]);
  assert.equal(r1.code, 0);
  assert.equal(r2.code, 0);
  for (const name of ['catalog.json', 'catalog.md']) {
    const a = readFileSync(path.join(out1, name), 'utf8');
    const b = readFileSync(path.join(out2, name), 'utf8');
    assert.equal(a, b, `${name} must be byte-identical across processes and input orders`);
  }
});

test('real process: build into nonempty foreign dir needs --force, which never deletes', async (t) => {
  const out = tmpdir_helper(t);
  writeFileSync(path.join(out, 'stray.txt'), 'keep me');
  const refused = await cli(['build', ALPHA, '--out', out]);
  assert.equal(refused.code, 4);
  assert.equal(refused.stderr, 'joons-mcp-tool-catalog: output_error\n');
  const forced = await cli(['build', ALPHA, '--out', out, '--force']);
  assert.equal(forced.code, 0);
  assert.equal(existsSync(path.join(out, 'stray.txt')), true);
  assert.equal(existsSync(path.join(out, 'catalog.json')), true);
});

test('real process: --quiet suppresses the terminal success report only', async (t) => {
  const out1 = tmpdir_helper(t);
  const quiet = await cli(['build', ALPHA, '--out', out1, '--quiet']);
  assert.equal(quiet.code, 0);
  assert.equal(quiet.stdout, '');
  assert.equal(existsSync(path.join(out1, 'catalog.json')), true);
  const v = await cli(['validate', ALPHA, '--quiet']);
  assert.equal(v.code, 0);
  assert.equal(v.stdout, '');
  const json = await cli(['build', ALPHA, '--out', out1, '--quiet', '--format', 'json']);
  assert.equal(json.code, 0);
  assert.ok(json.stdout.startsWith('{'));
});

test('real process: exit codes 0/2/3 across input, usage and output kinds', async (t) => {
  const out = tmpdir_helper(t);
  const missing = await cli(['validate', path.join(out, 'nope.json')]);
  assert.equal(missing.code, 2);
  assert.equal(missing.stderr, 'joons-mcp-tool-catalog: input_unreadable\n');

  const malformed = await cli(['validate', BAD_FORMAT]);
  assert.equal(malformed.code, 2);
  assert.equal(malformed.stderr, 'joons-mcp-tool-catalog: invalid_snapshot\n');

  const cred = await cli(['list', CREDENTIAL]);
  assert.equal(cred.code, 2);
  assert.equal(cred.stderr, 'joons-mcp-tool-catalog: credential_detected\n');

  const unknownFlag = await cli(['list', ALPHA, '--bogus']);
  assert.equal(unknownFlag.code, 3);
  assert.equal(unknownFlag.stderr, 'joons-mcp-tool-catalog: usage_error\n');

  const terminator = await cli(['list', ALPHA, '--']);
  assert.equal(terminator.code, 3);
  assert.equal(terminator.stderr, 'joons-mcp-tool-catalog: usage_error\n');

  const buildNoOut = await cli(['build', ALPHA]);
  assert.equal(buildNoOut.code, 3);

  const emptyQuery = await cli(['search', ALPHA, '--query', '   ']);
  assert.equal(emptyQuery.code, 3);

  // search never writes files
  assert.equal(existsSync(path.join(out, 'catalog.json')), false);
});

test('real process: search counts.matches is the true total over the 1000 cap', async (t) => {
  const dir = tmpdir_helper(t);
  const tools = Array.from({ length: 1001 }, (_, i) => ({
    name: `common_tool_${i}`,
    title: 'needle bearer',
    description: null,
    inputSchema: { type: 'object' },
    outputSchema: null,
    annotations: null,
  }));
  const snapshot = {
    format: 'joons-mcp-diff/snapshot',
    schemaVersion: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    tool: { name: 'fixture-snapshot-writer', version: '1.0.0' },
    label: null,
    server: { name: 'mass-server', version: '1.0.0', protocolVersion: '2025-06-18' },
    tools,
    stats: { toolCount: tools.length, pages: 1 },
  };
  const file = path.join(dir, 'mass.json');
  writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`);
  const r = await cli(['search', file, '--query', 'needle', '--format', 'json']);
  assert.equal(r.code, 0);
  const report = JSON.parse(r.stdout);
  assert.equal(report.counts.matches, 1001, 'true total');
  assert.equal(report.matches.length, 1000, 'emitted cap');
});

test('real process: --help and --version exit 0 with fixed text', async () => {
  const help = await cli(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /Usage:/);
  const version = await cli(['--version']);
  assert.equal(version.code, 0);
  assert.match(version.stdout, /^joons-mcp-tool-catalog 0\.1\.1\n$/);
});
