# CLI reference - joons-mcp-tool-catalog 0.1.0

Exact grammar, exit codes, fixed error lines and report fields.

## Grammar

```
joons-mcp-tool-catalog build <snapshot>... --out DIR [--force] [--format terminal|json|markdown] [--quiet]
joons-mcp-tool-catalog search <snapshot>... --query TEXT [--details] [--format terminal|json|markdown]
joons-mcp-tool-catalog list <snapshot>... [--details] [--format terminal|json|markdown]
joons-mcp-tool-catalog collisions <snapshot>... [--details] [--format terminal|json|markdown]
joons-mcp-tool-catalog validate <snapshot>... [--quiet]
joons-mcp-tool-catalog --help | --version
```

- The command word is required and must be first, except for `--help` and
  `--version`, which must appear alone (combined with anything else is a
  usage error).
- `<snapshot>...`: one or more regular files, at least one. Directories are
  refused. At most 100 input files, at most 64 MiB total, at most 8 MiB per
  file.
- Options accept `--key=value` or `--key value`. A bare `--` terminator is
  itself a usage error, as is any dash-leading token in snapshot position.
  Empty or missing option values,
  duplicate single-value flags (`--out`, `--format`, `--query`), unknown
  flags, flags inappropriate for the command, and invalid enum values are
  usage errors.
- Flags per command: `build` - `--out` (required), `--force`, `--format`,
  `--quiet`; `search` - `--query` (required), `--details`, `--format`;
  `list` / `collisions` - `--details`, `--format`; `validate` - `--quiet`.
- `--query`: 1..200 UTF-16 code units after trimming. Search tokens are
  whitespace-separated and ANDed, case-insensitively, over tool name, title
  and description. Score: 100 per token found in the name, 10 in the title,
  1 in the description. Ranking: score descending, then name code-unit
  order, then server ordinal, then tool index. At most 1,000 matches are
  emitted; `counts.matches` is the true total.
- `--format`: `terminal` (default), `json`, `markdown`.
- `--quiet`: suppresses a successful terminal report only (`build`,
  `validate`). JSON/Markdown reports and errors are unaffected.
- `--details`: collision and match entries additionally carry `"name": "<redacted>"`
  (at most 200 code points, Markdown-escaped in Markdown). The mode note
  `details: may contain internal names` is rendered.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success. Collisions and duplicates are catalog data, never an error. |
| 2 | An input was unreadable, malformed, unsafe, or over a limit; or an unexpected internal error (`internal_error`). One bad input rejects the whole invocation; no partial output is ever emitted. |
| 3 | Usage error. |
| 4 | Output preparation, artifact write, or stdout write failure. No successful artifact claim is made on 4. A failure may leave earlier completed artifact files in place; the multi-file write is not transactional. |

Precedence: usage (3) first, then input rejection (2), then output (4).
There is no exit code 1.

## Fixed stderr lines

Every failure prints exactly one line to stderr, of the form
`joons-mcp-tool-catalog: <kind>`, with no further text:

- `joons-mcp-tool-catalog: input_unreadable` - a snapshot path cannot be
  opened, is not a regular file, or changes size while being read.
- `joons-mcp-tool-catalog: invalid_json` - a snapshot is not well-formed
  JSON (including duplicate object keys, non-finite numbers, lone
  surrogates, or invalid UTF-8).
- `joons-mcp-tool-catalog: invalid_snapshot` - a snapshot is JSON but not
  the exact `joons-mcp-diff/snapshot` v1 shape (unknown or missing keys,
  wrong `format`/`schemaVersion`, duplicate tool name within one snapshot,
  bad ISO timestamp, `toolCount` mismatch, reserved keys such as
  `__proto__`).
- `joons-mcp-tool-catalog: limit_exceeded` - a size, depth, node, string,
  array, tool-count, file-count or collision-entry cap was exceeded. Limits
  are enforced before materialization; nothing is ever truncated.
- `joons-mcp-tool-catalog: credential_detected` - a `server.name` or tool
  `name` is credential-shaped (token prefixes, private-key banners, JWT,
  Bearer, or sensitive name=value pairs, including encoded variants).
  Identifiers are never mutated to make them safe.
- `joons-mcp-tool-catalog: output_error` - the output directory is unsafe
  or a write failed. stdout closing early (EPIPE) also yields this line.
- `joons-mcp-tool-catalog: usage_error` - the command line itself is
  invalid.
- `joons-mcp-tool-catalog: internal_error` - any unexpected failure. Fixed
  text only, never a stack trace.

stderr uses fixed error lines without input-derived content, parser or OS
exceptions, or ANSI sequences. A broken stderr (EPIPE) is ignored and does not change the exit
code.

## stdout

stdout carries only the requested report. Default reports use fixed safe
vocabulary and ordinals; `--details` adds sanitized input-derived names.
No ANSI sequences, no carriage returns: output is UTF-8 with LF endings.

By design, `catalog.json` contains exact tool names and sanitized titles and
descriptions; `catalog.md` summarizes ordinals and counts. Sanitizing uses
best-effort literal patterns for URLs, Windows drive/UNC/POSIX/`~/` path
starts (the rest of the field is dropped), e-mail, IPv4, Bearer/JWT,
sensitive name=value pairs and opaque tokens, plus tolerant percent decoding
and base64 candidates for credentials. Percent-encoded or obfuscated path
starts such as `C:%5CUsers%5C...`, names or paths inside exact tool names,
hex, base32, reversed and entity encodings, and personal names in free text
are not recognized. There is no anonymization guarantee; a human must review
outputs before sharing.

## Report schema (JSON format)

```json
{
  "format": "joons-mcp-tool-catalog/report",
  "schemaVersion": 1,
  "tool": { "name": "joons-mcp-tool-catalog", "version": "0.1.0" },
  "command": "search",
  "status": "PASS",
  "mode": { "details": false },
  "counts": { "servers": 1, "tools": 2, "collisions": 0, "collidingTools": 0, "matches": 1, "redactions": 0 },
  "servers": [{ "server": "server-1", "tools": 2 }],
  "collisions": [],
  "matches": [{ "tool": "tool-1", "server": "server-1", "score": 101 }],
  "problems": []
}
```

- `command` is `build`, `search`, `list`, `collisions` or `validate`.
- `status` is always `PASS` on exit 0 (no verdict semantics; collisions
  are data).
- `mode.details` mirrors `--details`.
- `counts.matches` is the true total number of matching tools; `matches`
  carries at most 1,000 entries in rank order.
- `counts.redactions` counts title/description strings changed by
  redaction in this run's outputs.
- Server entries contain anonymous ordinal labels and tool counts; without `--details` they omit `name`, and with it `name` is the empty string; no input-derived server name is emitted.
  In terminal output the empty name appears as `name=`; in Markdown it appears as `()`.
- Collision entries
  carry `kind` (`exact` or `weak`) and the tool ordinals; with
  `--details`, `name` holds the (redacted) exact name or weak key. Match
  entries carry the tool ordinal, its server ordinal and the integer
  score; with `--details`, `name` holds the redacted tool name.
- `problems` is always `[]` in 0.1.0: any input problem rejects the
  invocation before a report exists.

## Artifact schema (build only)

`build --out DIR` writes, in order: `catalog.json`, `catalog.md`, then the
zero-byte marker `.joons-mcp-tool-catalog-output`. Fixed names only. The
report is emitted only after all three writes succeed.

```json
{
  "format": "joons-mcp-tool-catalog/catalog",
  "schemaVersion": 1,
  "tool": { "name": "joons-mcp-tool-catalog", "version": "0.1.0" },
  "command": "build",
  "counts": { "servers": 1, "tools": 2, "collisions": 0, "collidingTools": 0, "redactions": 0 },
  "servers": [{ "server": "server-1", "sha256": "a1b2c3d4e5f6", "tools": 2 }],
  "tools": [{ "tool": "tool-1", "server": "server-1", "name": "greet", "title": null, "description": null, "collides": false }],
  "collisions": [{ "kind": "exact", "name": "greet", "tools": ["tool-1", "tool-2"] }],
  "matches": []
}
```

- The artifact is the explicit opt-in: tool `name` values appear verbatim;
  `title`/`description` are redacted (`null` when the source is `null`).
  Review the artifact before sharing it.
- Artifact server entries carry the ordinal, the first 12 hex characters
  of the snapshot byte SHA-256, and the tool count. Report server entries
  never carry a hash.
- `collides` is `true` exactly for tools that appear in a collision group.
- `matches` is `[]` for build.
- JSON is two-space indented, LF, with a final LF.
