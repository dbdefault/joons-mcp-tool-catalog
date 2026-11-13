import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readSnapshotFile } from '../src/input/read.js';
import { validateSnapshot } from '../src/input/snapshot.js';
import { makeSnapshot, makeTool } from './doubles/snapshot-input.js';

async function expectKind(promise, kind) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.kind, kind, `expected ${kind}, got ${error.kind}`);
    assert.equal(error.message, '');
    return true;
  });
}

async function withJsonFile(json, run) {
  const dir = await mkdtemp(path.join(tmpdir(), 'catalog-limits-'));
  const file = path.join(dir, 'in.json');
  try {
    await writeFile(file, json);
    await run(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('depth beyond 64 rejects with limit_exceeded', async () => {
  const deep65 = '['.repeat(65) + '0' + ']'.repeat(65); // scalar at depth 65
  await withJsonFile(deep65, (file) =>
    expectKind(readSnapshotFile(file), 'limit_exceeded')
  );
});

test('depth exactly 64 parses', async () => {
  const deep64 = '['.repeat(64) + '0' + ']'.repeat(64); // scalar at depth 64
  await withJsonFile(deep64, async (file) => {
    // Not a snapshot structurally; prove the parse cap passes, then the
    // structural check fires instead.
    await expectKind(readSnapshotFile(file), 'invalid_snapshot');
  });
});

test('value node cap enforced during tokenization', async () => {
  const pairs = [];
  for (let i = 0; i <= 500000; i += 1) pairs.push(`"k${i}":0`);
  const many = `{${pairs.join(',')}}`; // 500001 nodes + root > 500000
  await withJsonFile(many, (file) =>
    expectKind(readSnapshotFile(file), 'limit_exceeded')
  );
});

test('string cap enforced before materialization', async () => {
  const big = `["${'a'.repeat(100001)}"]`;
  await withJsonFile(big, (file) =>
    expectKind(readSnapshotFile(file), 'limit_exceeded')
  );
  const atCap = `["${'a'.repeat(100000)}"]`;
  await withJsonFile(atCap, (file) =>
    expectKind(readSnapshotFile(file), 'invalid_snapshot')
  );
});

test('array element cap enforced', async () => {
  const wide = `[${'0,'.repeat(100001)}0]`;
  await withJsonFile(wide, (file) =>
    expectKind(readSnapshotFile(file), 'limit_exceeded')
  );
});

test('tool count cap per snapshot', async () => {
  const tools = Array.from({ length: 10001 }, (_, i) => makeTool(`tool-${i}`));
  const snap = makeSnapshot({ tools, stats: { toolCount: 10001, pages: 1 } });
  await withJsonFile(JSON.stringify(snap), (file) =>
    expectKind(readSnapshotFile(file), 'limit_exceeded')
  );
});

test('reserved keys rejected even in ignored schema branches', async () => {
  const protoSchema = JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}}}');
  const snap = makeSnapshot({
    tools: [makeTool('ok', { inputSchema: protoSchema })]
  });
  await withJsonFile(JSON.stringify(snap), (file) =>
    expectKind(readSnapshotFile(file), 'invalid_snapshot')
  );

  const ctorSchema = JSON.parse('{"constructor":{"prototype":{}}}');
  const snap2 = makeSnapshot({
    tools: [makeTool('ok', { outputSchema: ctorSchema })]
  });
  await withJsonFile(JSON.stringify(snap2), (file) =>
    expectKind(readSnapshotFile(file), 'invalid_snapshot')
  );
});

test('nonfinite numbers reject as invalid_json', async () => {
  await withJsonFile('[1e999]', (file) =>
    expectKind(readSnapshotFile(file), 'invalid_json')
  );
});

test('duplicate keys reject as invalid_json', async () => {
  await withJsonFile('{"a":1,"a":2}', (file) =>
    expectKind(readSnapshotFile(file), 'invalid_json')
  );
});

test('lone surrogate escapes reject as invalid_json', async () => {
  await withJsonFile('"\\uD800"', (file) =>
    expectKind(readSnapshotFile(file), 'invalid_json')
  );
  await withJsonFile('"\\uDC00"', (file) =>
    expectKind(readSnapshotFile(file), 'invalid_json')
  );
  // Paired surrogates are fine.
  await withJsonFile('"\\uD83D\\uDE00"', (file) =>
    expectKind(readSnapshotFile(file), 'invalid_snapshot')
  );
});

test('trailing garbage and truncation reject as invalid_json', async () => {
  await withJsonFile('{"a":1} extra', (file) =>
    expectKind(readSnapshotFile(file), 'invalid_json')
  );
  await withJsonFile('{"a":1', (file) =>
    expectKind(readSnapshotFile(file), 'invalid_json')
  );
});

test('API hardening: cyclic values rejected without stack overflow', () => {
  const snap = makeSnapshot();
  snap.tools[0].inputSchema = { self: null };
  snap.tools[0].inputSchema.self = snap.tools[0].inputSchema;
  assert.throws(() => validateSnapshot(snap), (e) => e.kind === 'invalid_snapshot');
});

test('API hardening: getters never invoked', () => {
  let invoked = 0;
  const snap = makeSnapshot();
  Object.defineProperty(snap, 'evil', {
    enumerable: true,
    get() {
      invoked += 1;
      return 1;
    }
  });
  assert.throws(() => validateSnapshot(snap), (e) => e.kind === 'invalid_snapshot');
  assert.equal(invoked, 0);
});

test('API hardening: non-plain, non-JSON and non-finite values rejected', () => {
  class Fancy {}
  const withClass = makeSnapshot();
  withClass.tools[0].inputSchema = new Fancy();
  assert.throws(() => validateSnapshot(withClass), (e) => e.kind === 'invalid_snapshot');

  const withUndefined = makeSnapshot();
  withUndefined.tools[0].inputSchema = undefined;
  assert.throws(() => validateSnapshot(withUndefined), (e) => e.kind === 'invalid_snapshot');

  const withBigInt = makeSnapshot();
  withBigInt.stats.pages = 1n;
  assert.throws(() => validateSnapshot(withBigInt), (e) => e.kind === 'invalid_snapshot');

  const withNaN = makeSnapshot();
  withNaN.stats.pages = NaN;
  assert.throws(() => validateSnapshot(withNaN), (e) => e.kind === 'invalid_snapshot');

  assert.throws(() => validateSnapshot(42), (e) => e.kind === 'invalid_snapshot');
  assert.throws(() => validateSnapshot(null), (e) => e.kind === 'invalid_snapshot');
});

test('API hardening: caps and reserved keys on API values', () => {
  const withReserved = makeSnapshot();
  withReserved.tools[0].inputSchema = { prototype: 1 };
  assert.throws(() => validateSnapshot(withReserved), (e) => e.kind === 'invalid_snapshot');

  const deep65 = makeSnapshot();
  let inner = [];
  for (let i = 0; i < 62; i += 1) inner = [inner];
  deep65.tools[0].inputSchema = inner; // container lands at depth 65
  assert.throws(() => validateSnapshot(deep65), (e) => e.kind === 'limit_exceeded');

  const longString = makeSnapshot();
  longString.tools[0].description = 'x'.repeat(100001);
  assert.throws(() => validateSnapshot(longString), (e) => e.kind === 'limit_exceeded');

  const wideArray = makeSnapshot();
  wideArray.tools[0].inputSchema = new Array(100001).fill(0);
  assert.throws(() => validateSnapshot(wideArray), (e) => e.kind === 'limit_exceeded');
});

test('input objects are not mutated by validation', () => {
  const snap = makeSnapshot();
  const before = JSON.stringify(snap);
  try {
    validateSnapshot(snap);
  } catch {
    // ignore
  }
  assert.equal(JSON.stringify(snap), before);
  assert.equal(Object.getPrototypeOf(snap), Object.prototype);
});
