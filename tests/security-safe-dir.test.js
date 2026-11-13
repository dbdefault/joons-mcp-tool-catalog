import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, link, readFile, readdir, rename, symlink, unlink, writeFile, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  MARKER_NAME,
  prepareOutputDir,
  writeAtomic
} from '../src/security/safe-dir.js';
import { CatalogError } from '../src/errors.js';

const execFileAsync = promisify(execFile);

async function tempRoot() {
  return mkdtemp(path.join(tmpdir(), 'catalog-safedir-'));
}

async function expectOutputError(promise) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof CatalogError, 'expected CatalogError');
    assert.equal(error.kind, 'output_error');
    assert.equal(error.message, '');
    return true;
  });
}

test('creates a fresh nested directory', async () => {
  const root = await tempRoot();
  try {
    const target = path.join(root, 'a', 'b');
    const result = await prepareOutputDir(target, [], false);
    assert.equal(result, path.resolve(target));
    const info = await lstat(result);
    assert.ok(info.isDirectory());
  } finally {
    await unlink(path.join(root, 'a', 'b')).catch(() => {});
  }
});

test('accepts existing empty directory without marker', async () => {
  const root = await tempRoot();
  const target = path.join(root, 'out');
  await mkdir(target);
  const result = await prepareOutputDir(target, [], false);
  assert.equal(result, path.resolve(target));
});

test('nonempty foreign directory refused without marker, accepted with marker or force', async () => {
  const root = await tempRoot();
  const target = path.join(root, 'out');
  await mkdir(target);
  await writeFile(path.join(target, 'foreign.txt'), 'x');
  await expectOutputError(prepareOutputDir(target, [], false));
  await expectOutputError(prepareOutputDir(target, [], undefined));

  const withForce = await prepareOutputDir(target, [], true);
  assert.equal(withForce, path.resolve(target));

  await writeFile(path.join(target, MARKER_NAME), '');
  const withMarker = await prepareOutputDir(target, [], false);
  assert.equal(withMarker, path.resolve(target));
});

test('marker as directory is refused', async () => {
  const root = await tempRoot();
  const target = path.join(root, 'out');
  await mkdir(target);
  await mkdir(path.join(target, MARKER_NAME));
  await writeFile(path.join(target, 'x.txt'), 'x');
  await expectOutputError(prepareOutputDir(target, [], false));
});

test('marker as symlink is refused', async (t) => {
  const root = await tempRoot();
  const target = path.join(root, 'out');
  await mkdir(target);
  await writeFile(path.join(target, 'x.txt'), 'x');
  try {
    await symlink('x.txt', path.join(target, MARKER_NAME), 'file');
  } catch (error) {
    if (error && error.code === 'EPERM') {
      t.skip('symlinks unavailable (permissions)');
      return;
    }
    throw error;
  }
  await expectOutputError(prepareOutputDir(target, [], false));
});

test('file target refused', async () => {
  const root = await tempRoot();
  const target = path.join(root, 'afile');
  await writeFile(target, 'x');
  await expectOutputError(prepareOutputDir(target, [], false));
});

test('symlink component refused', async (t) => {
  const root = await tempRoot();
  const real = path.join(root, 'real');
  await mkdir(real);
  const link = path.join(root, 'link');
  try {
    await symlink(real, link, 'dir');
  } catch (error) {
    if (error && error.code === 'EPERM') {
      t.skip('symlinks unavailable (permissions)');
      return;
    }
    throw error;
  }
  await expectOutputError(prepareOutputDir(path.join(link, 'out'), [], false));
});

test('junction component refused on windows', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('windows-only junction test');
    return;
  }
  const root = await tempRoot();
  const real = path.join(root, 'real');
  await mkdir(real);
  const link = path.join(root, 'junction');
  await execFileAsync('cmd', ['/d', '/c', 'mklink', '/j', link, real]);
  await expectOutputError(prepareOutputDir(path.join(link, 'out'), [], false));
});

test('darwin system links /var /tmp /etc are the only allowed symlinks', async (t) => {
  if (process.platform === 'darwin') {
    for (const p of ['/var', '/tmp', '/etc']) {
      const info = await lstat(p);
      if (!info.isSymbolicLink()) {
        t.skip(`${p} is not a symlink on this host`);
        return;
      }
      // The system link itself is readable, while its root may not be
      // writable. Creation below a link is exercised by the simulated test.
      const result = await prepareOutputDir(p, [], true);
      assert.equal(result, path.resolve(p));
    }
    return;
  }
  // On non-darwin platforms a /var-style link gets no allowance; prove the
  // code path by pointing a link-shaped path at the platform rules instead.
  const root = await tempRoot();
  const fakeVar = path.join(root, 'var');
  const real = path.join(root, 'private-var');
  await mkdir(real);
  try {
    await symlink(real, fakeVar, 'dir');
  } catch (error) {
    if (error && error.code === 'EPERM') {
      t.skip('symlinks unavailable (permissions)');
      return;
    }
    throw error;
  }
  await expectOutputError(prepareOutputDir(path.join(fakeVar, 'out'), [], false));
});

test('output equal to input parent or containing inputs is refused', async () => {
  const root = await tempRoot();
  const inputDir = path.join(root, 'inputs');
  await mkdir(inputDir);
  const input = path.join(inputDir, 'snap.json');
  await writeFile(input, '{}');

  await expectOutputError(prepareOutputDir(inputDir, [input], false));

  // Output is an ancestor of the input's directory -> refused.
  await expectOutputError(prepareOutputDir(root, [input], false));

  // Sibling directory is fine.
  const sibling = path.join(root, 'out');
  const ok = await prepareOutputDir(sibling, [input], false);
  assert.equal(ok, path.resolve(sibling));
});

test('writeAtomic writes and overwrites regular files', async () => {
  const root = await tempRoot();
  const dir = await prepareOutputDir(path.join(root, 'out'), [], false);
  await writeAtomic(dir, 'catalog.json', Buffer.from('v1'));
  assert.equal(await readFile(path.join(dir, 'catalog.json'), 'utf8'), 'v1');
  await writeAtomic(dir, 'catalog.json', Buffer.from('v2'));
  assert.equal(await readFile(path.join(dir, 'catalog.json'), 'utf8'), 'v2');
  // No temp litter.
  const entries = await readdir(dir);
  assert.deepEqual(entries, ['catalog.json']);
});

test('writeAtomic refuses symlink destination', async (t) => {
  const root = await tempRoot();
  const dir = await prepareOutputDir(path.join(root, 'out'), [], false);
  const dest = path.join(dir, 'dest.txt');

  await mkdir(path.join(dir, 'asdir'));
  await expectOutputError(writeAtomic(dir, 'asdir', Buffer.from('x')));

  try {
    await symlink('catalog.json', dest, 'file');
  } catch (error) {
    if (error && error.code === 'EPERM') {
      t.skip('symlinks unavailable (permissions)');
      return;
    }
    throw error;
  }
  await expectOutputError(writeAtomic(dir, 'dest.txt', Buffer.from('x')));
  await unlink(dest);
});

test('writeAtomic refuses directory, hardlinked and input-hardlinked destinations', async () => {
  const root = await tempRoot();
  const dir = await prepareOutputDir(path.join(root, 'out'), [], false);
  await mkdir(path.join(dir, 'asdir'));
  await expectOutputError(writeAtomic(dir, 'asdir', Buffer.from('x')));
  // Hardlinked pair: nlink > 1 refuses overwrite.
  await writeAtomic(dir, 'dest.txt', Buffer.from('x'));
  const hard = path.join(dir, 'hard.txt');
  await link(path.join(dir, 'dest.txt'), hard);
  await expectOutputError(writeAtomic(dir, 'dest.txt', Buffer.from('y')));
  assert.equal(await readFile(path.join(dir, 'dest.txt'), 'utf8'), 'x');
  await unlink(hard);

  // Dest hardlinked to an input is refused via options.inputs.
  const inputDir = await tempRoot();
  const input = path.join(inputDir, 'snap.json');
  await writeFile(input, 'snapshot-bytes');
  const linked = path.join(dir, 'linked.json');
  await link(input, linked);
  await expectOutputError(
    writeAtomic(dir, 'linked.json', Buffer.from('y'), { inputs: [input] })
  );
  assert.equal(await readFile(input, 'utf8'), 'snapshot-bytes');
  await unlink(linked);
});

test('writeAtomic failed retry never loses an existing destination (injected fs)', async () => {
  const root = await tempRoot();
  const dir = path.join(root, 'out');
  await mkdir(dir);
  const dest = path.join(dir, 'catalog.json');
  await writeFile(dest, 'precious');

  // Case 1: rename over dest fails, moving dest aside also fails
  // (rename called for temp->dest then dest->backup). Dest must survive.
  let renameCalls = 0;
  const failingMoveAside = {
    rename: async (from, to) => {
      renameCalls += 1;
      if (renameCalls <= 2) {
        const e = new Error('EPERM');
        e.code = 'EPERM';
        throw e;
      }
      return rename(from, to);
    }
  };
  await expectOutputError(
    writeAtomic(dir, 'catalog.json', Buffer.from('new'), { fs: failingMoveAside })
  );
  assert.equal(await readFile(dest, 'utf8'), 'precious');

  // Case 2: temp->dest fails, dest->backup succeeds, retry temp->dest fails,
  // backup->dest restore succeeds. Dest must survive unchanged.
  let calls2 = 0;
  const failingRetry = {
    rename: async (from, to) => {
      calls2 += 1;
      if (calls2 === 1 || calls2 === 3) {
        const e = new Error('EPERM');
        e.code = 'EPERM';
        throw e;
      }
      return rename(from, to);
    }
  };
  await expectOutputError(
    writeAtomic(dir, 'catalog.json', Buffer.from('new'), { fs: failingRetry })
  );
  assert.equal(await readFile(dest, 'utf8'), 'precious');

  // Case 3: healthy injected fs still overwrites via the normal path.
  await writeAtomic(dir, 'catalog.json', Buffer.from('new'), {
    fs: { rename, unlink }
  });
  assert.equal(await readFile(dest, 'utf8'), 'new');

  // No litter from the injected-failure runs.
  const litter = await readdir(dir).then((list) => list.filter((n) => n.includes('.tmp-') || n.includes('.prior-')));
  assert.deepEqual(litter, []);
});

test('writeAtomic failure leaves no temp litter', async () => {
  const root = await tempRoot();
  const dir = path.join(root, 'out');
  await mkdir(dir);
  await writeFile(path.join(dir, 'catalog.json'), 'precious');
  // Refusal path: dest exists with nlink > 1 -> no temps, dest untouched.
  await link(path.join(dir, 'catalog.json'), path.join(dir, 'copy.json'));
  await expectOutputError(
    writeAtomic(dir, 'catalog.json', Buffer.from('attacker'))
  );
  assert.equal(await readFile(path.join(dir, 'catalog.json'), 'utf8'), 'precious');
  const entries = await readdir(dir).then((list) => list.filter((n) => n.includes('.tmp-')));
  assert.deepEqual(entries, []);

  // Marker name is the contract constant.
  assert.equal(MARKER_NAME, '.joons-mcp-tool-catalog-output');
});

test('writeAtomic rejects path-traversing names', async () => {
  const root = await tempRoot();
  const dir = await prepareOutputDir(path.join(root, 'out'), [], false);
  await expectOutputError(writeAtomic(dir, '../evil.txt', Buffer.from('x')));
  await expectOutputError(writeAtomic(dir, 'a/b.txt', Buffer.from('x')));
  await expectOutputError(writeAtomic(dir, '..', Buffer.from('x')));
});
