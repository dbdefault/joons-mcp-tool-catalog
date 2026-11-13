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
const cli = (...args) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' });
function setup(t) { const dir = mkdtempSync(path.join(tmpdir(), 'catalog-r8-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; }
test('path starts replace the field remainder via API and real build', t => {
  const cases = [['/home/ user/file','[PATH]'], ['/Users/ Alice Smith/file','[PATH]'], ['/home/\u00a0user/file','[PATH]'], ['/ x/y','/ x/y'], ['see /home/ me/x trailing words','see [PATH]'], ['see /home/ me/x https://host/end','see [PATH]'], ['see https://host/end /home/ me/x','see [URL] [PATH]'], ['C:\\single','[PATH]'], ['a/b and/or 1/2','a/b and/or 1/2']];
  for (const [input, expected] of cases) assert.equal(redactText(input), expected, input);
  const dir = setup(t); const snapshot = JSON.parse(readFileSync(fixture));
  snapshot.tools = cases.map(([input], i) => ({ name: 'tool' + i, title: input, description: null, inputSchema: {}, outputSchema: null, annotations: null })); snapshot.stats.toolCount = cases.length;
  const file = path.join(dir, 'in.json'); const out = path.join(dir, 'out'); writeFileSync(file, JSON.stringify(snapshot)); const result = cli('build', file, '--out', out); assert.equal(result.status, 0, result.stderr);
  const artifact = JSON.parse(readFileSync(path.join(out, 'catalog.json'), 'utf8'));
  for (const [i, [, expected]] of cases.entries()) assert.equal(artifact.tools.find(x => x.name === 'tool' + i).title, expected);
  assert.equal(artifact.counts.redactions, cases.filter(([a,b]) => a !== b).length);
});
test('unbounded credential prefixes and malformed percent variants through real CLI', t => {
  const values = ['%Zsecret%3Dabcdefgh','%ZZBearer%20abc','%G%42earer%20abc','%%Bearer%20abc','%2Zpassword%3Dxyz12345','xBearer abc','Zpassword: abcdefgh','Zsecret=abcdefgh','prefixghp_' + 'a'.repeat(20)];
  const dir = setup(t); const snapshot = JSON.parse(readFileSync(fixture));
  for (const [i, value] of values.entries()) {
    assert.equal(scanForCredential(value), true, value); assert.ok(!redactText(value).includes(value), value);
    snapshot.server.name = value; const file = path.join(dir, 'in.json'); writeFileSync(file, JSON.stringify(snapshot));
    const result = cli('validate', file); assert.equal(result.status, 2, value); assert.equal(result.stderr, 'joons-mcp-tool-catalog: credential_detected\n');
    snapshot.server.name = 'safe'; snapshot.tools[0].description = value; writeFileSync(file, JSON.stringify(snapshot)); const out = path.join(dir, 'out' + i);
    const built = cli('build', file, '--out', out); assert.equal(built.status, 0, built.stderr); const resultText = readFileSync(path.join(out, 'catalog.json'), 'utf8'); assert.ok(!resultText.includes(value)); assert.ok(JSON.parse(resultText).counts.redactions > 0);
  }
});
