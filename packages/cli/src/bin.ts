#!/usr/bin/env node
import { run } from "./cli.js";

const code = await run(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  stdout: process.stdout,
  stderr: process.stderr,
  stdin: process.stdin,
});
process.exitCode = code;
