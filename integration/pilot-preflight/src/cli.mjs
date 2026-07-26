#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import process from "node:process";

import {
  PreflightValidationError,
  buildTwoSeatPilotPlan
} from "./index.mjs";

const USAGE =
  "Usage: node src/cli.mjs --manifest /path/to/public-seat-manifest.json";

async function main(argv) {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  if (argv.length !== 2 || argv[0] !== "--manifest" || argv[1].length === 0) {
    throw new CliError("INVALID_ARGUMENTS", USAGE);
  }

  let source;
  try {
    source = await readFile(argv[1], "utf8");
  } catch {
    throw new CliError(
      "MANIFEST_READ_FAILED",
      "Could not read the public manifest file"
    );
  }

  let manifest;
  try {
    manifest = JSON.parse(source);
  } catch {
    throw new CliError(
      "MANIFEST_JSON_INVALID",
      "Public manifest must contain valid JSON"
    );
  }

  const plan = buildTwoSeatPilotPlan(manifest);
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

class CliError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

main(process.argv.slice(2)).catch((error) => {
  const code =
    error instanceof PreflightValidationError || error instanceof CliError
      ? error.code
      : "PREFLIGHT_FAILED";
  process.stderr.write(`${code}: ${error.message}\n`);
  process.exitCode = 1;
});
