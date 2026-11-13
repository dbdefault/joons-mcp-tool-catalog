import { redactText } from '../security/redact.js';

export function makeCatalog(command, merged, extra = {}) {
  const collisions = extra.collisions ?? [];
  const matches = extra.matches ?? [];
  const colliding = new Set(collisions.flatMap((entry) => entry.tools));
  let redactions = 0;
  const sha256s = Array.isArray(extra.sha256s) ? extra.sha256s : [];
  const tools = merged.tools.map((item) => {
    const clean = (value) => {
      if (value == null) return null;
      const result = redactText(value, { maxLength: 200 });
      if (result !== value) redactions++;
      return result;
    };
    return { tool: item.tool, server: item.server, name: item.name,
      title: clean(item.title), description: clean(item.description),
      collides: colliding.has(item.tool) };
  });
  return {
    format: 'joons-mcp-tool-catalog/catalog', schemaVersion: 1,
    tool: { name: 'joons-mcp-tool-catalog', version: '0.1.1' }, command,
    counts: { servers: merged.servers.length, tools: tools.length,
      collisions: collisions.length, collidingTools: colliding.size, redactions },
    servers: merged.servers.map((server, i) => ({ server: server.server,
      // Artifact servers carry the snapshot raw-byte SHA prefix. The CLI
      // supplies ordinal-aligned prefixes via extra.sha256s (the merge stays
      // hash-free); a server.sha256 field is accepted as a fallback.
      sha256: String((Object.hasOwn(sha256s, i) ? sha256s[i] : undefined) ?? (Object.hasOwn(server, 'sha256') ? server.sha256 : '')).slice(0, 12), tools: server.tools })),
    tools,
    collisions: collisions.map((entry) => entry.kind === 'exact'
      ? { kind: 'exact', name: entry.name, tools: [...entry.tools] }
      : { kind: 'weak', key: entry.key, tools: [...entry.tools] }),
    matches: command === 'build' ? [] : matches.map((item) => typeof item === 'string' ? item : item.tool)
  };
}
