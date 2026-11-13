// Shipped-file hygiene (RA-004): no internal worker split labels (W1..W4),
// no "worker" wording, no "contract" wording anywhere in the files that the
// release ships (the package.json files allowlist, scanned recursively).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SHIPPED_DIRS = ['bin', 'src', 'examples', 'docs'];
const SHIPPED_FILES = [
  'README.md',
  'README.ko.md',
  'ARCHITECTURE.md',
  'SECURITY.md',
  'LIMITATIONS.md',
  'CHANGELOG.md',
  'LICENSE',
];

// Same patterns the independent review grepped for, plus 'contract'. The
// 'contract' wording ban does not apply to LICENSE: the Apache-2.0 text is
// fixed external legal boilerplate and uses the word in its legal sense.
const BANNED = [/\bW[1-4]\b/, /worker/i];
const BANNED_EXCEPT_LICENSE = [/contract/i];

function collect(dir, acc) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, acc);
    else acc.push(full);
  }
}

test('shipped files contain no internal worker/contract labels', () => {
  const targets = [];
  for (const top of SHIPPED_DIRS) collect(path.join(ROOT, top), targets);
  for (const file of SHIPPED_FILES) targets.push(path.join(ROOT, file));
  assert.ok(targets.length > 10);
  for (const file of targets) {
    const text = readFileSync(file, 'utf8');
    const patterns = path.basename(file) === 'LICENSE'
      ? BANNED
      : BANNED.concat(BANNED_EXCEPT_LICENSE);
    for (const pattern of patterns) {
      assert.ok(!pattern.test(text), `${path.relative(ROOT, file)} matches ${pattern}`);
    }
  }
});
