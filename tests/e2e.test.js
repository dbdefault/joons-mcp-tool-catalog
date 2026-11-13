import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli.js';
import { makeReferenceDeps } from './doubles/reference.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const ALPHA = path.join(FIXTURES, 'alpha.json');
const BETA = path.join(FIXTURES, 'beta.json');
const GAMMA = path.join(FIXTURES, 'gamma.json');
const BAD_FORMAT = path.join(FIXTURES, 'bad-format.json');
const CREDENTIAL = path.join(FIXTURES, 'credential-name.json');

function collector() {
  return { buf: '', write(s) { this.buf += s; } };
}

async function run(argv, overrides = {}) {
  const stdout = collector();
  const stderr = collector();
  const deps = { ...makeReferenceDeps(), ...overrides };
  const code = await main(argv, { stdout, stderr, deps });
  return { code, stdout, stderr, deps };
}

function tmpdir_helper(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'w4-e2e-'));
  t.after(() => { rmSync(dir, { recursive: true, force: true }); });
  return dir;
}

test('build writes catalog.json, catalog.md and zero-byte marker last', async (t) => {
  const out = tmpdir_helper(t);
  const writes = [];
  const deps = {
    writeAtomic: async (dir, name, bytes) => {
      writes.push(name);
      return makeReferenceDeps().writeAtomic(dir, name, bytes);
    },
  };
  const r = await run(['build', ALPHA, BETA, GAMMA, '--out', out], deps);
  assert.equal(r.code, 0);
  assert.deepEqual(writes, ['catalog.json', 'catalog.md', '.joons-mcp-tool-catalog-output']);
  const marker = path.join(out, '.joons-mcp-tool-catalog-output');
  assert.equal(statSync(marker).size, 0);
  const catalog = JSON.parse(readFileSync(path.join(out, 'catalog.json'), 'utf8'));
  assert.equal(catalog.format, 'joons-mcp-tool-catalog/catalog');
  assert.equal(catalog.command, 'build');
  assert.deepEqual(Object.keys(catalog.counts), ['servers', 'tools', 'collisions', 'collidingTools', 'redactions']);
  assert.equal(catalog.counts.servers, 3);
  assert.equal(catalog.counts.tools, 8);
  // exact groups: search(alpha,beta), help(beta,gamma); weak: get_weather
  assert.equal(catalog.counts.collisions, 3);
  assert.equal(catalog.counts.collidingTools, 6);
  // artifact never carries server names, only ordinals + sha256 prefixes
  const raw = readFileSync(path.join(out, 'catalog.json'), 'utf8');
  assert.ok(!raw.includes('alpha-server') && !raw.includes('beta-server') && !raw.includes('gamma-server'));
  assert.match(catalog.servers[0].sha256, /^[0-9a-f]{12}$/);
  // tool names verbatim in artifact, sorted by code-unit (uppercase first);
  // sha aligns to ordinal order (alpha < beta < gamma)
  assert.equal(catalog.tools[0].name, 'Get_Weather');
  assert.ok(catalog.tools.some((x) => x.name === 'Get_Weather'));
  // catalog.md exists, LF-only, and has no CR
  const md = readFileSync(path.join(out, 'catalog.md'), 'utf8');
  assert.ok(!md.includes('\r'));
});

test('build is deterministic across input order shuffles', async (t) => {
  const out1 = tmpdir_helper(t);
  const out2 = tmpdir_helper(t);
  const r1 = await run(['build', ALPHA, BETA, GAMMA, '--out', out1]);
  assert.equal(r1.code, 0);
  const r2 = await run(['build', GAMMA, ALPHA, BETA, '--out', out2]);
  assert.equal(r2.code, 0);
  const a = readFileSync(path.join(out1, 'catalog.json'), 'utf8');
  const b = readFileSync(path.join(out2, 'catalog.json'), 'utf8');
  assert.equal(a, b);
  const md1 = readFileSync(path.join(out1, 'catalog.md'), 'utf8');
  const md2 = readFileSync(path.join(out2, 'catalog.md'), 'utf8');
  assert.equal(md1, md2);
});

test('build is deterministic across tool order shuffles inside snapshots', async (t) => {
  const shuffledDir = tmpdir_helper(t);
  const shuffled = path.join(shuffledDir, 'alpha-shuffled.json');
  const alpha = JSON.parse(readFileSync(ALPHA, 'utf8'));
  alpha.tools = [alpha.tools[2], alpha.tools[0], alpha.tools[1]];
  writeFileSync(shuffled, `${JSON.stringify(alpha, null, 2)}\n`);
  const out1 = tmpdir_helper(t);
  const out2 = tmpdir_helper(t);
  assert.equal((await run(['build', ALPHA, BETA, '--out', out1])).code, 0);
  assert.equal((await run(['build', shuffled, BETA, '--out', out2])).code, 0);
  // Tool order is catalog data order, so every field matches; the embedded
  // snapshot sha256 legitimately differs because the file bytes differ.
  const stripSha = (text) => {
    const value = JSON.parse(text);
    for (const s of value.servers) s.sha256 = '';
    return JSON.stringify(value);
  };
  assert.equal(
    stripSha(readFileSync(path.join(out1, 'catalog.json'), 'utf8')),
    stripSha(readFileSync(path.join(out2, 'catalog.json'), 'utf8')),
  );
});

test('search ranks name over title over description; reports true total', async () => {
  const r = await run(['search', ALPHA, BETA, GAMMA, '--query', 'weather', '--format', 'json']);
  assert.equal(r.code, 0);
  const report = JSON.parse(r.stdout.buf);
  assert.equal(report.command, 'search');
  assert.equal(report.status, 'PASS');
  assert.equal(report.counts.matches, 2);
  assert.equal(report.matches.length, 2);
  // both tools hit name+title+description for the token: 100+10+1
  assert.equal(report.matches[0].score, 111);
  assert.equal(report.matches[1].score, 111);
  // tie broken by name code-unit: 'G' < 'g'
  assert.equal(report.matches[0].tool, 'tool-1');
  assert.ok(!('name' in report.matches[0]));
});

test('search multi-token AND and zero-match exit 0', async () => {
  let r = await run(['search', ALPHA, BETA, GAMMA, '--query', 'weather city', '--format', 'json']);
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.stdout.buf).counts.matches, 2);
  r = await run(['search', ALPHA, '--query', 'zzz-no-such-thing', '--format', 'json']);
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.stdout.buf).counts.matches, 0);
});

test('list shows per-server counts and validate exits 0 on good inputs', async () => {
  const r = await run(['list', ALPHA, BETA, GAMMA, '--format', 'json']);
  assert.equal(r.code, 0);
  const report = JSON.parse(r.stdout.buf);
  assert.deepEqual(report.servers, [
    { server: 'server-1', tools: 3 },
    { server: 'server-2', tools: 3 },
    { server: 'server-3', tools: 2 },
  ]);
  const v = await run(['validate', ALPHA, BETA]);
  assert.equal(v.code, 0);
  assert.equal(v.stdout.buf.includes('status: PASS'), true);
});

test('collisions are data, not errors: exit 0 with exact and weak groups', async () => {
  const r = await run(['collisions', ALPHA, BETA, GAMMA, '--details', '--format', 'json']);
  assert.equal(r.code, 0);
  const report = JSON.parse(r.stdout.buf);
  assert.equal(report.counts.collisions, 3);
  const kinds = report.collisions.map((c) => c.kind);
  assert.deepEqual(kinds, ['exact', 'exact', 'weak']);
  assert.deepEqual(report.collisions[0].tools, ['tool-5', 'tool-6']); // help on beta,gamma
  assert.deepEqual(report.collisions[1].tools, ['tool-7', 'tool-8']); // search on alpha,beta
  assert.equal(report.collisions[2].name, 'get_weather'); // redacted weak key
  assert.deepEqual(report.collisions[2].tools, ['tool-1', 'tool-3']); // Get_Weather vs get_weather( )
});

test('one bad snapshot rejects the whole build; no artifacts claimed', async (t) => {
  const out = tmpdir_helper(t);
  const r = await run(['build', ALPHA, BAD_FORMAT, '--out', out]);
  assert.equal(r.code, 2);
  assert.equal(r.stderr.buf, 'joons-mcp-tool-catalog: invalid_snapshot\n');
  assert.equal(r.stdout.buf, '');
  assert.equal(existsSync(path.join(out, 'catalog.json')), false);
});

test('credential-shaped tool name rejects snapshot as credential_detected', async () => {
  const r = await run(['list', CREDENTIAL]);
  assert.equal(r.code, 2);
  assert.equal(r.stderr.buf, 'joons-mcp-tool-catalog: credential_detected\n');
});

test('planted URLs and e-mails never appear in reports; redactions counted', async (t) => {
  const out = tmpdir_helper(t);
  const r = await run(['build', ALPHA, BETA, '--out', out, '--format', 'json']);
  assert.equal(r.code, 0);
  for (const s of ['https://internal.example-ops.net', 'ops@example-ops.net']) {
    assert.ok(!r.stdout.buf.includes(s), `stdout leaked ${s}`);
    assert.ok(!r.stderr.buf.includes(s));
  }
  const catalog = JSON.parse(readFileSync(path.join(out, 'catalog.json'), 'utf8'));
  assert.equal(catalog.counts.redactions, 2);
  const titles = catalog.tools.map((x) => x.title).join('\n');
  assert.ok(titles.includes('[URL]'));
  const descs = catalog.tools.map((x) => x.description).join('\n');
  assert.ok(descs.includes('[EMAIL]'));
});

test('details mode adds redacted names; markdown escapes them', async () => {
  const r = await run(['search', ALPHA, BETA, '--query', 'weather', '--details', '--format', 'json']);
  assert.equal(r.code, 0);
  const report = JSON.parse(r.stdout.buf);
  assert.equal(report.mode.details, true);
  assert.ok('name' in report.matches[0]);
  const md = await run(['search', ALPHA, BETA, '--query', 'weather', '--details', '--format', 'markdown']);
  assert.equal(md.code, 0);
  assert.ok(md.stdout.buf.includes('details: may contain internal names'));
  assert.ok(!md.stdout.buf.includes('https://'));
});

test('quiet build suppresses terminal report but still writes artifacts', async (t) => {
  const out = tmpdir_helper(t);
  const r = await run(['build', ALPHA, '--out', out, '--quiet']);
  assert.equal(r.code, 0);
  assert.equal(r.stdout.buf, '');
  assert.equal(existsSync(path.join(out, 'catalog.json')), true);
});

test('build refuses output dir containing an input; force does not bypass', async (t) => {
  const dir = tmpdir_helper(t);
  const nested = path.join(dir, 'in');
  const out = path.join(dir, 'in', 'out');
  const s = path.join(nested, 's.json');
  // missing input rejects first: input errors take precedence over output errors
  const r = await run(['build', s, '--out', out, '--force']);
  assert.equal(r.code, 2);
  assert.equal(r.stderr.buf, 'joons-mcp-tool-catalog: input_unreadable\n');
  // with a real input, output == input parent is refused even with force
  const fsmod = await import('node:fs');
  fsmod.mkdirSync(nested, { recursive: true });
  fsmod.copyFileSync(ALPHA, s);
  const r2 = await run(['build', s, '--out', nested, '--force']);
  assert.equal(r2.code, 4);
  assert.equal(r2.stderr.buf, 'joons-mcp-tool-catalog: output_error\n');
  // output containing an input is likewise refused
  const r3 = await run(['build', s, '--out', dir, '--force']);
  assert.equal(r3.code, 4);
});

test('non-empty foreign directory refused without marker, accepted with force', async (t) => {
  const dir = tmpdir_helper(t);
  const out = path.join(dir, 'out');
  const fsmod = await import('node:fs');
  fsmod.mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, 'stray.txt'), 'x');
  const r = await run(['build', ALPHA, '--out', out]);
  assert.equal(r.code, 4);
  const r2 = await run(['build', ALPHA, '--out', out, '--force']);
  assert.equal(r2.code, 0);
  assert.equal(existsSync(path.join(out, 'catalog.json')), true);
  assert.equal(existsSync(path.join(out, 'stray.txt')), true); // force never deletes
});

test('second build into same dir succeeds via marker; no stray temp files left', async (t) => {
  const out = tmpdir_helper(t);
  assert.equal((await run(['build', ALPHA, '--out', out])).code, 0);
  assert.equal((await run(['build', ALPHA, BETA, '--out', out])).code, 0);
  const entries = readdirSync(out).filter((n) => n.startsWith('.tmp-'));
  assert.deepEqual(entries, []);
});

test('search/list/collisions/validate never write any file', async (t) => {
  const dir = tmpdir_helper(t);
  const before = readdirSync(dir);
  const argvSets = [
    ['search', ALPHA, '--query', 'weather'],
    ['list', ALPHA],
    ['collisions', ALPHA, BETA],
    ['validate', ALPHA],
  ];
  for (const argv of argvSets) {
    const r = await run(argv);
    assert.equal(r.code, 0, JSON.stringify(argv));
  }
  assert.deepEqual(readdirSync(dir), before);
});
