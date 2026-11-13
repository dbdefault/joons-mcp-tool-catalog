import test from 'node:test';
import assert from 'node:assert/strict';
import { redactText } from '../src/security/redact.js';

function redacted(input, options) {
  return redactText(input, options);
}

test('urls become [URL]', () => {
  assert.equal(redacted('see https://example.com/a?b=1 ok'), 'see [URL] ok');
  assert.equal(redacted('ftp://host/file'), '[URL]');
  assert.equal(redacted('no-scheme-here.com/x'), 'no-scheme-here.com/x');
});

test('paths become [PATH]', () => {
  assert.equal(redacted('C:\\Users\\example-user\\project\\x.js'), '[PATH]');
  assert.equal(redacted('C:/data/one/two'), '[PATH]');
  assert.equal(redacted('\\\\share\\dir\\file.txt'), '[PATH]');
  assert.equal(redacted('/etc/hosts'), '[PATH]');
  assert.equal(redacted('/var/log/syslog'), '[PATH]');
  assert.equal(redacted('~/home/dir'), '[PATH]');
  assert.equal(redacted('relative/path/only'), 'relative/path/only');
  assert.equal(redacted('C:\\single'), '[PATH]');
});

test('emails and ipv4 become [EMAIL] and [IP]', () => {
  assert.equal(redacted('mail user@example.com now'), 'mail [EMAIL] now');
  assert.equal(redacted('host 10.0.0.1 down'), 'host [IP] down');
  assert.equal(redacted('version 0.1.0 stays'), 'version 0.1.0 stays');
  assert.equal(redacted('user@10.0.0.1'), 'user@[IP]');
});

test('sensitive pairs are masked, name kept', () => {
  assert.equal(redacted('token=abcdefgh'), 'token=[MASKED]');
  assert.equal(redacted('api_key=XYZ'), 'api_key=[MASKED]');
  assert.equal(redacted('secret: hunter222'), 'secret: [MASKED]');
  assert.equal(redacted('{"token":"abcdefgh"}'), '{"token":"[MASKED]"}');
  assert.equal(redacted('password'), 'password'); // no value form
});

test('bearer, jwt, private key, opaque tokens', () => {
  assert.equal(redacted('Bearer abcdef1234567890'), 'Bearer [MASKED]');
  assert.equal(redacted('Bearer abcdef'), 'Bearer [MASKED]');
  assert.equal(redacted('Bearer abc'), 'Bearer [MASKED]'); // contract: Bearer\s+\S+
  assert.equal(redacted('say Bearer abc now'), 'say Bearer [MASKED] now');
  assert.equal(
    redacted('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc-def_123456'),
    '[REDACTED]'
  );
  assert.equal(redacted('-----BEGIN RSA PRIVATE KEY-----'), '[PRIVATEKEY]');
  // 20 chars: below the 24+ opaque-token threshold, contract keeps it.
  assert.equal(redacted('AKIAIOSFODNN7EXAMPLE'), '[REDACTED]');
  assert.equal(
    redacted('AKIAIOSFODNN7EXAMPLEEXTRA'),
    '[REDACTED]'
  );
  assert.equal(redacted('abcdefghijklmnopqrstuvwx'), '[REDACTED]');
  assert.equal(redacted('short-token-abc'), 'short-token-abc');
});

test('controls, ansi and bidi are stripped', () => {
  // ESC is stripped; the CSI residue "[31m" is plain text per contract.
  assert.equal(redacted('a\u001B[31mb\u001B[0mc'), 'a[31mb[0mc');
  assert.equal(redacted('plain\u0007bell'), 'plainbell');
  assert.equal(redacted('te\u202Ernal'), 'ternal');
  assert.equal(redacted('a\u200Eb'), 'ab');
  assert.equal(redacted('x\u2028y'), 'xy');
  assert.equal(redacted('tab\tand\nnewline stay'), 'tabandnewline stay');
});

test('output is never longer than input for long text', () => {
  const long = 'x'.repeat(5000);
  const out = redacted(long);
  assert.ok(out.length <= 203);
  const withUrl = `${'y'.repeat(4000)} https://example.com/${'z'.repeat(4000)}`;
  assert.ok(redacted(withUrl).length < withUrl.length);
});

test('truncation to 200 code points by default', () => {
  // Spaces keep the text out of the opaque-token rule.
  const long = 'ab cd '.repeat(120); // 720 chars
  const out = redacted(long);
  assert.equal(out.length, 203);
  assert.equal(out, long.slice(0, 200) + '...');
});

test('custom maxLength', () => {
  assert.equal(redacted('abcdefgh', { maxLength: 4 }), 'abcd...');
  assert.equal(redacted('abc', { maxLength: 10 }), 'abc');
  assert.equal(redacted('', { maxLength: 10 }), '');
});

test('non-string input yields empty string', () => {
  assert.equal(redacted(null), '');
  assert.equal(redacted(undefined), '');
  assert.equal(redacted(42), '');
});
