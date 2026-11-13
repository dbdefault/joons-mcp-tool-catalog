// CLI orchestration tests with the real modules (no injected deps,
// no doubles): the 64 MiB aggregate raw-byte cap (RR-06) and end-to-end
// credential refusal for Bearer-shaped names (RR-03) through production
// wiring. Self-contained; temp dirs are cleaned up.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { main } from '../src/cli.js';

function collector() {
  return { buf: '', write(s) { this.buf += s; } };
}

async function run(argv) {
  const stdout = collector();
  const stderr = collector();
  const code = await main(argv, { stdout, stderr });
  return { code, stdout, stderr };
}

function tmpdir_helper(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'catalog-real-cli-'));
  t.after(() => { rmSync(dir, { recursive: true, force: true }); });
  return dir;
}

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

// One valid snapshot padded with long descriptions to exactly `size` bytes.
function paddedSnapshotBytes(size) {
  const tool = (i, descLen) => ({
    name: `pad_tool_${i}`,
    title: null,
    description: 'd'.repeat(descLen),
    inputSchema: { type: 'object' },
    outputSchema: null,
    annotations: null,
  });
  const make = (tools, label) => ({
    format: 'joons-mcp-diff/snapshot',
    schemaVersion: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    tool: { name: 'fixture-snapshot-writer', version: '1.0.0' },
    label,
    server: { name: 'pad-server', version: '1.0.0', protocolVersion: '2025-06-18' },
    tools,
    stats: { toolCount: tools.length, pages: 1 },
  });
  const tools = Array.from({ length: 83 }, (_, i) => tool(i, 100000));
  const base = Buffer.byteLength(JSON.stringify(make(tools, null)));
  // 'null' (4 chars) is replaced by '"...label..."' (labelLen + 2 chars).
  const labelLen = size - base + 2;
  if (labelLen < 0 || labelLen > 100000) {
    throw new Error(`padded snapshot size ${size} not reachable (labelLen ${labelLen})`);
  }
  const bytes = Buffer.from(JSON.stringify(make(tools, 'L'.repeat(labelLen))));
  assert.equal(bytes.length, size);
  return bytes;
}

test('aggregate raw input over 64 MiB refuses as limit_exceeded (RR-06)', async (t) => {
  const dir = tmpdir_helper(t);
  const one = paddedSnapshotBytes(MAX_FILE_BYTES); // 8 MiB, valid snapshot
  const files = [];
  for (let i = 0; i < 9; i += 1) {
    const file = path.join(dir, `pad-${i}.json`);
    writeFileSync(file, one);
    files.push(file);
  }
  const r = await run(['validate', ...files]);
  assert.equal(r.code, 2);
  assert.equal(r.stderr.buf, 'joons-mcp-tool-catalog: limit_exceeded\n');
  assert.equal(r.stdout.buf, '');
});

test('aggregate raw input at exactly 64 MiB is accepted', async (t) => {
  const dir = tmpdir_helper(t);
  const one = paddedSnapshotBytes(MAX_FILE_BYTES);
  const files = [];
  for (let i = 0; i < 8; i += 1) {
    const file = path.join(dir, `pad-${i}.json`);
    writeFileSync(file, one);
    files.push(file);
  }
  const r = await run(['validate', ...files]);
  assert.equal(r.code, 0, r.stderr.buf);
});

test('Bearer-shaped server name refuses whole run via real admission (RR-03)', async (t) => {
  const dir = tmpdir_helper(t);
  const snapshot = {
    format: 'joons-mcp-diff/snapshot',
    schemaVersion: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    tool: { name: 'fixture-snapshot-writer', version: '1.0.0' },
    label: null,
    server: { name: 'Bearer abc', version: '1.0.0', protocolVersion: '2025-06-18' },
    tools: [],
    stats: { toolCount: 0, pages: 0 },
  };
  const file = path.join(dir, 'bearer.json');
  writeFileSync(file, JSON.stringify(snapshot));
  const r = await run(['validate', file]);
  assert.equal(r.code, 2);
  assert.equal(r.stderr.buf, 'joons-mcp-tool-catalog: credential_detected\n');
});

test('prefixghp_-shaped tool name refuses whole run via real admission (RR-03)', async (t) => {
  const dir = tmpdir_helper(t);
  const snapshot = {
    format: 'joons-mcp-diff/snapshot',
    schemaVersion: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    tool: { name: 'fixture-snapshot-writer', version: '1.0.0' },
    label: null,
    server: { name: 'clean-server', version: '1.0.0', protocolVersion: '2025-06-18' },
    tools: [{
      name: 'prefixghp_ABCDEFGHIJKLMNOPQRST',
      title: null,
      description: null,
      inputSchema: { type: 'object' },
      outputSchema: null,
      annotations: null,
    }],
    stats: { toolCount: 1, pages: 1 },
  };
  const file = path.join(dir, 'prefixed.json');
  writeFileSync(file, JSON.stringify(snapshot));
  const r = await run(['validate', file]);
  assert.equal(r.code, 2);
  assert.equal(r.stderr.buf, 'joons-mcp-tool-catalog: credential_detected\n');
});

test('paired supplementary characters survive the real read path (RR-05)', async (t) => {
  const dir = tmpdir_helper(t);
  const snapshot = {
    format: 'joons-mcp-diff/snapshot',
    schemaVersion: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    tool: { name: 'fixture-snapshot-writer', version: '1.0.0' },
    label: '\uD83D\uDE00', // U+1F600 as a JS string (paired surrogates)
    server: { name: 'emoji-server', version: '1.0.0', protocolVersion: '2025-06-18' },
    tools: [{
      name: 'greet',
      title: null,
      description: null,
      inputSchema: { type: 'object' },
      outputSchema: null,
      annotations: null,
    }],
    stats: { toolCount: 1, pages: 1 },
  };
  const file = path.join(dir, 'emoji.json');
  writeFileSync(file, JSON.stringify(snapshot)); // raw UTF-8 bytes on disk
  const r = await run(['validate', file]);
  assert.equal(r.code, 0, r.stderr.buf);
});
