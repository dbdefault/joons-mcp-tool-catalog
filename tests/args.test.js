import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, UsageError } from '../src/args.js';

function ok(argv) {
  return parseArgs(argv);
}

function usage(argv) {
  assert.throws(() => parseArgs(argv), (err) => err instanceof UsageError && err.kind === 'usage_error');
}

test('build with --out DIR space form', () => {
  const r = ok(['build', 'a.json', 'b.json', '--out', 'dist']);
  assert.equal(r.command, 'build');
  assert.deepEqual(r.snapshots, ['a.json', 'b.json']);
  assert.equal(r.options.out, 'dist');
  assert.equal(r.options.format, 'terminal');
  assert.equal(r.options.force, false);
  assert.equal(r.options.quiet, false);
});

test('build with --out=DIR equals form and boolean flags', () => {
  const r = ok(['build', 'a.json', '--out=dist', '--force', '--quiet', '--format=markdown']);
  assert.equal(r.options.out, 'dist');
  assert.equal(r.options.force, true);
  assert.equal(r.options.quiet, true);
  assert.equal(r.options.format, 'markdown');
});

test('search requires --query, accepts --details', () => {
  const r = ok(['search', 'a.json', '--query', 'weather now', '--details']);
  assert.equal(r.command, 'search');
  assert.equal(r.options.query, 'weather now');
  assert.equal(r.options.details, true);
  usage(['search', 'a.json']);
  usage(['search', 'a.json', '--query=']);
  usage(['search', 'a.json', '--query', '   ']);
  usage(['search', 'a.json', '--query', 'x'.repeat(201)]);
  ok(['search', 'a.json', '--query', 'x'.repeat(200)]);
});

test('query with surrounding control/space trim still valid', () => {
  const r = ok(['search', 'a.json', '--query', '  hi  ']);
  assert.equal(r.options.query, '  hi  ');
});

test('list and collisions accept --details and --format only', () => {
  ok(['list', 'a.json']);
  ok(['collisions', 'a.json', '--details', '--format', 'json']);
  usage(['list', 'a.json', '--out', 'x']);
  usage(['collisions', 'a.json', '--query', 'q']);
  usage(['collisions', 'a.json', '--quiet']);
});

test('validate accepts only --quiet', () => {
  ok(['validate', 'a.json']);
  ok(['validate', 'a.json', '--quiet']);
  usage(['validate', 'a.json', '--format', 'json']);
  usage(['validate', 'a.json', '--details']);
  usage(['validate']);
});

test('at least one snapshot required', () => {
  usage(['build', '--out', 'dist']);
  usage(['search', '--query', 'x']);
  usage(['list']);
});

test('unknown command and dash-leading command are usage errors', () => {
  usage([]);
  usage(['frobnicate', 'a.json']);
  usage(['--bogus', 'a.json']);
  usage(['-x', 'a.json']);
});

test('unknown flags are usage errors', () => {
  usage(['list', 'a.json', '--bogus']);
  usage(['list', 'a.json', '--bogus=1']);
  usage(['build', 'a.json', '--out', 'd', '--format']); // missing value
  usage(['build', 'a.json', '--out']); // missing value at end
  usage(['build', 'a.json', '--out', '--force']); // value looks like a flag
});

test('duplicate single-value flags are usage errors', () => {
  usage(['build', 'a.json', '--out', 'd1', '--out', 'd2']);
  usage(['search', 'a.json', '--query', 'a', '--query=b']);
  usage(['list', 'a.json', '--format', 'json', '--format', 'terminal']);
});

test('repeated boolean flags are tolerated', () => {
  const r = ok(['build', 'a.json', '--out', 'd', '--force', '--force']);
  assert.equal(r.options.force, true);
});

test('boolean flags reject attached values', () => {
  usage(['build', 'a.json', '--out', 'd', '--force=yes']);
  usage(['search', 'a.json', '--query', 'q', '--details=1']);
});

test('invalid format enum is a usage error', () => {
  usage(['list', 'a.json', '--format', 'xml']);
  usage(['list', 'a.json', '--format', 'JSON']);
  ok(['list', 'a.json', '--format', 'terminal']);
  ok(['list', 'a.json', '--format', 'json']);
  ok(['list', 'a.json', '--format', 'markdown']);
});

test('-- terminator is a usage error (contract grammar)', () => {
  usage(['list', '--', '-weird.json']);
  usage(['list', 'a.json', '--']);
  usage(['build', 'a.json', '--out', 'd', '--']);
  // dash-leading tokens without a terminator are still refused
  usage(['list', '-weird.json']);
});

test('help and version must appear alone', () => {
  assert.deepEqual(parseArgs(['--help']), { help: true });
  assert.deepEqual(parseArgs(['--version']), { version: true });
  usage(['--help', 'list']);
  usage(['list', '--help']);
  usage(['--version', '--help']);
  usage(['--help=x']);
});

test('non-string tokens are usage errors', () => {
  usage(['list', 42]);
  usage(null);
});
