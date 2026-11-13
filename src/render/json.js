export function renderCatalogJson(catalog) {
  return JSON.stringify(catalog, null, 2) + '\n';
}
export function renderReportJson(report) {
  return JSON.stringify(report, null, 2) + '\n';
}
