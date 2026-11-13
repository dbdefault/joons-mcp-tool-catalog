# Contributing

## Setup

Node.js 20 or newer. There are no dependencies to install and no build
step.

## Running tests

```sh
node scripts/test.js
```

The runner enumerates test files explicitly and executes them with the
built-in `node:test` runner. Tests are self-contained: they use temporary
directories under the OS temp dir, cleaned up after themselves, and never
touch the network.

## Rules that tests enforce

- Zero runtime and dev dependencies; ESM JavaScript only.
- Source files are ASCII-only; non-ASCII appears only in `README.ko.md`.
- No network, no subprocess, no dynamic code execution in `src/`.
- No untrusted string (paths, input text, tokens, server names) in any
  report, stderr line, or artifact other than the declared opt-in tool
  names.
- Fixed error kinds and exit codes; determinism across runs and input
  order shuffles.

## Pull requests

- Keep changes within one module area; interfaces between areas change
  only by agreement.
- Add or update tests for behavior changes; never weaken a safety check
  without a written rationale.
- Do not claim a check passed until you ran it.
