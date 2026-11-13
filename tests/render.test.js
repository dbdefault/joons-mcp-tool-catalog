import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCatalogJson, renderReportJson } from '../src/render/json.js';
import { renderCatalogMarkdown, renderReportMarkdown } from '../src/render/markdown.js';
import { renderReportTerminal } from '../src/render/terminal.js';

test('renderers use LF and JSON is indented and newline terminated', () => {
  const report={command:'search',status:'PASS',mode:{details:true},counts:{matches:1},servers:[{server:'server-1',tools:1,name:'a*<b>'}],collisions:[],matches:[]};
  const catalog={counts:{tools:1},servers:[],tools:[{tool:'tool-1',server:'server-1',name:'private-name',collides:false}],collisions:[]};
  for (const text of [renderReportJson(report),renderCatalogJson(catalog),renderReportMarkdown(report),renderCatalogMarkdown(catalog),renderReportTerminal(report)]) {
    assert.ok(text.endsWith('\n'));
    assert.ok(!text.includes('\r'));
  }
  assert.equal(renderCatalogJson({a:1}), '{\n  "a": 1\n}\n');
  assert.match(renderReportMarkdown(report), /a\\\*\\<b\\>/);
  assert.doesNotMatch(renderCatalogMarkdown(catalog), /private-name/);
  assert.match(renderReportTerminal(report), /details: may contain internal names/);
});
