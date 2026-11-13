# Changelog

## 0.1.0

Initial release.

- Offline command-line tool merging `joons-mcp-diff/snapshot` v1 files into
  a normalized catalog.
- Commands: `build`, `search`, `list`, `collisions`, `validate`.
- Exact and weak collision detection across servers (catalog data, never
  errors).
- Deterministic substring-AND search with fixed 100/10/1 scoring and
  stable tie-breaks.
- `catalog.json` artifact, `catalog.md`, zero-byte marker written last.
- JSON, Markdown and terminal reports built from fixed vocabulary;
  opt-in `--details` redacted names.
- Credential-shaped identifier refusal, bounded parsing, reserved-key
  rejection, output-directory hardening, atomic writes.
- Exit codes 0/2/3/4 with fixed stderr lines; no exit 1.
