import { scanForCredential, scanNormalized, replaceJwt } from './credentials.js';

// Display redaction pipeline. Fixed regexes with bounded quantifiers only,
// applied in documented order. Output is never longer than input except for
// the fixed markers, and ends truncated to maxLength code points.

// 1. Strip controls: C0, DEL, C1, bidi/format controls (U+200E/F,
// U+202A-202E, U+2066-2069, U+061C), U+2028/2029 and ESC.
const CONTROLS = new RegExp(
  '[\u0000-\u001F\u007F-\u009F' +
    '\u061C\u200E\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069\u001B]',
  'g'
);

// 2. URLs: scheme of 2..16 chars then non-space run.
const URL_TOKEN = /[a-z][a-z0-9+.-]{1,15}:\/\/\S+/g;

// Paths are consumed to the end of the control-stripped text once found.
// This intentionally hides ambiguous spaces and any following text.
export function redactPaths(text) {
  if (!/[\\/~.:]/.test(text)) return text;
  const n = text.length;
  const lastPosixSlash = text.lastIndexOf('/');
  const slash = c => c === '/' || c === '\\';
  const letter = c => c !== undefined && ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'));
  for (let i = 0; i < n; i += 1) {
    const c = text[i];
    if (letter(c) && text[i + 1] === ':' && slash(text[i + 2])) return text.slice(0, i) + '[PATH]';
    if ((c === '\\' && text[i + 1] === '\\') ||
        (c === '~' && slash(text[i + 1])) ||
        (c === '.' && text[i + 1] === '.' && slash(text[i + 2]) && i + 3 < n && !/[\s\p{White_Space}\\/]/u.test(text[i + 3]))) return text.slice(0, i) + '[PATH]';
    const previous = text[i - 1];
    const posixBoundary = i === 0 || /[\s\p{White_Space}'"\[\]{}()=:,]/u.test(previous);
    if (c === '/' && posixBoundary && i + 1 < n && !/[\s\p{White_Space}/]/u.test(text[i + 1]) && lastPosixSlash > i) return text.slice(0, i) + '[PATH]';
  }
  return text;
}

// 4. E-mail, 5. IPv4.
const EMAIL = /\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,24}\b/g;
const IPV4 = /(?<![0-9])(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?![0-9.])/g;

const SENSITIVE_NAME =
  'password|passwd|secret|token|apikey|api_key|api-key|authorization|' +
  'credential|cookie|session|privatekey|private_key';

// 6. Sensitive pairs -> name=[MASKED] (any non-empty opaque value).
const PAIR_EQ = new RegExp(
  `((?:${SENSITIVE_NAME}))=\\S+`,
  'gi'
);
const PAIR_COLON = new RegExp(
  `((?:${SENSITIVE_NAME})):[\\s\\p{White_Space}]*([^\\s\\p{White_Space}]+)`,
  'giu'
);
const PAIR_JSON = new RegExp(
  `"((?:${SENSITIVE_NAME}))":"([^"]*)"`,
  'gi'
);

// 6b. Private key block header, Bearer token (mask token, keep "Bearer"),
// JWT. Shape: Bearer\s+\S+ -- any non-space value is masked.
const PRIVATE_KEY_BLOCK =
  /-----BEGIN [A-Z0-9 ][A-Z0-9 ]{0,30}PRIVATE KEY-----/g;
const BEARER_TOKEN = /(Bearer[\s\p{White_Space}]+)([^\s\p{White_Space}]+)/gu;

// 7. Opaque tokens of 24+ chars from the base64-ish alphabet.
const OPAQUE_TOKEN = /[A-Za-z0-9_+/=-]{24,}/g;

const DEFAULT_MAX_LENGTH = 200;

function maskBearer(match, prefix, token) {
  return prefix + '[MASKED]';
}

export function redactText(text, options) {
  if (typeof text !== 'string') return '';
  const maxLength =
    options !== undefined &&
    options !== null &&
    Number.isSafeInteger(options.maxLength) &&
    options.maxLength > 0
      ? options.maxLength
      : DEFAULT_MAX_LENGTH;

  let out = text.replace(CONTROLS, '');
  if (/[\u0009-\u000d\u0085\u2028\u2029]/u.test(text) && scanForCredential(text)) return '[REDACTED]';
  out = out.replace(URL_TOKEN, '[URL]');
  if (scanNormalized(out)) return '[REDACTED]';
  if (/\[(?:MASKED|REDACTED)\]/.test(out) && scanForCredential(out)) return '[REDACTED]';
  out = out.replace(/\S{11,}/g, (token) => {
    if (/^(?:\{"(?:password|passwd|secret|token|apikey|api_key|api-key|authorization|credential|cookie|session|privatekey|private_key)":"[^"\s]*"\}|(?:password|passwd|secret|token|apikey|api_key|api-key|authorization|credential|cookie|session|privatekey|private_key)=\S+)$/i.test(token)) return token;
    return scanForCredential(token) ? '[REDACTED]' : token;
  });
  out = redactPaths(out);
  out = out.replace(EMAIL, '[EMAIL]');
  out = out.replace(IPV4, '[IP]');
  out = out.replace(PAIR_JSON, '"$1":"[MASKED]"');
  out = out.replace(PAIR_EQ, '$1=[MASKED]');
  out = out.replace(PAIR_COLON, '$1: [MASKED]');
  out = out.replace(PRIVATE_KEY_BLOCK, '[PRIVATEKEY]');
  out = out.replace(BEARER_TOKEN, maskBearer);
  out = replaceJwt(out, '[REDACTED]');
  out = out.replace(OPAQUE_TOKEN, '[REDACTED]');
  const remainder = out.replace(/(^|\s)Bearer \[MASKED\](?=\s|$)/g, '$1');
  if (scanForCredential(remainder) && !/^(?:(?:password|passwd|secret|token|apikey|api_key|api-key|authorization|credential|cookie|session|privatekey|private_key)\s*[:=]\s*\[MASKED\]|\{"(?:password|passwd|secret|token|apikey|api_key|api-key|authorization|credential|cookie|session|privatekey|private_key)":"\[MASKED\]"\})$/i.test(remainder)) out = '[REDACTED]';
  const points = Array.from(out);
  if (points.length > maxLength) out = points.slice(0, maxLength).join('') + '...';
  return out;
}
