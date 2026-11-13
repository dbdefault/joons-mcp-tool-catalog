// Public entrypoint surface (CONTRACT "Ownership and interfaces"):
// importing src/index.js must succeed and every contract-listed export
// must exist. Regression test for RR-02.

import test from 'node:test';
import assert from 'node:assert/strict';

const api = await import('../src/index.js');

const FUNCTION_EXPORTS = [
  'main',
  'parseArgs',
  'readSnapshotFile',
  'validateSnapshot',
  'scanForCredential',
  'redactText',
  'mergeSnapshots',
  'findCollisions',
  'searchTools',
  'listServers',
  'makeCatalog',
  'makeReport',
  'renderCatalogJson',
  'renderReportJson',
  'renderReportTerminal',
  'renderCatalogMarkdown',
  'renderReportMarkdown',
];

test('public entrypoint imports and exposes every contract-listed export', () => {
  assert.equal(typeof api.VERSION, 'string');
  assert.ok(api.VERSION.length > 0);
  for (const name of FUNCTION_EXPORTS) {
    assert.equal(typeof api[name], 'function', `missing export: ${name}`);
  }
});

test('listServers works through the public entrypoint (RR-02 regression)', () => {
  const merged = api.mergeSnapshots([
    api.validateSnapshot({
      format: 'joons-mcp-diff/snapshot',
      schemaVersion: 1,
      createdAt: '2026-01-01T00:00:00Z',
      tool: { name: 't', version: '1' },
      label: null,
      server: { name: 'b-server', version: '1', protocolVersion: 'p' },
      tools: [
        { name: 'x', title: null, description: null, inputSchema: {}, outputSchema: null, annotations: null },
        { name: 'y', title: null, description: null, inputSchema: {}, outputSchema: null, annotations: null },
      ],
      stats: { toolCount: 2, pages: 1 },
    }),
  ]);
  assert.deepEqual(api.listServers(merged.tools), [
    { server: 'server-1', ordinal: 1, tools: 2 },
  ]);
});
