// Unified credential-shaped identifier scanner. One fixed-regex bounded
// scanner shared by input admission (refusal) and display redaction
// (masking). Never emits decoded input; malformed encodings are skipped.

// Fixed prefixes and character runs avoid nested repetition. Short key-like
// fragments inside ordinary alphanumeric words are not identifier starts.
const GH_PREFIX = /gh[pousr]_[A-Za-z0-9]{20,}/;
const GH_PAT = /github_pat_[A-Za-z0-9_-]{6,}/;
const KEY = /(?:^|[^A-Za-z0-9])(?:sk-|sk_live_|pk_live_|rk_live_)[A-Za-z0-9_-]{6,}/;
const LEGACY_KEY = /(?:^|[^A-Za-z0-9])sk-[A-Za-z0-9]{16,}/;
const AWS_KEY = /(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[0-9A-Z]{16}/;
const SLACK_KEY = /(?:^|[^A-Za-z0-9])xox[aboprs]-[A-Za-z0-9-]{6,}/;
const OTHER_KEYS = /(?:glpat-[A-Za-z0-9_-]{6,}|AIza[A-Za-z0-9_-]{35}|ya29\.[A-Za-z0-9_-]+|SG\.[A-Za-z0-9_-]{20,}|npm_[A-Za-z0-9_-]{20,})/;

// "Bearer <token>": the shape is Bearer\s+\S+; any non-space value
// counts (case-sensitive "Bearer").
const BEARER_TOKEN = /Bearer[\s\p{White_Space}]+[^\s\p{White_Space}]+/u;

const SENSITIVE_NAME =
  'password|passwd|secret|token|apikey|api_key|api-key|authorization|' +
  'credential|cookie|session|privatekey|private_key';

// Opaque pair forms for detection: value is one run of >= 8 non-space chars.
const PAIR_EQ = new RegExp(`(?:${SENSITIVE_NAME})=[^\\s\\p{White_Space}]{8,}`, 'iu');
const PAIR_COLON = new RegExp(`(?:${SENSITIVE_NAME}):[\\s\\p{White_Space}]*[^\\s\\p{White_Space}]{8,}`, 'iu');
const PAIR_JSON = new RegExp(`"(?:${SENSITIVE_NAME})":"[^"\\r\\n]{8,}"`, 'i');

const BASE64ISH_TOKEN = /[A-Za-z0-9_+\/-]{8,}={0,2}/g;
export function replaceJwt(text, mask) {
  return text.replace(/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*/g,
    (part) => chainHasJwt(part) ? mask : part);
}

function chainHasJwt(part) {
  const segments = part.split('.');
  for (let i = 0; i + 2 < segments.length; i += 1) {
    const start = segments[i].indexOf('eyJ');
    if (start >= 0 && start + 3 < segments[i].length) return true;
  }
  return false;
}

function hasJwt(text) {
  const segments = /[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*/g;
  let match;
  while ((match = segments.exec(text)) !== null) {
    if (chainHasJwt(match[0])) return true;
  }
  return false;
}

// Controls removed before the normalized scan (C0, DEL, C1, bidi/format).
const CONTROL_STRIP = new RegExp(
  '[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]',
  'g'
);

function scanDirect(text) {
  if (GH_PREFIX.test(text)) return true;
  if (GH_PAT.test(text)) return true;
  if (KEY.test(text) || LEGACY_KEY.test(text)) return true;
  if (AWS_KEY.test(text) || OTHER_KEYS.test(text)) return true;
  if (SLACK_KEY.test(text)) return true;
  for (const line of text.split(/[\r\n]/)) {
    const start = line.indexOf('-----BEGIN ');
    if (start !== -1 && line.indexOf(' PRIVATE KEY-----', start + 10) !== -1) return true;
  }
  if (hasJwt(text)) return true;
  if (BEARER_TOKEN.test(text)) return true;
  if (PAIR_EQ.test(text)) return true;
  if (PAIR_COLON.test(text)) return true;
  if (PAIR_JSON.test(text)) return true;
  return false;
}

export function percentDecoded(text) {
  if (!text.includes('%')) return text;
  return text.replace(/(?:%[0-9a-fA-F]{2})+/g, run => Buffer.from(run.replace(/%/g, ''), 'hex').toString('utf8'));
}

function tryBase64Decode(token) {
  if (token.length % 4 === 1) return null;
  const urlSafe = !token.includes('+') && !token.includes('/');
  let buf;
  try {
    buf = Buffer.from(
      token + '='.repeat((4 - (token.length % 4)) % 4),
      urlSafe ? 'base64url' : 'base64'
    );
  } catch {
    return null;
  }
  if (buf.length === 0) return null;
  return buf.toString('utf8');
}

// One bounded normalization round: strip control/format characters,
// percent-decode the whole text, and decode base64/base64url-looking
// tokens inside it. Decoded forms are only scanned, never emitted or
// rescanned recursively.
export function scanNormalized(text) {
  const noControls = text.replace(CONTROL_STRIP, '');
  if (noControls !== text && scanDirect(noControls)) return true;

  const viaPercent = percentDecoded(text);
  if (viaPercent !== text && scanDirect(viaPercent)) return true;
  if (text.includes('%%')) {
    const undoubled = percentDecoded(text.replace(/%%/g, ''));
    if (scanDirect(undoubled)) return true;
  }
  if (viaPercent.includes('%')) {
    const removed = viaPercent.replace(/%(?![0-9a-fA-F]{2})/g, '');
    if (removed !== viaPercent && scanDirect(removed)) return true;
    const shortened = viaPercent.replace(/%(?![0-9a-fA-F]{2})[^0-9a-fA-F%]{0,2}/g, '');
    if (shortened !== viaPercent && scanDirect(shortened)) return true;
  }
  if (viaPercent !== text && viaPercent.includes('%')) {
    const twice = percentDecoded(viaPercent);
    if (twice !== viaPercent && scanDirect(twice)) return true;
  }

  BASE64ISH_TOKEN.lastIndex = 0;
  let m;
  while ((m = BASE64ISH_TOKEN.exec(text)) !== null) {
    if (m[0].length % 4 === 1) continue;
    const decoded = tryBase64Decode(m[0]);
    if (decoded !== null && scanDirect(decoded)) return true;
  }
  return false;
}

export function scanForCredential(text) {
  if (typeof text !== 'string') return false;
  if (text.length === 0) return false;
  if (scanDirect(text)) return true;
  return scanNormalized(text);
}
