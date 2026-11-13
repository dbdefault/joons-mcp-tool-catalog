// Merge parsed snapshots into normalized server/tool ordinals.
// Pure: no filesystem, no renderers. Input is already-validated snapshot
// values produced by input admission (validateSnapshot / readSnapshotFile).

const MAX_TOOLS_PER_SNAPSHOT = 10000;
const MAX_TOOLS_TOTAL = 50000;

export function catalogError(kind) {
  const err = new Error(kind);
  err.name = 'CatalogError';
  err.kind = kind;
  return err;
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// UTF-16 code-unit order, no locale collation.
export function compareCodeUnits(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

// Snapshot values must already be admitted JSON; this is a defensive
// re-check for malformed internal values.
function checkSnapshot(value, inputIndex) {
  if (
    !isPlainObject(value) ||
    !isPlainObject(value.server) ||
    typeof value.server.name !== 'string' ||
    !Array.isArray(value.tools)
  ) {
    throw catalogError('invalid_snapshot');
  }
  if (value.tools.length > MAX_TOOLS_PER_SNAPSHOT) {
    throw catalogError('limit_exceeded');
  }
  for (const tool of value.tools) {
    if (!isPlainObject(tool) || typeof tool.name !== 'string') {
      throw catalogError('invalid_snapshot');
    }
  }
  return { value, inputIndex };
}

// mergeSnapshots(parsed[]) -> {servers, tools}
// Server ordinals: snapshots sorted by server.name code-unit order,
// stable tie-break by input argument index, numbered server-1..server-S.
// Tool ordinals: all tools sorted by (name code-unit, server ordinal,
// index within snapshot), numbered tool-1..tool-N.
//
// Returned shapes (plain data only):
//   servers: [{server: 'server-<n>', ordinal, tools}]  (no raw names, no sha256)
//   tools:   [{tool, ordinal, server, serverOrdinal, index, name, title, description}]
// Raw server names never leave this module in output fields; sha256 is
// attached downstream by the output layer via its `extra` input, not here.
export function mergeSnapshots(parsed) {
  if (!Array.isArray(parsed)) throw catalogError('invalid_snapshot');

  const snapshots = parsed.map((value, inputIndex) => checkSnapshot(value, inputIndex));

  snapshots.sort((a, b) => {
    const byName = compareCodeUnits(a.value.server.name, b.value.server.name);
    return byName !== 0 ? byName : a.inputIndex - b.inputIndex;
  });

  const servers = [];
  const tools = [];
  snapshots.forEach((snapshot, position) => {
    const ordinal = position + 1;
    servers.push({
      server: `server-${ordinal}`,
      ordinal,
      tools: snapshot.value.tools.length,
    });
    snapshot.value.tools.forEach((tool, index) => {
      tools.push({
        tool: '',
        ordinal: 0,
        server: `server-${ordinal}`,
        serverOrdinal: ordinal,
        index,
        name: tool.name,
        title: typeof tool.title === 'string' ? tool.title : null,
        description: typeof tool.description === 'string' ? tool.description : null,
      });
    });
  });

  if (tools.length > MAX_TOOLS_TOTAL) throw catalogError('limit_exceeded');

  tools.sort((a, b) => {
    const byName = compareCodeUnits(a.name, b.name);
    if (byName !== 0) return byName;
    if (a.serverOrdinal !== b.serverOrdinal) return a.serverOrdinal - b.serverOrdinal;
    return a.index - b.index;
  });

  tools.forEach((tool, position) => {
    tool.ordinal = position + 1;
    tool.tool = `tool-${tool.ordinal}`;
  });

  return { servers, tools };
}

// listServers(tools) -> per-server counts, sorted by server ordinal.
// Shape: [{server: 'server-<n>', ordinal, tools}]
export function listServers(tools) {
  if (!Array.isArray(tools)) throw catalogError('invalid_snapshot');
  const counts = new Map();
  for (const tool of tools) {
    if (!isPlainObject(tool) || typeof tool.serverOrdinal !== 'number') {
      throw catalogError('invalid_snapshot');
    }
    counts.set(tool.serverOrdinal, (counts.get(tool.serverOrdinal) || 0) + 1);
  }
  return [...counts.keys()]
    .sort((a, b) => a - b)
    .map((ordinal) => ({
      server: `server-${ordinal}`,
      ordinal,
      tools: counts.get(ordinal),
    }));
}
