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
const whitespace = [0x09,0x0a,0x0b,0x0c,0x0d,0x20,0x85,0xa0,0x1680,0x2000,0x2001,0x2002,0x2003,0x2004,0x2005,0x2006,0x2007,0x2008,0x2009,0x200a,0x2028,0x2029,0x202f,0x205f,0x3000].map(x => String.fromCodePoint(x));
function setup(t) { const dir = mkdtempSync(path.join(tmpdir(), 'catalog-r7-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; }
function build(t, tools) {
  const dir = setup(t); const snapshot = JSON.parse(readFileSync(fixture)); snapshot.tools = tools; snapshot.stats.toolCount = tools.length;
  const file = path.join(dir, 'in.json'); const out = path.join(dir, 'out'); writeFileSync(file, JSON.stringify(snapshot));
  const result = spawnSync(process.execPath, [bin, 'build', file, '--out', out], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
  return JSON.parse(readFileSync(path.join(out, 'catalog.json'), 'utf8'));
}
const tool = (name, value) => ({ name, title: value, description: null, inputSchema: {}, outputSchema: null, annotations: null });
test('RT6-01 Unicode whitespace and UTF-8 percent credential encodings', t => {
  const values = [];
  for (const ws of whitespace) {
    for (const raw of ['Bearer' + ws + 'abc', 'secret:' + ws + 'abcdefgh']) {
      for (const input of [raw, encodeURIComponent(raw), Buffer.from(raw).toString('base64'), '%zz' + encodeURIComponent(raw)]) {
        assert.equal(scanForCredential(input), true, JSON.stringify(input));
        assert.ok(!redactText(input).includes(input), JSON.stringify(input));
        if (/[\u0009-\u000d\u0085\u2028\u2029]/u.test(raw) && input === raw) assert.ok(!redactText(input).includes('abc'), JSON.stringify(input));
        values.push(input);
      }
    }
  }
  const artifact = build(t, values.map((value, i) => tool('credential' + i, value)));
  assert.equal(artifact.counts.redactions, values.length);
  for (const item of artifact.tools) assert.ok(!values.includes(item.title));
});
test('RA6-002 URL pass preserves surrounding text and precedes paths', t => {
  const values = ['hello file://host/path bye','hello https://host/path bye','hello http://host/path bye','hello ftp://host/path bye'];
  for (const value of values) assert.equal(redactText(value), 'hello [URL] bye');
  assert.equal(redactText('before /first folder/user/file https://host/x tail'), 'before [PATH]');
  assert.equal(redactText('before https://host/x /first folder/user/file'), 'before [URL] [PATH]');
  const artifact = build(t, values.map((v, i) => tool('url' + i, v)));
  assert.equal(artifact.counts.redactions, values.length); for (const item of artifact.tools) assert.equal(item.title, 'hello [URL] bye');
  for (const text of ['a/b', 'and/or', '2026/11/13']) assert.equal(redactText(text), text);
});
test('RA6-001 path form, spacing, length and context matrix through API and build', t => {
  for (const value of ['/My Documents/alice', '/first folder/user/file', '/Users/Some Name/x', '/Program Files/x']) assert.equal(redactText(value), '[PATH]');
  const forms = ['/','~/', 'C:\\', 'C:/', '\\\\host\\', '../', 'file://host/'];
  const prefixes = ['', 'word ', '(', '[MASKED] ', '[REDACTED] ', 'https://host/x ', ''];
  const values = []; const expectedValues = [];
  for (const form of forms) for (let spacing = 0; spacing < 7; spacing++) for (const length of [10, 300, 3000]) for (let p = 0; p < prefixes.length; p++) {
    const sep = form.includes('\\') ? '\\' : '/';
    let segments = ['first', 'middle', 'last']; if (spacing < 3) segments[spacing] += ' spaced';
    if (spacing === 5) segments[1] = ' ' + segments[1];
    if (spacing === 6) segments[1] = '\u00a0' + segments[1];
    const fileUrl = form.startsWith('file:'); if (fileUrl) segments = segments.map(x => x.replaceAll(' ', '%20').replaceAll('\u00a0', '%C2%A0'));
    const value = prefixes[p] + form + segments[0] + sep + segments[1] + sep + segments[2] + 'x'.repeat(length) + 'SECRET' + (spacing === 3 ? ' trailing text' : '') + (p === 6 ? ' https://host/end' : '');
    const expectedPrefix = p === 5 ? '[URL] ' : prefixes[p];
    const expected = expectedPrefix + (fileUrl ? '[URL]' + (spacing === 3 ? ' trailing text' : '') + (p === 6 ? ' [URL]' : '') : '[PATH]');
    const output = redactText(value); assert.equal(output, expected, value.slice(0, 100));
    values.push(value); expectedValues.push(expected);
  }
  const artifact = build(t, values.map((value, i) => tool('matrix' + i, value)));
  assert.equal(artifact.counts.redactions, values.length);
  for (const item of artifact.tools) assert.equal(item.title, expectedValues[Number(item.name.slice(6))], item.tool);
});
