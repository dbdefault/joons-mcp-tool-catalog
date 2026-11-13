import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { prepareOutputDir } from '../src/security/safe-dir.js';

const p = path.posix;
const directory = { isSymbolicLink: () => false, isDirectory: () => true, isFile: () => false };
const symlink = { isSymbolicLink: () => true, isDirectory: () => false, isFile: () => false };
const file = { isSymbolicLink: () => false, isDirectory: () => false, isFile: () => true };
function scenario({ platform = 'darwin', system = 'var', systemKind = 'link', targetDirectory = true, wrongTarget = false, alias = false } = {}) {
  const sys = `/${system}`;
  const sysLower = sys.toLowerCase();
  const real = value => {
    const lower = value.toLowerCase();
    if (lower === '/alias' || lower.startsWith('/alias/')) return '/private/var/folders/out' + value.slice(6);
    if (lower === sysLower || lower.startsWith(sysLower + '/')) return (wrongTarget ? '/elsewhere' : '/private/' + system.toLowerCase()) + value.slice(sys.length);
    return value;
  };
  const ids = new Map(); let next = 1n;
  const identity = value => { const key = real(value).toLowerCase(); if (!ids.has(key)) ids.set(key, next++); return { ...directory, dev: 1n, ino: ids.get(key), nlink: 1n }; };
  const fs = {
    async lstat(value) { if (value.toLowerCase() === sysLower) return systemKind === 'file' ? file : symlink; if (value === '/Users/x/link') return symlink; return directory; },
    async stat(value) { if (value.toLowerCase() === sysLower && !targetDirectory) return file; return identity(value); },
    async realpath(value) { if (alias && value === '/alias/source.json') return '/private/var/folders/out/source.json'; return real(value); },
    async readdir() { return []; },
    async mkdir() { throw new Error('unexpected mkdir'); },
  };
  return { platform, path: p, fs };
}
const bad = e => e && e.kind === 'output_error';

test('simulated darwin admits directory targets under each allowed system link', async () => {
  for (const sys of ['var', 'tmp', 'etc', 'VAR', 'Var']) {
    const result = await prepareOutputDir(`/${sys}/folders/out`, [], false, scenario({ system: sys }));
    assert.equal(result, `/${sys}/folders/out`);
    assert.equal(await prepareOutputDir(`/${sys}`, [], false, scenario({ system: sys })), `/${sys}`);
  }
});
test('simulated realpath and link-target stat errors fail closed', async () => {
  const brokenLink = scenario(); brokenLink.fs.stat = async () => { throw new Error('unavailable'); };
  await assert.rejects(prepareOutputDir('/var/folders/out', [], false, brokenLink), bad);
  const brokenInput = scenario(); const original = brokenInput.fs.realpath;
  brokenInput.fs.realpath = async value => { if (value.endsWith('/source.json')) throw new Error('unavailable'); return original(value); };
  await assert.rejects(prepareOutputDir('/var/folders/out', ['/private/var/other/source.json'], true, brokenInput), bad);
});
test('simulated creation under a system link resolves its existing ancestor', async () => {
  const opts = scenario(); const original = opts.fs.lstat; let created = false;
  opts.fs.lstat = async value => { if (value === '/var/folders/new' && !created) { const e = new Error('missing'); e.code = 'ENOENT'; throw e; } return original(value); };
  opts.fs.mkdir = async value => { assert.equal(value, '/var/folders/new'); created = true; };
  assert.equal(await prepareOutputDir('/var/folders/new', ['/private/var/folders/other/source.json'], false, opts), '/var/folders/new');
  assert.equal(created, true);
});
test('simulated darwin rejects non-system links, files and invalid link targets', async () => {
  await assert.rejects(prepareOutputDir('/var/folders/out', [], false, scenario({ platform: 'linux' })), bad);
  await assert.rejects(prepareOutputDir('/Users/x/link/out', [], false, scenario()), bad);
  await assert.rejects(prepareOutputDir('/var/folders/out', [], false, scenario({ systemKind: 'file' })), bad);
  await assert.rejects(prepareOutputDir('/var/folders/out', [], false, scenario({ targetDirectory: false })), bad);
  await assert.rejects(prepareOutputDir('/var/folders/out', [], false, scenario({ wrongTarget: true })), bad);
});
test('simulated darwin resolves both sides before overlap and alias checks', async () => {
  const opts = scenario({ alias: true });
  assert.equal(await prepareOutputDir('/var/folders/out', ['/private/var/folders/other/source.json'], true, opts), '/var/folders/out');
  await assert.rejects(prepareOutputDir('/var/folders/out', ['/private/var/folders/out/source.json'], true, scenario()), bad);
  await assert.rejects(prepareOutputDir('/private/var/folders/out', ['/var/folders/out/source.json'], true, scenario()), bad);
  await assert.rejects(prepareOutputDir('/var/folders/out', ['/alias/source.json'], true, scenario({ alias: true })), bad);
  await assert.rejects(prepareOutputDir('/VAR/folders/out', ['/private/var/folders/OUT/source.json'], true, scenario({ system: 'VAR' })), bad);
});
