import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readSnapshotFile, parseSnapshotBytes } from '../src/input/read.js';
import { snapshotJson } from './doubles/snapshot-input.js';

async function withTempFile(bytes, run, name = 'snap.json') {
  const dir = await mkdtemp(path.join(tmpdir(), 'catalog-read-'));
  const file = path.join(dir, name);
  try {
    await writeFile(file, bytes);
    await run(file, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('reads a valid snapshot and returns value plus full sha256', async () => {
  const bytes = snapshotJson();
  await withTempFile(bytes, async (file) => {
    const { value, sha256 } = await readSnapshotFile(file);
    assert.equal(value.format, 'joons-mcp-diff/snapshot');
    assert.equal(value.tools[0].name, 'greet');
    assert.equal(typeof sha256, 'string');
    assert.match(sha256, /^[0-9a-f]{64}$/);
    assert.equal(sha256, createHash('sha256').update(bytes).digest('hex'));
  });
});

test('single BOM removed before parsing', async () => {
  const bytes = snapshotJson();
  await withTempFile(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(bytes)]), async (file) => {
    const { value, sha256 } = await readSnapshotFile(file);
    assert.equal(value.format, 'joons-mcp-diff/snapshot');
    // Hash covers raw bytes including the BOM.
    const raw = await import('node:fs/promises').then((fs) => fs.readFile(file));
    assert.equal(sha256, createHash('sha256').update(raw).digest('hex'));
  });
});

test('missing file and directory refuse as input_unreadable', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'catalog-read-'));
  try {
    await assert.rejects(
      readSnapshotFile(path.join(dir, 'nope.json')),
      (e) => e.kind === 'input_unreadable'
    );
    await assert.rejects(
      readSnapshotFile(dir),
      (e) => e.kind === 'input_unreadable'
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('file larger than 8 MiB refuses as limit_exceeded', async () => {
  const big = Buffer.alloc(8 * 1024 * 1024 + 1, 0x20);
  await withTempFile(big, async (file) => {
    await assert.rejects(readSnapshotFile(file), (e) => e.kind === 'limit_exceeded');
  });
});

test('file at exactly 8 MiB fails structural check, not the size cap', async () => {
  const edge = Buffer.concat([
    Buffer.alloc(8 * 1024 * 1024 - 1, 0x20),
    Buffer.from('[')
  ]);
  assert.equal(edge.length, 8 * 1024 * 1024);
  await withTempFile(edge, async (file) => {
    await assert.rejects(readSnapshotFile(file), (e) => e.kind === 'invalid_json');
  });
});

test('fatal UTF-8 decode refuses as invalid_json', async () => {
  await withTempFile(Buffer.from([0xff, 0xfe, 0xfd, 0x00]), async (file) => {
    await assert.rejects(readSnapshotFile(file), (e) => e.kind === 'invalid_json');
  });
});

test('well-formed JSON with wrong shape refuses as invalid_snapshot', async () => {
  await withTempFile(JSON.stringify({ hello: 'world' }), async (file) => {
    await assert.rejects(readSnapshotFile(file), (e) => e.kind === 'invalid_snapshot');
  });
});

test('parseSnapshotBytes is exported for bounded-parse reuse', () => {
  const value = parseSnapshotBytes(Buffer.from('{"a":[1,true,null]}'));
  assert.deepEqual(value, { a: [1, true, null] });
});

test('valid paired supplementary characters (raw UTF-8) are accepted', async () => {
  // U+1F600 as raw UTF-8 bytes inside a valid snapshot label.
  const snap = snapshotJson({ label: '\uD83D\uDE00' });
  await withTempFile(snap, async (file) => {
    const { value } = await readSnapshotFile(file);
    assert.equal(value.label, '\uD83D\uDE00');
  });
  // Escaped pair form is equivalent.
  const escaped = snap.replace('\uD83D\uDE00', '\\uD83D\\uDE00');
  await withTempFile(escaped, async (file) => {
    const { value } = await readSnapshotFile(file);
    assert.equal(value.label, '\uD83D\uDE00');
  });
});

test('lone surrogates are rejected as invalid_json', async () => {
  const loneHigh = snapshotJson({ label: 'x' }).replace('"x"', '"\\uD800"');
  await withTempFile(loneHigh, async (file) => {
    await assert.rejects(readSnapshotFile(file), (e) => e.kind === 'invalid_json');
  });
  const loneLow = snapshotJson({ label: 'x' }).replace('"x"', '"\\uDC00"');
  await withTempFile(loneLow, async (file) => {
    await assert.rejects(readSnapshotFile(file), (e) => e.kind === 'invalid_json');
  });
  // CESU-8-style surrogate encoding (ED A0 80) is fatal UTF-8, also invalid_json.
  await withTempFile(Buffer.from([0x22, 0xED, 0xA0, 0x80, 0x22]), async (file) => {
    await assert.rejects(readSnapshotFile(file), (e) => e.kind === 'invalid_json');
  });
});

test('credential-shaped server name refuses whole snapshot', async () => {
  const snap = snapshotJson({
    server: { name: 'ghp_abcdefghijklmnopqrstuv', version: '1', protocolVersion: '1' }
  });
  await withTempFile(snap, async (file) => {
    await assert.rejects(readSnapshotFile(file), (e) => e.kind === 'credential_detected');
  });
});

test('input paths are never executed, expanded or read as directories', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'catalog-read-'));
  try {
    const sub = path.join(dir, 'subdir');
    await mkdir(sub);
    await assert.rejects(readSnapshotFile(sub), (e) => e.kind === 'input_unreadable');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
