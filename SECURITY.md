# Security

## Threat model

Snapshot files are untrusted input. They may be crafted to be enormous,
deeply nested, almost-valid, or to carry credential-shaped strings, and an
attacker may benefit from them being merged, echoed into a terminal or
report, written over other files, or turned into code.

The catalog treats every snapshot as data to be validated, capped and
scanned - never as instructions:

- Snapshots are opened read-only as regular files, stat-checked, and read
  at most 8 MiB + 1 byte per file (64 MiB total, 100 files). Over-limit
  inputs are rejected, never truncated.
- JSON is tokenized with strict limits (depth 64, 500,000 nodes per file,
  100,000 code units per string, 100,000 array elements, 10,000 tools per
  snapshot, 50,000 tools total) before materialization; duplicate keys,
  non-finite numbers, lone surrogates and malformed UTF-8 are rejected.
- The reserved keys `__proto__`, `constructor` and `prototype` are
  rejected anywhere in the document, including schema branches the catalog
  otherwise ignores. All internal maps are `Map` or null-prototype objects.
- Input is never executed, evaluated, used as a path, command or URL, or
  compiled into a regular expression; only fixed, bounded regexes are
  used.

## Credential-shaped identifier refusal

A single fixed scanner is shared by input admission and display redaction.
Applied to every `server.name` and tool `name`, a match rejects the whole
snapshot with `credential_detected` (exit 2). Covered shapes include
`ghp_`/`gho_`/`ghu_`/`github_pat_` tokens, `sk-` keys, `AKIA` keys,
Slack `xox*` tokens, PEM private-key banners, `Bearer` strings, JWTs, and
case-insensitive `password`/`secret`/`token`/`api_key`/... pairs with opaque
values - checked in original and decoded (percent, base64) forms.
Identifiers are never mutated to make them safe: mutation would change
collision semantics.

## Allowlist reports

Default reports use fixed safe vocabulary and ordinal identifiers. `--details` adds
short sanitized input-derived names that pass through a fixed redaction
pipeline (controls stripped; recognized URL, path, e-mail, IP, token
and credential-shaped patterns replaced with placeholders; truncated to 200
code points), never expanded. Markdown renderers escape Markdown
metacharacters in any `--details` text. No ANSI sequences are emitted.
Server entries contain anonymous ordinal labels and tool counts; without `--details` they omit `name`, and with it `name` is the empty string; no input-derived server name is emitted.
In terminal output the empty name appears as `name=`; in Markdown it appears as `()`.

On macOS, the root-level system links `/var`, `/tmp` and `/etc` are allowed only when they resolve to their corresponding `/private` directories. Their names and resolved targets are compared case-insensitively; other symbolic-link components are refused.
URLs, including file URLs, are replaced before paths. Path handling replaces
everything from a recognized path start to the end of the field, including
spaces and text following original line breaks; text before the start stays.
This can
over-redact. See `docs/SECURITY.md` for the exact rule.

## Output-directory safety

`build --out DIR` resolves absolute paths and rejects symlink/junction
components (except the resolved macOS system links `/var`, `/tmp`,
`/etc`), existing non-directory targets, and any directory equal to an
input's parent or containing an input. A non-empty directory is accepted
only with the tool's own regular-file marker or `--force`; `--force` never
bypasses path/symlink checks and never deletes files. Fixed destinations
must not be symlinks, directories, or hardlinks to an input. Files are
written to exclusive random same-directory temp files, flushed and closed,
then atomically renamed; on failure only the tool's own temp is removed
and an existing destination is preserved. The zero-byte marker is written
last, only after both artifacts succeed.

## Residual risks

- Default reports use fixed safe vocabulary and ordinals. By design,
  `catalog.json` contains exact tool names and sanitized titles/descriptions;
  `catalog.md` summarizes ordinals and counts. Sanitizing uses best-effort
  literal patterns for URLs, Windows drive/UNC/POSIX/`~/` path starts (the
  rest of the field is dropped), e-mail, IPv4, Bearer/JWT, sensitive
  name=value pairs and opaque tokens, plus tolerant percent decoding and
  base64 candidates for credentials. Percent-encoded or obfuscated path starts
  such as `C:%5CUsers%5C...`, names or paths inside exact tool names, hex,
  base32, reversed and entity encodings, and personal names in free text are
  not recognized. There is no anonymization guarantee; a human must review
  outputs before sharing.
- Redaction is best effort, not an anonymization guarantee. Artifacts
  contain exact tool names by explicit opt-in (`--out`). **Review
  artifacts before sharing them.**
- Checks and writes are race-safe where no-follow semantics are available,
  but a residual TOCTOU window remains on platforms without it; an
  attacker with concurrent write access to the output directory can in
  theory swap contents between check and rename.
- The multi-file artifact write is not transactional: an exit-4 failure
  may leave earlier completed files behind.

## Coordinated disclosure

Report security issues privately to the maintainers via the project's
issue tracker with the `security` label. Do not publish exploit details
before a fix is released.
# Supported interface

Version 0.1.0 is a command-line tool. The code is not a supported library: modules under `src/` are internal, with no API stability and no safety guarantees for in-process use or untrusted in-process objects. Use the CLI with snapshot files.

