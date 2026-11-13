import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, symlinkSync, linkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const bin = path.join(root, 'bin', 'joons-mcp-tool-catalog.js');
const fixture = readFileSync(path.join(root, 'tests', 'fixtures', 'alpha.json'));
function setup(t) { const dir = mkdtempSync(path.join(tmpdir(), 'catalog-r13-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; }
function run(args) { return spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', timeout: 15000 }); }
function refused(input, out) {
  const before = readFileSync(input);
  const r = run(['build', input, '--out', out, '--force']);
  assert.equal(r.status, 4, r.stderr); assert.equal(r.stderr, 'joons-mcp-tool-catalog: output_error\n');
  assert.equal(r.stdout, ''); assert.deepEqual(readFileSync(input), before);
  assert.ok(!readdirSync(out).some(x => x === 'catalog.json' || x === 'catalog.md' || x === '.joons-mcp-tool-catalog-output'));
}
for (const kind of ['junction', 'symlink']) {
  test(`real CLI refuses input directory ${kind} aliases`, t => {
    if (kind === 'junction' && process.platform !== 'win32') return t.skip('junctions are Windows-only');
    const dir = setup(t), out = path.join(dir, 'out'), nested = path.join(out, 'nested');
    mkdirSync(out); mkdirSync(nested); writeFileSync(path.join(out, 'source.json'), fixture); writeFileSync(path.join(nested, 'source.json'), fixture);
    const alias = path.join(dir, 'alias');
    try { symlinkSync(out, alias, kind === 'junction' ? 'junction' : 'dir'); }
    catch (e) { if (kind === 'symlink' && e.code === 'EPERM') return t.skip('symlinks unavailable (permissions)'); throw e; }
    refused(path.join(alias, 'source.json'), out);
    refused(path.join(alias, 'nested', 'source.json'), out);
    const middle = path.join(dir, 'middle'); mkdirSync(middle);
    symlinkSync(nested, path.join(middle, 'alias'), kind === 'junction' ? 'junction' : 'dir');
    refused(path.join(middle, 'alias', 'source.json'), out);
    const separate = path.join(dir, 'other.json'); writeFileSync(separate, fixture);
    const multi = run(['build', separate, path.join(alias, 'source.json'), '--out', out, '--force']);
    assert.equal(multi.status, 4, multi.stderr); assert.equal(multi.stderr, 'joons-mcp-tool-catalog: output_error\n');
  });
}
test('real CLI refuses an input hardlinked inside the output directory', t => {
  const dir = setup(t), out = path.join(dir, 'out'), input = path.join(dir, 'source.json');
  mkdirSync(out); mkdirSync(path.join(out, 'nested')); writeFileSync(input, fixture); linkSync(input, path.join(out, 'nested', 'copy.json'));
  refused(input, out);
});
test('shipped source comments do not advertise a supported library API', () => {
  function walk(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]); }
  for (const folder of ['src', 'bin']) for (const file of walk(path.join(root, folder))) assert.doesNotMatch(readFileSync(file, 'utf8'), /public library|stable api|public api|library surface/i, file);
});
test('CLI server entries and documentation distinguish details mode', t => {
  const dir = setup(t);
    const input = path.join(dir, 'source.json'); writeFileSync(input, fixture);
    for (const details of [false, true]) {
      const result = run(['list', input, '--format', 'json', ...(details ? ['--details'] : [])]);
      assert.equal(result.status, 0, result.stderr);
      const report = JSON.parse(result.stdout);
      for (const server of report.servers) { assert.match(server.server, /^server-\d+$/); assert.equal(typeof server.tools, 'number'); if (details) assert.equal(server.name, ''); else assert.equal(Object.hasOwn(server, 'name'), false); }
      assert.ok(!result.stdout.includes(JSON.parse(fixture).server.name));
    }
    for (const format of ['terminal', 'markdown']) {
      const plain = run(['list', input, '--format', format]); const detailed = run(['list', input, '--format', format, '--details']);
      assert.equal(plain.status, 0, plain.stderr); assert.equal(detailed.status, 0, detailed.stderr);
      assert.ok(!plain.stdout.includes(JSON.parse(fixture).server.name)); assert.ok(!detailed.stdout.includes(JSON.parse(fixture).server.name));
      assert.match(detailed.stdout, format === 'terminal' ? /server: server-1 tools=\d+ name=\n/ : /- server-1: \d+ \(\)/);
    }
    for (const doc of ['docs/CLI.md', 'docs/SECURITY.md', 'SECURITY.md']) { const text = readFileSync(path.join(root, doc), 'utf8'); assert.match(text, /server entries[^\n]*empty string/i, doc); assert.match(text, /server entries[^\n]*no input-derived server name/i, doc); }
});
