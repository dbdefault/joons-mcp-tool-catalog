#!/usr/bin/env node
import { main } from '../src/cli.js';

process.stdout.on('error', () => {
  process.exitCode = 4;
  try { process.stderr.write('joons-mcp-tool-catalog: output_error\n'); } catch {}
});
process.stderr.on('error', () => {});
main().then(
  (code) => {
    if (process.exitCode !== 4) process.exitCode = code;
  },
  () => {
    try {
      process.stderr.write('joons-mcp-tool-catalog: internal_error\n');
    } catch {
      // stderr EPIPE is ignored.
    }
    process.exitCode = 2;
  },
);
