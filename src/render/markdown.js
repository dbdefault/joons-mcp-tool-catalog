const escape = (value) => String(value).replace(/[\\`*_{}\[\]()#+.!|<>~\-]/g, '\\$&');

export function renderReportMarkdown(report) {
  const lines = ['# JOONS MCP Tool Catalog', '', `Command: ${report.command}`, `Status: ${report.status}`];
  if (report.mode.details) lines.push('', 'details: may contain internal names');
  lines.push('', '## Counts', '');
  for (const [key, value] of Object.entries(report.counts)) lines.push(`- ${key}: ${value}`);
  lines.push('', '## Servers', '');
  for (const item of report.servers) lines.push(`- ${item.server}: ${item.tools}${item.name === undefined ? '' : ` (${escape(item.name)})`}`);
  lines.push('', '## Collisions', '');
  for (const item of report.collisions) lines.push(`- ${item.kind}: ${item.tools.join(', ')}${item.name === undefined ? '' : ` (${escape(item.name)})`}`);
  lines.push('', '## Matches', '');
  for (const item of report.matches) lines.push(`- ${item.tool}: ${item.server}, score ${item.score}${item.name === undefined ? '' : ` (${escape(item.name)})`}`);
  return lines.join('\n') + '\n';
}

export function renderCatalogMarkdown(catalog) {
  const lines = ['# JOONS MCP Tool Catalog', '', 'Review artifacts before sharing.', '', '## Counts', ''];
  for (const [key, value] of Object.entries(catalog.counts)) lines.push(`- ${key}: ${value}`);
  lines.push('', '## Servers', '');
  for (const item of catalog.servers) lines.push(`- ${item.server}: ${item.tools} tools, SHA-256 ${item.sha256}`);
  lines.push('', '## Tools', '');
  for (const item of catalog.tools) lines.push(`- ${item.tool}: ${item.server}, collides: ${item.collides}`);
  lines.push('', '## Collisions', '');
  for (const item of catalog.collisions) lines.push(`- ${item.kind}: ${item.tools.join(', ')}`);
  return lines.join('\n') + '\n';
}
