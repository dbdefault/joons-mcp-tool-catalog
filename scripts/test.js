// Test entry point. Explicitly enumerates test files and loads them with
// the built-in node:test runner (tests self-register on import and the
// runner reports results and sets the exit code automatically).
// No installs, no network. Files that do not exist yet are skipped with a
// note, so this script works both standalone and after full integration.

import { existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);

const TEST_FILES = [
  // CLI, orchestration and integration
  'tests/args.test.js',
  'tests/round3.test.js',
  'tests/round4.test.js',
  'tests/round5.test.js',
  'tests/round6.test.js',
  'tests/round8.test.js',
  'tests/round9.test.js',
  'tests/round10.test.js',
  'tests/round11.test.js',
  'tests/round13.test.js',
  'tests/round14.test.js',
  'tests/security-matrix.test.js',
  'tests/security-scaling.test.js',
  'tests/cli.test.js',
  'tests/cli-real.test.js',
  'tests/index-exports.test.js',
  'tests/e2e.test.js',
  'tests/e2e-real.test.js',
  'tests/e2e.docs.test.js',
  'tests/pack-contents.test.js',
  'tests/package-surface.test.js',
  'tests/internal-labels.test.js',
  // Core catalog algorithms
  'tests/catalog-merge.test.js',
  'tests/catalog-collisions.test.js',
  'tests/catalog-search.test.js',
  // Input and security
  'tests/input-read.test.js',
  'tests/input-snapshot.test.js',
  'tests/security-limits.test.js',
  'tests/security-credentials.test.js',
  'tests/security-redact.test.js',
  'tests/security-safe-dir.test.js',
  // Output and rendering
  'tests/output.test.js',
  'tests/render.test.js',
  'tests/security-tripwire.test.js',

];

const files = [];
const missing = [];
for (const rel of TEST_FILES) {
  const url = new URL(rel, root);
  if (existsSync(url)) files.push(url);
  else missing.push(rel);
}

if (files.length === 0) {
  process.stderr.write('scripts/test.js: no test files found\n');
  process.exit(1);
}
if (missing.length > 0) {
  process.stderr.write(`scripts/test.js: skipped (not present yet): ${missing.join(', ')}\n`);
}

let failed = false;
for (const url of files) {
  try {
    await import(url);
  } catch (err) {
    failed = true;
    process.stderr.write(`scripts/test.js: failed to load ${url.pathname}: ${err}\n`);
  }
}
if (failed) {
  process.exitCode = 1;
}
