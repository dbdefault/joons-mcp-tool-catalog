// Internal CLI implementation; this module is not a supported library interface.

export { VERSION } from './version.js';
import { main as rawMain } from './cli.js';
import { parseArgs as rawParseArgs } from './args.js';
import { isInert, register } from './inert.js';
import { CatalogError } from './errors.js';
import { types } from 'node:util';
import { readSnapshotFile as rawReadSnapshotFile } from './input/read.js';
import { scanForCredential as rawScanForCredential } from './security/credentials.js';
import { redactText as rawRedactText } from './security/redact.js';
import { mergeSnapshots as rawMergeSnapshots, listServers as rawListServers } from './catalog/merge.js';
import { findCollisions as rawFindCollisions } from './catalog/collisions.js';
import { searchTools as rawSearchTools } from './catalog/search.js';
import { makeCatalog as rawMakeCatalog } from './output/catalog.js';
import { makeReport as rawMakeReport } from './output/report.js';
import { renderCatalogJson as rawCatalogJson, renderReportJson as rawReportJson } from './render/json.js';
import { renderReportTerminal as rawReportTerminal } from './render/terminal.js';
import { renderCatalogMarkdown as rawCatalogMarkdown, renderReportMarkdown as rawReportMarkdown } from './render/markdown.js';

const invalid = () => { throw new CatalogError('invalid_input'); };
const requireInert = value => { if (!isInert(value)) invalid(); };
function strings(argv) {
  if (types.isProxy(argv) || !Array.isArray(argv)) invalid();
  const length = Object.getOwnPropertyDescriptor(argv, 'length').value;
  const out = [];
  for (let i = 0; i < length; i++) {
    const d = Object.getOwnPropertyDescriptor(argv, String(i));
    if (!d || !Object.hasOwn(d, 'value') || typeof d.value !== 'string') invalid();
    Object.defineProperty(out, i, { value: d.value, enumerable: true, writable: true, configurable: true });
  }
  return out;
}
export const parseArgs = argv => rawParseArgs(strings(argv));
export const main = (argv, io) => { if (io !== undefined) invalid(); return rawMain(argv === undefined ? undefined : strings(argv)); };

export const readSnapshotFile = path => { if (typeof path !== 'string') invalid(); return rawReadSnapshotFile(path); };
export { validateSnapshot } from './input/snapshot.js';
export const scanForCredential = text => { if (typeof text !== 'string') invalid(); return rawScanForCredential(text); };
export const redactText = (text, options) => { if (typeof text !== 'string' || options !== undefined) invalid(); return rawRedactText(text); };
export function mergeSnapshots(values) {
  if (types.isProxy(values) || !Array.isArray(values)) invalid();
  const length = Object.getOwnPropertyDescriptor(values, 'length').value;
  if (length > 100) throw new CatalogError('limit_exceeded');
  const safe = [];
  for (let i = 0; i < length; i++) {
    const d = Object.getOwnPropertyDescriptor(values, String(i));
    if (!d || !Object.hasOwn(d, 'value')) invalid();
    requireInert(d.value);
    Object.defineProperty(safe, i, { value: d.value, enumerable: true, writable: true, configurable: true });
  }
  return register(rawMergeSnapshots(safe));
}
const derived = fn => (...args) => { requireInert(args[0]); return register(fn(...args)); };
export const listServers = derived(rawListServers);
export const findCollisions = derived(rawFindCollisions);
export const searchTools = (tools, query) => { requireInert(tools); if (typeof query !== 'string') invalid(); return register(rawSearchTools(tools, query)); };
export const makeCatalog = (command, merged, extra) => { if (typeof command !== 'string') invalid(); requireInert(merged); if (extra !== undefined) requireInert(extra); return register(rawMakeCatalog(command, merged, extra)); };
export const makeReport = (command, merged, extra, options) => { if (typeof command !== 'string') invalid(); requireInert(merged); if (extra !== undefined) requireInert(extra); if (options !== undefined) requireInert(options); return register(rawMakeReport(command, merged, extra, options)); };
export const renderCatalogJson = derived(rawCatalogJson);
export const renderReportJson = derived(rawReportJson);
export const renderReportTerminal = derived(rawReportTerminal);
export const renderCatalogMarkdown = derived(rawCatalogMarkdown);
export const renderReportMarkdown = derived(rawReportMarkdown);
