import test from 'node:test';
import assert from 'node:assert/strict';
import { main, HELP_TEXT, VERSION_TEXT, MARKER_NAME } from '../src/cli.js';
import { writeAtomic } from '../src/security/safe-dir.js';
import { mkdtemp, open, rename, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

function collector() {
  return {
    buf: '',
    write(s) { this.buf += s; },
  };
}

function kindError(kind) {
  const e = new Error(kind);
  e.kind = kind;
  return e;
}

// Minimal canned deps: no filesystem, no real algorithms.
function cannedDeps() {
  const calls = { writeAtomic: [], prepareOutputDir: 0 };
  const deps = {
    readSnapshotFile: async () => ({ value: { ok: true }, sha256: 'a'.repeat(64) }),
    validateSnapshot: () => {},
    scanForCredential: () => false,
    redactText: (t) => t,
    mergeSnapshots: () => ({
      servers: [{ server: 'server-1', tools: 1 }],
      tools: [{ tool: 'tool-1', server: 'server-1', name: 'greet', title: null, description: null, index: 0 }],
    }),
    findCollisions: () => ({ entries: [], collidingTools: 0 }),
    searchTools: () => ({ matches: [{ tool: 'tool-1', server: 'server-1', name: 'greet', score: 100 }], total: 1 }),
    listServers: () => [{ server: 'server-1', tools: 1 }],
    makeCatalog: (command) => ({ command, fake: 'catalog' }),
    makeReport: (command, merged, extra, opts) => ({ command, details: opts.details }),
    renderCatalogJson: () => 'CATALOG-JSON\n',
    renderCatalogMarkdown: () => 'CATALOG-MD\n',
    renderReportJson: (r) => `${JSON.stringify(r)}\n`,
    renderReportTerminal: (r) => `TERMINAL ${r.command}\n`,
    renderReportMarkdown: (r) => `MD ${r.command}\n`,
    prepareOutputDir: async (...args) => {
      calls.prepareOutputDir += 1;
      if (cannedDeps.prepareFails) throw kindError('output_error');
      return args;
    },
    writeAtomic: async (dir, name) => {
      calls.writeAtomic.push(name);
      if (cannedDeps.writeFailsOn === name) throw kindError('output_error');
    },
  };
  return { deps, calls };
}

async function run(argv, overrides = {}) {
  const { deps, calls } = cannedDeps();
  Object.assign(deps, overrides);
  const stdout = collector();
  const stderr = collector();
  const code = await main(argv, { stdout, stderr, deps });
  return { code, stdout, stderr, calls };
}

test('--help and --version exit 0 with fixed text', async () => {
  let r = await run(['--help']);
  assert.equal(r.code, 0);
  assert.equal(r.stdout.buf, HELP_TEXT);
  assert.equal(r.stderr.buf, '');
  r = await run(['--version']);
  assert.equal(r.code, 0);
  assert.equal(r.stdout.buf, VERSION_TEXT);
});

test('usage errors exit 3 with fixed stderr line', async () => {
  for (const argv of [[], ['nope'], ['search', 'a.json'], ['build', 'a.json'], ['list', 'a.json', '--wat']]) {
    const r = await run(argv);
    assert.equal(r.code, 3, JSON.stringify(argv));
    assert.equal(r.stderr.buf, 'joons-mcp-tool-catalog: usage_error\n');
    assert.equal(r.stdout.buf, '');
  }
});

test('input rejection kinds exit 2 and reject the whole invocation', async () => {
  for (const kind of ['input_unreadable', 'invalid_json', 'invalid_snapshot', 'limit_exceeded', 'credential_detected']) {
    const r = await run(['list', 'good.json', 'bad.json'], {
      readSnapshotFile: async (p) => {
        if (p === 'bad.json') throw kindError(kind);
        return { value: {}, sha256: 'b'.repeat(64) };
      },
    });
    assert.equal(r.code, 2, kind);
    assert.equal(r.stderr.buf, `joons-mcp-tool-catalog: ${kind}\n`);
    assert.equal(r.stdout.buf, '');
  }
});

test('more than 100 input files is limit_exceeded before reading', async () => {
  let reads = 0;
  const r = await run(
    ['list', ...Array.from({ length: 101 }, (_, i) => `s${i}.json`)],
    { readSnapshotFile: async () => { reads += 1; return { value: {}, sha256: 'c'.repeat(64) }; } },
  );
  assert.equal(r.code, 2);
  assert.equal(reads, 0);
  assert.equal(r.stderr.buf, 'joons-mcp-tool-catalog: limit_exceeded\n');
  assert.equal(r.calls.writeAtomic.length, 0);
});

test('usage precedence beats input errors', async () => {
  const r = await run(['list', '--bogus-flag', 'a.json'], {
    readSnapshotFile: async () => { throw kindError('invalid_json'); },
  });
  assert.equal(r.code, 3);
  assert.equal(r.stderr.buf, 'joons-mcp-tool-catalog: usage_error\n');
});

test('input precedence beats output errors: bad input with failing out dir exits 2', async () => {
  const r = await run(['build', 'bad.json', '--out', 'd'], {
    readSnapshotFile: async () => { throw kindError('invalid_snapshot'); },
    writeAtomic: async () => { throw kindError('output_error'); },
  });
  assert.equal(r.code, 2);
  assert.equal(r.stderr.buf, 'joons-mcp-tool-catalog: invalid_snapshot\n');
  assert.equal(r.calls.writeAtomic.length, 0);
});

test('build writes artifacts in order, marker last, then reports', async () => {
  const r = await run(['build', 'a.json', '--out', 'd']);
  assert.equal(r.code, 0);
  assert.deepEqual(r.calls.writeAtomic, ['catalog.json', 'catalog.md', MARKER_NAME]);
  assert.equal(r.stdout.buf, 'TERMINAL build\n');
});

test('build flushes each temp before close and rename, including marker last', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'catalog-sync-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const events = [];
  const fs = {
    open: async (file, flags) => {
      const handle = await open(file, flags);
      return {
        write: async (...args) => { events.push('write'); return handle.write(...args); },
        sync: async () => { events.push('sync'); return handle.sync(); },
        close: async () => { events.push('close'); return handle.close(); },
      };
    },
    rename: async (from, to) => { events.push(`rename:${path.basename(to)}`); return rename(from, to); },
  };
  const result = await run(['build', 'a.json', '--out', dir], {
    writeAtomic: (output, name, bytes) => writeAtomic(output, name, bytes, { fs }),
  });
  assert.equal(result.code, 0, result.stderr.buf);
  assert.deepEqual(events, ['write', 'sync', 'close', 'rename:catalog.json', 'write', 'sync', 'close', 'rename:catalog.md', 'write', 'sync', 'close', `rename:${MARKER_NAME}`]);
  assert.equal((await readFile(path.join(dir, MARKER_NAME))).length, 0);
});

test('build sync failure exits 4, removes its temp and preserves destination', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'catalog-sync-fail-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'catalog.json'), 'original');
  const events = [];
  const fs = {
    open: async (file, flags) => {
      const handle = await open(file, flags);
      return {
        write: async (...args) => { events.push('write'); return handle.write(...args); },
        sync: async () => { events.push('sync'); throw new Error('sync failed'); },
        close: async () => { events.push('close'); return handle.close(); },
      };
    },
    rename: async (from, to) => { events.push('rename'); return rename(from, to); },
  };
  const result = await run(['build', 'a.json', '--out', dir], {
    writeAtomic: (output, name, bytes) => writeAtomic(output, name, bytes, { fs }),
  });
  assert.equal(result.code, 4); assert.equal(result.stderr.buf, 'joons-mcp-tool-catalog: output_error\n'); assert.equal(result.stdout.buf, '');
  assert.deepEqual(events, ['write', 'sync', 'close']);
  assert.equal(await readFile(path.join(dir, 'catalog.json'), 'utf8'), 'original');
  assert.deepEqual(await readdir(dir), ['catalog.json']);
});

test('build failure at catalog.md: exit 4, marker never written, no report', async () => {
  const written = [];
  const r = await run(['build', 'a.json', '--out', 'd'], {
    writeAtomic: async (dir, name) => {
      written.push(name);
      if (name === 'catalog.md') throw kindError('output_error');
    },
  });
  assert.equal(r.code, 4);
  assert.deepEqual(written, ['catalog.json', 'catalog.md']);
  assert.equal(r.stdout.buf, '');
  assert.equal(r.stderr.buf, 'joons-mcp-tool-catalog: output_error\n');
});

test('non-output-error failures in the output phase still map to output_error/4', async () => {
  const r = await run(['build', 'a.json', '--out', 'd'], {
    writeAtomic: async () => { throw new Error('disk exploded'); },
  });
  assert.equal(r.code, 4);
  assert.equal(r.stderr.buf, 'joons-mcp-tool-catalog: output_error\n');
});

test('prepareOutputDir failure exits 4 without any writes', async () => {
  const r = await run(['build', 'a.json', '--out', 'd'], {
    prepareOutputDir: async () => { throw kindError('output_error'); },
  });
  assert.equal(r.code, 4);
  assert.equal(r.calls.writeAtomic.length, 0);
  assert.equal(r.stdout.buf, '');
});

test('unexpected errors become internal_error exit 2, never a stack', async () => {
  const r = await run(['list', 'a.json'], {
    mergeSnapshots: () => { throw new Error('secret stack detail'); },
  });
  assert.equal(r.code, 2);
  assert.equal(r.stderr.buf, 'joons-mcp-tool-catalog: internal_error\n');
  assert.ok(!r.stderr.buf.includes('secret'));
});

test('stdout EPIPE is exit 4; stderr content stays ignored', async () => {
  const epipe = {
    buf: '',
    write() { const e = new Error('epipe'); e.code = 'EPIPE'; throw e; },
  };
  const { deps } = cannedDeps();
  const code = await main(['list', 'a.json'], { stdout: epipe, stderr: collector(), deps });
  assert.equal(code, 4);
});

test('stderr write failure does not change the exit code', async () => {
  const brokenStderr = {
    write() { const e = new Error('epipe'); e.code = 'EPIPE'; throw e; },
  };
  const r = await run(['list', 'a.json']);
  const code = await main(['list', 'a.json'], { stdout: collector(), stderr: brokenStderr, deps: cannedDeps().deps });
  assert.equal(code, 0);
  assert.equal(r.code, 0);
});

test('quiet suppresses the terminal success report only', async () => {
  let r = await run(['build', 'a.json', '--out', 'd', '--quiet']);
  assert.equal(r.code, 0);
  assert.equal(r.stdout.buf, '');
  assert.deepEqual(r.calls.writeAtomic, ['catalog.json', 'catalog.md', MARKER_NAME]);

  r = await run(['build', 'a.json', '--out', 'd', '--quiet', '--format', 'json']);
  assert.equal(r.code, 0);
  assert.ok(r.stdout.buf.startsWith('{'));

  r = await run(['validate', 'a.json', '--quiet']);
  assert.equal(r.code, 0);
  assert.equal(r.stdout.buf, '');

  r = await run(['validate', 'a.json']);
  assert.equal(r.code, 0);
  assert.equal(r.stdout.buf, 'TERMINAL validate\n');
});

test('search passes query through and details reach makeReport', async () => {
  let seenQuery;
  let seenDetails;
  const r = await run(['search', 'a.json', '--query', 'Weather NOW', '--details', '--format', 'json'], {
    searchTools: (tools, query) => { seenQuery = query; return { matches: [], total: 0 }; },
    makeReport: (command, merged, extra, opts) => { seenDetails = opts.details; return { command }; },
  });
  assert.equal(r.code, 0);
  assert.equal(seenQuery, 'Weather NOW');
  assert.equal(seenDetails, true);
  assert.ok(r.stdout.buf.includes('"command":"search"'));
});

test('format selection routes to the right renderer', async () => {
  let r = await run(['list', 'a.json', '--format', 'json']);
  assert.equal(r.stdout.buf, '{"command":"list","details":false}\n');
  r = await run(['collisions', 'a.json', '--format', 'markdown']);
  assert.equal(r.stdout.buf, 'MD collisions\n');
});

test('search/list/collisions never write files', async () => {
  for (const argv of [
    ['search', 'a.json', '--query', 'x'],
    ['list', 'a.json'],
    ['collisions', 'a.json'],
    ['validate', 'a.json'],
  ]) {
    const r = await run(argv);
    assert.equal(r.code, 0, JSON.stringify(argv));
    assert.equal(r.calls.writeAtomic.length, 0);
    assert.equal(r.calls.prepareOutputDir, 0);
  }
});

test('sha256 prefixes are aligned to server ordinals, 12 hex chars', async () => {
  let seenSha;
  const r = await run(['build', 'z.json', 'a.json', '--out', 'd'], {
    readSnapshotFile: async (p) => ({
      value: { server: { name: p === 'a.json' ? 'aaa' : 'zzz' } },
      sha256: p === 'a.json' ? '1'.repeat(64) : '2'.repeat(64),
    }),
    mergeSnapshots: (values) => ({
      servers: [{ server: 'server-1', tools: 0 }, { server: 'server-2', tools: 0 }],
      tools: [],
    }),
    makeCatalog: (command, merged, extra) => { seenSha = extra.sha256s; return {}; },
  });
  assert.equal(r.code, 0);
  assert.deepEqual(seenSha, ['1'.repeat(12), '2'.repeat(12)]);
});
