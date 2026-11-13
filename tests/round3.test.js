import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanForCredential } from '../src/security/credentials.js';
import { redactText } from '../src/security/redact.js';

const bin = fileURLToPath(new URL('../bin/joons-mcp-tool-catalog.js', import.meta.url));
const fixture = new URL('./fixtures/alpha.json', import.meta.url);
function setup(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'catalog-r3-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function cli(...args) { return spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' }); }
test('RR2-01 credential shapes and encoded forms through API and CLI', (t) => {
  const dir = setup(t);
  const snapshot = JSON.parse(readFileSync(fixture));
  const shapes = ['ghp_'+'a'.repeat(20), 'gho_'+'a'.repeat(20), 'ghu_'+'a'.repeat(20), 'github_pat_'+'a'.repeat(20), 'sk-'+'a'.repeat(16), 'AKIA'+'A'.repeat(17), 'xoxb-'+'a'.repeat(10), '-----BEGIN EC-TEST PRIVATE KEY-----', 'Bearer abc', 'eyJabc.def.ghi', 'password=12345678', 'secret: 12345678', '"token":"12345678"', encodeURIComponent('Bearer abc'), Buffer.from('Bearer abc').toString('base64'), Buffer.from('Bearer abc').toString('base64url'), 'Bearer\u0000 abc'];
  for (const shape of shapes) {
    assert.equal(scanForCredential(shape), true, shape);
    for (const field of shape.includes('\u0000') ? [] : ['server', 'tool']) {
      const value = structuredClone(snapshot);
      if (field === 'server') value.server.name = shape; else value.tools[0].name = shape;
      const file = path.join(dir, 'input.json'); writeFileSync(file, JSON.stringify(value));
      const result = cli('validate', file);
      assert.equal(result.status, 2, shape + ' ' + field);
      assert.equal(result.stderr, 'joons-mcp-tool-catalog: credential_detected\n');
    }
  }
});
test('RR2-02 encoded credentials removed from build artifacts', (t) => {
  const dir = setup(t); const snapshot = JSON.parse(readFileSync(fixture));
  const secret = Buffer.from('Bearer abc').toString('base64');
  snapshot.tools[0].description = secret;
  const file = path.join(dir, 'input.json'); writeFileSync(file, JSON.stringify(snapshot));
  const out = path.join(dir, 'out'); const result = cli('build', file, '--out', out);
  assert.equal(result.status, 0, result.stderr);
  const json = readFileSync(path.join(out, 'catalog.json'), 'utf8');
  const md = readFileSync(path.join(out, 'catalog.md'), 'utf8');
  assert.ok(!json.includes(secret)); assert.ok(!md.includes(secret));
  assert.ok(JSON.parse(json).counts.redactions >= 1);
});
test('RR2-03 closed stdout produces fixed output error', async () => {
  const child = spawn(process.execPath, [bin, 'list', fileURLToPath(fixture), '--format', 'json'], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.destroy(); let stderr = ''; child.stderr.setEncoding('utf8'); child.stderr.on('data', x => { stderr += x; });
  const code = await new Promise(resolve => child.on('close', resolve));
  assert.equal(code, 4); assert.equal(stderr, 'joons-mcp-tool-catalog: output_error\n');
});
test('RR2-04 two BOMs rejected', (t) => {
  const dir = setup(t); const file = path.join(dir, 'input.json');
  writeFileSync(file, Buffer.concat([Buffer.from([239,187,191,239,187,191]), readFileSync(fixture)]));
  const result = cli('validate', file); assert.equal(result.status, 2); assert.equal(result.stderr, 'joons-mcp-tool-catalog: invalid_json\n');
});
test('RR2-05 controls stripped and markdown has no CR', (t) => {
  assert.equal(redactText('a\nb\tc\rd'), 'abcd');
  const dir = setup(t); const snapshot = JSON.parse(readFileSync(fixture)); snapshot.tools[0].description = 'a\rb\nc\td';
  const file = path.join(dir, 'input.json'); writeFileSync(file, JSON.stringify(snapshot)); const out = path.join(dir, 'out');
  assert.equal(cli('build', file, '--out', out).status, 0);
  const md = readFileSync(path.join(out, 'catalog.md'), 'utf8'); assert.ok(!md.includes('\r'));
  assert.ok(JSON.parse(readFileSync(path.join(out, 'catalog.json'), 'utf8')).tools.some(tool => tool.description === 'abcd'));
});
test('RT2-01 internal format character remains in search token', () => {
  const result = cli('search', fileURLToPath(fixture), '--query', 'greet\u200btool', '--format', 'json');
  assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).counts.matches, 0);
});
