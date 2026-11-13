# Changelog

## 0.1.1

Fixes to the credential-shaped identifier refusal (a heuristic, not a
guarantee). Reports now carry tool version 0.1.1; nothing else changed.

- The unlabeled private key header (`-----BEGIN PRIVATE KEY-----`) is now
  refused. Before, an off-by-one in the header search let it through.
- The recognised families were aligned with a reviewed list: AWS ID
  prefixes (AKIA, ASIA, AGPA, AIDA, AROA, AIPA, ANPA, ANVA), GitHub, GitLab,
  Slack, Stripe-style, Google, SendGrid and npm tokens, Bearer values, JWTs
  and PEM private key headers. Certificate headers stay accepted. Tokens
  outside this list are not detected.
- A key-like fragment inside an ordinary word (for example `task-runner`)
  is no longer treated as a token.
- A wall-clock timing test was relaxed for shared CI machines (test only).

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
