// Command-line grammar for joons-mcp-tool-catalog.
// Fixed vocabulary only. argv contents are never echoed into errors.
import { trimBoundary } from './security/trim.js';

export class UsageError extends Error {
  constructor() {
    super('usage_error');
    this.name = 'UsageError';
    this.kind = 'usage_error';
  }
}

export const COMMANDS = new Set(['build', 'search', 'list', 'collisions', 'validate']);
export const FORMATS = new Set(['terminal', 'json', 'markdown']);

const VALUE_FLAGS = new Set(['out', 'format', 'query']);
const BOOL_FLAGS = new Set(['force', 'quiet', 'details']);

// Which flags each command accepts. Anything else is a usage error.
const ALLOWED = {
  build: new Set(['out', 'force', 'format', 'quiet']),
  search: new Set(['query', 'details', 'format']),
  list: new Set(['details', 'format']),
  collisions: new Set(['details', 'format']),
  validate: new Set(['quiet']),
};

const QUERY_LIMIT = 200;

function trimQueryText(text) {
  return trimBoundary(text);
}

// argv: array of tokens (no node/script prefix).
// Returns { help: true } | { version: true } |
//   { command, snapshots, options: { out, force, format, quiet, details, query } }
// Throws UsageError (kind 'usage_error') on any grammar violation.
export function parseArgs(argv) {
  if (!Array.isArray(argv)) throw new UsageError();
  for (const tok of argv) {
    if (typeof tok !== 'string') throw new UsageError();
  }

  const hasHelp = argv.includes('--help');
  const hasVersion = argv.includes('--version');
  if (hasHelp || hasVersion) {
    if (argv.length !== 1) throw new UsageError();
    return hasHelp ? { help: true } : { version: true };
  }

  const command = argv[0];
  if (command === undefined || command === '' || command.startsWith('-')) {
    throw new UsageError();
  }
  if (!COMMANDS.has(command)) throw new UsageError();
  const allowed = ALLOWED[command];

  const options = {
    out: undefined,
    force: false,
    format: 'terminal',
    quiet: false,
    details: false,
    query: undefined,
  };
  const provided = new Set();
  const snapshots = [];

  for (let i = 1; i < argv.length; i += 1) {
    const tok = argv[i];
    if (tok === '--') throw new UsageError(); // terminator is a usage error
    if (tok.startsWith('--')) {
      const eq = tok.indexOf('=');
      const key = eq === -1 ? tok.slice(2) : tok.slice(2, eq);
      if (key === '') throw new UsageError();
      if (BOOL_FLAGS.has(key)) {
        if (eq !== -1) throw new UsageError(); // boolean flags take no value
        if (!allowed.has(key)) throw new UsageError();
        provided.add(key);
        options[key] = true;
      } else if (VALUE_FLAGS.has(key)) {
        if (provided.has(key)) throw new UsageError(); // duplicate single-value flag
        if (!allowed.has(key)) throw new UsageError();
        provided.add(key);
        let value;
        if (eq !== -1) {
          value = tok.slice(eq + 1);
        } else {
          if (i + 1 >= argv.length) throw new UsageError();
          const next = argv[i + 1];
          if (next === '' || next.startsWith('-')) throw new UsageError();
          value = next;
          i += 1;
        }
        if (value === '') throw new UsageError();
        options[key] = value;
      } else {
        throw new UsageError();
      }
      continue;
    }
    if (tok.length > 1 && tok.startsWith('-')) throw new UsageError();
    snapshots.push(tok);
  }

  if (snapshots.length < 1) throw new UsageError();
  if (command === 'build' && options.out === undefined) throw new UsageError();
  if (command === 'search') {
    if (options.query === undefined) throw new UsageError();
    const trimmed = trimQueryText(options.query);
    if (trimmed.length < 1 || trimmed.length > QUERY_LIMIT) throw new UsageError();
  }
  if (provided.has('format') && !FORMATS.has(options.format)) throw new UsageError();

  return { help: false, version: false, command, snapshots, options };
}
