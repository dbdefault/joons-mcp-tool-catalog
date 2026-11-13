// Local test double: builds valid minimal snapshots and JSON text.
// Fictional values only.

export function makeTool(name, overrides) {
  return {
    name,
    title: null,
    description: null,
    inputSchema: { type: 'object' },
    outputSchema: null,
    annotations: null,
    ...overrides
  };
}

export function makeSnapshot(overrides) {
  const tools = overrides && Array.isArray(overrides.tools)
    ? overrides.tools
    : [makeTool('greet')];
  const base = {
    format: 'joons-mcp-diff/snapshot',
    schemaVersion: 1,
    createdAt: '2026-01-02T03:04:05Z',
    tool: { name: 'diff-tool', version: '1.0.0' },
    label: null,
    server: {
      name: 'example-server',
      version: '1.0.0',
      protocolVersion: '2025-06-18'
    },
    tools,
    stats: { toolCount: tools.length, pages: 1 }
  };
  if (!overrides) return base;
  const { tools: _ignored, ...rest } = overrides;
  const merged = { ...base, ...rest };
  if (Array.isArray(overrides.tools)) merged.tools = overrides.tools;
  if (overrides.stats) merged.stats = overrides.stats;
  return merged;
}

export function snapshotJson(overrides) {
  return JSON.stringify(makeSnapshot(overrides));
}

export const CLEAN_NAMES = [
  'greet',
  'get-weather',
  'list_files',
  'fetchURL-v2',
  'tool.number.0.1.0',
  'mixedCASE_Name9'
];
