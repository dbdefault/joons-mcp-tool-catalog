// Tests: findCollisions (src/catalog/collisions.js).
// Self-contained: node:test + node:assert/strict only.

import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeSnapshots } from '../src/catalog/merge.js';
import { findCollisions, weakKey } from '../src/catalog/collisions.js';
import { makeSnapshot } from './doubles/snapshot.js';

function mergedOf(serverDefs) {
  return mergeSnapshots(serverDefs.map(([server, defs]) => makeSnapshot(server, defs)));
}

test('exact collision: same name on 2 servers -> one exact entry', () => {
  const merged = mergedOf([
    ['beta', [{ name: 'greet' }, { name: 'solo' }]],
    ['alpha', [{ name: 'greet' }]],
  ]);
  const entries = findCollisions(merged.tools);
  // alpha sorts first -> server-1 ('greet' = tool-1); beta -> server-2
  // ('greet' = tool-2, 'solo' = tool-3).
  assert.deepEqual(entries, [
    { kind: 'exact', name: 'greet', tools: ['tool-1', 'tool-2'] },
  ]);
});

test('same name on a single server only is not a collision', () => {
  const merged = mergedOf([['alpha', [{ name: 'greet' }, { name: 'greet2' }]]]);
  assert.deepEqual(findCollisions(merged.tools), []);
});

test('weak collision: case/trim variants across servers, no exact entry', () => {
  const merged = mergedOf([
    ['alpha', [{ name: 'Get_Weather' }]],
    ['beta', [{ name: 'get_weather ' }]],
  ]);
  const entries = findCollisions(merged.tools);
  assert.deepEqual(entries, [
    { kind: 'weak', key: 'get_weather', tools: ['tool-1', 'tool-2'] },
  ]);
});

test('weak trim removes all White_Space, Cc and Cf characters (U+200B)', () => {
  const merged = mergedOf([
    ['alpha', [{ name: 'Alpha' }]],
    ['beta', [{ name: '\u200Balpha\u200B' }]],
  ]);
  const entries = findCollisions(merged.tools);
  assert.deepEqual(entries, [
    { kind: 'weak', key: 'alpha', tools: ['tool-1', 'tool-2'] },
  ]);
  assert.equal(weakKey('\u200B\u00A0x\uFEFF'), 'x');
  assert.equal(weakKey('\u2066pad\u2069'), 'pad');
});

test('weak key applies NFC before comparison', () => {
  // 'A\u0301' (A + combining acute) vs '\u00C1' (precomposed) share K.
  const merged = mergedOf([
    ['alpha', [{ name: 'A\u0301' }]],
    ['beta', [{ name: '\u00C1' }]],
  ]);
  const entries = findCollisions(merged.tools);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, 'weak');
  assert.equal(entries[0].key, '\u00e1');
});

test('pure exact group is reported once, never double-reported as weak', () => {
  const merged = mergedOf([
    ['alpha', [{ name: 'same' }, { name: 'other' }]],
    ['beta', [{ name: 'same' }]],
  ]);
  const entries = findCollisions(merged.tools);
  // name sort gives: 'other' tool-1 (alpha), 'same' tool-2 (alpha), 'same' tool-3 (beta).
  assert.deepEqual(entries, [
    { kind: 'exact', name: 'same', tools: ['tool-2', 'tool-3'] },
  ]);
});

test('weak group requires >=2 distinct servers AND >=2 distinct exact names', () => {
  // Same weak key, same server, two spellings -> not a weak collision.
  const oneServer = mergedOf([
    ['alpha', [{ name: 'Ab' }, { name: 'ab' }]],
  ]);
  assert.deepEqual(findCollisions(oneServer.tools), []);

  // Same weak key, two servers, but identical exact names -> exact only.
  const twoServersSameName = mergedOf([
    ['alpha', [{ name: 'ab' }]],
    ['beta', [{ name: 'ab' }]],
  ]);
  assert.deepEqual(findCollisions(twoServersSameName.tools), [
    { kind: 'exact', name: 'ab', tools: ['tool-1', 'tool-2'] },
  ]);
});

test('weak group spans all member tools across servers, sorted by ordinal', () => {
  const merged = mergedOf([
    ['alpha', [{ name: 'X1' }, { name: 'unrelated' }]],
    ['beta', [{ name: 'x1' }]],
    ['gamma', [{ name: ' x1\t' }]],
  ]);
  const entries = findCollisions(merged.tools);
  // name sort: ' x1\t' tool-1 (gamma), 'X1' tool-2 (alpha),
  // 'unrelated' tool-3 (alpha), 'x1' tool-4 (beta).
  assert.deepEqual(entries, [
    { kind: 'weak', key: 'x1', tools: ['tool-1', 'tool-2', 'tool-4'] },
  ]);
});

test('output sort: exact before weak, then key code-unit, then tool ordinals', () => {
  const merged = mergedOf([
    ['alpha', [{ name: 'zebra' }, { name: 'Beta' }, { name: 'apple' }]],
    ['beta', [{ name: 'ZEBRA' }, { name: 'beta' }, { name: 'apple' }]],
  ]);
  const entries = findCollisions(merged.tools);
  // 'zebra'/'ZEBRA' differ in exact name -> weak only; 'apple' is a true exact.
  assert.deepEqual(entries.map((e) => [e.kind, e.name ?? e.key]), [
    ['exact', 'apple'],
    ['weak', 'beta'],
    ['weak', 'zebra'],
  ]);
});

test('tool id lists inside entries are ordinal-ascending', () => {
  const merged = mergedOf([
    ['beta', [{ name: 'dup' }]],
    ['alpha', [{ name: 'dup' }]],
    ['gamma', [{ name: 'dup' }]],
  ]);
  const [entry] = findCollisions(merged.tools);
  assert.equal(entry.kind, 'exact');
  assert.deepEqual(entry.tools, entry.tools.slice().sort());
});

test('collision cap: >10,000 entries -> limit_exceeded, no partial output', () => {
  // 5,000 exact groups (alpha/beta share n0..n4999) + 6,000 weak-only groups
  // (gamma has w0..w5999, delta has W0..W5999) = 11,000 entries,
  // while every snapshot stays under the 10,000-tool cap.
  const shared = Array.from({ length: 5000 }, (_, i) => ({ name: `n${i}` }));
  const lower = Array.from({ length: 6000 }, (_, i) => ({ name: `w${i}` }));
  const upper = Array.from({ length: 6000 }, (_, i) => ({ name: `W${i}` }));
  const merged = mergedOf([
    ['alpha', shared],
    ['beta', shared],
    ['gamma', lower],
    ['delta', upper],
  ]);
  assert.throws(() => findCollisions(merged.tools), {
    name: 'CatalogError',
    kind: 'limit_exceeded',
  });
});

test('exactly 10,000 entries is accepted', () => {
  const defs = Array.from({ length: 10000 }, (_, i) => ({ name: `n${i}` }));
  const merged = mergedOf([
    ['alpha', defs],
    ['beta', defs],
  ]);
  const entries = findCollisions(merged.tools);
  assert.equal(entries.length, 10000);
  assert.equal(entries[0].name, 'n0');
  assert.equal(entries[9999].name, 'n9999');
});

test('malformed tools rejected (invalid_snapshot)', () => {
  assert.throws(() => findCollisions([{ name: 'x' }]), {
    name: 'CatalogError',
    kind: 'invalid_snapshot',
  });
  assert.throws(() => findCollisions('nope'), {
    name: 'CatalogError',
    kind: 'invalid_snapshot',
  });
});

test('weakKey: trim + NFC + lowercase', () => {
  assert.equal(weakKey('  Get_Weather \t'), 'get_weather');
  assert.equal(weakKey('A\u0301'), '\u00e1');
  assert.equal(weakKey('plain'), 'plain');
});
