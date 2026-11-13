# Display path handling

Default reports use fixed safe vocabulary and ordinals. By design,
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

After control removal, URLs including `file://`, `http://`, `https://` and
`ftp://` are replaced with `[URL]` through the next whitespace; text after
the URL remains eligible for later processing. The path scan recognizes a
drive letter followed by `:\` or `:/`, UNC `\\`, `~/`, and `../` or `..\`
followed by a segment. A POSIX start is `/` at the field start or after
whitespace, a quote, bracket, `=`, `:` or `,`, immediately followed by a
non-whitespace, non-slash character, with another `/` anywhere later.
Spaces can occur after that point, including after the second slash. Words
such as `and/or` and fractions such as `a/b` or `1/2` are not path starts.

Once a path start is recognized, everything from it to the end of the field
becomes `[PATH]`; text before the start is retained. This includes spaces and
previously replaced URLs after the start. Line
breaks are removed before the scan, so text from subsequent original lines
can also be consumed. The rule can over-redact ambiguous text; redaction is
best effort, and artifacts should be reviewed before sharing.
Server entries contain anonymous ordinal labels and tool counts; without `--details` they omit `name`, and with it `name` is the empty string; no input-derived server name is emitted.
In terminal output the empty name appears as `name=`; in Markdown it appears as `()`.
