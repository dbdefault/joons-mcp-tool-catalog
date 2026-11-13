import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { main, HELP_TEXT, VERSION_TEXT } from '../src/cli.js';
import { makeReferenceDeps } from './doubles/reference.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const EXAMPLE = path.join(ROOT, 'examples', 'sample-snapshot.json');

function readDoc(rel) {
  // Fatal UTF-8 read: throws on invalid sequences, no lossy replacement.
  const buf = readFileSync(path.join(ROOT, rel));
  return new TextDecoder('utf-8', { fatal: true }).decode(buf);
}

function collector() {
  return { buf: '', write(s) { this.buf += s; } };
}

async function run(argv) {
  const stdout = collector();
  const stderr = collector();
  const code = await main(argv, { stdout, stderr, deps: makeReferenceDeps() });
  return { code, stdout, stderr };
}

test('README.ko.md has at least 1000 Hangul syllables and no mojibake', () => {
  const text = readDoc('README.ko.md');
  const syllables = text.match(/[\uac00-\ud7a3]/g) ?? [];
  assert.ok(syllables.length >= 1000, `only ${syllables.length} syllables`);
  assert.equal(text.includes('\uFFFD'), false, 'replacement char found');
  assert.equal(/[\u4e00-\u9fff]/.test(text), false, 'hanzi found in Korean doc');
});

test('all public docs decode as fatal UTF-8', () => {
  for (const rel of ['README.md', 'README.ko.md', 'docs/CLI.md', 'ARCHITECTURE.md', 'SECURITY.md', 'LIMITATIONS.md', 'CHANGELOG.md', 'CONTRIBUTING.md']) {
    assert.doesNotThrow(() => readDoc(rel), rel);
  }
});

test('docs/CLI.md enumerates every fixed error kind', () => {
  const cli = readDoc('docs/CLI.md');
  for (const kind of ['input_unreadable', 'invalid_json', 'invalid_snapshot', 'limit_exceeded', 'credential_detected', 'output_error', 'usage_error', 'internal_error']) {
    assert.ok(cli.includes(`joons-mcp-tool-catalog: ${kind}`), `missing ${kind}`);
    assert.ok(cli.includes(kind), `missing prose for ${kind}`);
  }
  for (const code of ['exit code 1', 'no exit code 1', 'There is no exit code 1']) {
    if (cli.includes(code)) break;
  }
});

test('public docs contain no internal references or private data', () => {
  const banned = [/CONTRACT\.md/i, /OPEN_QUESTIONS/i, /W1 core/, /W2 input/, /W3 output/, /W4 CLI/, /JOONS-BRAIN/i, /JOONS-DSKT/i, /SUNS-DSKT/i, /JOONS-LAPTOP/i, /dbdef/i, /10\.0\./, /192\.168\./];
  for (const rel of ['README.md', 'README.ko.md', 'docs/CLI.md', 'ARCHITECTURE.md', 'SECURITY.md', 'LIMITATIONS.md', 'CHANGELOG.md', 'CONTRIBUTING.md']) {
    const text = readDoc(rel);
    for (const re of banned) {
      assert.ok(!re.test(text), `${rel} matches ${re}`);
    }
  }
});

test('README examples match real CLI behavior', async () => {
  // --help output lists every documented command form
  const r = await run(['--help']);
  assert.equal(r.code, 0);
  assert.equal(r.stdout.buf, HELP_TEXT);
  for (const cmd of ['build <snapshot>... --out DIR', 'search <snapshot>... --query TEXT', 'list <snapshot>...', 'collisions <snapshot>...', 'validate <snapshot>...']) {
    assert.ok(HELP_TEXT.includes(cmd), cmd);
  }
  // quickstart commands all succeed against the example snapshot
  assert.equal((await run(['validate', EXAMPLE])).code, 0);
  const s = await run(['search', EXAMPLE, '--query', 'weather', '--format', 'json']);
  assert.equal(s.code, 0);
  assert.equal(JSON.parse(s.stdout.buf).counts.matches, 1);
  const l = await run(['list', EXAMPLE]);
  assert.equal(l.code, 0);
  const c = await run(['collisions', EXAMPLE]);
  assert.equal(c.code, 0);
});

test('license notices present', () => {
  const license = readDoc('LICENSE');
  assert.ok(license.includes('Apache License'));
  assert.ok(license.includes('Version 2.0'));
  const readme = readDoc('README.md');
  assert.ok(readme.includes('Apache-2.0'));
});

test('documentation describes the CLI-only boundary without library usage examples', () => {
  for (const rel of ['README.md', 'ARCHITECTURE.md', 'SECURITY.md', 'LIMITATIONS.md']) {
    const text = readDoc(rel);
    assert.match(text, /not a supported library/i, rel);
    assert.match(text, /no API stability/i, rel);
    assert.match(text, /in-process/i, rel);
  }
  const ko = readDoc('README.ko.md');
  assert.match(ko, /\uc9c0\uc6d0\ud558\ub294 \ub77c\uc774\ube0c\ub7ec\ub9ac\uac00 \uc544\ub2d9\ub2c8\ub2e4/);
  assert.match(ko, /\uc548\uc815\uc131/);
  for (const rel of ['README.md', 'README.ko.md', 'ARCHITECTURE.md', 'SECURITY.md', 'LIMITATIONS.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'docs/CLI.md', 'docs/SECURITY.md']) {
    assert.doesNotMatch(readDoc(rel), /import\s*\{|validateSnapshot\s*\(|public library surface|public API values|CLI and library|command.line tool and library/i, rel);
  }
});

test('source tree is ASCII-only outside README.ko.md', () => {
  const walk = (dir, acc) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, acc);
      else if (/\.(js|json|md)$/.test(entry.name)) acc.push(full);
    }
    return acc;
  };
  for (const file of walk(ROOT, [])) {
    if (file.endsWith('README.ko.md')) continue;
    if (file.includes('fixtures') || file.includes('examples')) continue; // validated JSON
    if (file.includes('CONTRACT.md') || file.includes('OPEN_QUESTIONS.md') || file.includes('TASK.md') || file.includes('NOTES_W4.md')) continue;
    const text = readFileSync(file, 'utf8');
    assert.ok(/^[\x20-\x7E\n\r\t]*$/.test(text), `non-ASCII in ${path.relative(ROOT, file)}`);
  }
});
