import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanForCredential } from '../src/security/credentials.js';
import { redactText } from '../src/security/redact.js';
import { validateSnapshot } from '../src/input/snapshot.js';
const bin = fileURLToPath(new URL('../bin/joons-mcp-tool-catalog.js', import.meta.url));
const fixture = new URL('./fixtures/alpha.json', import.meta.url);
function setup(t) { const dir = mkdtempSync(path.join(tmpdir(), 'catalog-r6-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; }
function cli(...args) { return spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' }); }
test('RA5-001 malformed and doubled percent encodings are refused and redacted', t => {
  const cases = ['%ZZBearer%20abc', '%zz%42%65%61%72%65%72%20%61%62%63', 'Bearer%20abc%zz', 'safe%zzBearer%20abc', '%ffBearer%20abc', '%2542%2565%2561%2572%2565%2572%2520abc', 'YWJjZGVmZ2g %ZZBearer%20abc'];
  const dir = setup(t);
  for (const [i, value] of cases.entries()) {
    assert.equal(scanForCredential(value), true, value);
    const snapshot = JSON.parse(readFileSync(fixture)); snapshot.server.name = value;
    assert.throws(() => validateSnapshot(snapshot), e => e.kind === 'credential_detected');
    const file = path.join(dir, 'in.json'); writeFileSync(file, JSON.stringify(snapshot));
    const result = cli('validate', file); assert.equal(result.status, 2); assert.equal(result.stderr, 'joons-mcp-tool-catalog: credential_detected\n');
    assert.ok(!redactText(value).includes(value));
    snapshot.server.name = 'safe'; snapshot.tools[0].description = value; writeFileSync(file, JSON.stringify(snapshot));
    const out = path.join(dir, 'out' + i); const build = cli('build', file, '--out', out); assert.equal(build.status, 0, build.stderr);
    for (const name of ['catalog.json', 'catalog.md']) assert.ok(!readFileSync(path.join(out, name), 'utf8').includes(value));
  }
});
test('RA5-002 paths of arbitrary length and spaces redacted in real build', t => {
  const dir = setup(t); const snapshot = JSON.parse(readFileSync(fixture));
  const values = ['C:/Program Files/secret.txt', '\\\\host\\' + '\uac00'.repeat(256) + '\\file', '~/' + '#'.repeat(511) + 'SECRET_SUFFIX', 'C:\\Users\\Some Name\\SECRET', '../a/SECRET', '..\\a\\SECRET', 'file:///a/SECRET', '/a/b/SECRET', 'one C:/a/SECRET and /b/SECRET'];
  for (const n of [1000, 10000, 90000]) values.push('~/'+ '#'.repeat(n) + 'SECRET');
  snapshot.tools = values.map((s, i) => ({ name: 'tool' + i, title: s, description: s, inputSchema: {}, outputSchema: null, annotations: null })); snapshot.stats.toolCount = values.length;
  for (const value of values) { const out = redactText(value); assert.ok(out.includes(value.startsWith('file://') ? '[URL]' : '[PATH]'), value.slice(0, 60)); assert.ok(!out.includes('SECRET')); assert.ok(!out.includes('Program Files')); assert.ok(!out.includes('\\\\host')); }
  const file = path.join(dir, 'in.json'); writeFileSync(file, JSON.stringify(snapshot)); const out = path.join(dir, 'out'); const result = cli('build', file, '--out', out); assert.equal(result.status, 0, result.stderr);
  for (const name of ['catalog.json', 'catalog.md']) { const resultText = readFileSync(path.join(out, name), 'utf8'); assert.ok(!resultText.includes('SECRET')); assert.ok(!resultText.includes('Program Files')); assert.ok(!resultText.includes('\\\\host')); }
});
test('RA5-002 seeded 500 path suffixes cannot survive', () => {
  let seed = 275341; const next = () => seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  const prefixes = ['C:/Program Files/', 'D:\\Some Name\\', '\\\\host\\share\\', '/var/log/', '~/', '..\\dir\\', 'file:///tmp/'];
  for (let i = 0; i < 500; i++) {
    const value = 'before ' + prefixes[next() % prefixes.length] + '#'.repeat(next() % 1000) + 'SECRET' + i;
    assert.ok(!redactText(value).includes('SECRET'), `case ${i}`);
  }
});
