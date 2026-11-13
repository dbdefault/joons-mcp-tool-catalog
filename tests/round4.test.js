import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { redactText } from '../src/security/redact.js';
import { scanForCredential } from '../src/security/credentials.js';

const bin = fileURLToPath(new URL('../bin/joons-mcp-tool-catalog.js', import.meta.url));
const fixture = new URL('./fixtures/alpha.json', import.meta.url);
function setup(t) { const dir = mkdtempSync(path.join(tmpdir(), 'catalog-r4-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; }
function cli(...args) { return spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' }); }

test('RA3-001 marker positions and encodings in real build', t => {
  const dir = setup(t); const snapshot = JSON.parse(readFileSync(fixture));
  const encoded = ['Bearer%20abc', Buffer.from('Bearer abc').toString('base64'), Buffer.from('Bearer abc').toString('base64url')];
  const plants = encoded.flatMap(s => ['[MASKED]' + s, '[REDACTED]' + s, s + '[MASKED]', s + '[REDACTED]', s.slice(0, 4) + '[MASKED]' + s.slice(4)]);
  snapshot.tools = plants.map((s, i) => ({ name: 'tool' + i, title: s, description: s, inputSchema: {}, outputSchema: null, annotations: null }));
  snapshot.stats.toolCount = plants.length;
  const file = path.join(dir, 'in.json'); const out = path.join(dir, 'out'); writeFileSync(file, JSON.stringify(snapshot));
  const result = cli('build', file, '--out', out); assert.equal(result.status, 0, result.stderr);
  const json = readFileSync(path.join(out, 'catalog.json'), 'utf8'); const md = readFileSync(path.join(out, 'catalog.md'), 'utf8');
  for (const value of JSON.parse(json).tools) { assert.equal(scanForCredential(value.title), false); assert.equal(scanForCredential(value.description), false); }
  for (const secret of encoded) { assert.ok(!json.includes(secret)); assert.ok(!md.includes(secret)); }
});
test('RA3-001 seeded 600 scanner-positive combinations are sanitized', () => {
  let seed = 912837; const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  const secrets = ['Bearer abc', 'ghp_' + 'a'.repeat(20), 'gho_' + 'a'.repeat(20), 'ghu_' + 'a'.repeat(20), 'github_pat_' + 'a'.repeat(20), 'sk-' + 'a'.repeat(16), 'AKIA' + 'A'.repeat(16), 'xoxb-' + 'a'.repeat(10), '-----BEGIN EC-TEST PRIVATE KEY-----', 'password=12345678', 'secret: 12345678', '"token":"12345678"', 'eyJabc.def.ghi'];
  const markers = ['[MASKED]', '[REDACTED]', 'safe'];
  for (let i = 0; i < 600; i++) {
    const raw = secrets[next() % secrets.length]; const mode = Math.floor(i / secrets.length) % 4;
    const value = mode === 0 ? raw : mode === 1 ? encodeURIComponent(raw) : Buffer.from(raw).toString(mode === 2 ? 'base64' : 'base64url');
    const input = markers[next() % markers.length] + value + markers[next() % markers.length];
    const output = redactText(input); assert.equal(scanForCredential(output), false, `case ${i}`);
  }
});
test('RA3-002 code point boundaries through API and build', t => {
  const exact = 'a '.repeat(99) + 'a\u{1f600}';
  assert.equal(redactText(exact), exact); assert.equal(redactText('\u{1f600}'.repeat(150)), '\u{1f600}'.repeat(150));
  assert.equal(redactText(exact + 'b'), exact + '...');
  const dir = setup(t); const snapshot = JSON.parse(readFileSync(fixture)); snapshot.tools[0].description = exact + 'b';
  const file = path.join(dir, 'in.json'); const out = path.join(dir, 'out'); writeFileSync(file, JSON.stringify(snapshot));
  const result = cli('build', file, '--out', out); assert.equal(result.status, 0, result.stderr);
  assert.ok(JSON.parse(readFileSync(path.join(out, 'catalog.json'), 'utf8')).tools.some(v => v.description === exact + '...'));
  assert.ok(readFileSync(path.join(out, 'catalog.md'), 'utf8').isWellFormed());
});
test('RR3-02 hostile scanner scaling and real CLI latency', t => {
  function measure(s) { const start = performance.now(); for (let i = 0; i < 8; i++) scanForCredential(s); return performance.now() - start; }
  for (const part of ['-----BEGIN ', 'a', 'ghp_']) {
    measure(part.repeat(2000)); const small = measure(part.repeat(5000)); const large = measure(part.repeat(20000));
    assert.ok(large < small * 8 + 8, `${part}: ${small} -> ${large}`);
  }
  const dir = setup(t); const snapshot = JSON.parse(readFileSync(fixture)); snapshot.server.name = '-----BEGIN '.repeat(9000);
  const file = path.join(dir, 'in.json'); writeFileSync(file, JSON.stringify(snapshot)); const start = performance.now();
  const result = cli('validate', file); assert.equal(result.status, 0, result.stderr); assert.ok(performance.now() - start < 500);
});
test('RA3-003 limits document separates input rejection from search cap', () => {
  const text = readFileSync(new URL('../LIMITATIONS.md', import.meta.url), 'utf8');
  assert.match(text, /counts\.matches/); assert.match(text, /1,000[\s\S]{0,200}(emitt|return)/i);
});
