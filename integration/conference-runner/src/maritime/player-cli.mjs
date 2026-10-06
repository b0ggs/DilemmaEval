#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPlayerRuntime } from './player-runtime.mjs';
import { safePlayerErrorCode } from './diagnostics.mjs';
import { PLAYER_INPUT_MAX_BYTES } from './protocol.mjs';

function cliError(code) {
  return Object.assign(new Error(code), { code });
}

function parsePlayerJson(text, code) {
  try { return JSON.parse(text); }
  catch { throw cliError(code); }
}

export function playerCliErrorCode(error) {
  if (error?.code === 'EACCES') return 'PLAYER_FILESYSTEM_EACCES';
  if (error?.code === 'EPERM') return 'PLAYER_FILESYSTEM_EPERM';
  return safePlayerErrorCode(error?.code, safePlayerErrorCode(error?.message, 'PLAYER_TOOL_FAILED'));
}

export async function main(args = process.argv.slice(2), env = process.env, {
  readFileImpl = readFile, stdin = process.stdin, createPlayerRuntimeImpl = createPlayerRuntime
} = {}) {
  if (args.length < 1 || args.length > 2 || (args[1] && !['--inspect', '--diagnose'].includes(args[1]))) {
    throw new TypeError('PLAYER_CLI_ARGUMENTS_INVALID');
  }
  const settings = parsePlayerJson(await readFileImpl(args[0], 'utf8'), 'PLAYER_SETTINGS_JSON_INVALID');
  const runtime = createPlayerRuntimeImpl({ settings, env });
  if (args[1] === '--inspect') return runtime.inspect();
  let text = '';
  try {
    for await (const chunk of stdin) {
      text += chunk.toString();
      if (Buffer.byteLength(text) > PLAYER_INPUT_MAX_BYTES) throw cliError('PLAYER_INPUT_TOO_LARGE');
    }
  } catch (error) {
    if (error?.code === 'PLAYER_INPUT_TOO_LARGE') throw error;
    throw cliError('PLAYER_STDIN_READ_FAILED');
  }
  const input = parsePlayerJson(text, 'PLAYER_INPUT_JSON_INVALID');
  return args[1] === '--diagnose' ? runtime.diagnose(input) : runtime.execute(input);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Deliberately never print a stack, raw exception, environment, or CLI result.
  main().then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error => {
    const code = playerCliErrorCode(error);
    process.stdout.write(`${JSON.stringify({ ok: false, error: { code } })}\n`);
    process.exitCode = 1;
  });
}
