export function renderReportTerminal(report) {
  const lines = ['JOONS MCP Tool Catalog', `command: ${report.command}`, `status: ${report.status}`];
  if (report.mode.details) lines.push('details: may contain internal names');
  for (const [key, value] of Object.entries(report.counts)) lines.push(`${key}: ${value}`);
  for (const server of report.servers) lines.push(`server: ${server.server} tools=${server.tools}${!Object.hasOwn(server, 'name') ? '' : ` name=${server.name}`}`);
  for (const item of report.collisions) lines.push(`collision: ${item.kind} ${item.tools.join(', ')}${!Object.hasOwn(item, 'name') ? '' : ` name=${item.name}`}`);
  for (const item of report.matches) lines.push(`match: ${item.tool} ${item.server} score=${item.score}${!Object.hasOwn(item, 'name') ? '' : ` name=${item.name}`}`);
  return lines.join('\n') + '\n';
}
