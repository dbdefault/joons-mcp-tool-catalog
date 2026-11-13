import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanForCredential, scanNormalized, replaceJwt, percentDecoded } from '../src/security/credentials.js';
import { redactText, redactPaths } from '../src/security/redact.js';
import { trimBoundary } from '../src/security/trim.js';
import { weakKey } from '../src/catalog/collisions.js';

const bin = fileURLToPath(new URL('../bin/joons-mcp-tool-catalog.js', import.meta.url));
const fixture = new URL('./fixtures/alpha.json', import.meta.url);
const families = ['eyJ', 'eyJ.', 'AKIA', 'ghp_', 'sk-', 'Bearer ', '-----BEGIN ', 'a', 'a=', '%4', '%41%', '%', '%Z', 'C:\\ ', '\\\\', '~/', '&#', '&#x', '\u200b', '\u0301', '\ufdfa', ' ', 'a ', '/a/', 'C:/a/', 'a@'];
const sample = (part, n) => part.repeat(Math.ceil(n / part.length)).slice(0, n);
test('RA4-002 interior whitespace does not make trim quadratic', () => {
  const time = n => { const text = 'a' + ' '.repeat(n) + 'x'; const start = performance.now(); weakKey(text); return performance.now() - start; };
  time(10000); const small = time(20000); const large = time(80000);
  assert.ok(small < 5 || large < small * 8 + 10, `${small} -> ${large}`);
});
test('RA4-002 hostile scanning and normalization scaling plus real CLI', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'catalog-scale-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const part of families) {
    for (const fn of [scanForCredential, scanNormalized, redactText, redactPaths, percentDecoded, weakKey, trimBoundary, s => replaceJwt(s, '[REDACTED]')]) {
      const times = [];
      for (const n of [10000, 20000, 40000, 80000]) {
        const value = sample(part, n); const start = performance.now(); fn(value); times.push(performance.now() - start);
      }
      if (times[1] >= 5) assert.ok(times[3] < times[1] * 8 + 10, `${fn.name} ${JSON.stringify(part)} ${times}`);
    }
    const snapshot = JSON.parse(readFileSync(fixture)); snapshot.server.name = sample(part, 99000);
    const file = path.join(dir, 'in.json'); writeFileSync(file, JSON.stringify(snapshot)); const start = performance.now();
    const result = spawnSync(process.execPath, [bin, 'validate', file, '--quiet'], { encoding: 'utf8', timeout: 1500 });
    assert.equal(result.error, undefined, JSON.stringify(part)); assert.ok([0, 2].includes(result.status));
    assert.ok(performance.now() - start < 1500, JSON.stringify(part));
  }
});
