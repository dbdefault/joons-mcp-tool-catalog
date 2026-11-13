// Output directory safety and atomic writes.
//
// prepareOutputDir resolves the absolute target, refuses symlink/junction
// components (except the resolved macOS system links /var, /tmp, /etc on
// darwin), refuses file targets, refuses directories that are (or contain)
// an input's parent, and accepts a nonempty existing directory only with
// our regular non-symlink marker or force.
//
// writeAtomic writes via an exclusive random same-directory temp file,
// flush/closes, then renames over the destination. On any failure it
// removes only its own temp and preserves an existing destination.
//
// Residual TOCTOU: checks and writes are separate syscalls; an attacker
// swapping components between prepareOutputDir and writeAtomic is not
// fully excluded on platforms without true no-follow openat support.

import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  stat,
  unlink
} from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { outputError } from '../errors.js';

export const MARKER_NAME = '.joons-mcp-tool-catalog-output';

const DARWIN_SYSTEM_LINKS = new Set(['/var', '/tmp', '/etc']);
const DEFAULT_CONTEXT = { platform: process.platform, path, fs: { lstat, stat, realpath, readdir, mkdir } };

function componentsOf(absolutePath, ctx) {
  const parsed = ctx.path.parse(absolutePath);
  const rest = absolutePath.slice(parsed.root.length);
  const segs = rest.split(ctx.path.sep).filter((s) => s.length > 0);
  return { root: parsed.root, segments: segs };
}

function keySegments(absolutePath, ctx) {
  const { root, segments } = componentsOf(absolutePath, ctx);
  const fold = ctx.platform === 'win32' || ctx.platform === 'darwin';
  const rootKey = fold ? root.toLowerCase() : root;
  return [rootKey, ...segments.map((s) => (fold ? s.toLowerCase() : s))];
}

function samePath(a, b, ctx) {
  const ka = keySegments(a, ctx);
  const kb = keySegments(b, ctx);
  return ka.length === kb.length && ka.every((part, i) => part === kb[i]);
}

// True when `ancestor` is a strict component-prefix of `descendant`.
function containsPath(ancestor, descendant, ctx) {
  const ka = keySegments(ancestor, ctx);
  const kb = keySegments(descendant, ctx);
  if (ka.length >= kb.length) return false;
  return ka.every((part, i) => part === kb[i]);
}

function err() {
  throw outputError();
}

async function lstatOrNull(p, ctx = DEFAULT_CONTEXT) {
  try {
    return await ctx.fs.lstat(p);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    err();
  }
}

// Walks existing components from the filesystem root. Returns true when
// the full target exists as a directory.
async function checkComponents(target, ctx) {
  const { root, segments } = componentsOf(target, ctx);
  let current = root;
  for (const segment of segments) {
    current = ctx.path.join(current, segment);
    const info = await lstatOrNull(current, ctx);
    if (info === null) return false; // first missing component
    if (info.isSymbolicLink()) {
      const allowed =
        ctx.platform === 'darwin' && DARWIN_SYSTEM_LINKS.has(current.toLowerCase());
      if (!allowed) err();
      try {
        const resolved = await ctx.fs.realpath(current);
        const expected = '/private' + current.toLowerCase();
        if (!samePath(resolved, expected, ctx) || !(await ctx.fs.stat(current)).isDirectory()) err();
      } catch { err(); }
      continue;
    }
    if (!info.isDirectory()) err(); // file or other non-directory target
  }
  return true;
}

function checkNotContainingInputs(target, inputs, ctx) {
  for (const input of inputs) {
    const parent = ctx.path.dirname(input);
    if (samePath(target, parent, ctx)) err();
    if (containsPath(target, parent, ctx)) err();
  }
}

// Resolve an existing ancestor and append only the as-yet-uncreated suffix.
async function resolvedTarget(target, ctx) {
  let current = target;
  const missing = [];
  for (;;) {
    const info = await lstatOrNull(current, ctx);
    if (info !== null) {
      try { return ctx.path.join(await ctx.fs.realpath(current), ...missing.reverse()); }
      catch { err(); }
    }
    const parent = ctx.path.dirname(current);
    if (parent === current) err();
    missing.push(ctx.path.basename(current));
    current = parent;
  }
}

function usableIdentity(info) {
  return typeof info.dev === 'bigint' && typeof info.ino === 'bigint' && info.ino !== 0n;
}

// When an input has multiple links, refuse any matching file already under
// the output directory, without traversing symlinks or junctions.
async function checkLinkedInputs(target, inputs, ctx) {
  const linked = inputs.filter(info => info.nlink > 1n && usableIdentity(info));
  if (linked.length === 0) return;
  const pending = [target];
  while (pending.length) {
    const dir = pending.pop();
    let names;
    try { names = await ctx.fs.readdir(dir); } catch { err(); }
    for (const name of names) {
      const child = ctx.path.join(dir, name);
      let info;
      try { info = await ctx.fs.lstat(child, { bigint: true }); } catch { err(); }
      if (info.isSymbolicLink()) continue;
      if (info.isFile() && usableIdentity(info) && linked.some(input => isSameFile(input, info))) err();
      if (info.isDirectory()) pending.push(child);
    }
  }
}

// dir: output directory as given on the command line.
// inputPaths: resolved-or-not input file paths (already admitted).
// force: allow a nonempty foreign directory.
// Returns the absolute directory path (created if needed).
export async function prepareOutputDir(dir, inputPaths, force, ctx = DEFAULT_CONTEXT) {
  if (typeof dir !== 'string' || dir.length === 0) err();
  const target = ctx.path.resolve(dir);
  const inputs = Array.isArray(inputPaths)
    ? inputPaths.map((p) => ctx.path.resolve(String(p)))
    : [];

  const exists = await checkComponents(target, ctx);
  const targetReal = await resolvedTarget(target, ctx);
  const inputReal = [];
  const inputInfo = [];
  for (const input of inputs) {
    try { inputReal.push(await ctx.fs.realpath(input)); inputInfo.push(await ctx.fs.stat(input, { bigint: true })); }
    catch { err(); }
  }
  checkNotContainingInputs(targetReal, inputReal, ctx);
  if (exists) {
    let targetInfo;
    try { targetInfo = await ctx.fs.stat(targetReal, { bigint: true }); } catch { err(); }
    if (usableIdentity(targetInfo)) {
      for (const input of inputReal) {
        let parent = ctx.path.dirname(input);
        for (;;) {
          let info;
          try { info = await ctx.fs.stat(parent, { bigint: true }); } catch { err(); }
          if (usableIdentity(info) && isSameFile(targetInfo, info)) err();
          const next = ctx.path.dirname(parent);
          if (next === parent) break;
          parent = next;
        }
      }
    }
    await checkLinkedInputs(targetReal, inputInfo, ctx);
  }

  if (exists) {
    let entries;
    try {
      entries = await ctx.fs.readdir(target);
    } catch {
      err();
    }
    if (entries.length > 0 && force !== true) {
      const markerInfo = await lstatOrNull(ctx.path.join(target, MARKER_NAME), ctx);
      if (markerInfo === null) err();
      if (markerInfo.isSymbolicLink() || !markerInfo.isFile()) err();
    }
    return target;
  }

  try {
    await ctx.fs.mkdir(target, { recursive: true });
  } catch {
    err();
  }
  // Recheck after creation: must be a real directory, not a link.
  const recheck = await lstatOrNull(target, ctx);
  if (recheck === null || recheck.isSymbolicLink() || !recheck.isDirectory()) {
    err();
  }
  return target;
}

function validateName(name) {
  if (typeof name !== 'string' || name.length === 0) err();
  if (name === '.' || name === '..') err();
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) err();
  if (path.isAbsolute(name)) err();
}

function isSameFile(a, b) {
  return a.dev === b.dev && a.ino === b.ino;
}

// Writes `bytes` to `dir/name` atomically (best effort per platform).
// options.inputs: optional input paths whose inode must not match dest
// (hardlink-to-input refusal).
// options.fs: optional { open, rename, unlink } overrides for tests
// (tests inject failures here; production uses the real fs functions).
export async function writeAtomic(dir, name, bytes, options) {
  if (typeof dir !== 'string' || dir.length === 0) err();
  validateName(name);
  const target = path.resolve(dir);
  const dest = path.join(target, name);
  const data = bytes instanceof Uint8Array ? bytes : Buffer.from(bytes);
  const fsOverrides =
    options !== undefined && options !== null && typeof options.fs === 'object' && options.fs !== null
      ? options.fs
      : {};
  const renameFn = typeof fsOverrides.rename === 'function' ? fsOverrides.rename : rename;
  const unlinkFn = typeof fsOverrides.unlink === 'function' ? fsOverrides.unlink : unlink;
  const openFn = typeof fsOverrides.open === 'function' ? fsOverrides.open : open;

  // No-follow destination checks; refuse links, dirs and hardlinks.
  const destInfo = await lstatOrNull(dest);
  if (destInfo !== null) {
    if (destInfo.isSymbolicLink() || !destInfo.isFile()) err();
    if (destInfo.nlink > 1) err();
    if (options !== undefined && options !== null && Array.isArray(options.inputs)) {
      for (const input of options.inputs) {
        let inputInfo;
        try {
          inputInfo = await stat(path.resolve(String(input)));
        } catch {
          continue;
        }
        if (isSameFile(destInfo, inputInfo)) err();
      }
    }
  }

  let handle;
  let tempPath;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    tempPath = path.join(target, `${name}.tmp-${randomBytes(8).toString('hex')}`);
    try {
      handle = await openFn(tempPath, 'wx');
      break;
    } catch (error) {
      if (error && error.code === 'EEXIST') continue;
      err();
    }
  }
  if (handle === undefined) err();

  try {
    await handle.write(data, 0, data.length, 0);
    await handle.sync();
    await handle.close();
    handle = undefined;
  } catch {
    await handle.close().catch(() => {});
    handle = undefined;
    await unlink(tempPath).catch(() => {});
    err();
  }

  try {
    await renameFn(tempPath, dest);
  } catch (firstError) {
    // Windows cannot rename over an existing file: move the existing
    // destination aside, rename the temp into place, and on any retry
    // failure move the original destination back. A failed retry must
    // never lose an existing valid destination.
    let renamed = false;
    let backupPath = null;
    const destNow = await lstatOrNull(dest);
    if (destNow !== null && destNow.isFile() && !destNow.isSymbolicLink()) {
      try {
        backupPath = path.join(target, `${name}.prior-${randomBytes(8).toString('hex')}`);
        await renameFn(dest, backupPath);
      } catch {
        backupPath = null; // could not move dest aside; leave it untouched
      }
      if (backupPath !== null) {
        try {
          await renameFn(tempPath, dest);
          renamed = true;
        } catch {
          renamed = false;
          // Restore the original destination before giving up.
          await renameFn(backupPath, dest).catch(() => {});
          backupPath = null;
        }
        if (renamed) {
          await unlinkFn(backupPath).catch(() => {});
          backupPath = null;
        }
      }
    }
    if (!renamed) {
      if (backupPath !== null) {
        await renameFn(backupPath, dest).catch(() => {});
      }
      await unlinkFn(tempPath).catch(() => {});
      err();
    }
  }
}
