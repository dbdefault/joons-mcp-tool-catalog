# Limitations

- **Collisions are data, not verdicts.** An exact or weak collision means
  names are the same or fold together; it says nothing about behavior,
  schema compatibility or quality. Every successful command exits 0.
- **Name comparison is exact or weak-fold only.** There is no Levenshtein,
  phonetic, or regex name matching. Weak folding is
  `toLowerCase(NFC(trim(name)))` across at least two servers with at least
  two distinct exact names.
- **Search is substring AND, not semantic.** A tool matches only when
  every query token appears (case-insensitively) in its name, title or
  description. There are no field filters, globs or regular expressions.
- **No schema analysis.** `inputSchema`/`outputSchema` are carried as
  opaque JSON. The catalog does not validate schema semantics, does not
  compare schemas, and cannot tell you whether two colliding tools are
  interchangeable.
- **No live-server truth.** The catalog reflects exactly the snapshot
  files you give it. It never contacts a server, so it cannot know what a
  server offers right now, whether it is healthy, or whether a snapshot is
  stale.
- **Input and collision caps are hard limits.** 8 MiB per snapshot file,
  64 MiB total, 100 files, 10,000 tools per snapshot, 50,000 tools total,
  and 10,000 collision entries. Over-limit input is rejected.
  Search returns at most 1,000 emitted matches, while `counts.matches`
  preserves the true total.
- **Redaction is best-effort.** Default reports use fixed safe vocabulary and
  ordinals. By design, `catalog.json` contains exact tool names and sanitized
  titles/descriptions; `catalog.md` summarizes ordinals and counts. Literal
  patterns cover URLs, Windows drive/UNC/POSIX/`~/` path starts (the rest of
  the field is dropped), e-mail, IPv4, Bearer/JWT, sensitive name=value pairs
  and opaque tokens, plus tolerant percent decoding and base64 candidates for
  credentials. Percent-encoded or obfuscated path starts such as
  `C:%5CUsers%5C...`, names or paths in exact tool names, hex, base32, reversed
  and entity encodings, and personal names in free text are not recognized.
  There is no anonymization guarantee; a human must review outputs before sharing.
- **Path redaction can over-redact.** URLs, including file URLs, are handled
  first. Once a path start is recognized, everything from that start to the
  end of the field is replaced, including spaces and text
  following original line breaks; see `docs/SECURITY.md`.
- **Ordinals, not identities.** Servers appear as `server-<n>` sorted by
  server-name code units, identified in the artifact only by a SHA-256
  prefix of the snapshot bytes. If you rebuild from different files, the
  ordinals and hashes change.
- **One bad input rejects the run.** A deterministic catalog over a
  silently partial input set would be worse than no catalog.
- **Not transactional.** A failed `build` (exit 4) may leave
  `catalog.json` or `catalog.md` behind without the marker; only an
  existing destination is never overwritten by a failed rename.
# Supported interface

Version 0.1.1 is a command-line tool. The code is not a supported library: modules under `src/` are internal, with no API stability and no safety guarantees for in-process use or untrusted in-process objects. Use the CLI with snapshot files.

