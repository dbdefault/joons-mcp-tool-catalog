import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./doubles/loader.mjs', import.meta.url);
// Cache-busting query: other suites import the real redact module in the
// same process; force fresh module instances so the loader hook above
// redirects '../security/redact.js' to the double for THESE imports.
const { makeCatalog } = await import('../src/output/catalog.js?redact-double');
const { makeReport } = await import('../src/output/report.js?redact-double');

const merged = { servers: [
  { server: 'server-1', name: 'internal-one', sha256: 'abcdef0123456789', tools: 1 },
  { server: 'server-2', name: 'internal-two', sha256: '0123456789abcdef', tools: 1 }
], tools: [
  { tool: 'tool-1', server: 'server-1', name: 'name*one', title: 'example-secret', description: null },
  { tool: 'tool-2', server: 'server-2', name: 'name*one', title: null, description: 'ok' }
] };
const extra = { collisions: [{kind:'exact', name:'name*one', tools:['tool-1','tool-2']}], matches:[{tool:'tool-1', server:'server-1', score:101}], matchCount:1200 };

test('catalog has fixed schema and redacts text while preserving exact names', () => {
  const c = makeCatalog('build', merged, extra);
  assert.deepEqual(Object.keys(c), ['format','schemaVersion','tool','command','counts','servers','tools','collisions','matches']);
  assert.deepEqual(c.counts, {servers:2,tools:2,collisions:1,collidingTools:2,redactions:1});
  assert.equal(c.servers[0].sha256, 'abcdef012345');
  assert.equal(c.tools[0].name, 'name*one');
  assert.equal(c.tools[0].title, '[MASKED]');
  assert.deepEqual(c.matches, []);
});
test('report is allowlisted and details are explicit', () => {
  const report = makeReport('search', merged, extra);
  assert.equal(report.counts.matches, 1200);
  assert.equal(report.matches[0].score, 101);
  assert.doesNotMatch(JSON.stringify(report), /internal-one|name\*one|example-secret|abcdef/);
  const detailed = makeReport('search', merged, extra, {details:true});
  assert.equal(detailed.matches[0].name, 'name*one');
  assert.equal(detailed.collisions[0].name, 'name*one');
});
test('search match output is capped', () => {
  const matches = Array.from({length: 1001}, () => ({tool:'tool-1',server:'server-1',score:1}));
  const report = makeReport('search', merged, {matches, matchCount:1001});
  assert.equal(report.matches.length, 1000);
  assert.equal(report.counts.matches, 1001);
});
test('counts.matches is the true total from extra.total (CLI key)', () => {
  const matches = Array.from({length: 1000}, () => ({tool:'tool-1',server:'server-1',score:1}));
  const report = makeReport('search', merged, {matches, total: 1001});
  assert.equal(report.matches.length, 1000);
  assert.equal(report.counts.matches, 1001);
  const catalog = makeCatalog('search', merged, {matches, total: 1001});
  assert.equal(catalog.matches.length, 1000);
});
