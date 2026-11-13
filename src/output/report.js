import { redactText } from '../security/redact.js';
import { makeCatalog } from './catalog.js';

export function makeReport(command, merged, extra = {}, { details = false } = {}) {
  const catalog = makeCatalog(command, merged, extra);
  const byTool = new Map(merged.tools.map((item) => [item.tool, item]));
  const clean = (value) => redactText(value, { maxLength: 200 });
  const servers = merged.servers.map((item) => {
    const entry = { server: item.server, tools: item.tools };
    if (details) entry.name = clean(item.name);
    return entry;
  });
  const collisions = (extra.collisions ?? []).map((item) => {
    const entry = { kind: item.kind, tools: [...item.tools] };
    if (details) entry.name = clean(item.kind === 'exact' ? item.name : item.key);
    return entry;
  });
  const matches = (extra.matches ?? []).slice(0, 1000).map((item) => {
    const source = byTool.get(item.tool);
    const entry = { tool: item.tool, server: item.server ?? source.server, score: item.score };
    if (details) entry.name = clean(source.name);
    return entry;
  });
  return {
    format: 'joons-mcp-tool-catalog/report', schemaVersion: 1,
    tool: { name: 'joons-mcp-tool-catalog', version: '0.1.0' }, command,
    status: 'PASS', mode: { details },
    counts: { servers: catalog.counts.servers, tools: catalog.counts.tools,
      collisions: catalog.counts.collisions, collidingTools: catalog.counts.collidingTools,
      matches: extra.total ?? extra.matchCount ?? extra.totalMatches ?? (extra.matches ?? []).length,
      redactions: catalog.counts.redactions },
    servers, collisions, matches, problems: []
  };
}
