import { types } from 'node:util';
import { invalidSnapshot, limitExceeded } from './errors.js';
import { LIMITS, RESERVED_KEYS } from './security/limits.js';

const inert = new WeakSet();
export const isInert = value => value !== null && typeof value === 'object' && inert.has(value);

// Register only newly created internal values, never caller-owned objects.
export function register(value) {
  if (value === null || typeof value !== 'object' || inert.has(value)) return value;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && 'value' in descriptor) register(descriptor.value);
  }
  Object.freeze(value);
  inert.add(value);
  return value;
}

export function toInert(root) {
  let nodes = 0;
  const ancestors = new Set();
  function copy(value, depth) {
    if (++nodes > LIMITS.MAX_VALUE_NODES || depth > LIMITS.MAX_DEPTH) throw limitExceeded();
    if (typeof value === 'string') { if (value.length > LIMITS.MAX_STRING_CODE_UNITS) throw limitExceeded(); return value; }
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') { if (!Number.isFinite(value)) throw invalidSnapshot(); return value; }
    if (typeof value !== 'object' || types.isProxy(value) || ancestors.has(value)) throw invalidSnapshot();
    const array = Array.isArray(value);
    const proto = Object.getPrototypeOf(value);
    if (array ? proto !== Array.prototype : proto !== null && proto !== Object.prototype) throw invalidSnapshot();
    const keys = Reflect.ownKeys(value);
    let length = 0;
    if (array) {
      const descriptor = Object.getOwnPropertyDescriptor(value, 'length');
      length = descriptor.value;
      if (length > LIMITS.MAX_ARRAY_ELEMENTS) throw limitExceeded();
      if (keys.length !== length + 1) throw invalidSnapshot();
    }
    const result = array ? [] : Object.create(null);
    ancestors.add(value);
    for (const key of keys) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string' || RESERVED_KEYS.has(key)) throw invalidSnapshot();
      if (key.length > LIMITS.MAX_STRING_CODE_UNITS) throw limitExceeded();
      if (array && (!/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= length)) throw invalidSnapshot();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw invalidSnapshot();
      Object.defineProperty(result, key, { value: copy(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    ancestors.delete(value);
    return result;
  }
  return copy(root, 0);
}
