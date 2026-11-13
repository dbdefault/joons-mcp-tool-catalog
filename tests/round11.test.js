import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import * as api from '../src/index.js';

const snapshot = () => JSON.parse(readFileSync(new URL('./fixtures/alpha.json', import.meta.url), 'utf8'));
test('returns a frozen registered copy and rejects raw or cloned snapshots', () => {
  const raw = snapshot();
  const inert = api.validateSnapshot(raw);
  assert.notEqual(inert, raw);
  assert.equal(Object.getPrototypeOf(inert), null);
  assert.ok(Object.isFrozen(inert) && Object.isFrozen(inert.tools));
  assert.doesNotThrow(() => api.mergeSnapshots([inert]));
  for (const value of [raw, Object.freeze(snapshot()), structuredClone(inert)]) {
    assert.throws(() => api.mergeSnapshots([value]), e => e.kind === 'invalid_input');
  }
});
test('inherited getters are never invoked during admission or rejection', () => {
  const raw = snapshot(); let calls = 0;
  try {
    Object.defineProperty(Object.prototype, 'server', { configurable: true, get() { calls++; } });
    assert.throws(() => api.validateSnapshot({}), e => e.kind === 'invalid_snapshot');
    assert.throws(() => api.mergeSnapshots([{}]), e => e.kind === 'invalid_input');
    assert.doesNotThrow(() => api.validateSnapshot(raw));
    assert.equal(calls, 0);
  } finally { delete Object.prototype.server; }
});
test('exact per-snapshot depth boundary survives merge', () => {
  const raw = snapshot(); let schema = 0;
  for (let i = 0; i < 61; i++) schema = [schema];
  raw.tools[0].inputSchema = schema;
  assert.doesNotThrow(() => api.mergeSnapshots([api.validateSnapshot(raw)]));
  raw.tools[0].inputSchema = [schema];
  assert.throws(() => api.validateSnapshot(raw), e => e.kind === 'limit_exceeded');
});
test('derived functions reject forgeries before accessing properties', () => {
  let calls = 0; const hostile = Object.defineProperty({}, 'tools', { get() { calls++; } });
  const callsToApi = [
    () => api.findCollisions(hostile), () => api.searchTools(hostile, 'x'),
    () => api.listServers(hostile), () => api.makeCatalog('build', hostile),
    () => api.makeReport('list', hostile), () => api.renderCatalogJson(hostile),
    () => api.renderReportJson(hostile), () => api.renderReportTerminal(hostile),
    () => api.renderCatalogMarkdown(hostile), () => api.renderReportMarkdown(hostile),
  ];
  for (const call of callsToApi) assert.throws(call, e => e.kind === 'invalid_input');
  assert.equal(calls, 0);
});
test('per-snapshot node limit and raw over-limit rejection', () => {
  const raw = snapshot();
  const parts = Array.from({ length: 5 }, () => []);
  raw.tools[0].inputSchema = parts;
  const count = value => value && typeof value === 'object' ? 1 + Object.values(value).reduce((sum, item) => sum + count(item), 0) : 1;
  let left = 500000 - count(raw);
  for (const part of parts) { const n = Math.min(left, 100000); for (let i = 0; i < n; i++) part.push(0); left -= n; }
  assert.equal(left, 0);
  const inert = api.validateSnapshot(raw);
  assert.doesNotThrow(() => api.mergeSnapshots([inert]));
  parts[4].push(0);
  assert.throws(() => api.validateSnapshot(raw), e => e.kind === 'limit_exceeded');
  assert.throws(() => api.mergeSnapshots([raw]), e => e.kind === 'invalid_input');
});
test('public pipeline produces registered values for rendering', () => {
  const merged = api.mergeSnapshots([api.validateSnapshot(snapshot())]);
  assert.ok(Object.isFrozen(merged.tools));
  assert.doesNotThrow(() => api.findCollisions(merged.tools));
  assert.doesNotThrow(() => api.searchTools(merged.tools, 'x'));
  const report = api.makeReport('list', merged);
  const catalog = api.makeCatalog('build', merged);
  assert.equal(typeof api.renderReportJson(report), 'string');
  assert.equal(typeof api.renderCatalogJson(catalog), 'string');
  assert.throws(() => api.renderReportJson(structuredClone(report)), e => e.kind === 'invalid_input');
});
test('English and Korean documentation states the CLI boundary', () => {
  for (const name of ['README.md', 'ARCHITECTURE.md', 'SECURITY.md', 'LIMITATIONS.md']) {
    const content = readFileSync(new URL('../' + name, import.meta.url), 'utf8');
    assert.match(content, /not a supported library/i); assert.match(content, /in-process/i);
  }
  const korean = readFileSync(new URL('../README.ko.md', import.meta.url), 'utf8');
  assert.match(korean, /\uba85\ub839\uc904/); assert.match(korean, /\uc9c0\uc6d0\ud558\ub294 \ub77c\uc774\ube0c\ub7ec\ub9ac\uac00 \uc544\ub2d9\ub2c8\ub2e4/);
});
test('prototype getters do not run in a separate process', () => {
  const script = `
    import * as api from './src/index.js';
    import { readFileSync } from 'node:fs';
    import { stat, open } from 'node:fs/promises';
    const raw = JSON.parse(readFileSync('./tests/fixtures/alpha.json'));
    void process.stdout; void process.stderr;
    let hits = 0; let failure = ''; let trace = '';
    const get = () => { hits++; trace += String(new Error().stack); return undefined; };
    try {
      for (const key of ['server', 'tools', 'name']) Object.defineProperty(Object.prototype, key, { configurable: true, get });
      Object.defineProperty(Array.prototype, '0', { configurable: true, get, set(value) { Object.defineProperty(this, '0', { value, writable: true, configurable: true, enumerable: true }); } });
      const inert = api.validateSnapshot(raw);
      const calls = [() => api.validateSnapshot({}), () => api.mergeSnapshots([{}]), () => api.findCollisions({}), () => api.searchTools({}, 'x'), () => api.makeCatalog('build', {}), () => api.makeReport('list', {})];
      for (let i = 0; i < calls.length; i++) { try { calls[i](); failure = 'accepted'; } catch (e) { if (e.kind !== (i === 0 ? 'invalid_snapshot' : 'invalid_input')) failure = 'wrong kind'; } }
      api.mergeSnapshots([inert]);
      try { await stat('./tests/fixtures/alpha.json'); const h = await open('./tests/fixtures/alpha.json', 'r'); await h.close(); } catch (e) { failure = String(e.stack); }
      if (await api.main(['validate', './tests/fixtures/alpha.json', '--quiet']) !== 0 && !failure) failure = 'CLI failed';
    } catch (e) { failure = String(e.stack || e); }
    finally { for (const key of ['server', 'tools', 'name']) delete Object.prototype[key]; delete Array.prototype[0]; }
    if (hits || failure) { process.stderr.write(JSON.stringify({ hits, failure, trace })); process.exitCode = 1; }
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
