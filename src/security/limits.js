// Shared admission caps. Enforced during tokenization (before
// materialization) and during the public-API guard pass.

export const LIMITS = Object.freeze({
  MAX_FILE_BYTES: 8 * 1024 * 1024, // 8 MiB per input file
  READ_PROBE_BYTES: 8 * 1024 * 1024 + 1,
  MAX_TOTAL_BYTES: 64 * 1024 * 1024, // across all inputs (orchestrator)
  MAX_INPUT_FILES: 100,
  MAX_DEPTH: 64, // root depth 0
  MAX_VALUE_NODES: 500000, // per file / per API value
  MAX_STRING_CODE_UNITS: 100000, // per string or key (UTF-16 code units)
  MAX_ARRAY_ELEMENTS: 100000, // per array
  MAX_TOOLS_PER_SNAPSHOT: 10000,
  MAX_TOOLS_TOTAL: 50000, // across all snapshots (orchestrator)
  MAX_COLLISION_ENTRIES: 10000,
  MAX_NAME_CODE_UNITS: 1000 // tool name
});

export const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
