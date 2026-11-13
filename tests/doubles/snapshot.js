// Local test double: minimal snapshot-value factory for W1 tests.
// Values are deterministic and carry no real server data.

export function makeSnapshot(serverName, toolDefs) {
  const tools = toolDefs.map((raw) => {
    const def = typeof raw === 'string' ? { name: raw } : raw;
    return {
      name: def.name,
      title: def.title === undefined ? null : def.title,
      description: def.description === undefined ? null : def.description,
      inputSchema: {},
      outputSchema: null,
      annotations: null,
    };
  });
  return {
    format: 'joons-mcp-diff/snapshot',
    schemaVersion: 1,
    createdAt: '2026-01-01T00:00:00Z',
    tool: { name: 'joons-mcp-diff', version: '1.0.0' },
    label: null,
    server: { name: serverName, version: '1.0.0', protocolVersion: '2025-06-18' },
    tools,
    stats: { toolCount: tools.length, pages: 1 },
  };
}
