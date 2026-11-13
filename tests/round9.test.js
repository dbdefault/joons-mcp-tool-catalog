import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSnapshot } from '../src/input/snapshot.js';

const bin = fileURLToPath(new URL('../bin/joons-mcp-tool-catalog.js', import.meta.url));
const fixture = new URL('./fixtures/alpha.json', import.meta.url);
function setup(t) { const dir = mkdtempSync(path.join(tmpdir(), 'catalog-r9-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; }
function count(value) { if (value === null || typeof value !== 'object') return 1; return 1 + Object.values(value).reduce((n, v) => n + count(v), 0); }
function snapshotWith(schema) {
  const original = JSON.parse(readFileSync(fixture)); const { tools, ...rest } = original;
  const first = tools[0]; const { inputSchema, ...other } = first;
  return { ...rest, tools: [{ ...other, inputSchema: schema }] , stats: { ...original.stats, toolCount: 1 } };
}
test('RR8-01 exact node boundary in real API and CLI for wide and deep inputs', t => {
  const dir = setup(t);
  for (const deep of [false, true]) {
    const arrays = Array.from({ length: 5 }, () => []); let schema = arrays;
    if (deep) for (let i = 0; i < 35; i++) schema = { child: schema };
    const snapshot = snapshotWith(schema); const baseline = count(snapshot); let remaining = 500000 - baseline;
    for (const array of arrays) { const n = Math.min(100000, remaining); for (let i = 0; i < n; i++) array.push(i % 2); remaining -= n; }
    assert.equal(remaining, 0); assert.equal(count(snapshot), 500000);
    const start = performance.now(); assert.doesNotThrow(() => validateSnapshot(snapshot));
    const file = path.join(dir, 'in.json'); writeFileSync(file, JSON.stringify(snapshot));
    let result = spawnSync(process.execPath, [bin, 'validate', file, '--quiet'], { encoding: 'utf8', timeout: 12000 }); assert.equal(result.status, 0, result.stderr);
    arrays[4].push(true); assert.equal(count(snapshot), 500001);
    assert.throws(() => validateSnapshot(snapshot), e => e.kind === 'limit_exceeded');
    writeFileSync(file, JSON.stringify(snapshot)); result = spawnSync(process.execPath, [bin, 'validate', file, '--quiet'], { encoding: 'utf8', timeout: 12000 });
    assert.equal(result.status, 2); assert.equal(result.stderr, 'joons-mcp-tool-catalog: limit_exceeded\n');
    assert.ok(performance.now() - start < 20000);
  }
  const snapshot = snapshotWith(Array.from({ length: 5 }, () => Array(100000).fill(0)));
  assert.throws(() => validateSnapshot(snapshot), e => e.kind === 'limit_exceeded');
});
test('RT8-01 docs accurately state disclosure limits', () => {
  for (const name of ['README.md', 'SECURITY.md', 'docs/SECURITY.md', 'LIMITATIONS.md', 'docs/CLI.md']) {
    const text = readFileSync(new URL('../' + name, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /(?:paths|server names|personal data)[^.]{0,120}never appear in any output/i, name);
    assert.doesNotMatch(text, /(?:no paths in output|paths never appear|personal data never appears)/i, name);
    for (const expression of [/best.effort/i, /percent-encoded/i, /base32/i, /personal names/i, /human/i, /catalog\.json/i, /catalog\.md/i, /anonymization/i, /fixed safe\s+vocabulary/i, /sanitized/i, /UNC/i, /POSIX/i, /e-mail/i, /IPv4/i, /Bearer\/JWT/i, /opaque/i, /base64/i, /hex/i, /reversed/i, /entity/i]) assert.match(text, expression, name);
  }
  const ko = readFileSync(new URL('../README.ko.md', import.meta.url), 'utf8');
  for (const part of ['\uc0ac\ub78c', '\uc775\uba85\ud654', '\uacbd\ub85c', 'base32', 'catalog.json', 'percent']) assert.ok(ko.includes(part), part);
  assert.doesNotMatch(ko, /\uc11c\ubc84 \uc774\ub984 \uc790\uccb4\ub294 \uc5b4\ub5a4 \ucd9c\ub825\uc5d0\ub3c4\s*\uc808\ub300 \ub098\ud0c0\ub098\uc9c0/);
});
test('RT8-01 exact names and encoded paths can survive real build', t => {
  const dir = setup(t); const snapshot = JSON.parse(readFileSync(fixture)); snapshot.tools[0].name = '/Users/alice/file'; snapshot.tools[0].description = 'C:%5CUsers%5CAlice%5Cfile';
  const file = path.join(dir, 'in.json'); const out = path.join(dir, 'out'); writeFileSync(file, JSON.stringify(snapshot));
  const result = spawnSync(process.execPath, [bin, 'build', file, '--out', out], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
  const catalog = JSON.parse(readFileSync(path.join(out, 'catalog.json'), 'utf8'));
  assert.ok(catalog.tools.some(v => v.name === '/Users/alice/file' && v.description === 'C:%5CUsers%5CAlice%5Cfile'));
});
