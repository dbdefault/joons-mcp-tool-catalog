import test from 'node:test';
import assert from 'node:assert/strict';
import { scanForCredential } from '../src/security/credentials.js';
import { CLEAN_NAMES } from './doubles/snapshot-input.js';

function show(text) {
  return String(JSON.stringify(text)).slice(0, 80);
}

function hit(text) {
  assert.equal(
    scanForCredential(text),
    true,
    `expected credential hit: ${show(text)}`
  );
}

function miss(text) {
  assert.equal(
    scanForCredential(text),
    false,
    `expected clean: ${show(text)}`
  );
}

test('github token shapes', () => {
  hit('ghp_abcdefghijklmnopqrstuv');
  hit('gho_ABCDEFGHIJKLMNOPQRST');
  hit('ghu_12345678901234567890');
  hit('github_pat_11ABCDEFGH0abcdefghijklmNOPQRSTUV');
  hit('prefix-ghp_abcdefghijklmnopqrstuv');
  hit('prefixghp_ABCDEFGHIJKLMNOPQRST'); // prefixed token still detected
  hit('ghp_abcdefghijklmnopqrstuv-suffix');
});

test('sk and AKIA shapes', () => {
  hit('sk-ABCDEFGHIJKLMNOP');
  hit('sk-abcdefghijklmnop1234');
  hit('AKIAIOSFODNN7EXAMPLE');
  hit('key-AKIAIOSFODNN7EXAMPLE');
});

test('slack and private key shapes', () => {
  hit('xoxb-1234567890-abcdefghij');
  hit('xoxp-aaaaaaaabbbb');
  hit('-----BEGIN RSA PRIVATE KEY-----');
  hit('-----BEGIN OPENSSH PRIVATE KEY-----');
  hit('-----BEGIN FOO PRIVATE KEY-----');
});

test('bearer and jwt shapes', () => {
  hit('Bearer abcdef1234567890');
  hit('Bearer abc');
  hit('Bearer abcdefgh');
  hit('Authorization: Bearer ya29.abc-def_123');
  hit('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc-def_123456');
  miss('bearer of good news'); // lowercase is not the Bearer shape
});

test('sensitive name=value pairs with opaque values', () => {
  hit('token=abcdefgh');
  hit('api_key=ABCDEF123456!');
  hit('password=hunter222');
  hit('session: 9f8e7d6c5b4a');
  hit('secret: abcdefgh');
  hit('x=1 "token":"abcdefgh" y=2');
  hit('AUTHORIZATION: Bearer xyz12345');
});

test('short or non-opaque values stay clean', () => {
  miss('token=abc');
  miss('session: the');
  miss('title=hello world');
  miss('cookie=abc def');
  miss('apikey=');
  hit('mytoken=abcdefgh'); // a prefix does not exempt a sensitive pair
  miss('"token":"abc"');
});

test('percent-encoded forms', () => {
  hit('ghp_%61%62%63%64%65%66%67%68%69%6a%6b%6c%6d%6e%6f%70%71%72%73%74%75%76');
  hit('%41%4b%49%41%49%4f%53%46%4f%44%4e%4e%37%45%58%41%4d%50%4c%45');
  hit('sk-%41%42%43%44%45%46%47%48%49%4a%4b%4c%4d%4e%4f%50');
  miss('100% sure');
  miss('%zz%41broken');
});

test('base64 and base64url encoded forms', () => {
  // "the-token-ghp_abcdefghjkl1234567890-suffix"
  hit('dGhlLXRva2VuLWdocF9hYmNkZWZnaGprbDEyMzQ1Njc4OTAtdWZmaXg');
  // "key-AKIAIOSFODNN7EXAMPLE-suffix"
  hit('a2V5LUFLSUFJT1NGT0ROTjdFWEFNUExFLXN1ZmZpeA');
  // urlsafe variant of "sk-ABCDEFGHIJKLMNOP"
  hit('c2stQUJDREVGR0hJSktMTU5PUA');
  miss('aGVsbG8gd29ybGQ'); // "hello world"
});

test('control-stripped forms', () => {
  hit('ghp_abcdefghij\u0000klmnopqrst');
  miss('clean\u0000name');
});

test('clean identifiers never hit', () => {
  for (const name of CLEAN_NAMES) miss(name);
  miss('');
  miss(42);
  miss(null);
  miss(undefined);
});


test('unlabeled and labeled private key headers are refused', () => {
  for (const name of ['-----BEGIN PRIVATE KEY-----', '-----BEGIN RSA PRIVATE KEY-----', '-----BEGIN EC PRIVATE KEY-----', '-----BEGIN OPENSSH PRIVATE KEY-----', '-----BEGIN ENCRYPTED PRIVATE KEY-----', 'prefix-----BEGIN PRIVATE KEY-----suffix']) {
    assert.equal(scanForCredential(name), true, name);
  }
  for (const name of ['-----BEGIN CERTIFICATE-----', '-----BEGIN PRIVATE-----', 'BEGIN PRIVATE KEY', 'ordinary-tool-name']) {
    assert.equal(scanForCredential(name), false, name);
  }
});


test('credential families recognised (boundaries and negative controls)', () => {
  const A = 'A'.repeat(16);
  for (const p of ['AKIA', 'ASIA', 'AGPA', 'AIDA', 'AROA', 'AIPA', 'ANPA', 'ANVA']) {
    assert.equal(scanForCredential(p + A), true, p);
    assert.equal(scanForCredential(p + 'A'.repeat(15)), false, p + ' short');
  }
  for (const name of ['ghp_' + 'a'.repeat(20), 'github_pat_abcdef', 'glpat-abcdef', 'sk-abcdef', 'xoxb-123456', 'AIza' + 'b'.repeat(35), 'ya29.token', 'SG.' + 'c'.repeat(20), 'npm_' + 'd'.repeat(20), '-----BEGIN PRIVATE KEY-----']) {
    assert.equal(scanForCredential(name), true, name);
  }
  for (const name of ['ghp_' + 'a'.repeat(19), 'task-runner', 'desk-tool', 'read_file', '-----BEGIN CERTIFICATE-----']) {
    assert.equal(scanForCredential(name), false, name);
  }
});