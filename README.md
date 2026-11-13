# joons-mcp-tool-catalog

Merge one or more MCP tool-list snapshots (the `joons-mcp-diff/snapshot` v1
format) into a single normalized, searchable, offline catalog.

- Detects duplicate and colliding tool names across servers (exact and weak).
- Lists tools per server and globally.
- Deterministic text search over tool names, titles and descriptions.
- Emits a stable `catalog.json` artifact plus Markdown and terminal reports.

The tool is fully offline: it never connects to an MCP server, never runs a
tool, makes no network request, and spawns no process. No MCP server was
contacted at any point.

## Requirements

Node.js 20 or newer. No dependencies, no build step.

## Quickstart

```sh
# Validate snapshot files
node bin/joons-mcp-tool-catalog.js validate examples/sample-snapshot.json

# Build a catalog into ./out
node bin/joons-mcp-tool-catalog.js build examples/sample-snapshot.json --out out

# Search across snapshots
node bin/joons-mcp-tool-catalog.js search examples/sample-snapshot.json --query weather

# List servers and tools
node bin/joons-mcp-tool-catalog.js list examples/sample-snapshot.json

# Show collisions (duplicates are catalog data, never an error)
node bin/joons-mcp-tool-catalog.js collisions examples/sample-snapshot.json
```

## CLI reference

```
joons-mcp-tool-catalog build <snapshot>... --out DIR [--force] [--format terminal|json|markdown] [--quiet]
joons-mcp-tool-catalog search <snapshot>... --query TEXT [--details] [--format terminal|json|markdown]
joons-mcp-tool-catalog list <snapshot>... [--details] [--format terminal|json|markdown]
joons-mcp-tool-catalog collisions <snapshot>... [--details] [--format terminal|json|markdown]
joons-mcp-tool-catalog validate <snapshot>... [--quiet]
joons-mcp-tool-catalog --help | --version
```

- `<snapshot>...`: one or more snapshot files (at least one). Directories are
  refused. Options accept `--key=value` or `--key value`; `--` is a usage error.
- `--out DIR` (build only, required): output directory. Must not contain any
  input, and no input may live inside it. A non-empty directory is accepted
  only when it already carries the `.joons-mcp-tool-catalog-output` marker or
  `--force` is given. `--force` never bypasses path or symlink checks and
  never deletes files.
- `--query TEXT` (search only, required): 1..200 code units after trimming.
  Search is a whitespace-tokenized, case-insensitive substring AND over tool
  name, title and description. Scoring: 100 per token found in the name,
  10 in the title, 1 in the description; ties break by name, then server
  ordinal, then tool index. At most 1,000 matches are shown; the true total
  is reported in `counts.matches`.
- `--format`: `terminal` (default), `json` or `markdown`.
- `--quiet` (build, validate): successful terminal output prints nothing.
- `--details` (search, list, collisions): additionally include short,
  redacted, input-derived names in reports. Details may contain internal
  names; review before sharing.
- `--force` (build only): see `--out`.

Successful terminal runs with `--quiet` print nothing; other successful runs
print one report to stdout. Failures print one fixed error line
`joons-mcp-tool-catalog: <kind>` to stderr.

Exit codes: `0` success (collisions are data, never an error); `2` an input
was unreadable, malformed, unsafe or over limit, or an internal error
(`internal_error`); `3` usage error; `4` output preparation/write/stdout
failure. There is no exit code 1.

See [docs/CLI.md](docs/CLI.md) for the exact grammar, every fixed error line
and every report field.

## Artifact schema

`build --out DIR` writes three files, in this order:

1. `catalog.json` - the normalized catalog:
   ```json
   {
     "format": "joons-mcp-tool-catalog/catalog",
     "schemaVersion": 1,
     "tool": { "name": "joons-mcp-tool-catalog", "version": "0.1.1" },
     "command": "build",
     "counts": { "servers": 1, "tools": 2, "collisions": 0, "collidingTools": 0, "redactions": 0 },
     "servers": [{ "server": "server-1", "sha256": "a1b2c3d4e5f6", "tools": 2 }],
     "tools": [{ "tool": "tool-1", "server": "server-1", "name": "greet", "title": null, "description": null, "collides": false }],
     "collisions": [{ "kind": "exact", "name": "greet", "tools": ["tool-1", "tool-2"] }],
     "matches": []
   }
   ```
2. `catalog.md` - a Markdown rendering of the same catalog.
3. `.joons-mcp-tool-catalog-output` - a zero-byte marker, written last.

Servers appear only as `server-<n>` ordinals (sorted by server-name code
units) plus the first 12 hex characters of the snapshot byte SHA-256.
`catalog.json` contains exact tool names and sanitized titles and descriptions
by explicit design; `catalog.md` summarizes ordinals and counts and omits names, titles and descriptions.
Each changed string is counted in `counts.redactions`.

Default stdout reports use only fixed safe vocabulary and ordinal identifiers.
`--details` adds short sanitized input-derived names.

Sanitizing is best-effort literal pattern matching. It recognizes URLs,
literal Windows drive, UNC, POSIX and `~/` path starts (the rest of the field
is dropped), e-mail, IPv4, Bearer/JWT, sensitive name=value pairs and opaque
tokens; credential scanning also tries tolerant percent decoding and base64
candidates. It does not recognize percent-encoded or otherwise obfuscated
path starts such as `C:%5CUsers%5C...`, names or paths in exact tool names,
hex, base32, reversed or entity encodings, or personal names in free text.
There is no anonymization guarantee. A human must review outputs before sharing.

## Interpreting collisions

Collisions and duplicates are catalog **data**, not verdicts, and every
successful command exits `0`.

- **Exact collision**: the same tool name string is provided by tools from
  two or more distinct servers. Every exact collision is also a duplicate
  tool name.
- **Weak collision**: two or more *different* exact names that fold to the
  same key `toLowerCase(NFC(trim(name)))` across two or more servers, e.g.
  `Get_Weather` and `get_weather `. A pure exact group is reported once, as
  exact, never as weak.

A collision means the names are the same or fold together; it says nothing
about whether the tools behave the same. Use the catalog to decide where to
look, not as a substitute for reviewing the tools themselves.

## Safe disclosure

- Reports are built from a fixed allowlist of vocabulary. `--details` widens
  this only with short redacted names, never expanded.
- Input files are treated as untrusted: they are size-capped, depth-capped,
  scanned for reserved keys and credential-shaped identifiers, and never
  executed, evaluated, opened as paths/URLs, or compiled into regular
  expressions. A credential-shaped `server.name` or tool `name` rejects the
  whole snapshot.
- Redaction is best effort, not an anonymization guarantee. Artifacts
  contain exact tool names by explicit opt-in - **review artifacts before
  sharing**.

## Determinism

Identical input bytes and options produce byte-identical outputs across
runs, input order shuffles and operating systems: no clocks, no randomness,
no locale sorting, and no input file locations used as metadata. (The per-snapshot `sha256` prefix
identifies the exact input bytes; shuffling the bytes of a snapshot changes
that prefix by design.) All outputs are UTF-8 with LF line endings.

## Offline guarantee

No network, no subprocess, no dynamic code execution anywhere in the source
tree; tests assert this with import tripwires.

## Development

```sh
node scripts/test.js
```

The test runner enumerates test files explicitly and runs them with the
built-in `node:test` runner. Zero dependencies; nothing is installed.

## License

Apache-2.0. See [LICENSE](LICENSE).
# Supported interface

Version 0.1.1 is a command-line tool. The code is not a supported library: modules under `src/` are internal, with no API stability and no safety guarantees for in-process use or untrusted in-process objects. Use the CLI with snapshot files.

