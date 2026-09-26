import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, playerCliErrorCode } from '../../src/maritime/player-cli.mjs';
import { safePlayerErrorCode } from '../../src/maritime/diagnostics.mjs';
import { config, roster, operations } from './fixtures.mjs';

const privateText = 'Bearer fixture-private-token /private/fixture-wallet.json';
const cliPath = fileURLToPath(new URL('../../src/maritime/player-cli.mjs', import.meta.url));

async function cli(args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      env: { PATH: process.env.PATH }, stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error); });
    child.on('close', code => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

function assertCliFailure(result, code) {
  assert.equal(result.code, 1);
  assert.equal(result.stdout, `${JSON.stringify({ ok: false, error: { code } })}\n`);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.includes(privateText), false);
  assert.equal(safePlayerErrorCode(code), code, 'classified errors must survive diagnostic persistence');
}

test('CLI preserves known codes and maps exact permission errno without exposing exception details', () => {
  for (const [error, expected] of [
    [Object.assign(new Error(privateText), { code: 'EACCES', path: '/private/fixture-wallet.json' }), 'PLAYER_FILESYSTEM_EACCES'],
    [Object.assign(new Error(privateText), { code: 'EPERM', syscall: 'chmod' }), 'PLAYER_FILESYSTEM_EPERM'],
    [Object.assign(new Error(privateText), { code: 'REVISION_CHECK_FAILED' }), 'REVISION_CHECK_FAILED'],
    [new TypeError('PLAYER_SEAT_BUSY'), 'PLAYER_SEAT_BUSY'],
    [new TypeError('PLAYER_CHOICE_LOCATION_INVALID'), 'PLAYER_CHOICE_LOCATION_INVALID'],
    [Object.assign(new Error(privateText), { code: 'EACCES_FIXTURE_SECRET' }), 'PLAYER_TOOL_FAILED'],
    [new Error(privateText), 'PLAYER_TOOL_FAILED']
  ]) {
    const code = playerCliErrorCode(error);
    assert.equal(code, expected);
    assert.equal(safePlayerErrorCode(code), code);
    assert.equal(JSON.stringify({ ok: false, error: { code } }).includes(privateText), false);
  }
});

test('settings read and runtime filesystem failures keep distinct permission codes', async () => {
  for (const [errno, expected] of [['EACCES', 'PLAYER_FILESYSTEM_EACCES'], ['EPERM', 'PLAYER_FILESYSTEM_EPERM']]) {
    const fail = () => { throw Object.assign(new Error(privateText), { code: errno }); };
    await assert.rejects(main(['fixture-settings.json'], {}, { readFileImpl: fail }),
      error => playerCliErrorCode(error) === expected);
    await assert.rejects(main(['fixture-settings.json'], {}, {
      readFileImpl: async () => '{}', stdin: ['{}'],
      createPlayerRuntimeImpl: () => ({ execute: fail })
    }), error => playerCliErrorCode(error) === expected);
  }
});

test('stdin read failure reports a fixed code and cannot execute a partial request', async () => {
  let executions = 0;
  const stdin = { async *[Symbol.asyncIterator]() {
    yield '{"request":';
    throw Object.assign(new Error(privateText), { code: 'EIO' });
  } };
  await assert.rejects(main(['fixture-settings.json'], {}, {
    readFileImpl: async () => '{}', stdin,
    createPlayerRuntimeImpl: () => ({ execute: () => { executions++; } })
  }), error => {
    assert.equal(playerCliErrorCode(error), 'PLAYER_STDIN_READ_FAILED');
    assert.equal(error.message, 'PLAYER_STDIN_READ_FAILED');
    assert.equal(error.cause, undefined);
    return true;
  });
  assert.equal(executions, 0);
});

test('stdin size limit retains its existing code and prevents execution', async () => {
  let executions = 0;
  await assert.rejects(main(['fixture-settings.json'], {}, {
    readFileImpl: async () => '{}', stdin: ['x'.repeat(131_073)],
    createPlayerRuntimeImpl: () => ({ execute: () => { executions++; } })
  }), error => playerCliErrorCode(error) === 'PLAYER_INPUT_TOO_LARGE');
  assert.equal(executions, 0);
});

test('valid input and inspection preserve runtime results and invocation semantics', async () => {
  const settings = { fixture: true }, env = { FIXTURE: 'public' }, input = { request: { fixture: 'request' } };
  const response = { schema_version: 1, status: 'observed' };
  let executions = 0, inspections = 0;
  const dependencies = {
    readFileImpl: async () => JSON.stringify(settings), stdin: [JSON.stringify(input)],
    createPlayerRuntimeImpl: actual => {
      assert.deepEqual(actual, { settings, env });
      return {
        execute: received => { executions++; assert.deepEqual(received, input); return response; },
        inspect: () => { inspections++; return response; }
      };
    }
  };
  assert.equal(await main(['fixture-settings.json'], env, dependencies), response);
  assert.equal(await main(['fixture-settings.json', '--inspect'], env, { ...dependencies,
    stdin: { async *[Symbol.asyncIterator]() { throw new Error('inspection must not read stdin'); } }
  }), response);
  assert.equal(executions, 1);
  assert.equal(inspections, 1);
});

test('diagnostic CLI mode consumes stdin but cannot route through gameplay execute', async () => {
  const input = { request: { type: 'runtime-diagnostic' } };
  const response = { schema_version: 1, type: 'runtime-diagnostic-response' };
  let diagnoses = 0;
  const dependencies = { readFileImpl: async () => '{}', stdin: [JSON.stringify(input)],
    createPlayerRuntimeImpl: () => ({
      execute: () => assert.fail('diagnostics must not use gameplay execute'),
      diagnose: received => { diagnoses++; assert.deepEqual(received, input); return response; }
    }) };
  assert.equal(await main(['fixture-settings.json', '--diagnose'], {}, dependencies), response);
  assert.equal(diagnoses, 1);
});

test('actual CLI distinguishes malformed settings from malformed input with exact safe output', async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'conference-player-cli-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const settingsPath = join(directory, 'fixture-settings.json');
  await writeFile(settingsPath, `{"malformed":"${privateText}"`);
  assertCliFailure(await cli([settingsPath]), 'PLAYER_SETTINGS_JSON_INVALID');

  await writeFile(settingsPath, JSON.stringify({ schema_version: 1, seat_id: 'oc-1', harness: 'openclaw',
    chain_id: 84532, rpc_url: config.rpc_url, game_address: config.game_address,
    game_repo: join(directory, 'game'), state_directory: join(directory, 'private'), roster, operations_manifest: operations }));
  assertCliFailure(await cli([settingsPath], `{"malformed":"${privateText}"`), 'PLAYER_INPUT_JSON_INVALID');
  assertCliFailure(await cli([settingsPath], ''), 'PLAYER_INPUT_JSON_INVALID');
  assertCliFailure(await cli([]), 'PLAYER_CLI_ARGUMENTS_INVALID');
});
