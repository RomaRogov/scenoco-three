#!/usr/bin/env node
// The `scenoco` executable. It exists only to hand `process.argv` to `run` and turn its result
// into an exit code, so everything the CLI does stays testable as a plain function call.
import { run } from './cli.js';

run(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
