#!/usr/bin/env node

import { runCli } from "./cli-lib.mjs";

process.exitCode = await runCli();
