import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildInstallArtifact, createMaritimeInstaller,
  INSTALL_PUBLIC_ARTIFACT_INTEGRITY_MISMATCH } from '../../src/maritime/index.mjs';
import { config, operations, jsonResponse } from './fixtures.mjs';

async function fixture({ corruption = 'none' } = {}) {
  const artifact = await buildInstallArtifact({ config, seatId: 'oc-1', persistentRoot: '/opt/data',
    operationsManifest: operations });
  const storage = new Map();
  const writeCounts = new Map();
  const calls = [];
  const corruptPath = artifact.files.find(file => file.path.endsWith('/runtime-identity.mjs')).path;
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname;
    const body = init.body === undefined ? undefined : JSON.parse(init.body);
    calls.push({ method: init.method, path, body });
    if (init.method === 'GET' && path.endsWith('/files/list')) return jsonResponse({ root: '/opt/data' });
    if (init.method === 'PUT' && path.endsWith('/files/write')) {
      const count = (writeCounts.get(body.path) ?? 0) + 1;
      writeCounts.set(body.path, count);
      const corrupt = body.path === corruptPath &&
        (corruption === 'persistent-zero' || (corruption === 'transient-zero' && count === 1));
      storage.set(body.path, corrupt ? '' : body.content);
      return jsonResponse({ ok: true });
    }
    if (init.method === 'POST' && path.endsWith('/exec')) {
      const command = body.command;
      if (command[0] === 'mkdir') return jsonResponse({ exitCode: 0, stdout: '' });
      if (command[0] === 'node' && command[1] === '--input-type=module' && command[2] === '-e') {
        assert.deepEqual(JSON.parse(command[4]).files, artifact.files.map(file => file.path));
        return jsonResponse({ exitCode: 0, stdout: `${JSON.stringify({ schema_version: 1,
          flushed_file_count: artifact.files.length })}\n`, stderr: '' });
      }
      if (command[0] === 'sha256sum') {
        const stdout = command.slice(2).map(file =>
          `${createHash('sha256').update(storage.get(file) ?? '').digest('hex')}  ${file}`).join('\n');
        return jsonResponse({ exitCode: 0, stdout: `${stdout}\n` });
      }
      if (JSON.stringify(command) === JSON.stringify(artifact.install_command)) {
        return jsonResponse({ exitCode: 0, stdout: JSON.stringify({ schema_version: 1,
          seat_id: artifact.seat_id, runtime_installed: true, gameplay_execution_proven: false,
          hermes_terminal_env_passthrough_configured: false, hermes_private_state_owner_configured: false }) });
      }
      if (JSON.stringify(command) === JSON.stringify(artifact.inspect_command)) {
        return jsonResponse({ exitCode: 0, stdout: '{}' });
      }
    }
    throw new Error(`unexpected fixture request ${init.method} ${path}`);
  };
  return { artifact, storage, calls, writeCounts,
    installer: createMaritimeInstaller({ apiKey: 'fixture-key', fetchImpl }) };
}

test('installer hashes every public artifact in exact order after upload and install', async () => {
  const f = await fixture();
  const result = await f.installer.install(f.artifact);
  assert.equal(result.installed, true);
  const hashes = f.calls.filter(call => call.body?.command?.[0] === 'sha256sum');
  assert.equal(hashes.length, 2);
  const flushes = f.calls.filter(call => call.body?.command?.[1] === '--input-type=module');
  assert.equal(flushes.length, 1);
  assert.ok(f.calls.indexOf(flushes[0]) > f.calls.findLastIndex(call => call.method === 'PUT'));
  assert.ok(f.calls.indexOf(flushes[0]) < f.calls.indexOf(hashes[0]));
  for (const call of hashes) {
    assert.deepEqual(call.body.command, ['sha256sum', '--', ...f.artifact.files.map(file => file.path)]);
    assert.ok(call.body.command.slice(2).every(path => !path.startsWith('/opt/data/dilemma-conference/oc-1/private')));
  }
  assert.equal(f.calls.filter(call => JSON.stringify(call.body?.command) === JSON.stringify(f.artifact.install_command)).length, 1);
});

test('installer repairs one transient zero-byte upload exactly once before execution', async () => {
  const f = await fixture({ corruption: 'transient-zero' });
  await f.installer.install(f.artifact);
  assert.ok([...f.writeCounts.values()].every(count => count === 2));
  assert.equal(f.calls.filter(call => call.body?.command?.[1] === '--input-type=module').length, 2);
  assert.equal(f.calls.filter(call => call.body?.command?.[0] === 'sha256sum').length, 3);
  assert.equal(f.calls.filter(call => JSON.stringify(call.body?.command) === JSON.stringify(f.artifact.install_command)).length, 1);
});

test('persistent zero-byte upload fails with fixed integrity code before installer execution', async () => {
  const f = await fixture({ corruption: 'persistent-zero' });
  await assert.rejects(f.installer.install(f.artifact), error =>
    error.code === INSTALL_PUBLIC_ARTIFACT_INTEGRITY_MISMATCH && error.ambiguous === false);
  assert.ok([...f.writeCounts.values()].every(count => count === 2));
  assert.equal(f.calls.filter(call => call.body?.command?.[0] === 'sha256sum').length, 2);
  assert.equal(f.calls.filter(call => JSON.stringify(call.body?.command) === JSON.stringify(f.artifact.install_command)).length, 0);
});

test('runtime inspection rejects a corrupted public file before running player code', async () => {
  const f = await fixture();
  for (const file of f.artifact.files) f.storage.set(file.path, file.content);
  const corruptPath = f.artifact.files.find(file => file.path.endsWith('/runtime-identity.mjs')).path;
  f.storage.set(corruptPath, '');
  await assert.rejects(f.installer.inspectRuntime(f.artifact), error =>
    error.code === INSTALL_PUBLIC_ARTIFACT_INTEGRITY_MISMATCH);
  assert.equal(f.calls.filter(call => JSON.stringify(call.body?.command) === JSON.stringify(f.artifact.inspect_command)).length, 0);
  const hash = f.calls.find(call => call.body?.command?.[0] === 'sha256sum');
  assert.deepEqual(hash.body.command.slice(2), f.artifact.files.map(file => file.path));
});

async function hermesConfigurationFixture(configurationResponse) {
  const artifact = await buildInstallArtifact({ config, seatId: 'hs-1', persistentRoot: '/opt/data',
    operationsManifest: operations });
  const calls = [];
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname;
    const body = init.body === undefined ? undefined : JSON.parse(init.body);
    calls.push({ method: init.method, path, body });
    if (init.method === 'GET' && path.endsWith('/files/list')) return jsonResponse({ root: '/opt/data' });
    if (init.method === 'POST' && path.endsWith('/exec') && body.command[0] === 'sha256sum') {
      return jsonResponse({ exitCode: 0, stdout: `${artifact.files.map(file => `${file.sha256}  ${file.path}`).join('\n')}\n` });
    }
    if (init.method === 'POST' && path.endsWith('/exec') &&
        JSON.stringify(body.command) === JSON.stringify(artifact.hermes_configure_command)) {
      return jsonResponse(configurationResponse);
    }
    throw new Error(`unexpected fixture request ${init.method} ${path}`);
  };
  return { artifact, calls, installer: createMaritimeInstaller({ apiKey: 'fixture-key', fetchImpl }) };
}

test('post-restart Hermes configuration hashes public code and invokes only the dedicated configure argv', async () => {
  const f = await hermesConfigurationFixture({ exitCode: 0, stdout: JSON.stringify({
    schema_version: 1, seat_id: 'hs-1', configured: true, variable: 'GAMEPLAY_WALLET_PRIVATE_KEY',
    config_owner_configured: true, private_state_owner_configured: true, runtime_identity: { uid: 10_000, gid: 10_000 }
  }) });
  const result = await f.installer.configureHarnessConfiguration(f.artifact);
  assert.equal(result.hermes_terminal_env_passthrough_configured, true);
  assert.equal(result.hermes_config_owner_configured, true);
  const execs = f.calls.filter(call => call.method === 'POST' && call.path.endsWith('/exec'));
  assert.deepEqual(execs.map(call => call.body.command), [
    ['sha256sum', '--', ...f.artifact.files.map(file => file.path)],
    f.artifact.hermes_configure_command
  ]);
  assert.ok(execs[0].body.command.slice(2).every(path => !path.includes('/private')));
});

test('post-restart Hermes configuration rejects nonzero and malformed evidence', async () => {
  for (const response of [
    { exitCode: 1, stdout: '{}' },
    { exitCode: 0, stdout: '{"schema_version":1,"seat_id":"hs-1","configured":false}' },
    { exitCode: 0, stdout: JSON.stringify({ schema_version: 1, seat_id: 'hs-1', configured: true,
      variable: 'GAMEPLAY_WALLET_PRIVATE_KEY', private_state_owner_configured: true,
      runtime_identity: { uid: 10_000, gid: 10_000 } }) }
  ]) {
    const f = await hermesConfigurationFixture(response);
    await assert.rejects(f.installer.configureHarnessConfiguration(f.artifact), error =>
      error.code === 'HERMES_CONFIG_UPDATE_OUTCOME_UNKNOWN' && error.ambiguous === true);
  }
});
