import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const bin = path.join(root, 'bin', 'joons-mcp-tool-catalog.js');
const fixture = path.join(root, 'examples', 'sample-snapshot.json');

test('package exposes only metadata and retains its CLI', () => {
  for (const key of ['main', 'module', 'types']) assert.equal(Object.hasOwn(manifest, key), false, key);
  assert.deepEqual(manifest.exports, { './package.json': './package.json' });
  assert.equal(manifest.bin['joons-mcp-tool-catalog'], 'bin/joons-mcp-tool-catalog.js');
  assert.ok(!Object.hasOwn(manifest.exports, '.'));
  assert.ok(!Object.keys(manifest.exports).some(key => key.startsWith('./src/')));
  const probe = `import { createRequire } from 'node:module'; for (const name of ['joons-mcp-tool-catalog', 'joons-mcp-tool-catalog/src/index.js']) { try { await import(name); process.exitCode = 1; } catch (error) { if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error; } } createRequire(import.meta.url)('joons-mcp-tool-catalog/package.json');`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('offline package listing and all five real CLI commands', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'catalog-surface-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cache = path.join(dir, 'cache');
  const pack = process.platform === 'win32'
    ? spawnSync('cmd', ['/d', '/s', '/c', `npm pack --dry-run --json --offline --cache "${cache}" "${root}"`], { cwd: dir, encoding: 'utf8', windowsVerbatimArguments: true, timeout: 60000 })
    : spawnSync('npm', ['pack', '--dry-run', '--json', '--offline', '--cache', cache, root], { cwd: dir, encoding: 'utf8', timeout: 60000 });
  assert.equal(pack.status, 0, pack.stderr || String(pack.error));
  const files = JSON.parse(pack.stdout)[0].files.map(entry => entry.path);
  const allowed = new Set([...manifest.files, 'package.json']);
  for (const file of files) assert.ok(allowed.has(file.split('/')[0]), file);
  for (const file of ['package.json', 'bin/joons-mcp-tool-catalog.js', 'src/index.js', 'docs/CLI.md', 'examples/sample-snapshot.json', 'README.md', 'README.ko.md', 'ARCHITECTURE.md', 'SECURITY.md', 'LIMITATIONS.md', 'CHANGELOG.md', 'LICENSE']) assert.ok(files.includes(file), file);
  const cases = [ ['validate', fixture], ['list', fixture], ['search', fixture, '--query', 'weather'], ['collisions', fixture], ['build', fixture, '--out', path.join(dir, 'out')] ];
  for (const args of cases) {
    const result = spawnSync(process.execPath, [bin, ...args], { cwd: dir, encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, `${args[0]}: ${result.stderr}`);
  }
});
