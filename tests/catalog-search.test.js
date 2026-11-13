// Tests: searchTools (src/catalog/search.js).
// Self-contained: node:test + node:assert/strict only.

import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeSnapshots } from '../src/catalog/merge.js';
import { searchTools } from '../src/catalog/search.js';
import { makeSnapshot } from './doubles/snapshot.js';

function search(serverDefs, query) {
  const merged = mergeSnapshots(serverDefs.map(([server, defs]) => makeSnapshot(server, defs)));
  return searchTools(merged.tools, query);
}

test('AND semantics: every token must match somewhere', () => {
  const { matches, total } = search(
    [['alpha', [
      { name: 'weather', description: 'will get forecasts' },
      { name: 'weather_only' },
    ]]],
    'weather get',
  );
  assert.equal(total, 1);
  assert.deepEqual(matches, [{ tool: 'tool-1', server: 'server-1', score: 101 }]);
});

test('ranking: name match > title match > description match', () => {
  const { matches } = search(
    [['alpha', [
      { name: 'by_title', title: 'find' },
      { name: 'by_desc', description: 'will find things' },
      { name: 'find_by_name' },
    ]]],
    'find',
  );
  // mergeSnapshots re-sorts tools by name: by_desc -> tool-1, by_title -> tool-2.
  assert.deepEqual(matches.map((m) => [m.tool, m.score]), [
    ['tool-3', 100],
    ['tool-2', 10],
    ['tool-1', 1],
  ]);
});

test('score accumulates per token per field', () => {
  const { matches } = search(
    [['alpha', [{ name: 'get', title: 'get things', description: 'get it' }]]],
    'get',
  );
  assert.deepEqual(matches, [{ tool: 'tool-1', server: 'server-1', score: 111 }]);
});

test('case-insensitive substring on both sides', () => {
  const { total } = search(
    [['alpha', [{ name: 'GetData' }, { name: 'getter' }, { name: 'data' }]]],
    'GETDATA',
  );
  assert.equal(total, 1);
  const { total: total2 } = search([['alpha', [{ name: 'GetData' }]]], 'getdata');
  assert.equal(total2, 1);
});

test('tie-break: score desc, then name, then server ordinal, then index', () => {
  const { matches } = search(
    [
      ['beta', [{ name: 'same' }, { name: 'same' }]],
      ['alpha', [{ name: 'same' }, { name: 'aaa' }]],
    ],
    'same',
  );
  // 'aaa' does not contain 'same'. The three 'same' tools tie at score 100:
  // server-1 before server-2, then index within snapshot.
  assert.equal(matches.length, 3);
  assert.deepEqual(matches.map((m) => m.tool), ['tool-2', 'tool-3', 'tool-4']);
});

test('tie-break puts smaller name code-unit first at equal score', () => {
  const result = searchTools(
    [
      { tool: 'tool-1', ordinal: 1, server: 'server-1', serverOrdinal: 1, index: 0, name: 'zz', title: 'q', description: null },
      { tool: 'tool-2', ordinal: 2, server: 'server-1', serverOrdinal: 1, index: 1, name: 'yy', title: 'q', description: null },
    ],
    'q',
  );
  assert.deepEqual(result.matches.map((m) => m.tool), ['tool-2', 'tool-1']); // 'yy' < 'zz'
});

test('emission cap 1,000 with true total in counts', () => {
  const defs = Array.from({ length: 1100 }, (_, i) => ({
    name: `match-${String(i).padStart(4, '0')}`,
  }));
  const { matches, total } = search([['alpha', defs]], 'match');
  assert.equal(total, 1100);
  assert.equal(matches.length, 1000);
  assert.equal(matches[0].tool, 'tool-1');
  assert.equal(matches[999].tool, 'tool-1000');
  for (const m of matches) assert.equal(m.score, 100);
});

test('no results is empty with total 0 (exit 0 at CLI level)', () => {
  const { matches, total } = search([['alpha', [{ name: 'abc' }]]], 'zzz');
  assert.deepEqual(matches, []);
  assert.equal(total, 0);
});

test('null title/description are skipped without error', () => {
  const { matches, total } = search([['alpha', [{ name: 'abc' }]]], 'abc');
  assert.equal(total, 1);
  assert.equal(matches[0].score, 100);
});

test('empty or whitespace-only query -> usage_error', () => {
  assert.throws(() => search([['alpha', [{ name: 'abc' }]]], ''), {
    name: 'CatalogError', kind: 'usage_error',
  });
  assert.throws(() => search([['alpha', [{ name: 'abc' }]]], '   \t '), {
    name: 'CatalogError', kind: 'usage_error',
  });
  assert.throws(() => search([['alpha', [{ name: 'abc' }]]], 42), {
    name: 'CatalogError', kind: 'usage_error',
  });
});

test('query over 200 code units -> usage_error; exactly 200 accepted', () => {
  const tools = [['alpha', [{ name: 'abc' }]]];
  assert.throws(() => search(tools, 'a'.repeat(201)), {
    name: 'CatalogError', kind: 'usage_error',
  });
  const { total } = search(tools, 'abc' + ' '.repeat(194) + 'abc');
  assert.equal(total, 1);
});

test('internal whitespace runs collapse to one space before tokenizing', () => {
  const { total } = search(
    [['alpha', [{ name: 'foo_bar' }]]],
    '  foo \t\n bar  ',
  );
  assert.equal(total, 1);
});

test('query trim removes Cc/Cf edge characters', () => {
  const { total } = search([['alpha', [{ name: 'abc' }]]], '\u0000abc\u0000');
  assert.equal(total, 1);
});

test('malformed tools rejected (invalid_snapshot)', () => {
  assert.throws(() => searchTools([{ name: 'x' }], 'x'), {
    name: 'CatalogError', kind: 'invalid_snapshot',
  });
  assert.throws(() => searchTools('nope', 'x'), {
    name: 'CatalogError', kind: 'invalid_snapshot',
  });
});

test('match entries expose only tool, server, score', () => {
  const { matches } = search(
    [['alpha', [{ name: 'greet', title: 'Greeter' }]]],
    'greet',
  );
  assert.deepEqual(Object.keys(matches[0]).sort(), ['score', 'server', 'tool']);
});
