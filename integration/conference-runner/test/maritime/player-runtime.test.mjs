import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildInvocation, createJsonRpcChainVerifier, deriveEthereumAddress, FROZEN_NETWORK, PINNED_GAME_REVISION } from '../../../game-bridge/src/index.js';
import { createPlayerRuntime, buildInstallArtifact, validatePlayerSettings,
  buildRestrictedYarnWrapper, FOUNDRY_SCRIPT_MAPPINGS, HERMES_TERMINAL_PASSTHROUGH_ENV,
  updateHermesConfigText, configureHermesTerminalEnvPassthrough,
  updateOpenClawConfigText, inspectOpenClawConfigText,
  inspectHermesTerminalEnvPassthrough, HERMES_RUNTIME_IDENTITY,
  runtimeIdentityForSettings, preparePrivateStateDirectory,
  prepareGameplayCommandAccess } from '../../src/maritime/index.mjs';
import { createPlayerChainVerifier, privateDirectory, playerProcessRunner, lockSeat, readProcessBirthIdentity } from '../../src/maritime/player-runtime.mjs';
import { classifyPlayerBridgeError } from '../../src/maritime/diagnostics.mjs';
import { enforceHermesConfigOwnership, inspectHermesConfigOwnership } from '../../src/maritime/install-runtime.mjs';
import { updateHermesMiniResponsesText } from '../../src/maritime/install-runtime.mjs';
import { config, roster, operations, poke } from './fixtures.mjs';

async function fixture(t, impl = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'conference-player-test-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const settings = { schema_version: 1, seat_id: 'oc-1', harness: 'openclaw', chain_id: 84532, rpc_url: config.rpc_url,
    game_address: config.game_address, game_repo: join(directory, 'game'), state_directory: join(directory, 'private'),
    roster, operations_manifest: operations };
  const calls = [];
  const bridgeFactory = () => ({
    reader: { run: impl.read ?? (async () => ({ exit_code: 0, error: null, parsed: {
      gameId: '7', chainId: 84532, addresses: { game: config.game_address }, game: { outcome: 'Cancelled' }
    } })) },
    player: { run: async (operation, options) => {
      calls.push({ operation, options });
      if (impl.run) return impl.run(operation, options);
      if (operation === 'prepare_commit') {
        await writeFile(options.out, JSON.stringify({ schemaVersion: 'prisoners-daolemma/commit-bundle-v0', chainId: 84532,
          game: config.game_address, gameId: '7', round: 1, wallet: roster[0].wallet_address,
          choice: options.choice, salt: `0x${'a'.repeat(64)}`, commitment: `0x${'b'.repeat(64)}` }));
        return { exit_code: 0, error: null, parsed: {} };
      }
      return { exit_code: 0, error: null, parsed: { txHash: `0x${'c'.repeat(64)}`, chainId: 84532,
        gameId: '7', game: config.game_address, wallet: roster[0].wallet_address } };
    } }
  });
  return { settings, calls, directory, make: () => createPlayerRuntime({ settings, env: {}, bridgeFactory }) };
}

test('player chain verification retries one transient read after 250ms using only eth_chainId', async () => {
  const order = [];
  const request = Object.freeze({ rpcUrl: config.rpc_url, expectedChainId: 84532 });
  const verifier = createJsonRpcChainVerifier({ timeoutMs: 5000, fetchImpl: async (url, options) => {
    assert.equal(url, request.rpcUrl);
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] });
    order.push('read');
    if (order.length === 1) throw new Error('fixture private provider detail');
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x14a34' }));
  } });
  const verify = createPlayerChainVerifier({ verifier, delay: async milliseconds => { order.push(milliseconds); } });
  assert.deepEqual(await verify(request), { chainId: 84532 });
  assert.deepEqual(order, ['read', 250, 'read']);
});

test('persistent player chain verification failure stops after two reads with a generic error', async () => {
  const request = Object.freeze({ rpcUrl: config.rpc_url, expectedChainId: 84532 });
  let reads = 0;
  const waits = [];
  const verify = createPlayerChainVerifier({ verifier: async actual => {
    assert.equal(actual, request);
    reads++;
    throw new Error('fixture private provider detail');
  }, delay: async milliseconds => { waits.push(milliseconds); } });
  await assert.rejects(verify(request), error => error.message === 'PLAYER_CHAIN_VERIFICATION_UNAVAILABLE' &&
    !String(error).includes('private provider'));
  assert.equal(reads, 2);
  assert.deepEqual(waits, [250]);
});

test('returned wrong or unusable chain IDs are not retried or rewritten before bridge validation', async () => {
  for (const response of [{ chainId: 1 }, { chainId: 8453 }, { chainId: 84532 }, {}, null]) {
    let reads = 0;
    const verify = createPlayerChainVerifier({ verifier: async () => { reads++; return response; },
      delay: async () => assert.fail('returned verification results must not retry') });
    assert.equal(await verify({ rpcUrl: config.rpc_url, expectedChainId: 84532 }), response);
    assert.equal(reads, 1);
  }
});

test('Linux process birth identity hashes boot and starttime without retaining process names', async () => {
  const boot = '11111111-2222-3333-4444-555555555555';
  const reads = [];
  const identity = async (starttime, bootId = boot, name = 'fixture private agent) name') =>
    readProcessBirthIdentity(42, { platform: 'linux', readFileImpl: async path => {
      reads.push(path);
      if (path === '/proc/sys/kernel/random/boot_id') return `${bootId}\n`;
      assert.equal(path, '/proc/42/stat');
      return `42 (${name}) S ${Array(18).fill('0').join(' ')} ${starttime} 0 0\n`;
    } });
  const first = await identity('123');
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(await identity('123', boot, 'a different process name'), first);
  assert.notEqual(await identity('124'), first);
  assert.notEqual(await identity('123', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'), first);
  assert.ok(reads.every(path => path === '/proc/sys/kernel/random/boot_id' || path === '/proc/42/stat'));
});

test('unavailable or malformed process birth evidence returns unknown without exposing failures', async () => {
  let reads = 0;
  assert.equal(await readProcessBirthIdentity(42, { platform: 'darwin', readFileImpl: async () => { reads++; } }), null);
  assert.equal(reads, 0);
  assert.equal(await readProcessBirthIdentity(42, { platform: 'linux', readFileImpl: async () => {
    throw new Error('Bearer fixture-private-token');
  } }), null);
  for (const [boot, stat] of [
    ['private invalid boot', '42 (fixture) S'],
    ['11111111-2222-3333-4444-555555555555', '42 (fixture) S'],
    ['11111111-2222-3333-4444-555555555555', `43 (fixture) S ${Array(18).fill('0').join(' ')} 123`]
  ]) assert.equal(await readProcessBirthIdentity(42, { platform: 'linux',
    readFileImpl: async path => path.endsWith('boot_id') ? boot : stat }), null);
});

test('new seat locks persist only PID and birth digest and reject the same live process', async t => {
  const f = await fixture(t);
  const identity = 'a'.repeat(64);
  const syncs = [];
  const options = { processIdentity: async () => identity, probeProcess: () => {}, syncDirectory: async directory => {
    assert.equal(directory, f.directory);
    syncs.push((await readdir(directory)).includes('seat.lock'));
  } };
  const release = await lockSeat(f.directory, options);
  try {
    assert.deepEqual(JSON.parse(await readFile(join(f.directory, 'seat.lock'), 'utf8')),
      { pid: process.pid, birth_identity: identity });
    assert.equal((await lstat(join(f.directory, 'seat.lock'))).mode & 0o777, 0o600);
    await assert.rejects(lockSeat(f.directory, options), /PLAYER_SEAT_BUSY/);
  } finally { await release(); }
  assert.deepEqual(syncs, [true, false], 'creation and release must persist the parent directory entry');
  assert.equal((await readdir(f.directory)).includes('seat.lock'), false);
});

test('a live reused PID with a verified different birth can recover a stale seat lock', async t => {
  const f = await fixture(t);
  const path = join(f.directory, 'seat.lock');
  await writeFile(path, JSON.stringify({ pid: process.pid, birth_identity: 'a'.repeat(64) }));
  let probes = 0;
  const syncs = [];
  const release = await lockSeat(f.directory, {
    processIdentity: async () => 'b'.repeat(64),
    probeProcess: pid => { probes++; assert.equal(pid, process.pid); },
    syncDirectory: async directory => {
      assert.equal(directory, f.directory);
      syncs.push((await readdir(directory)).includes('seat.lock'));
    }
  });
  try {
    assert.equal(probes, 1);
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { pid: process.pid, birth_identity: 'b'.repeat(64) });
  } finally { await release(); }
  assert.deepEqual(syncs, [false, true, false], 'stale removal, replacement and release each sync the exact parent');
});

test('legacy, unknown, malformed and inaccessible live lock identities always remain busy', async t => {
  const f = await fixture(t);
  const path = join(f.directory, 'seat.lock');
  for (const [previous, processIdentity, probeProcess = () => {}] of [
    [{ pid: 42 }, async () => 'b'.repeat(64)],
    [{ pid: 42, birth_identity: null }, async () => 'b'.repeat(64)],
    [{ pid: 42, birth_identity: 'malformed' }, async () => 'b'.repeat(64)],
    [{ pid: 42, birth_identity: 'a'.repeat(64) }, async () => null],
    [{ pid: 42, birth_identity: 'a'.repeat(64) }, async () => { throw new Error('private identity read failure'); }],
    [{ pid: 42, birth_identity: 'a'.repeat(64) }, async () => 'Bearer fixture-private-token'],
    [{ pid: 42, birth_identity: 'a'.repeat(64) }, async () => 'b'.repeat(64),
      () => { throw Object.assign(new Error('private permission failure'), { code: 'EPERM' }); }]
  ]) {
    const original = JSON.stringify(previous);
    await writeFile(path, original);
    await assert.rejects(lockSeat(f.directory, { processIdentity, probeProcess }), /PLAYER_SEAT_BUSY/);
    assert.equal(await readFile(path, 'utf8'), original);
  }
});

test('dead legacy owners recover and platforms without birth identity still create locks', async t => {
  const f = await fixture(t);
  const path = join(f.directory, 'seat.lock');
  await writeFile(path, JSON.stringify({ pid: 42 }));
  const syncs = [];
  const release = await lockSeat(f.directory, {
    processIdentity: async () => null,
    probeProcess: pid => { assert.equal(pid, 42); throw Object.assign(new Error(), { code: 'ESRCH' }); },
    syncDirectory: async directory => {
      assert.equal(directory, f.directory);
      syncs.push((await readdir(directory)).includes('seat.lock'));
    }
  });
  try {
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { pid: process.pid, birth_identity: null });
    await assert.rejects(lockSeat(f.directory, { processIdentity: async () => null, probeProcess: () => {} }),
      /PLAYER_SEAT_BUSY/);
  } finally { await release(); }
  assert.deepEqual(syncs, [false, true, false]);
});

test('existing private directory at exact 0700 skips chmod but still checks access', async () => {
  const path = '/opt/data/dilemma-conference/hs-1/private';
  let chmodCalls = 0, accessCalls = 0;
  const metadata = { mode: 0o40700, isDirectory: () => true, isSymbolicLink: () => false };
  await privateDirectory(path, {
    mkdirImpl: async () => undefined,
    lstatImpl: async () => metadata,
    realpathImpl: async () => path,
    chmodImpl: async () => { chmodCalls++; throw Object.assign(new Error('not permitted'), { code: 'EPERM' }); },
    accessImpl: async () => { accessCalls++; }
  });
  assert.equal(chmodCalls, 0);
  assert.equal(accessCalls, 1);
});

test('wrong-mode private directory is repaired to exact 0700', async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'conference-private-mode-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'private');
  await mkdir(path, { mode: 0o755 });
  await chmod(path, 0o755);
  await privateDirectory(path);
  const { mode } = await lstat(path);
  assert.equal(mode & 0o7777, 0o700);
});

test('wrong-mode private directory fails closed when chmod is not permitted', async () => {
  const path = '/opt/data/dilemma-conference/hs-1/private';
  let chmodCalls = 0;
  const metadata = { mode: 0o40755, isDirectory: () => true, isSymbolicLink: () => false };
  await assert.rejects(privateDirectory(path, {
    mkdirImpl: async () => undefined,
    lstatImpl: async () => metadata,
    realpathImpl: async () => path,
    chmodImpl: async () => { chmodCalls++; throw Object.assign(new Error('not permitted'), { code: 'EPERM' }); },
    accessImpl: async () => {}
  }), error => error.code === 'EPERM');
  assert.equal(chmodCalls, 1);
});

test('Hermes private state ownership targets only the exact directory after chmod', async () => {
  const path = '/opt/data/dilemma-conference/hs-1/private';
  const settings = { harness: 'hermes', seat_id: 'hs-1', persistent_root: '/opt/data', state_directory: path,
    runtime_identity: { ...HERMES_RUNTIME_IDENTITY } };
  const calls = [];
  let inspections = 0;
  const metadata = () => ({ mode: 0o40700, uid: inspections++ === 0 ? 0 : 10_000, gid: inspections === 1 ? 0 : 10_000,
    isDirectory: () => true, isSymbolicLink: () => false });
  const result = await preparePrivateStateDirectory(settings, {
    mkdirImpl: async target => { calls.push(['mkdir', target]); },
    chmodImpl: async (target, mode) => { calls.push(['chmod', target, mode]); },
    chownImpl: async (target, uid, gid) => { calls.push(['chown', target, uid, gid]); },
    lstatImpl: async target => { calls.push(['lstat', target]); return metadata(); },
    realpathImpl: async target => { calls.push(['realpath', target]); return target; }
  });
  assert.deepEqual(calls, [
    ['mkdir', path], ['lstat', path], ['realpath', path], ['chmod', path, 0o700],
    ['chown', path, 10_000, 10_000], ['lstat', path], ['realpath', path]
  ]);
  assert.deepEqual(result.runtime_identity, HERMES_RUNTIME_IDENTITY);
});

test('Hermes private state preparation recreates a missing exact seat directory', async () => {
  const path = '/opt/data/dilemma-conference/hs-2/private';
  const settings = { harness: 'hermes', seat_id: 'hs-2', persistent_root: '/opt/data', state_directory: path,
    runtime_identity: { ...HERMES_RUNTIME_IDENTITY } };
  let created = 0;
  const metadata = { mode: 0o40700, uid: 10_000, gid: 10_000,
    isDirectory: () => true, isSymbolicLink: () => false };
  const result = await preparePrivateStateDirectory(settings, {
    mkdirImpl: async target => { assert.equal(target, path); created++; },
    chmodImpl: async (target, mode) => { assert.equal(target, path); assert.equal(mode, 0o700); },
    chownImpl: async () => { throw new Error('existing directory should already have runtime ownership'); },
    lstatImpl: async target => {
      assert.equal(target, path); return metadata;
    },
    realpathImpl: async target => target
  });
  assert.equal(created, 1);
  assert.equal(result.path, path);
});

test('Hermes runtime identity rejects missing, wrong, and malformed values before mutation', async () => {
  const base = { harness: 'hermes', seat_id: 'hs-1', persistent_root: '/opt/data',
    state_directory: '/opt/data/dilemma-conference/hs-1/private' };
  for (const runtime_identity of [undefined, { uid: 0, gid: 10_000 }, { uid: 10_000, gid: '10000' },
    { uid: 10_000, gid: 10_000, name: 'hermes' }]) {
    let mutated = false;
    await assert.rejects(preparePrivateStateDirectory({ ...base, ...(runtime_identity ? { runtime_identity } : {}) }, {
      mkdirImpl: async () => { mutated = true; }
    }), /MARITIME_RUNTIME_IDENTITY_INVALID/);
    assert.equal(mutated, false);
  }
  assert.deepEqual(runtimeIdentityForSettings({ ...base, runtime_identity: { uid: 10_000, gid: 10_000 } }),
    HERMES_RUNTIME_IDENTITY);
  let unrelatedMutation = false;
  await assert.rejects(preparePrivateStateDirectory({ ...base,
    state_directory: '/opt/data/unrelated/private', runtime_identity: { ...HERMES_RUNTIME_IDENTITY } }, {
    mkdirImpl: async () => { unrelatedMutation = true; }
  }), /INSTALL_STATE_DIRECTORY_INVALID/);
  assert.equal(unrelatedMutation, false);
});

test('ownership correction is idempotent and never chowns existing bundle descendants', async () => {
  const path = '/opt/data/dilemma-conference/hs-1/private';
  const settings = { harness: 'hermes', seat_id: 'hs-1', persistent_root: '/opt/data', state_directory: path,
    runtime_identity: { ...HERMES_RUNTIME_IDENTITY } };
  const chownTargets = [];
  const metadata = { mode: 0o40700, uid: 10_000, gid: 10_000,
    isDirectory: () => true, isSymbolicLink: () => false };
  await preparePrivateStateDirectory(settings, {
    mkdirImpl: async () => undefined, chmodImpl: async () => {},
    chownImpl: async target => { chownTargets.push(target); },
    lstatImpl: async () => metadata, realpathImpl: async () => path
  });
  assert.deepEqual(chownTargets, []);
});

test('OpenClaw private state preparation never changes ownership', async () => {
  const path = '/opt/data/dilemma-conference/oc-1/private';
  const settings = { harness: 'openclaw', seat_id: 'oc-1', persistent_root: '/opt/data', state_directory: path };
  let chownCalls = 0;
  const metadata = { mode: 0o40700, uid: 0, gid: 0, isDirectory: () => true, isSymbolicLink: () => false };
  await preparePrivateStateDirectory(settings, {
    mkdirImpl: async () => undefined, chmodImpl: async () => {}, chownImpl: async () => { chownCalls++; },
    lstatImpl: async () => metadata, realpathImpl: async () => path
  });
  assert.equal(chownCalls, 0);
});

test('Hermes gameplay command access repairs only the exact bin directory and wrapper', async () => {
  const directory = '/opt/data/dilemma-conference/hs-1/bin';
  const executable = `${directory}/yarn`;
  const settings = { harness: 'hermes', seat_id: 'hs-1', persistent_root: '/opt/data', bin_directory: directory,
    runtime_identity: { ...HERMES_RUNTIME_IDENTITY } };
  const calls = [];
  let repaired = false;
  const metadata = path => ({ mode: path === directory ? 0o40700 : 0o100700,
    uid: repaired ? 10_000 : 0, gid: repaired ? 10_000 : 0,
    isDirectory: () => path === directory, isFile: () => path === executable, isSymbolicLink: () => false });
  const result = await prepareGameplayCommandAccess(settings, executable, {
    chmodImpl: async (path, mode) => { calls.push(['chmod', path, mode]); },
    chownImpl: async (path, uid, gid) => { calls.push(['chown', path, uid, gid]); if (path === executable) repaired = true; },
    lstatImpl: async path => metadata(path), realpathImpl: async path => path
  });
  assert.deepEqual(calls, [
    ['chmod', directory, 0o700], ['chmod', executable, 0o700],
    ['chown', directory, 10_000, 10_000], ['chown', executable, 10_000, 10_000]
  ]);
  assert.deepEqual(result.runtime_identity, HERMES_RUNTIME_IDENTITY);
});

test('gameplay command access rejects unrelated paths and symlinks before mutation', async () => {
  const directory = '/opt/data/dilemma-conference/hs-1/bin';
  const executable = `${directory}/yarn`;
  const settings = { harness: 'hermes', seat_id: 'hs-1', persistent_root: '/opt/data', bin_directory: directory,
    runtime_identity: { ...HERMES_RUNTIME_IDENTITY } };
  let mutations = 0;
  const dependencies = {
    chmodImpl: async () => { mutations++; }, chownImpl: async () => { mutations++; },
    lstatImpl: async path => ({ mode: path === directory ? 0o40700 : 0o120700, uid: 0, gid: 0,
      isDirectory: () => path === directory, isFile: () => path === executable,
      isSymbolicLink: () => path === executable }),
    realpathImpl: async path => path
  };
  await assert.rejects(prepareGameplayCommandAccess(settings, '/opt/data/unrelated/yarn', dependencies),
    /INSTALL_BIN_DIRECTORY_INVALID/);
  await assert.rejects(prepareGameplayCommandAccess(settings, executable, dependencies),
    /INSTALL_GAMEPLAY_COMMAND_UNSAFE/);
  assert.equal(mutations, 0);
});

test('player settings accept the public owner address as the single operator', async t => {
  const f = await fixture(t);
  const settings = { ...f.settings, operations_manifest: {
    ...operations, phase_advancer: { ...operations.phase_advancer, wallet_address: FROZEN_NETWORK.owner }
  } };
  assert.equal(validatePlayerSettings(settings), settings);
  const runtime = createPlayerRuntime({ settings, env: { DILEMMA_LAUNCHER_PRIVATE_KEY: 'fixture-forbidden' } });
  await assert.rejects(runtime.execute({ request: poke('join') }), /PLAYER_ROLE_COLLISION/);
});

test('owner and operator wallets remain forbidden as player wallets', async t => {
  const f = await fixture(t);
  const ownerPlayer = { ...f.settings, roster: roster.map((row, index) => index === 0 ?
    { ...row, wallet_address: FROZEN_NETWORK.owner.toLowerCase() } : row) };
  assert.throws(() => validatePlayerSettings(ownerPlayer), /PLAYER_OPERATIONS_MANIFEST_INVALID/);
  const operatorPlayer = { ...f.settings, operations_manifest: {
    ...operations, phase_advancer: { ...operations.phase_advancer, wallet_address: roster[0].wallet_address }
  } };
  assert.throws(() => validatePlayerSettings(operatorPlayer), /PLAYER_OPERATIONS_MANIFEST_INVALID/);
});

test('agent chooses locally, commit bundle survives restart, reveal reuses same file', async t => {
  const f = await fixture(t);
  const result = await f.make().execute({ request: poke('commit'), choice: 'catch' });
  assert.equal(result.status, 'submitted');
  assert.equal(JSON.stringify(result).includes('catch'), false); assert.equal(JSON.stringify(result).includes('salt'), false);
  const repeated = await f.make().execute({ request: poke('commit'), choice: 'steal' });
  assert.deepEqual(repeated, result); assert.equal(f.calls.length, 2);
  const reveal = await f.make().execute({ request: poke('reveal') });
  assert.equal(reveal.status, 'submitted'); assert.equal(f.calls.length, 3);
  assert.equal(f.calls[1].options.input, f.calls[2].options.input);
  const bundle = JSON.parse(await readFile(f.calls[2].options.input, 'utf8')); assert.equal(bundle.choice, 'catch');
  const journals = await readdir(join(f.settings.state_directory, 'requests'));
  for (const file of journals) assert.equal((await readFile(join(f.settings.state_directory, 'requests', file), 'utf8')).includes(bundle.salt), false);
});

test('uncertain signed call persists intent and is never repeated after restart', async t => {
  const f = await fixture(t, { run: async () => { throw new Error('provider secret'); } });
  const first = await f.make().execute({ request: poke('join') });
  assert.equal(first.error.code, 'PLAYER_SUBMISSION_OUTCOME_UNKNOWN');
  const again = await f.make().execute({ request: { ...poke('join'), request_id: 'different-id-same-action' } });
  assert.equal(again.error.code, first.error.code); assert.equal(f.calls.length, 1);
});

test('bridge failures retain only allowlisted codes across restart without replay', async t => {
  for (const [code, expected] of [['REVISION_CHECK_FAILED', 'REVISION_CHECK_FAILED'],
    ['SECRET_PROVIDER_DETAIL', 'PLAYER_SUBMISSION_OUTCOME_UNKNOWN']]) {
    const f = await fixture(t, { run: async () => ({ error: { code, message: 'private provider output' },
      exit_code: null, stdout: 'private stdout', stderr: 'private stderr', parsed: { salt: 'private salt' } }) });
    const result = await f.make().execute({ request: poke('join') });
    assert.equal(result.error.code, expected);
    const retry = await f.make().execute({ request: { ...poke('join'), request_id: 'new-request-id' } });
    assert.equal(retry.error.code, expected);
    assert.equal(f.calls.length, 1);
    const [file] = await readdir(join(f.settings.state_directory, 'requests'));
    const raw = await readFile(join(f.settings.state_directory, 'requests', file), 'utf8');
    const journal = JSON.parse(raw);
    assert.equal(journal.stage, 'submitting');
    assert.equal(journal.operation, 'join');
    assert.equal(journal.response.status, 'error');
    assert.equal(journal.response.error.code, expected);
    for (const secret of ['private provider output', 'private stdout', 'private stderr', 'private salt', 'SECRET_PROVIDER_DETAIL']) {
      assert.equal(raw.includes(secret), false);
    }
  }
});

test('fixed ethers failure codes survive prepare/submission journals and restart without private output or replay', async t => {
  for (const phase of ['join', 'commit']) {
    for (const [ethersCode, expected] of [['INSUFFICIENT_FUNDS', 'PLAYER_INSUFFICIENT_FUNDS'],
      ['NONCE_EXPIRED', 'PLAYER_NONCE_EXPIRED'], ['REPLACEMENT_UNDERPRICED', 'PLAYER_REPLACEMENT_UNDERPRICED']]) {
      const secret = 'Bearer fixture-private-token /private/fixture-wallet.json';
      const f = await fixture(t, { run: async () => ({ error: { code: 'COMMAND_FAILED', message: secret },
        exit_code: 1, stdout: secret, stderr: `Error: ${secret} (code=${ethersCode}, version=providers/5.7.2)`,
        parsed: { salt: secret } }) });
      const input = { request: poke(phase), ...(phase === 'commit' ? { choice: 'catch' } : {}) };
      const result = await f.make().execute(input);
      assert.equal(result.error.code, expected);
      const retry = await f.make().execute({ ...input, request: { ...input.request, request_id: 'new-request-id' } });
      assert.equal(retry.error.code, expected);
      assert.equal(f.calls.length, 1, 'classified failures must remain non-replayable');
      const [file] = await readdir(join(f.settings.state_directory, 'requests'));
      const raw = await readFile(join(f.settings.state_directory, 'requests', file), 'utf8');
      const journal = JSON.parse(raw);
      assert.equal(journal.operation, phase === 'commit' ? 'prepare_commit' : 'join');
      assert.equal(journal.stage, phase === 'commit' ? 'preparing' : 'submitting');
      assert.equal(journal.response.error.code, expected);
      assert.equal(raw.includes(secret), false);
      assert.equal(JSON.stringify(result).includes(secret), false);
      assert.deepEqual(Object.keys(journal).sort(), ['operation', 'request_id', 'response', 'schema_version', 'stage']);
    }
  }
});

test('ethers classification is bounded and limited to exact COMMAND_FAILED stderr tokens', () => {
  for (const stderr of [
    'insufficient funds for transaction', 'code=INSUFFICIENT_FUNDS_PRIVATE_DETAIL',
    'provider_code=INSUFFICIENT_FUNDS', 'code=INSUFFICIENT_FUNDS/PRIVATE_DETAIL',
    'code="INSUFFICIENT_FUNDS"', 'code=insufficient_funds',
    'code=INSUFFICIENT_FUNDS, code=NONCE_EXPIRED',
    `code=INSUFFICIENT_FUNDS ${'x'.repeat(32_768)}`
  ]) assert.equal(classifyPlayerBridgeError({ error: { code: 'COMMAND_FAILED' }, stderr }), 'COMMAND_FAILED');
  assert.equal(classifyPlayerBridgeError({ error: { code: 'REVISION_CHECK_FAILED' },
    stderr: 'code=INSUFFICIENT_FUNDS' }), 'REVISION_CHECK_FAILED');
  assert.equal(classifyPlayerBridgeError({ error: { code: 'COMMAND_FAILED', message: 'code=INSUFFICIENT_FUNDS' },
    stdout: 'code=INSUFFICIENT_FUNDS', stderr: '' }), 'COMMAND_FAILED');
  assert.equal(classifyPlayerBridgeError({ error: { code: 'PRIVATE_UNKNOWN_CODE' }, stderr: 'code=INSUFFICIENT_FUNDS' }),
    'PLAYER_SUBMISSION_OUTCOME_UNKNOWN');
  assert.equal(classifyPlayerBridgeError({ error: { code: 'PRIVATE_UNKNOWN_CODE' } }, 'PLAYER_PREPARE_FAILED'),
    'PLAYER_PREPARE_FAILED');
});

test('Hermes Git ownership exception is scoped to the selected checkout and read commands', async () => {
  const calls = [];
  const settings = { harness: 'hermes', game_repo: '/opt/data/dilemma-conference/hs-1/game' };
  const run = playerProcessRunner(settings, async invocation => { calls.push(invocation); });
  const invocation = { command: 'git', args: ['rev-parse', '--show-toplevel', 'HEAD'], cwd: settings.game_repo, env: {} };
  await run(invocation);
  assert.deepEqual(calls[0].args, ['-c', 'safe.directory=', '-c', `safe.directory=${settings.game_repo}`, ...invocation.args]);
  for (const other of [{ ...invocation, cwd: '/another/checkout' }, { ...invocation, command: 'yarn' },
    { ...invocation, args: ['config', '--global', 'safe.directory', '*'] }]) {
    await run(other); assert.equal(calls.at(-1), other);
  }
  await playerProcessRunner({ ...settings, harness: 'openclaw' }, async value => assert.equal(value, invocation))(invocation);
  assert.deepEqual(invocation.args, ['rev-parse', '--show-toplevel', 'HEAD']);
});

test('real Git cross-owner check passes only for the explicitly trusted Hermes checkout', async t => {
  const f = await fixture(t);
  await mkdir(f.settings.game_repo);
  await promisify(execFile)('git', ['init', '--quiet', f.settings.game_repo]);
  const env = { PATH: process.env.PATH, HOME: f.directory, GIT_CONFIG_NOSYSTEM: '1', GIT_TEST_ASSUME_DIFFERENT_OWNER: '1' };
  await assert.rejects(promisify(execFile)('git', ['status', '--porcelain'], { cwd: f.settings.game_repo, env }),
    error => error.code === 128 && error.stderr.includes('dubious ownership'));
  const run = playerProcessRunner({ ...f.settings, harness: 'hermes' });
  const result = await run({ command: 'git', args: ['status', '--porcelain'], cwd: f.settings.game_repo, env });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, '');
  await writeFile(join(f.settings.game_repo, 'unexpected.txt'), 'untracked');
  const dirty = await run({ command: 'git', args: ['status', '--porcelain'], cwd: f.settings.game_repo, env });
  assert.match(dirty.stdout, /unexpected.txt/);
});

test('settlement queries pass real bridge validation with the auth adapter before refund or claim', async t => {
  for (const [outcome, expectedOperation] of [['Cancelled', 'refund'], ['Winners', 'claim']]) {
    let reads = 0;
    const f = await fixture(t, { read: async (operation, options) => {
      reads++;
      assert.equal(operation, 'state');
      const invocation = buildInvocation(operation, options, { allowedRpcUrl: config.rpc_url });
      assert.equal(invocation.args[invocation.args.indexOf('--registry') + 1], FROZEN_NETWORK.authRegistry);
      return { exit_code: 0, error: null, parsed: {
        schemaVersion: 'prisoners-daolemma/evidence-v0', gameId: 7, chainId: 84532,
        addresses: { game: config.game_address, registry: FROZEN_NETWORK.authRegistry, chat: FROZEN_NETWORK.chat },
        game: { outcome }
      } };
    } });
    const result = await f.make().execute({ request: poke('claim') });
    assert.equal(result.status, 'submitted');
    assert.equal(reads, 1);
    assert.deepEqual(f.calls.map(call => call.operation), [expectedOperation]);
  }
});

test('claim uses authoritative cancellation for refund and rejects unverified state', async t => {
  const f = await fixture(t);
  await f.make().execute({ request: poke('claim') }); assert.equal(f.calls[0].operation, 'refund');
  const bad = await fixture(t, { read: async () => ({ exit_code: 0, parsed: { game: { outcome: 'Cancelled' } } }) });
  const result = await bad.make().execute({ request: poke('claim') });
  assert.equal(result.error.code, 'PLAYER_SETTLEMENT_STATE_UNVERIFIED'); assert.equal(bad.calls.length, 0);
});

test('missing reveal, cross-seat and coordinator decision fields cannot sign', async t => {
  const f = await fixture(t);
  assert.equal((await f.make().execute({ request: poke('reveal') })).error.code, 'PLAYER_REVEAL_BUNDLE_MISSING');
  await assert.rejects(f.make().execute({ request: poke('join', roster[1]) }), /IDENTITY_INVALID/);
  await assert.rejects(f.make().execute({ request: { ...poke(), chain_state: { choice: 'share' } } }), /LOCAL_MATERIAL/);
  assert.equal(f.calls.length, 0);
});

test('nested commit choice is rejected before bridge or journal work', async t => {
  const f = await fixture(t);
  await assert.rejects(f.make().execute({ request: { ...poke('commit'), choice: 'share' } }), /PLAYER_CHOICE_LOCATION_INVALID/);
  assert.equal(f.calls.length, 0);
  await assert.rejects(lstat(f.settings.state_directory), { code: 'ENOENT' });
});

test('inspection rejects a missing checkout before creating private state', async t => {
  const f = await fixture(t);
  const fixtureKey = `0x${'0'.repeat(63)}1`;
  const wallet = deriveEthereumAddress(fixtureKey);
  f.settings.roster = f.settings.roster.map(row => row.seat_id === f.settings.seat_id
    ? { ...row, wallet_address: wallet } : row);
  const runtime = createPlayerRuntime({ settings: f.settings, env: { GAMEPLAY_WALLET_PRIVATE_KEY: fixtureKey } });
  await assert.rejects(runtime.inspect(), error => error.code === 'INVALID_REPOSITORY');
  await assert.rejects(lstat(f.settings.state_directory), { code: 'ENOENT' });
});

test('install artifact carries runnable imports and persistent seat isolation with no invented live evidence', async () => {
  const artifact = await buildInstallArtifact({ config, seatId: 'hs-1', persistentRoot: '/opt/data', operationsManifest: operations });
  assert.ok(artifact.files.length >= 10);
  assert.ok(artifact.files.every(file => file.path.startsWith('/opt/data/dilemma-conference/hs-1/')));
  assert.equal(artifact.live_evidence.gameplay_execution_proven, false);
  assert.equal(artifact.live_evidence.spectator_access_blocked, false);
  assert.equal(artifact.install_command[0], 'node');
  assert.equal(artifact.harness, 'hermes');
  assert.deepEqual(artifact.hermes_configure_command.slice(-2), ['--configure-hermes-config', '/opt/data/dilemma-conference/hs-1/seat.json']);
  assert.deepEqual(artifact.hermes_config_check_command.slice(-2), ['--check-hermes-config', '/opt/data/dilemma-conference/hs-1/seat.json']);
  const settings = JSON.parse(artifact.files.find(file => file.path.endsWith('/seat.json')).content);
  assert.equal(settings.hermes_config_path, '/opt/data/config.yaml');
  assert.deepEqual(settings.runtime_identity, { uid: 10_000, gid: 10_000 });
  assert.equal(JSON.stringify(artifact).includes('0x'.concat('a'.repeat(64))), false);
  const runtimeSource = artifact.files.find(file => file.path.endsWith('/shared/runtime-source.json'));
  assert.ok(runtimeSource); assert.equal(JSON.parse(runtimeSource.content).network.chain_id, 84532);
});

test('materialized install artifact actually imports and inspects one fixture signer in a separate process', async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'conference-artifact-test-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fixtureKey = `0x${'0'.repeat(63)}1`;
  const wallet = deriveEthereumAddress(fixtureKey);
  const artifactConfig = { ...config, roster: roster.map(row => row.seat_id === 'oc-1' ? { ...row, wallet_address: wallet } : row) };
  const artifact = await buildInstallArtifact({ config: artifactConfig, seatId: 'oc-1', persistentRoot: directory, operationsManifest: operations });
  for (const file of artifact.files) {
    await mkdir(dirname(file.path), { recursive: true }); await writeFile(file.path, file.content);
  }
  const materializedSettings = JSON.parse((await readFile(join(directory, 'dilemma-conference', 'oc-1', 'seat.json'))));
  const repo = materializedSettings.game_repo;
  await mkdir(join(repo, '.git'), { recursive: true });
  await mkdir(join(repo, 'packages', 'foundry', 'scripts-js'), { recursive: true });
  await writeFile(join(repo, 'packages', 'foundry', 'scripts-js', 'gameCli.js'), '');
  await mkdir(join(repo, 'packages', 'foundry', 'node_modules', 'ethers'), { recursive: true });
  await writeFile(join(repo, 'packages', 'foundry', 'node_modules', 'ethers', 'package.json'), '{}');
  const yarn = join(materializedSettings.bin_directory, 'yarn');
  await mkdir(materializedSettings.bin_directory, { recursive: true });
  await writeFile(yarn, buildRestrictedYarnWrapper(repo));
  await chmod(yarn, 0o700);
  const gitShim = join(directory, 'git-fixture-bin');
  await mkdir(gitShim, { recursive: true });
  await writeFile(join(gitShim, 'git'), `#!/bin/sh\ncase "$*" in\n  *status*) exit 0 ;;\n  *rev-parse*) printf "%s\\n${PINNED_GAME_REVISION}\\n" "$PWD" ;;\n  *) exit 64 ;;\nesac\n`);
  await chmod(join(gitShim, 'git'), 0o755);
  const inspectOptions = {
    env: { GAMEPLAY_WALLET_PRIVATE_KEY: fixtureKey, PATH: `${gitShim}:${process.env.PATH}` }, timeout: 10_000
  };
  const { stdout } = await promisify(execFile)(process.execPath, artifact.inspect_command.slice(1), inspectOptions);
  const result = JSON.parse(stdout);
  assert.equal(result.wallet_address, wallet); assert.equal(result.gameplay_execution_proven, false);
  assert.equal(stdout.includes(fixtureKey), false);

  await rm(yarn);
  await assert.rejects(promisify(execFile)(process.execPath, artifact.inspect_command.slice(1), inspectOptions), error => {
    assert.equal(JSON.parse(error.stdout).error.code, 'PLAYER_COMMAND_MISSING');
    return true;
  });
  await writeFile(yarn, buildRestrictedYarnWrapper(repo));
  await chmod(yarn, 0o700);
  assert.equal(JSON.parse((await promisify(execFile)(process.execPath,
    artifact.inspect_command.slice(1), inspectOptions)).stdout).wallet_address, wallet);
});

test('minimal yarn facade maps exactly the bridge scripts to pinned Foundry Node CLIs', async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'conference-yarn-facade-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const scripts = join(directory, 'packages/foundry/scripts-js');
  await mkdir(scripts, { recursive: true });
  for (const [file] of new Map(Object.values(FOUNDRY_SCRIPT_MAPPINGS).map(([file]) => [file, true]))) {
    await writeFile(join(directory, 'packages/foundry', file), 'process.stdout.write(JSON.stringify(process.argv.slice(2)))\n');
  }
  const wrapper = join(directory, 'yarn');
  await writeFile(wrapper, buildRestrictedYarnWrapper(directory), { mode: 0o700 });
  await chmod(wrapper, 0o700);
  for (const [script, [_file, subcommand]] of Object.entries(FOUNDRY_SCRIPT_MAPPINGS)) {
    const { stdout } = await promisify(execFile)(wrapper, [script, '--', '--json', '--game-id', '7']);
    assert.deepEqual(JSON.parse(stdout), [subcommand, '--json', '--game-id', '7']);
  }
});

test('minimal yarn facade rejects every non-allowlisted script and malformed separator', async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'conference-yarn-deny-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const wrapper = join(directory, 'yarn');
  await writeFile(wrapper, buildRestrictedYarnWrapper(directory), { mode: 0o700 });
  await chmod(wrapper, 0o700);
  for (const args of [
    ['auth:register', '--', '--json'], ['game:create', '--', '--json'], ['game:advance', '--', '--json'],
    ['game:withdraw-treasury', '--', '--json'], ['test', '--', '--json'], ['game:join;id', '--', '--json'],
    ['game:join', '--json'], [], ['query:summary']
  ]) await assert.rejects(promisify(execFile)(wrapper, args), error => error.code === 64);
});

test('remote installer uses only production Foundry npm dependencies without scripts or lockfile writes', async () => {
  const source = await readFile(new URL('../../src/maritime/install-runtime.mjs', import.meta.url), 'utf8');
  assert.match(source, /'npm', \['install', '--omit=dev', '--ignore-scripts', '--no-package-lock', '--workspaces=false', '--no-audit', '--no-fund'\]/);
  assert.equal(source.includes("'.yarn/releases/yarn-3.2.3.cjs'"), false);
  assert.match(source, /status', '--porcelain', '--untracked-files=all/);
});

test('Hermes config update adds exactly the authorized variable name and is text-idempotent', () => {
  const original = [
    'model:',
    '  default: "gpt-5.4"',
    '  model: "gpt-5.4"',
    '  provider: "openai"',
    '  base_url: "https://api.maritime.sh/api/llm/v1"',
    'terminal:',
    '  backend: local',
    '  env_passthrough:',
    '    - SAFE_PUBLIC_SETTING',
    'logging:',
    '  level: info',
    ''
  ].join('\n');
  const updated = updateHermesConfigText(original);
  assert.match(updated, /agent:\n  reasoning_effort: "low"/);
  assert.ok(updated.includes('    - SAFE_PUBLIC_SETTING'));
  assert.match(updated, /^model:\n  default: "gpt-5\.4-mini"\n  model: "gpt-5\.4-mini"\n  provider: "openai"\n  base_url: "https:\/\/api\.maritime\.sh\/api\/llm\/v1"\n  reasoning_effort: "low"\n  max_tokens: 2048/m);
  assert.equal(updated.match(new RegExp(HERMES_TERMINAL_PASSTHROUGH_ENV, 'g')).length, 1);
  assert.equal(updateHermesConfigText(updated), updated);
  const fresh = updateHermesConfigText('');
  assert.match(fresh, /^model:\n  default: "gpt-5\.4-mini"\n  model: "gpt-5\.4-mini"\n  reasoning_effort: "low"\n  max_tokens: 2048/m);
  assert.match(fresh, /terminal:\n  env_passthrough:\n    - GAMEPLAY_WALLET_PRIVATE_KEY/);
});

test('Hermes config update rejects scalar, mapping, duplicate, and malformed passthrough shapes', () => {
  for (const text of [
    'terminal:\n  env_passthrough: GAMEPLAY_WALLET_PRIVATE_KEY\n',
    'terminal:\n  env_passthrough: {}\n',
    'terminal:\n  env_passthrough:\n    key: value\n',
    'terminal:\n  env_passthrough: []\n  env_passthrough: []\n',
    'terminal: []\n',
    'model: gpt-5.4\n'
  ]) assert.throws(() => updateHermesConfigText(text), /HERMES_/);
});

test('OpenClaw model config preserves unrelated fields and fails closed on drift', () => {
  const before = JSON.stringify({ gateway: { port: 18789 }, agents: { defaults: {
    workspace: '/data/workspace', model: { primary: 'openai/gpt-5.5', fallbacks: ['openai/gpt-5.4'] },
    params: { cacheRetention: 'none' }, maxOutputTokens: 99
  } } });
  const after = updateOpenClawConfigText(before);
  const value = JSON.parse(after);
  assert.deepEqual(value.gateway, { port: 18789 });
  assert.equal(value.agents.defaults.workspace, '/data/workspace');
  assert.deepEqual(value.agents.defaults.model, { primary: 'openai/gpt-5.4-mini', fallbacks: [] });
  assert.equal(value.agents.defaults.thinkingDefault, 'low');
  assert.deepEqual(value.agents.defaults.params, { cacheRetention: 'none' });
  assert.equal(value.agents.defaults.models['openai/gpt-5.4-mini'].params.maxTokens, 2048);
  assert.equal(Object.hasOwn(value.agents.defaults, 'maxOutputTokens'), false);
  assert.deepEqual(inspectOpenClawConfigText(after), {
    model: 'gpt-5.4-mini', reasoning_effort: 'low', max_output_tokens: 2048,
    automatic_fallback: false, fallback_model: null, response_metadata_required: true
  });
  assert.equal(updateOpenClawConfigText(after), after);
  value.agents.defaults.model.primary = 'openai/gpt-5.4';
  assert.throws(() => inspectOpenClawConfigText(JSON.stringify(value)), /MODEL_CONFIG_INVALID/);
  value.agents.defaults.model.primary = 'openai/gpt-5.4-mini';
  value.agents.defaults.model.fallbacks = ['openai/gpt-5.4'];
  assert.throws(() => inspectOpenClawConfigText(JSON.stringify(value)), /MODEL_CONFIG_INVALID/);
  assert.doesNotMatch(after, /(?:0[xX])?[0-9a-fA-F]{64}|(?:mk|sk)_[A-Za-z0-9_-]{8,}/);
});

test('Hermes Maritime mini Responses patch is idempotent and fails closed on source drift', async () => {
  const { updateHermesMiniResponsesText } = await import('../../src/maritime/install-runtime.mjs');
  const source = '        # Eagerly warm the transport cache so import errors surface at init,\n';
  const patched = updateHermesMiniResponsesText(source);
  assert.match(patched, /DILEMMA_MARITIME_MINI_RESPONSES_V1/);
  assert.match(patched, /self\.api_mode = "codex_responses"/);
  assert.equal(updateHermesMiniResponsesText(patched), patched);
  assert.notEqual(updateHermesMiniResponsesText(source), source);
  assert.throws(() => updateHermesMiniResponsesText('different source'), /SOURCE_VERSION_MISMATCH/);
});


test('Hermes config file update is atomic, idempotent, and stores no secret value', async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'conference-hermes-config-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'config.yaml');
  await writeFile(path, 'terminal:\n  backend: local\n  env_passthrough: []\n', { mode: 0o600 });
  const ownership = async () => ({ config_owner_configured: true, runtime_identity: { ...HERMES_RUNTIME_IDENTITY } });
  assert.equal((await configureHermesTerminalEnvPassthrough(path, { enforceOwnershipImpl: ownership })).changed, true);
  assert.equal((await configureHermesTerminalEnvPassthrough(path, { enforceOwnershipImpl: ownership })).changed, false);
  assert.equal((await inspectHermesTerminalEnvPassthrough(path, { inspectOwnershipImpl: ownership })).configured, true);
  const text = await readFile(path, 'utf8');
  assert.equal(text.match(new RegExp(HERMES_TERMINAL_PASSTHROUGH_ENV, 'g')).length, 1);
  assert.equal(/0x[0-9a-fA-F]{64}/.test(text), false);
});

test('Hermes config ownership repairs root-owned 0600 to exact runtime identity', async () => {
  const path = '/opt/data/config.yaml';
  let mode = 0o100600, uid = 0, gid = 0;
  const calls = [];
  const metadata = () => ({ mode, uid, gid, isFile: () => true, isSymbolicLink: () => false });
  const result = await enforceHermesConfigOwnership(path, {
    lstatImpl: async target => { calls.push(['lstat', target]); return metadata(); },
    realpathImpl: async target => { calls.push(['realpath', target]); return target; },
    chmodImpl: async (target, nextMode) => { calls.push(['chmod', target, nextMode]); mode = 0o100000 | nextMode; },
    chownImpl: async (target, nextUid, nextGid) => { calls.push(['chown', target, nextUid, nextGid]); uid = nextUid; gid = nextGid; }
  });
  assert.deepEqual(result, { config_owner_configured: true, runtime_identity: HERMES_RUNTIME_IDENTITY });
  assert.deepEqual(calls, [
    ['lstat', path], ['realpath', path], ['chmod', path, 0o600], ['chown', path, 10_000, 10_000],
    ['lstat', path], ['realpath', path]
  ]);
});

test('Hermes config ownership enforcement is idempotent and touches only the exact file', async () => {
  const path = '/opt/data/config.yaml';
  const metadata = { mode: 0o100600, uid: 10_000, gid: 10_000, isFile: () => true, isSymbolicLink: () => false };
  const chmodTargets = [], chownTargets = [];
  const dependencies = {
    lstatImpl: async () => metadata, realpathImpl: async target => target,
    chmodImpl: async target => { chmodTargets.push(target); },
    chownImpl: async (target, uid, gid) => { chownTargets.push([target, uid, gid]); }
  };
  await enforceHermesConfigOwnership(path, dependencies);
  await enforceHermesConfigOwnership(path, dependencies);
  assert.deepEqual(chmodTargets, [path, path]);
  assert.deepEqual(chownTargets, [[path, 10_000, 10_000], [path, 10_000, 10_000]]);
});

test('Hermes config ownership fails closed on chown failure and path drift', async () => {
  const path = '/opt/data/config.yaml';
  const metadata = { mode: 0o100600, uid: 0, gid: 0, isFile: () => true, isSymbolicLink: () => false };
  await assert.rejects(enforceHermesConfigOwnership(path, {
    lstatImpl: async () => metadata, realpathImpl: async target => target, chmodImpl: async () => {},
    chownImpl: async () => { throw Object.assign(new Error('not permitted'), { code: 'EPERM' }); }
  }), error => error.code === 'EPERM');
  await assert.rejects(inspectHermesConfigOwnership(path, {
    lstatImpl: async () => metadata, realpathImpl: async () => '/other/config.yaml'
  }), /HERMES_CONFIG_FILE_INVALID/);
});

test('Hermes config update rejects a symlink before ownership mutation', async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'conference-hermes-config-link-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const target = join(directory, 'target.yaml');
  const path = join(directory, 'config.yaml');
  await writeFile(target, 'terminal:\n  env_passthrough: []\n');
  await symlink(target, path);
  let ownershipMutated = false;
  await assert.rejects(configureHermesTerminalEnvPassthrough(path, {
    enforceOwnershipImpl: async () => { ownershipMutated = true; }
  }), /HERMES_CONFIG_FILE_INVALID/);
  assert.equal(ownershipMutated, false);
});
