// Tests: mergeSnapshots + listServers (src/catalog/merge.js).
// Self-contained: node:test + node:assert/strict only.

import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeSnapshots, listServers } from '../src/catalog/merge.js';
import { makeSnapshot } from './doubles/snapshot.js';

function names(merged) {
  return merged.tools.map((tool) => tool.name);
}

test('server ordinals sorted by name code-unit, stable tie-break by input index', () => {
  const merged = mergeSnapshots([
    makeSnapshot('beta', ['b1']),
    makeSnapshot('alpha', ['a1']),
    makeSnapshot('beta', ['b2']),
  ]);
  assert.deepEqual(merged.servers, [
    { server: 'server-1', ordinal: 1, tools: 1 },
    { server: 'server-2', ordinal: 2, tools: 1 },
    { server: 'server-3', ordinal: 3, tools: 1 },
  ]);
  const byName = {};
  for (const tool of merged.tools) byName[tool.name] = tool.server;
  assert.equal(byName.a1, 'server-1');
  assert.equal(byName.b1, 'server-2'); // first 'beta' in input order
  assert.equal(byName.b2, 'server-3');
});

test('server sort is code-unit order, not locale or case-folded', () => {
  const merged = mergeSnapshots([
    makeSnapshot('Zeta', []),
    makeSnapshot('alpha', []),
    makeSnapshot('Beta', []),
  ]);
  assert.deepEqual(merged.servers.map((s) => s.server), ['server-1', 'server-2', 'server-3']);
  assert.equal(merged.tools.length, 0);
});

test('tool ordinals sorted by (name, server ordinal, index within snapshot)', () => {
  const merged = mergeSnapshots([
    makeSnapshot('beta', [{ name: 'x' }, { name: 'a' }, { name: 'x' }]),
    makeSnapshot('alpha', [{ name: 'x' }, { name: 'a' }]),
  ]);
  // alpha = server-1, beta = server-2.
  assert.deepEqual(names(merged), ['a', 'a', 'x', 'x', 'x']);
  assert.deepEqual(
    merged.tools.map((t) => [t.tool, t.server, t.index]),
    [
      ['tool-1', 'server-1', 1],
      ['tool-2', 'server-2', 1],
      ['tool-3', 'server-1', 0],
      ['tool-4', 'server-2', 0],
      ['tool-5', 'server-2', 2],
    ],
  );
});

test('merged tools carry name/title/description and ordinal fields only', () => {
  const merged = mergeSnapshots([
    makeSnapshot('alpha', [{ name: 'greet', title: 'Greet', description: 'Says hi' }]),
  ]);
  assert.deepEqual(merged.tools[0], {
    tool: 'tool-1',
    ordinal: 1,
    server: 'server-1',
    serverOrdinal: 1,
    index: 0,
    name: 'greet',
    title: 'Greet',
    description: 'Says hi',
  });
});

test('null title/description are preserved as null', () => {
  const merged = mergeSnapshots([makeSnapshot('alpha', [{ name: 't' }])]);
  assert.equal(merged.tools[0].title, null);
  assert.equal(merged.tools[0].description, null);
});

test('empty parsed array returns empty catalog', () => {
  assert.deepEqual(mergeSnapshots([]), { servers: [], tools: [] });
});

test('per-snapshot tool cap enforced (limit_exceeded)', () => {
  const tooMany = Array.from({ length: 10001 }, (_, i) => ({ name: `t${i}` }));
  assert.throws(() => mergeSnapshots([makeSnapshot('alpha', tooMany)]), {
    name: 'CatalogError',
    kind: 'limit_exceeded',
  });
});

test('total tool cap enforced across snapshots (limit_exceeded)', () => {
  const defs = Array.from({ length: 9000 }, (_, i) => ({ name: `t${i}` }));
  const snapshots = Array.from({ length: 6 }, () => makeSnapshot('alpha', defs));
  assert.throws(() => mergeSnapshots(snapshots), {
    name: 'CatalogError',
    kind: 'limit_exceeded',
  });
});

test('malformed snapshot value rejected (invalid_snapshot)', () => {
  assert.throws(() => mergeSnapshots([{ server: { name: 'x' } }]), {
    name: 'CatalogError',
    kind: 'invalid_snapshot',
  });
  assert.throws(() => mergeSnapshots([makeSnapshot('alpha', [{ name: 5 }])]), {
    name: 'CatalogError',
    kind: 'invalid_snapshot',
  });
  assert.throws(() => mergeSnapshots('nope'), {
    name: 'CatalogError',
    kind: 'invalid_snapshot',
  });
});

test('error messages carry no untrusted text', () => {
  try {
    mergeSnapshots([{ server: { name: 'x' } }]);
    assert.fail('should have thrown');
  } catch (err) {
    assert.equal(err.message, 'invalid_snapshot');
  }
});

test('listServers returns per-server counts sorted by ordinal', () => {
  const merged = mergeSnapshots([
    makeSnapshot('beta', [{ name: 'b1' }, { name: 'b2' }]),
    makeSnapshot('alpha', [{ name: 'a1' }]),
  ]);
  assert.deepEqual(listServers(merged.tools), [
    { server: 'server-1', ordinal: 1, tools: 1 },
    { server: 'server-2', ordinal: 2, tools: 2 },
  ]);
});

test('listServers rejects malformed tools', () => {
  assert.throws(() => listServers([{ name: 'x' }]), {
    name: 'CatalogError',
    kind: 'invalid_snapshot',
  });
});
