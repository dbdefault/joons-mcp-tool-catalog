// Snapshot structural validation (Diff v1 shape) plus the public-API guard
// pass: rejects cyclic, accessor-bearing, non-plain and non-JSON values
// without invoking getters, under the same caps as file admission.

import {
  LIMITS,
  RESERVED_KEYS
} from '../security/limits.js';
import {
  invalidSnapshot,
  limitExceeded,
  credentialDetected
} from '../errors.js';
import { scanForCredential } from '../security/credentials.js';
import { types } from 'node:util';
import { toInert, register } from '../inert.js';

const ROOT_KEYS = new Set([
  'format',
  'schemaVersion',
  'createdAt',
  'tool',
  'label',
  'server',
  'tools',
  'stats'
]);
const TOOL_META_KEYS = new Set(['name', 'version']);
const SERVER_KEYS = new Set(['name', 'version', 'protocolVersion']);
const STATS_KEYS = new Set(['toolCount', 'pages', 'duplicateNames']);
const TOOL_ENTRY_KEYS = new Set([
  'name',
  'title',
  'description',
  'inputSchema',
  'outputSchema',
  'annotations'
]);

const CONTROL_FREE = /^[^\u0000-\u001F\u007F-\u009F]*$/;
const ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function isPlainObject(value) {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isValidIsoTimestamp(text) {
  if (!ISO_TIMESTAMP.test(text)) return false;
  return !Number.isNaN(Date.parse(text));
}

// Guard pass: own-property enumeration only; getters are never invoked.
// Enforces JSON-ness, plainness, acyclicity, caps and reserved keys.
export function guardValue(root, maxNodes = LIMITS.MAX_VALUE_NODES) {
  let nodes = 0;
  const seen = new Set();
  const completed = new WeakMap();
  const stack = [{ value: root, depth: 0 }];
  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame.leave !== undefined) {
      const state = frame.leave;
      seen.delete(state.value);
      completed.set(state.value, { count: nodes - state.start, height: state.height });
      if (state.parent) state.parent.height = Math.max(state.parent.height, state.height + 1);
      continue;
    }
    const { value, depth } = frame;
    if (depth > LIMITS.MAX_DEPTH) throw limitExceeded();
    nodes += 1;
    if (nodes > maxNodes) throw limitExceeded();
    if (frame.parent) frame.parent.height = Math.max(frame.parent.height, 1);
    if (typeof value === 'string') {
      if (value.length > LIMITS.MAX_STRING_CODE_UNITS) throw limitExceeded();
      continue;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw invalidSnapshot();
      continue;
    }
    if (typeof value === 'boolean' || value === null) {
      continue;
    }
    if (typeof value !== 'object') throw invalidSnapshot();
    if (types.isProxy(value)) throw invalidSnapshot();
    if (seen.has(value)) throw invalidSnapshot(); // cyclic
    const previous = completed.get(value);
    if (previous !== undefined) {
      nodes += previous.count - 1;
      if (nodes > maxNodes || depth + previous.height > LIMITS.MAX_DEPTH) throw limitExceeded();
      if (frame.parent) frame.parent.height = Math.max(frame.parent.height, previous.height + 1);
      continue;
    }
    seen.add(value);
    const state = { value, depth, start: nodes - 1, height: 0, parent: frame.parent };
    stack.push({ leave: state });
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) throw invalidSnapshot();
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
      const length = lengthDescriptor.value;
      if (length > LIMITS.MAX_ARRAY_ELEMENTS) throw limitExceeded();
      const own = Reflect.ownKeys(value);
      if (own.length !== length + 1) throw invalidSnapshot();
      for (const key of own) {
        if (key === 'length') continue;
        if (typeof key !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= length) throw invalidSnapshot();
      }
      for (let i = length - 1; i >= 0; i -= 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
        if (descriptor === undefined || !descriptor.enumerable) {
          throw invalidSnapshot(); // holes and hidden elements are not JSON
        }
        if (typeof descriptor.get === 'function' || typeof descriptor.set === 'function') {
          throw invalidSnapshot();
        }
        stack.push({ value: descriptor.value, depth: depth + 1, parent: state });
      }
      continue;
    }
    if (!isPlainObject(value)) throw invalidSnapshot();
    const keys = Reflect.ownKeys(value);
    for (let i = keys.length - 1; i >= 0; i -= 1) {
      const key = keys[i];
      if (typeof key !== 'string') throw invalidSnapshot();
      if (RESERVED_KEYS.has(key)) throw invalidSnapshot();
      if (key.length > LIMITS.MAX_STRING_CODE_UNITS) throw limitExceeded();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable) {
        throw invalidSnapshot();
      }
      if (typeof descriptor.get === 'function' || typeof descriptor.set === 'function') {
        throw invalidSnapshot();
      }
      stack.push({ value: descriptor.value, depth: depth + 1, parent: state });
    }
  }
}

function expectExactKeys(value, allowed) {
  const keys = Object.keys(value);
  for (const key of keys) {
    if (!allowed.has(key)) throw invalidSnapshot();
  }
  for (const key of allowed) {
    if (!Object.hasOwn(value, key)) throw invalidSnapshot();
  }
}

function expectString(value) {
  if (typeof value !== 'string') throw invalidSnapshot();
}

function expectNullOrString(value) {
  if (value !== null && typeof value !== 'string') throw invalidSnapshot();
}

function expectNonNegativeSafeInteger(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw invalidSnapshot();
}

function checkToolName(name) {
  expectString(name);
  if (name.length === 0) throw invalidSnapshot();
  if (!CONTROL_FREE.test(name)) throw invalidSnapshot();
  if (name.length > LIMITS.MAX_NAME_CODE_UNITS) throw invalidSnapshot();
  if (scanForCredential(name)) throw credentialDetected();
}

function checkAnnotations(value) {
  if (value === null) return;
  if (!isPlainObject(value)) throw invalidSnapshot();
}

function checkToolEntry(entry) {
  if (!isPlainObject(entry)) throw invalidSnapshot();
  expectExactKeys(entry, TOOL_ENTRY_KEYS);
  checkToolName(entry.name);
  expectNullOrString(entry.title);
  expectNullOrString(entry.description);
  if (!Object.hasOwn(entry, 'inputSchema')) throw invalidSnapshot();
  checkAnnotations(entry.annotations);
}

function checkStats(stats, toolsLength) {
  if (!isPlainObject(stats)) throw invalidSnapshot();
  const keys = Object.keys(stats);
  for (const key of keys) {
    if (!STATS_KEYS.has(key)) throw invalidSnapshot();
  }
  if (!Object.hasOwn(stats, 'toolCount')) throw invalidSnapshot();
  if (!Object.hasOwn(stats, 'pages')) throw invalidSnapshot();
  if (stats.toolCount !== toolsLength) throw invalidSnapshot();
  expectNonNegativeSafeInteger(stats.pages);
  if (Object.hasOwn(stats, 'duplicateNames')) {
    if (!Array.isArray(stats.duplicateNames)) throw invalidSnapshot();
    for (const name of stats.duplicateNames) {
      expectString(name);
    }
  }
}

// Structural validation of one parsed snapshot. Throws CatalogError.
export function validateSnapshot(value) {
  value = toInert(value);
  if (!isPlainObject(value)) throw invalidSnapshot();
  expectExactKeys(value, ROOT_KEYS);

  if (value.format !== 'joons-mcp-diff/snapshot') throw invalidSnapshot();
  if (value.schemaVersion !== 1) throw invalidSnapshot();
  expectString(value.createdAt);
  if (!isValidIsoTimestamp(value.createdAt)) throw invalidSnapshot();
  expectNullOrString(value.label);

  if (!isPlainObject(value.tool)) throw invalidSnapshot();
  expectExactKeys(value.tool, TOOL_META_KEYS);
  expectString(value.tool.name);
  expectString(value.tool.version);

  if (!isPlainObject(value.server)) throw invalidSnapshot();
  expectExactKeys(value.server, SERVER_KEYS);
  expectString(value.server.name);
  expectString(value.server.version);
  expectString(value.server.protocolVersion);
  if (scanForCredential(value.server.name)) throw credentialDetected();

  if (!Array.isArray(value.tools)) throw invalidSnapshot();
  if (value.tools.length > LIMITS.MAX_TOOLS_PER_SNAPSHOT) throw limitExceeded();
  const seen = new Set();
  for (const entry of value.tools) {
    checkToolEntry(entry);
    if (seen.has(entry.name)) throw invalidSnapshot();
    seen.add(entry.name);
  }

  checkStats(value.stats, value.tools.length);
  return register(value);
}
