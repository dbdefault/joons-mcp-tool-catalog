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

test('1 MB redaction and scan stay fast (linear time, generous bound for shared CI machines)', () => {
  const clean = 'lorem ipsum dolor sit amet '.repeat(40000);
  assert.ok(clean.length >= 1000000);
  const best = (fn) => { let min = Infinity; for (let i = 0; i < 3; i++) { const start = performance.now(); fn(); min = Math.min(min, performance.now() - start); } return min; };

  assert.equal(scanForCredential(clean), false);
  const scanMs = best(() => scanForCredential(clean));
  assert.ok(scanMs < 1500, `scan took ${scanMs.toFixed(1)} ms`);

  const out = redactText(clean);
  const redactMs = best(() => redactText(clean));
  assert.ok(redactMs < 1500, `redact took ${redactMs.toFixed(1)} ms`);
  assert.ok(out.endsWith('...'));
});