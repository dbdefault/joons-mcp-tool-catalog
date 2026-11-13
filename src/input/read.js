// Bounded snapshot file admission: stat first, bounded read, fatal UTF-8
// decode, single BOM removal, tokenize-before-parse with early caps
// enforcement, then structural validation. Never materializes values that
// exceed caps; never silently truncates.

import { open, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  LIMITS,
  RESERVED_KEYS
} from '../security/limits.js';
import {
  inputUnreadable,
  invalidJson,
  invalidSnapshot,
  limitExceeded
} from '../errors.js';
import { validateSnapshot } from './snapshot.js';

const MAX_STRING = LIMITS.MAX_STRING_CODE_UNITS;
const WS = new Set([0x20, 0x09, 0x0a, 0x0d]);

class Tokenizer {
  constructor(text) {
    this.text = text;
    this.pos = 0;
    this.length = text.length;
  }

  error() {
    throw invalidJson();
  }

  skipWs() {
    while (this.pos < this.length && WS.has(this.text.charCodeAt(this.pos))) {
      this.pos += 1;
    }
  }

  peek() {
    this.skipWs();
    return this.pos < this.length ? this.text[this.pos] : '';
  }

  expect(ch) {
    if (this.peek() !== ch) this.error();
    this.pos += 1;
  }

  readLiteral(word) {
    if (!this.text.startsWith(word, this.pos)) this.error();
    this.pos += word.length;
  }

  // Raw (unescaped) input run; rejects control chars. Surrogates can only
  // appear here as valid UTF-16 pairs produced by fatal UTF-8 decoding of
  // supplementary characters (lone surrogates are rejected by the decoder);
  // accept a code unit only as part of a properly paired run. Lone
  // surrogates produced by \u escapes are rejected in readEscape.
  readRawRun() {
    const start = this.pos;
    let out = '';
    while (this.pos < this.length) {
      const code = this.text.charCodeAt(this.pos);
      if (code === 0x22) break;
      if (code === 0x5c) {
        if (this.pos > start && out.length === 0) {
          out = this.text.slice(start, this.pos);
        }
        out += this.readEscape();
        continue;
      }
      if (code < 0x20) this.error();
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = this.text.charCodeAt(this.pos + 1);
        if (next < 0xdc00 || next > 0xdfff) this.error();
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        const prev = this.text.charCodeAt(this.pos - 1);
        if (prev < 0xd800 || prev > 0xdbff) this.error();
      }
      if (out.length > 0) out += this.text[this.pos];
      this.pos += 1;
    }
    if (this.pos >= this.length) this.error();
    if (out.length === 0) {
      const run = this.text.slice(start, this.pos);
      if (run.length > MAX_STRING) throw limitExceeded();
      return run;
    }
    if (out.length > MAX_STRING) throw limitExceeded();
    return out;
  }

  readHex4() {
    if (this.pos + 4 > this.length) this.error();
    const hex = this.text.slice(this.pos, this.pos + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.error();
    this.pos += 4;
    return parseInt(hex, 16);
  }

  readEscape() {
    this.pos += 1; // consume backslash
    if (this.pos >= this.length) this.error();
    const esc = this.text[this.pos];
    this.pos += 1;
    switch (esc) {
      case '"':
        return '"';
      case '\\':
        return '\\';
      case '/':
        return '/';
      case 'b':
        return '\b';
      case 'f':
        return '\f';
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      case 'u': {
        const first = this.readHex4();
        if (first >= 0xd800 && first <= 0xdbff) {
          if (this.text[this.pos] !== '\\' || this.text[this.pos + 1] !== 'u') {
            this.error();
          }
          this.pos += 2;
          const second = this.readHex4();
          if (second < 0xdc00 || second > 0xdfff) this.error();
          return String.fromCharCode(first, second);
        }
        if (first >= 0xdc00 && first <= 0xdfff) this.error();
        return String.fromCharCode(first);
      }
      default:
        this.error();
    }
  }

  readString() {
    if (this.text[this.pos] !== '"') this.error();
    this.pos += 1;
    const value = this.readRawRun();
    this.pos += 1; // consume closing quote
    return value;
  }

  readNumber() {
    const rest = this.text.slice(this.pos);
    const m = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(rest);
    if (m === null) this.error();
    const raw = m[0];
    this.pos += raw.length;
    const value = Number(raw);
    if (!Number.isFinite(value)) throw invalidJson();
    return value;
  }

  // Caps are enforced here, during tokenization, before any value is
  // materialized. Depth counts values: root is 0, so no value may sit at
  // depth 65. state = { nodes, maxDepth }.
  readValue(state, depth) {
    if (depth > LIMITS.MAX_DEPTH) throw limitExceeded();
    const ch = this.peek();
    if (ch === '"') {
      state.nodes += 1;
      if (state.nodes > LIMITS.MAX_VALUE_NODES) throw limitExceeded();
      return this.readString();
    }
    if (ch === '{') {
      state.nodes += 1;
      if (state.nodes > LIMITS.MAX_VALUE_NODES) throw limitExceeded();
      this.pos += 1;
      const obj = {};
      if (this.peek() === '}') {
        this.pos += 1;
        return obj;
      }
      for (;;) {
        if (this.peek() !== '"') this.error();
        const key = this.readString();
        if (RESERVED_KEYS.has(key)) throw invalidSnapshot();
        this.expect(':');
        const value = this.readValue(state, depth + 1);
        if (Object.hasOwn(obj, key)) throw invalidJson();
        Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
        const sep = this.peek();
        if (sep === ',') {
          this.pos += 1;
          continue;
        }
        if (sep === '}') {
          this.pos += 1;
          return obj;
        }
        this.error();
      }
    }
    if (ch === '[') {
      state.nodes += 1;
      if (state.nodes > LIMITS.MAX_VALUE_NODES) throw limitExceeded();
      this.pos += 1;
      const arr = [];
      if (this.peek() === ']') {
        this.pos += 1;
        return arr;
      }
      for (;;) {
        arr.push(this.readValue(state, depth + 1));
        if (arr.length > LIMITS.MAX_ARRAY_ELEMENTS) throw limitExceeded();
        const sep = this.peek();
        if (sep === ',') {
          this.pos += 1;
          continue;
        }
        if (sep === ']') {
          this.pos += 1;
          return arr;
        }
        this.error();
      }
    }
    if (ch === 't') {
      state.nodes += 1;
      if (state.nodes > LIMITS.MAX_VALUE_NODES) throw limitExceeded();
      this.readLiteral('true');
      return true;
    }
    if (ch === 'f') {
      state.nodes += 1;
      if (state.nodes > LIMITS.MAX_VALUE_NODES) throw limitExceeded();
      this.readLiteral('false');
      return false;
    }
    if (ch === 'n') {
      state.nodes += 1;
      if (state.nodes > LIMITS.MAX_VALUE_NODES) throw limitExceeded();
      this.readLiteral('null');
      return null;
    }
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      state.nodes += 1;
      if (state.nodes > LIMITS.MAX_VALUE_NODES) throw limitExceeded();
      return this.readNumber();
    }
    if (ch === '') this.error();
    this.error();
  }
}

export function parseSnapshotBytes(buf) {
  let bytes = buf;
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    bytes = bytes.subarray(3);
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw invalidJson();
  }
  const tokenizer = new Tokenizer(text);
  const state = { nodes: 0, maxDepth: 0 };
  const value = tokenizer.readValue(state, 0);
  tokenizer.skipWs();
  if (tokenizer.pos !== tokenizer.length) throw invalidJson();
  return value;
}

async function readBounded(handle, size) {
  const capped = Math.min(size, LIMITS.READ_PROBE_BYTES);
  const buf = Buffer.alloc(capped);
  let offset = 0;
  while (offset < capped) {
    const { bytesRead } = await handle.read(buf, offset, capped - offset, offset);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  if (offset !== size || size > LIMITS.MAX_FILE_BYTES) {
    throw limitExceeded();
  }
  return buf;
}

// Reads and fully validates one snapshot file.
// Returns { value, sha256, bytes } where sha256 is the full hex digest of
// the file's raw bytes (callers show a truncated prefix) and bytes is the
// raw byte length (orchestrator enforces the 64 MiB aggregate cap).
export async function readSnapshotFile(path) {
  let handle;
  try {
    const info = await stat(path);
    if (!info.isFile()) throw inputUnreadable();
    handle = await open(path, 'r');
    const buf = await readBounded(handle, info.size);
    const sha256 = createHash('sha256').update(buf).digest('hex');
    const value = validateSnapshot(parseSnapshotBytes(buf));
    return { value, sha256, bytes: buf.length };
  } catch (error) {
    if (error && error.kind !== undefined) throw error;
    throw inputUnreadable();
  } finally {
    if (handle !== undefined) {
      await handle.close().catch(() => {});
    }
  }
}
