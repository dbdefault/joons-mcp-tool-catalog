// Release contents (RA-003): npm pack must ship exactly the documented
// allowlist -- bin/, src/, examples/, docs/, README.md, README.ko.md,
// ARCHITECTURE.md, SECURITY.md, LIMITATIONS.md, CHANGELOG.md, LICENSE --
// and never tests/, scripts/, test doubles, or internal docs.
// Offline: npm pack --dry-run performs no network access.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const ROOT = fileURLToPath(new URL('../', import.meta.url));
// npm is a .cmd shim on Windows: go through cmd /c there.

const ALLOWED_TOP = new Set([
  'bin',
  'src',
  'examples',
  'docs',
  'README.md',
  'README.ko.md',
  'ARCHITECTURE.md',
  'SECURITY.md',
  'LIMITATIONS.md',
  'CHANGELOG.md',
  'LICENSE',
  'package.json', // npm always includes the manifest itself
]);

test('npm pack --dry-run ships the allowlist and no tests/scripts/internal files', async (t) => {
  const cache = mkdtempSync(path.join(tmpdir(), 'catalog-npm-'));
  t.after(() => rmSync(cache, { recursive: true, force: true }));
  const PACK_CMD = process.platform === 'win32'
    ? { bin: 'cmd', args: ['/d', '/s', '/c', `npm pack --dry-run --json --offline --cache "${cache}"`] }
    : { bin: 'npm', args: ['pack', '--dry-run', '--json', '--offline', '--cache', cache] };
  let parsed;
  try {
    const { stdout } = await execFileAsync(PACK_CMD.bin, PACK_CMD.args, {
      cwd: ROOT,
      timeout: 60000,
      windowsVerbatimArguments: process.platform === 'win32',
    });
    parsed = JSON.parse(stdout);
  } catch (error) {
    if (error && (error.code === 'ENOENT' || (process.platform === 'win32' && error.code === 1 && /not recognized/i.test(error.stderr || '')))) {
      t.skip('npm not available on this host');
      return;
    }
    throw error;
  }
  assert.ok(Array.isArray(parsed) && parsed.length === 1, 'expected one pack entry');
  const files = parsed[0].files.map((entry) => entry.path);
  assert.ok(files.length > 0);
  for (const file of files) {
    const top = file.split('/')[0];
    assert.ok(ALLOWED_TOP.has(top), `file outside the release allowlist: ${file}`);
    assert.ok(!file.startsWith('tests/'), `tests/ must not ship: ${file}`);
    assert.ok(!file.startsWith('scripts/'), `scripts/ must not ship: ${file}`);
    assert.ok(!file.includes('doubles'), `test doubles must not ship: ${file}`);
    assert.ok(!file.endsWith('CONTRIBUTING.md'), `internal docs must not ship: ${file}`);
  }
  // The product itself is present.
  assert.ok(files.includes('package.json'));
  assert.ok(files.includes('bin/joons-mcp-tool-catalog.js'));
  assert.ok(files.includes('src/index.js'));
  assert.ok(files.includes('docs/CLI.md'));
  assert.ok(files.includes('examples/sample-snapshot.json'));
  for (const doc of ['README.md', 'README.ko.md', 'ARCHITECTURE.md', 'SECURITY.md', 'LIMITATIONS.md', 'CHANGELOG.md', 'LICENSE']) {
    assert.ok(files.includes(doc), `missing shipped doc: ${doc}`);
  }
});
