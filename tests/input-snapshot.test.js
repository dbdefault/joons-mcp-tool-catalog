import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSnapshot } from '../src/input/snapshot.js';
import { makeSnapshot, makeTool } from './doubles/snapshot-input.js';

function ok(value) {
  assert.doesNotThrow(() => validateSnapshot(value));
}

function bad(value) {
  assert.throws(() => validateSnapshot(value), (e) => e.kind === 'invalid_snapshot');
}

function credential(value) {
  assert.throws(() => validateSnapshot(value), (e) => e.kind === 'credential_detected');
}

test('minimal valid snapshot passes', () => {
  ok(makeSnapshot());
  ok(makeSnapshot({ tools: [], stats: { toolCount: 0, pages: 0 } }));
  ok(makeSnapshot({ label: 'nightly run' }));
});

test('root shape is exact', () => {
  bad(makeSnapshot({ extra: 1 }));
  const missing = makeSnapshot();
  delete missing.createdAt;
  bad(missing);
  bad(makeSnapshot({ format: 'other-format' }));
  bad(makeSnapshot({ schemaVersion: 2 }));
  bad(makeSnapshot({ createdAt: 'yesterday' }));
  bad(makeSnapshot({ createdAt: '2026-13-99T99:99:99Z' }));
  bad(makeSnapshot({ createdAt: '2026-01-02 03:04:05' }));
  ok(makeSnapshot({ createdAt: '2026-01-02T03:04:05.123+09:00' }));
  bad(makeSnapshot({ label: 7 }));
});

test('tool and server metadata shapes are exact', () => {
  bad(makeSnapshot({ tool: { name: 'x', version: '1', extra: 1 } }));
  bad(makeSnapshot({ tool: { name: 'x' } }));
  bad(makeSnapshot({ server: { name: 's', version: '1' } }));
  bad(makeSnapshot({ server: { name: 's', version: 1, protocolVersion: 'p' } }));
  bad(makeSnapshot({ server: { name: 's', version: '1', protocolVersion: 'p', x: 1 } }));
});

test('tool entries are exact and names are well-formed', () => {
  ok(makeSnapshot({
    tools: [makeTool('a', { outputSchema: 42, inputSchema: 'anything', annotations: { readOnlyHint: true } })]
  }));
  bad(makeSnapshot({ tools: [makeTool('a', { unknown: 1 })] }));
  bad(makeSnapshot({ tools: [makeTool('a', { title: 5 })] }));
  bad(makeSnapshot({ tools: [makeTool('a', { description: 5 })] }));
  bad(makeSnapshot({ tools: [makeTool('a', { annotations: [] })] }));
  const missingSchema = makeTool('a');
  delete missingSchema.inputSchema;
  bad(makeSnapshot({ tools: [missingSchema] }));

  bad(makeSnapshot({ tools: [makeTool('')] }));
  bad(makeSnapshot({ tools: [makeTool('a\u0007b')] }));
  bad(makeSnapshot({ tools: [makeTool('x'.repeat(1001))] }));
  ok(makeSnapshot({ tools: [makeTool('x'.repeat(1000))] }));
});

test('within-snapshot duplicate names are malformed input', () => {
  bad(makeSnapshot({ tools: [makeTool('dup'), makeTool('dup')] }));
  ok(makeSnapshot({ tools: [makeTool('a'), makeTool('A')] })); // exact bytes differ
});

test('stats shape and consistency', () => {
  bad(makeSnapshot({ stats: { toolCount: 2, pages: 1 } })); // 1 tool but count 2
  bad(makeSnapshot({ stats: { toolCount: 1, pages: -1 } }));
  bad(makeSnapshot({ stats: { toolCount: 1, pages: 1.5 } }));
  bad(makeSnapshot({ stats: { toolCount: 1, pages: 1, extra: 1 } }));
  bad(makeSnapshot({ stats: { toolCount: 1, pages: 1, duplicateNames: [1] } }));
  bad(makeSnapshot({ stats: { pages: 1 } })); // missing toolCount
  ok(makeSnapshot({ stats: { toolCount: 1, pages: 1, duplicateNames: ['x'] } }));
});

test('credential-shaped identifiers refuse the whole snapshot', () => {
  credential(makeSnapshot({ server: { name: 'AKIAIOSFODNN7EXAMPLE', version: '1', protocolVersion: 'p' } }));
  credential(makeSnapshot({ tools: [makeTool('sk-ABCDEFGHIJKLMNOP')] }));
  credential(makeSnapshot({ tools: [makeTool('tok-ghp_abcdefghijklmnopqrstuv')] }));
  credential(makeSnapshot({ tools: [makeTool('prefixghp_ABCDEFGHIJKLMNOPQRST')] }));
  credential(makeSnapshot({ tools: [makeTool('dGhlLXRva2VuLWdocF9hYmNkZWZnaGprbDEyMzQ1Njc4OTAtdWZmaXg')] }));
  credential(makeSnapshot({
    tools: [makeTool('a'), makeTool('Bearer abcdef1234567890')]
  }));
  credential(makeSnapshot({ server: { name: 'Bearer abc', version: '1', protocolVersion: 'p' } }));
  credential(makeSnapshot({ tools: [makeTool('Bearer abcdefgh')] }));
});

test('clean snapshots with credential-adjacent text pass', () => {
  ok(makeSnapshot({
    tools: [makeTool('list_files', { title: 'token-based auth helper' })]
  }));
  ok(makeSnapshot({
    tools: [makeTool('ghp_lookup_tool')] // 'ghp_' but too short to be a token
  }));
});

test('structural errors are CatalogError with empty message', () => {
  try {
    validateSnapshot(makeSnapshot({ extra: 1 }));
    assert.fail('should throw');
  } catch (error) {
    assert.equal(error.name, 'CatalogError');
    assert.equal(error.kind, 'invalid_snapshot');
    assert.equal(error.message, '');
    assert.equal(String(error).includes('extra'), false);
  }
});

test('accessor-bearing arrays are rejected without invoking getters', () => {
  let calls = 0;
  const snapshot = makeSnapshot({
    tools: [makeTool('a'), makeTool('b')]
  });
  Object.defineProperty(snapshot.tools, '0', {
    enumerable: true,
    configurable: true,
    get() {
      calls += 1;
      return makeTool('a');
    }
  });
  assert.throws(() => validateSnapshot(snapshot), (e) => e.kind === 'invalid_snapshot');
  assert.equal(calls, 0, 'getter must never run');
});

test('accessor-bearing objects are rejected without invoking getters', () => {
  let calls = 0;
  const snapshot = makeSnapshot();
  Object.defineProperty(snapshot.server, 'name', {
    enumerable: true,
    configurable: true,
    get() {
      calls += 1;
      return 'example-server';
    }
  });
  assert.throws(() => validateSnapshot(snapshot), (e) => e.kind === 'invalid_snapshot');
  assert.equal(calls, 0, 'getter must never run');
});
