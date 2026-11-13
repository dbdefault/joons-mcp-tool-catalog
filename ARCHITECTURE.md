# Architecture

## Overview

`joons-mcp-tool-catalog` is an offline command-line tool. It merges one or
more MCP tool-list snapshots (the `joons-mcp-diff/snapshot` v1 format)
into one normalized, searchable catalog and renders reports. It never
connects to an MCP server, never runs a tool, makes no network request and
spawns no process.

## Module split

- `bin/joons-mcp-tool-catalog.js` - thin executable wrapper around `main`.
- `src/args.js` - command-line grammar. Fixed vocabulary only; throws
  `usage_error` for every grammar violation. No I/O.
- `src/cli.js` - orchestration: parse, admit inputs, merge, compute
  collisions/search, build artifacts (marker last), render and emit the
  report. Owns exit-code precedence (usage 3, then input 2, then output 4)
  and error isolation (fixed stderr lines, `internal_error` never a stack).
  Module dependencies are injected for tests and loaded lazily otherwise.
- `src/version.js` - fixed product identity.
- `src/` modules are internal implementation details; their exports are not
  a supported package interface.
- Input and security (`src/input/`, `src/security/`): bounded file reads
  (8 MiB per file, 64 MiB total, 100 files), strict snapshot validation,
  reserved-key and credential-shaped-identifier refusal, redaction, and
  output-directory safety with atomic writes.
- Core (`src/catalog/`): pure normalization (server and tool ordinals),
  collision detection (exact and weak), deterministic search ranking, and
  per-server listings. No filesystem, no renderers.
- Output and rendering (`src/output/`, `src/render/`): fixed report and
  artifact schemas, JSON/Markdown/terminal renderers. Reports contain only
  allowlisted vocabulary plus declared `--details` redacted names.

## Data flow

```
argv -> parseArgs -> {command, snapshots, options}
snapshots -> bounded read -> validate structure, reserved keys and
  credential-shaped identifiers
validated values -> mergeSnapshots -> {servers, tools} (ordinals)
tools -> findCollisions / searchTools / listServers
build:  makeCatalog -> writeAtomic catalog.json -> catalog.md -> marker
all:    makeReport -> renderReport* -> stdout (after artifact writes)
errors: CatalogError(kind) -> fixed stderr line -> exit code
```

## Determinism strategy

- Server ordinals: snapshots sorted by `server.name` UTF-16 code-unit
  order (stable tie-break by input index), numbered `server-1..S`.
- Tool ordinals: all tools sorted by (name code-unit, server ordinal,
  index within snapshot), numbered `tool-1..N`.
- Collision entries: exact groups before weak groups, then key code-unit
  order, then tool ordinals.
- Search: fixed 100/10/1 scoring, ties broken by name, server ordinal,
  index; emission capped at 1,000 with the true total in counts.
- No clocks, randomness, locale collation or input file locations as
  metadata; artifacts can contain input-derived text. The only hash is the
  declared per-snapshot SHA-256 prefix in the
  artifact. Temp-file randomness during writes is unobservable in output.
- All serialized output is UTF-8 with LF.

## Failure model

Errors crossing module boundaries carry only a fixed `kind`. The CLI maps
kinds to exit codes: usage errors to 3, input rejections to 2, output
failures to 4, and anything unexpected to `internal_error` (2, never a
stack trace). One bad input rejects the whole invocation; the multi-file
artifact write is not transactional, and a write failure preserves any
existing destination.
# Supported interface

Version 0.1.0 is a command-line tool. The code is not a supported library: modules under `src/` are internal, with no API stability and no safety guarantees for in-process use or untrusted in-process objects. Use the CLI with snapshot files.

