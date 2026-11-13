// Exact and weak collision detection over merged tools.
// Pure: no filesystem, no renderers. Collisions are catalog DATA, never errors.

import { catalogError, compareCodeUnits } from './merge.js';
import { trimBoundary } from '../security/trim.js';

const MAX_COLLISION_ENTRIES = 10000;

// Trim per Normalization: ALL leading/trailing White_Space, Cc and Cf
// characters (property escapes, so format chars like U+200B are covered).

// K(name) = toLowerCase(NFC(trim(name)))
export function weakKey(name) {
  return trimBoundary(name).normalize('NFC').toLowerCase();
}

function sortedOrdinals(group) {
  return group
    .map((tool) => tool.ordinal)
    .sort((a, b) => a - b);
}

function sortedToolIds(group) {
  return group
    .slice()
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((tool) => tool.tool);
}

function checkTool(tool) {
  if (
    tool === null ||
    typeof tool !== 'object' ||
    typeof tool.name !== 'string' ||
    typeof tool.serverOrdinal !== 'number' ||
    typeof tool.ordinal !== 'number'
  ) {
    throw catalogError('invalid_snapshot');
  }
}

// findCollisions(tools) -> collision entries, output-sorted:
// exact groups before weak groups, then key code-unit, then tool ordinals.
//   [{kind: 'exact', name, tools: ['tool-<n>', ...]},
//    {kind: 'weak', key, tools: ['tool-<n>', ...]}]
// Cap: more than 10,000 total entries -> limit_exceeded, never partial output.
export function findCollisions(tools) {
  if (!Array.isArray(tools)) throw catalogError('invalid_snapshot');
  for (const tool of tools) checkTool(tool);

  const byName = new Map();
  const byKey = new Map();
  for (const tool of tools) {
    let exactGroup = byName.get(tool.name);
    if (exactGroup === undefined) {
      exactGroup = [];
      byName.set(tool.name, exactGroup);
    }
    exactGroup.push(tool);

    const key = weakKey(tool.name);
    let weakGroup = byKey.get(key);
    if (weakGroup === undefined) {
      weakGroup = [];
      byKey.set(key, weakGroup);
    }
    weakGroup.push(tool);
  }

  const entries = [];

  for (const [name, group] of byName) {
    const serverOrdinals = new Set(group.map((tool) => tool.serverOrdinal));
    if (serverOrdinals.size >= 2) {
      entries.push({
        kind: 'exact',
        name,
        tools: sortedToolIds(group),
        ordinals: sortedOrdinals(group),
        sortKey: name,
      });
    }
  }

  for (const [key, group] of byKey) {
    const serverOrdinals = new Set(group.map((tool) => tool.serverOrdinal));
    const exactNames = new Set(group.map((tool) => tool.name));
    // A pure exact group (one exact name) is reported once, as exact.
    if (serverOrdinals.size >= 2 && exactNames.size >= 2) {
      entries.push({
        kind: 'weak',
        key,
        tools: sortedToolIds(group),
        ordinals: sortedOrdinals(group),
        sortKey: key,
      });
    }
  }

  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'exact' ? -1 : 1;
    const byKey = compareCodeUnits(a.sortKey, b.sortKey);
    if (byKey !== 0) return byKey;
    const len = Math.min(a.ordinals.length, b.ordinals.length);
    for (let i = 0; i < len; i += 1) {
      if (a.ordinals[i] !== b.ordinals[i]) return a.ordinals[i] - b.ordinals[i];
    }
    return a.ordinals.length - b.ordinals.length;
  });

  if (entries.length > MAX_COLLISION_ENTRIES) {
    throw catalogError('limit_exceeded');
  }

  for (const entry of entries) {
    delete entry.ordinals;
    delete entry.sortKey;
  }
  return entries;
}
