import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as api from '../src/index.js';

const fixture = new URL('./fixtures/alpha.json', import.meta.url);
const snapshot = () => JSON.parse(readFileSync(fixture));
function fails(value) { assert.throws(() => api.validateSnapshot(value), e => e.kind === 'invalid_snapshot'); }
test('RA9-001 hidden symbol and array accessor shapes reject without invocation', () => {
  let calls = 0; const getter = () => { calls++; return null; };
  for (const name of ['label', 'server', 'tools']) {
    const value = snapshot(); Object.defineProperty(value, name, { get: getter, configurable: true, enumerable: false }); fails(value);
  }
  for (const create of [
    () => Object.defineProperty({}, 'hidden', { get: getter, enumerable: false }),
    () => Object.defineProperty({}, 'setter', { set() { calls++; }, enumerable: true }),
    () => Object.defineProperty({}, Symbol('hidden'), { get: getter, enumerable: true }),
    () => Object.defineProperty([], 'extra', { get: getter, enumerable: true }),
    () => Object.assign([], { extra: 1 }),
    () => Array(1),
    () => Object.defineProperty({}, 'hidden', { value: 1, enumerable: false }),
  ]) { const value = snapshot(); value.tools[0].inputSchema = create(); fails(value); }
  const tools = snapshot(); Object.defineProperty(tools.tools, 'extra', { get: getter, enumerable: true }); fails(tools);
  const nested = snapshot(); Object.defineProperty(nested.server, 'name', { get: getter, enumerable: false }); fails(nested);
  assert.equal(calls, 0);
});
test('RA9-001 plain null prototypes and shared acyclic JSON remain accepted', () => {
  const value = snapshot(); const child = Object.assign(Object.create(null), { allowed: 1 });
  value.tools[0].inputSchema = { left: child, right: child };
  assert.doesNotThrow(() => api.validateSnapshot(value));
});
test('RA9-001 repeated acyclic subtrees count toward the expanded node cap', () => {
  const value = snapshot(); let branch = { leaf: 1 };
  for (let i = 0; i < 20; i++) branch = { left: branch, right: branch };
  value.tools[0].inputSchema = branch;
  assert.throws(() => api.validateSnapshot(value), e => e.kind === 'limit_exceeded');
});
test('RA9-001 exotic objects and proxies are rejected without traps', () => {
  let traps = 0;
  class Custom {}
  class ArraySubclass extends Array {}
  const cases = [new Date(), new Map(), new Set(), /a/, new Uint8Array(1), () => 1, 1n, Symbol('x'), new Custom(), Object.create({ x: 1 }), new ArraySubclass(), new Proxy({}, { ownKeys() { traps++; return []; } })];
  for (const item of cases) { const value = snapshot(); value.tools[0].inputSchema = item; fails(value); }
  assert.equal(traps, 0);
});
test('RA9-001 public object-taking APIs reject hostile getters', () => {
  const calls = [];
  const hostile = () => Object.defineProperty({}, 'name', { enumerable: true, get() { calls.push('getter'); return 'x'; } });
  const cases = [
    () => api.mergeSnapshots([hostile()]), () => api.listServers([hostile()]),
    () => api.findCollisions([hostile()]), () => api.searchTools([hostile()], 'x'),
    () => api.makeCatalog('build', hostile()), () => api.makeReport('list', hostile()),
    () => api.renderCatalogJson(hostile()), () => api.renderReportJson(hostile()),
    () => api.renderReportTerminal(hostile()), () => api.renderCatalogMarkdown(hostile()), () => api.renderReportMarkdown(hostile()),
    () => api.parseArgs([hostile()]), () => api.redactText('x', hostile()),
    () => api.main([], hostile()), () => api.readSnapshotFile(hostile()), () => api.scanForCredential(hostile()),
  ];
  for (const call of cases) assert.throws(call, e => e.kind === 'invalid_input');
  assert.deepEqual(calls, []);
});
test('RA9-002 English and Korean descriptions match markdown output', () => {
  const en = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const ko = readFileSync(new URL('../README.ko.md', import.meta.url), 'utf8');
  assert.match(en, /catalog\.md[^\n]*ordinals and counts[^\n]*omits names, titles and descriptions/i);
  assert.match(ko, /catalog\.md[^\n]*\ubc88\ud638\uc640 \uac1c\uc218[^\n]*\uc774\ub984, \uc81c\ubaa9, \uc124\uba85/);
  assert.doesNotMatch(ko, /\uac19\uc740 \ub0b4\uc6a9\uc758 \ub9c8\ud06c\ub2e4\uc6b4/);
});
