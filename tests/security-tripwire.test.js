import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactText } from '../src/security/redact.js';
import { scanForCredential } from '../src/security/credentials.js';

const SRC_FILES = [
  'src/errors.js',
  'src/input/read.js',
  'src/input/snapshot.js',
  'src/security/limits.js',
  'src/security/credentials.js',
  'src/security/redact.js',
  'src/security/safe-dir.js'
];

const FORBIDDEN = [
  /node:child_process/,
  /node:net\b/,
  /node:dns/,
  /node:http/,
  /node:https/,
  /node:tls/,
  /require\(['"]node:/
];

test('no network, subprocess or dynamic-code modules anywhere in W2 source', async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const file of SRC_FILES) {
    const text = await readFile(path.join(here, '..', file), 'utf8');
    for (const pattern of FORBIDDEN) {
      assert.ok(
        !pattern.test(text),
        `${file} must not match ${pattern}`
      );
    }
  }
});

test('1 MB redaction and scan stay under 200 ms', () => {
  const clean = 'lorem ipsum dolor sit amet '.repeat(40000);
  assert.ok(clean.length >= 1000000);

  let start = performance.now();
  assert.equal(scanForCredential(clean), false);
  const scanMs = performance.now() - start;
  assert.ok(scanMs < 200, `scan took ${scanMs.toFixed(1)} ms`);

  start = performance.now();
  const out = redactText(clean);
  const redactMs = performance.now() - start;
  assert.ok(redactMs < 200, `redact took ${redactMs.toFixed(1)} ms`);
  assert.ok(out.endsWith('...'));
});
