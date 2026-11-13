import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanForCredential } from '../src/security/credentials.js';
import { redactText } from '../src/security/redact.js';
const bin = fileURLToPath(new URL('../bin/joons-mcp-tool-catalog.js', import.meta.url));
const fixture = new URL('./fixtures/alpha.json', import.meta.url);
test('RA4-001 all encoded candidates are examined or rejected at input limit', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'catalog-r5-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const encodings = [Buffer.from('Bearer abc').toString('base64'), Buffer.from('Bearer abc').toString('base64url'), 'Bearer%20abc'];
  for (const count of [4096, 4097, 20000]) for (const encoded of encodings) {
    const text = 'YWJjZGVmZ2g '.repeat(count) + encoded;
    assert.equal(scanForCredential(text), true, `${count} ${encoded}`);
    assert.ok(!redactText(text).includes(encoded));
    const snapshot = JSON.parse(readFileSync(fixture)); snapshot.server.name = text;
    const file = path.join(dir, 'in.json'); writeFileSync(file, JSON.stringify(snapshot));
    const result = spawnSync(process.execPath, [bin, 'validate', file], { encoding: 'utf8' });
    assert.equal(result.status, 2); assert.equal(result.stderr, `joons-mcp-tool-catalog: ${text.length > 100000 ? 'limit_exceeded' : 'credential_detected'}\n`);
    if (text.length <= 100000) {
      snapshot.server.name = 'safe'; snapshot.tools[0].description = text; writeFileSync(file, JSON.stringify(snapshot));
      const out = path.join(dir, `out-${count}-${encodings.indexOf(encoded)}`);
      const build = spawnSync(process.execPath, [bin, 'build', file, '--out', out], { encoding: 'utf8' });
      assert.equal(build.status, 0, build.stderr);
      assert.ok(!readFileSync(path.join(out, 'catalog.json'), 'utf8').includes(encoded));
      assert.ok(!readFileSync(path.join(out, 'catalog.md'), 'utf8').includes(encoded));
    }
  }
});
test('RA4-003 both READMEs document terminator and quiet output', () => {
  const en = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const ko = readFileSync(new URL('../README.ko.md', import.meta.url), 'utf8');
  assert.match(en, /`--`[^\n]*(?:usage error|rejected)/i); assert.match(en, /quiet[^\n]*(?:nothing|no output)/i);
  assert.match(ko, /`--`[^\n]*(?:\uc0ac\uc6a9\ubc95 \uc624\ub958|\uac70\ubd80)/); assert.match(ko, /quiet[^\n]*(?:\uc544\ubb34\uac83\ub3c4|\ucd9c\ub825\ud558\uc9c0)/);
});
test('RA4-002 JWT after preceding dotted segments remains detected', () => {
  assert.equal(scanForCredential('prefix.other.eyJabc.def.ghi'), true);
  assert.equal(redactText('prefix.other.eyJabc.def.ghi').includes('eyJabc.def.ghi'), false);
});
