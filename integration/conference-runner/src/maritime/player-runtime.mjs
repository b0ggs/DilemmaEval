import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, chmod, lstat, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createGameBridge, createJsonRpcChainVerifier, createProcessRunner, FROZEN_NETWORK, deriveEthereumAddress, verifyCheckout } from '../../../game-bridge/src/index.js';
import { assertPublicGameplayRequest, validateRuntimeDiagnosticInput } from './protocol.mjs';
import { validateMaritimeRoster } from './roster.mjs';
import { runtimeIdentityForSettings } from './runtime-identity.mjs';
import { safePlayerErrorCode, classifyPlayerBridgeError } from './diagnostics.mjs';

const HASH = /^0x[0-9a-fA-F]{64}$/;

export function validatePlayerSettings(settings) {
  if (settings?.schema_version !== 1 || settings.chain_id !== 84532 ||
      settings.game_address?.toLowerCase() !== FROZEN_NETWORK.game.toLowerCase() ||
      !isAbsolute(settings.game_repo ?? '') || !isAbsolute(settings.state_directory ?? '') ||
      !/^https:\/\//.test(settings.rpc_url ?? '') || !settings.operations_manifest) throw new TypeError('PLAYER_SETTINGS_INVALID');
  validateMaritimeRoster(settings.roster);
  const operations = settings.operations_manifest;
  const keysEqual = (value, keys) => value && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
  if (!keysEqual(operations, ['schema_version', 'network', 'chain_id', 'phase_advancer', 'gas_ceiling_wei']) ||
      !keysEqual(operations.phase_advancer, ['role', 'wallet_address', 'is_player_seat', 'erc8004_registered']) ||
      operations.schema_version !== 1 || operations.network !== 'base-sepolia' || operations.chain_id !== 84532 ||
      operations.phase_advancer.role !== 'phase-advancer' || operations.phase_advancer.is_player_seat !== false ||
      operations.phase_advancer.erc8004_registered !== false || !/^[1-9][0-9]*$/.test(operations.gas_ceiling_wei) ||
      !/^0x[0-9a-fA-F]{40}$/.test(operations.phase_advancer.wallet_address) ||
      settings.roster.some(row => row.wallet_address.toLowerCase() === FROZEN_NETWORK.owner.toLowerCase()) ||
      settings.roster.some(row => row.wallet_address.toLowerCase() === operations.phase_advancer.wallet_address.toLowerCase()) ||
      settings.roster.some(row => !Number.isInteger(row.cause_id) || row.cause_id < 1 || row.cause_id > 65535)) {
    throw new TypeError('PLAYER_OPERATIONS_MANIFEST_INVALID');
  }
  const seat = settings.roster.find(row => row.seat_id === settings.seat_id);
  if (!seat) throw new TypeError('PLAYER_SEAT_INVALID');
  if (seat.harness !== settings.harness) throw new TypeError('PLAYER_HARNESS_INVALID');
  runtimeIdentityForSettings(settings);
  const state = resolve(settings.state_directory), repo = resolve(settings.game_repo);
  if (state === repo || state.startsWith(`${repo}/`) || repo.startsWith(`${state}/`)) throw new TypeError('PLAYER_STORAGE_BOUNDARY_INVALID');
  return settings;
}

export async function privateDirectory(path, {
  mkdirImpl = mkdir, lstatImpl = lstat, realpathImpl = realpath,
  chmodImpl = chmod, accessImpl = access
} = {}) {
  const created = await mkdirImpl(path, { recursive: true, mode: 0o700 }) !== undefined;
  const metadata = await lstatImpl(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() ||
      await realpathImpl(path) !== resolve(path)) throw new Error('PLAYER_STORAGE_SYMLINK_REJECTED');
  // Maritime persistent volumes can expose an already-correct directory that
  // this process may use but may not chmod. Avoid that unnecessary mutation.
  if (!created && (metadata.mode & 0o7777) === 0o700) {
    await accessImpl(path, fsConstants.W_OK | fsConstants.X_OK);
    return;
  }
  await chmodImpl(path, 0o700);
  const repaired = await lstatImpl(path);
  if (!repaired.isDirectory() || repaired.isSymbolicLink() ||
      (repaired.mode & 0o7777) !== 0o700 || await realpathImpl(path) !== resolve(path)) {
    throw new Error('PLAYER_STORAGE_MODE_INVALID');
  }
  await accessImpl(path, fsConstants.W_OK | fsConstants.X_OK);
}

async function atomicJson(path, data) {
  const temp = `${path}.${process.pid}.tmp`;
  const handle = await open(temp, 'wx', 0o600);
  try { await handle.writeFile(`${JSON.stringify(data)}\n`); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temp, path);
  const directory = await open(dirname(path), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

async function readJson(path) {
  try {
    if (!(await lstat(path)).isFile()) throw new Error('PLAYER_STORAGE_INVALID');
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function readProcessBirthIdentity(pid, { platform = process.platform, readFileImpl = readFile } = {}) {
  if (platform !== 'linux' || !Number.isSafeInteger(pid) || pid < 1) return null;
  try {
    const boot = (await readFileImpl('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
    const stat = await readFileImpl(`/proc/${pid}/stat`, 'utf8');
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(boot) ||
        !stat.startsWith(`${pid} (`)) return null;
    // comm may contain spaces or ')'; starttime is field 22, after the final ')'.
    const fields = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/);
    const starttime = fields[19];
    if (!/^[A-Za-z]$/.test(fields[0] ?? '') || !/^[0-9]+$/.test(starttime ?? '')) return null;
    return createHash('sha256').update(`${boot.toLowerCase()}:${pid}:${starttime}`).digest('hex');
  } catch { return null; }
}

async function syncPrivateDirectory(directory) {
  const handle = await open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

export async function lockSeat(directory, {
  processIdentity = readProcessBirthIdentity, probeProcess = pid => process.kill(pid, 0),
  syncDirectory = syncPrivateDirectory
} = {}) {
  const path = join(directory, 'seat.lock');
  const identityFor = async pid => {
    try {
      const identity = await processIdentity(pid);
      return typeof identity === 'string' && /^[0-9a-f]{64}$/.test(identity) ? identity : null;
    } catch { return null; }
  };
  const birthIdentity = await identityFor(process.pid);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(path, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, birth_identity: birthIdentity }));
        await handle.sync();
        await syncDirectory(directory);
      } catch (error) { await handle.close(); throw error; }
      return async () => { await handle.close(); await unlink(path); await syncDirectory(directory); };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const previous = await readJson(path);
      if (!Number.isSafeInteger(previous?.pid) || previous.pid < 1) throw new Error('PLAYER_LOCK_INVALID');
      let alive = true;
      try { probeProcess(previous.pid); }
      catch (probe) {
        if (probe.code !== 'ESRCH') throw new Error('PLAYER_SEAT_BUSY');
        alive = false;
      }
      if (alive) {
        // A PID can belong to another process after a VM lifecycle transition.
        // Legacy or unavailable birth evidence never permits deleting a live lock.
        const observedIdentity = await identityFor(previous.pid);
        if (!/^[0-9a-f]{64}$/.test(previous.birth_identity ?? '') || !observedIdentity ||
            previous.birth_identity === observedIdentity) throw new Error('PLAYER_SEAT_BUSY');
      }
      await unlink(path);
      await syncDirectory(directory);
    }
  }
  throw new Error('PLAYER_SEAT_BUSY');
}

function responseFor(request, status, extra = {}) {
  return { schema_version: 1, request_id: request.request_id, game_id: request.game_id,
    round: request.round, phase: request.phase, seat_id: request.seat_id, status, ...extra };
}

function errorResponse(request, code) {
  return responseFor(request, 'error', { error: { code, message: 'Player operation requires chain reconciliation before another submission.' } });
}

function optionsFor(settings, request) {
  return { network: 'base-sepolia', chainId: 84532, rpcUrl: settings.rpc_url,
    game: settings.game_address, gameId: request.game_id };
}

export function playerProcessRunner(settings, execute = createProcessRunner({
  timeoutMs: settings.command_timeout_ms ?? 90_000, maxOutputBytes: 1_048_576
})) {
  return invocation => {
    // The operator installs the pinned checkout as root; Hermes runs as 10000.
    // Trust only this already-selected, canonical checkout for these Git reads.
    // No global config change or wildcard; all bridge integrity checks still run.
    if (settings.harness === 'hermes' && invocation.command === 'git' &&
        invocation.cwd === settings.game_repo && ['rev-parse', 'status'].includes(invocation.args[0])) {
      return execute({ ...invocation, args: ['-c', 'safe.directory=', '-c',
        `safe.directory=${invocation.cwd}`, ...invocation.args] });
    }
    return execute(invocation);
  };
}

export function createPlayerChainVerifier({
  verifier = createJsonRpcChainVerifier({ timeoutMs: 5_000 }),
  delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
} = {}) {
  if (typeof verifier !== 'function' || typeof delay !== 'function') throw new TypeError('PLAYER_CHAIN_VERIFIER_INVALID');
  return async request => {
    // Retry only a failed read-only eth_chainId query. Returned chain IDs pass
    // unchanged to the bridge's fail-closed check; player commands never retry.
    try { return await verifier(request); } catch {}
    await delay(250);
    try { return await verifier(request); }
    catch { throw new Error('PLAYER_CHAIN_VERIFICATION_UNAVAILABLE'); }
  };
}

async function boundedJsonRpc(fetchImpl, rpcUrl, requests, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(rpcUrl, { method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requests) });
    if (!response?.ok || Number(response.headers?.get?.('content-length')) > 65_536) {
      throw new Error('PLAYER_DIAGNOSTIC_CONTRACT_CHECK_FAILED');
    }
    const text = await response.text();
    if (Buffer.byteLength(text) > 65_536) throw new Error('PLAYER_DIAGNOSTIC_CONTRACT_CHECK_FAILED');
    return JSON.parse(text);
  } catch {
    throw new Error('PLAYER_DIAGNOSTIC_CONTRACT_CHECK_FAILED');
  } finally { clearTimeout(timer); }
}

/** Read-only pinned-contract verification at the coordinator's confirmed block. */
export function createPlayerContractVerifier({ fetchImpl = globalThis.fetch, timeoutMs = 5_000 } = {}) {
  if (typeof fetchImpl !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new TypeError('PLAYER_DIAGNOSTIC_VERIFIER_INVALID');
  }
  return async ({ rpcUrl, gameAddress, causeId, blockNumber, blockHash }) => {
    if (!/^https:\/\//.test(rpcUrl ?? '') || !/^0x[0-9a-fA-F]{40}$/.test(gameAddress ?? '') ||
        !Number.isInteger(causeId) || causeId < 1 || causeId > 65_535 ||
        !/^(?:0|[1-9][0-9]*)$/.test(blockNumber ?? '') || !HASH.test(blockHash ?? '')) {
      throw new TypeError('PLAYER_DIAGNOSTIC_CHAIN_INPUT_INVALID');
    }
    const blockTag = `0x${BigInt(blockNumber).toString(16)}`;
    const encodedCause = BigInt(causeId).toString(16).padStart(64, '0');
    const requests = [
      { jsonrpc: '2.0', id: 1, method: 'eth_getBlockByNumber', params: [blockTag, false] },
      { jsonrpc: '2.0', id: 2, method: 'eth_getCode', params: [gameAddress, blockTag] },
      { jsonrpc: '2.0', id: 3, method: 'eth_call', params: [{ to: gameAddress, data: '0x8da5cb5b' }, blockTag] },
      { jsonrpc: '2.0', id: 4, method: 'eth_call', params: [{ to: gameAddress, data: '0x8ca4f1f5' }, blockTag] },
      { jsonrpc: '2.0', id: 5, method: 'eth_call', params: [{ to: gameAddress, data: `0x240afc06${encodedCause}` }, blockTag] }
    ];
    const payload = await boundedJsonRpc(fetchImpl, rpcUrl, requests, timeoutMs);
    if (!Array.isArray(payload) || payload.length !== requests.length) {
      throw new Error('PLAYER_DIAGNOSTIC_CONTRACT_CHECK_FAILED');
    }
    const byId = new Map(payload.map(row => [row?.id, row]));
    const block = byId.get(1)?.result;
    const code = byId.get(2)?.result;
    const owner = byId.get(3)?.result;
    const activeGameId = byId.get(4)?.result;
    const causeWhitelisted = byId.get(5)?.result;
    if (byId.size !== 5 || payload.some(row => row?.jsonrpc !== '2.0' || row.error) ||
        block?.number?.toLowerCase() !== blockTag.toLowerCase() || block?.hash?.toLowerCase() !== blockHash.toLowerCase() ||
        typeof code !== 'string' || !/^0x[0-9a-fA-F]+$/.test(code) || code === '0x' ||
        !/^0x[0-9a-fA-F]{64}$/.test(owner ?? '') ||
        `0x${owner.slice(-40)}`.toLowerCase() !== FROZEN_NETWORK.owner.toLowerCase() ||
        !/^0x[0-9a-fA-F]{64}$/.test(activeGameId ?? '') || BigInt(activeGameId) !== 0n ||
        !/^0x[0-9a-fA-F]{64}$/.test(causeWhitelisted ?? '') || BigInt(causeWhitelisted) !== 1n) {
      throw new Error('PLAYER_DIAGNOSTIC_CONTRACT_CHECK_FAILED');
    }
    return { contract_read: true };
  };
}

function defaultBridgeFactory({ settings, request, bundleDirectory, env }) {
  const seat = settings.roster.find(row => row.seat_id === settings.seat_id);
  const baseEnv = Object.fromEntries(['PATH', 'HOME', 'TMPDIR'].filter(key => env[key] !== undefined).map(key => [key, env[key]]));
  if (settings.bin_directory) baseEnv.PATH = `${settings.bin_directory}:${baseEnv.PATH ?? '/usr/local/bin:/usr/bin:/bin'}`;
  baseEnv.DILEMMA_GAME_REPO = settings.game_repo;
  const common = { allowedRpcUrl: settings.rpc_url, runner: playerProcessRunner(settings),
    chainVerifier: createPlayerChainVerifier(),
    executionLimits: { timeoutMs: settings.command_timeout_ms ?? 90_000, maxOutputBytes: 1_048_576 } };
  return {
    player: createGameBridge({ ...common, executionRole: 'player',
      env: { ...baseEnv, GAMEPLAY_WALLET_PRIVATE_KEY: env.GAMEPLAY_WALLET_PRIVATE_KEY },
      seatManifest: { schema_version: 1, network: 'base-sepolia', game_id: request.game_id,
        seats: settings.roster.map(({ seat_id, team, harness, maritime_agent, wallet_address }) =>
          ({ seat_id, team, harness, maritime_agent, wallet_address })) },
      operationsManifest: settings.operations_manifest,
      expectedGameplayWallet: seat.wallet_address,
      expectedPhaseAdvancerWallet: settings.operations_manifest.phase_advancer.wallet_address,
      artifactDirectory: bundleDirectory
    }),
    reader: createGameBridge({ ...common, executionRole: 'read-only', env: baseEnv })
  };
}

function defaultDiagnosticReaderFactory({ settings, env }) {
  const baseEnv = Object.fromEntries(['PATH', 'HOME', 'TMPDIR'].filter(key => env[key] !== undefined).map(key => [key, env[key]]));
  if (settings.bin_directory) baseEnv.PATH = `${settings.bin_directory}:${baseEnv.PATH ?? '/usr/local/bin:/usr/bin:/bin'}`;
  baseEnv.DILEMMA_GAME_REPO = settings.game_repo;
  return createGameBridge({ allowedRpcUrl: settings.rpc_url, runner: playerProcessRunner(settings),
    executionRole: 'read-only', env: baseEnv,
    executionLimits: { timeoutMs: settings.command_timeout_ms ?? 90_000, maxOutputBytes: 1_048_576 } });
}

/** Runs inside ONE assigned agent VM. No coordinator key or strategy implementation. */
export function createPlayerRuntime({ settings, env = process.env, bridgeFactory = defaultBridgeFactory,
  checkoutVerifier = verifyCheckout, accessImpl = access, privateDirectoryImpl = privateDirectory,
  lockSeatImpl = lockSeat, diagnosticChainVerifier = createPlayerChainVerifier(),
  diagnosticContractVerifier = createPlayerContractVerifier(),
  diagnosticReaderFactory = defaultDiagnosticReaderFactory } = {}) {
  validatePlayerSettings(settings);
  if (typeof checkoutVerifier !== 'function' || typeof accessImpl !== 'function' ||
      typeof privateDirectoryImpl !== 'function' || typeof lockSeatImpl !== 'function' ||
      typeof diagnosticChainVerifier !== 'function' || typeof diagnosticContractVerifier !== 'function' ||
      typeof diagnosticReaderFactory !== 'function') {
    throw new TypeError('PLAYER_DIAGNOSTIC_DEPENDENCY_INVALID');
  }
  settings = structuredClone(settings);
  const seat = settings.roster.find(row => row.seat_id === settings.seat_id);
  const assertNoPrivilegedRole = () => {
    if (['PHASE_ADVANCER_PRIVATE_KEY', 'CONFERENCE_OWNER_PRIVATE_KEY', 'DILEMMA_LAUNCHER_PRIVATE_KEY', 'DILEMMA_PHASE_PRIVATE_KEY']
      .some(key => env[key] !== undefined)) throw new TypeError('PLAYER_ROLE_COLLISION');
  };
  const assertWallet = () => {
    const wallet = deriveEthereumAddress(env.GAMEPLAY_WALLET_PRIVATE_KEY);
    if (wallet.toLowerCase() !== seat.wallet_address.toLowerCase()) throw new TypeError('PLAYER_WALLET_MISMATCH');
    return wallet;
  };
  const inspectFiles = async () => {
    const inspectionEnv = Object.fromEntries(['PATH', 'HOME', 'TMPDIR'].filter(key => env[key] !== undefined).map(key => [key, env[key]]));
    const checkout = await checkoutVerifier(settings.game_repo, playerProcessRunner(settings), inspectionEnv);
    if (!checkout.ok) throw Object.assign(new Error(checkout.code), { code: checkout.code });
    for (const dependency of ['scripts-js/gameCli.js', 'node_modules/ethers/package.json']) {
      try { await accessImpl(join(settings.game_repo, 'packages/foundry', dependency), fsConstants.R_OK); }
      catch { throw Object.assign(new Error('INVALID_REPOSITORY'), { code: 'INVALID_REPOSITORY' }); }
    }
    try { await accessImpl(join(settings.bin_directory, 'yarn'), fsConstants.R_OK | fsConstants.X_OK); }
    catch { throw Object.assign(new Error('PLAYER_COMMAND_MISSING'), { code: 'PLAYER_COMMAND_MISSING' }); }
  };
  return Object.freeze({
    async execute(input) {
      if (!input || Object.keys(input).some(key => !['request', 'choice'].includes(key))) throw new TypeError('PLAYER_INPUT_INVALID');
      if (input.request && typeof input.request === 'object' && Object.hasOwn(input.request, 'choice')) {
        throw new TypeError('PLAYER_CHOICE_LOCATION_INVALID');
      }
      const request = structuredClone(input.request);
      assertPublicGameplayRequest(request);
      if (request.seat_id !== seat.seat_id || request.team !== seat.team ||
          !/^[1-9][0-9]*$/.test(request.game_id)) throw new TypeError('PLAYER_REQUEST_IDENTITY_INVALID');
      if (request.phase !== 'commit' && Object.hasOwn(input, 'choice')) throw new TypeError('CHOICE_IS_COMMIT_ONLY');
      if (Object.hasOwn(input, 'choice') && !['share', 'steal', 'catch'].includes(input.choice)) throw new TypeError('PLAYER_CHOICE_INVALID');
      assertNoPrivilegedRole();
      await privateDirectory(settings.state_directory);
      const release = await lockSeat(settings.state_directory);
      try {
        const bundleDirectory = join(settings.state_directory, 'bundles');
        const journals = join(settings.state_directory, 'requests');
        await privateDirectory(bundleDirectory); await privateDirectory(journals);
        const semantic = `${settings.chain_id}:${settings.game_address.toLowerCase()}:${request.game_id}:${request.round}:${request.phase}`;
        const action = createHash('sha256').update(semantic).digest('hex');
        const journalPath = join(journals, `${action}.json`);
        const persistError = async (code, operation, stage = 'submitting') => {
          const response = errorResponse(request, safePlayerErrorCode(code, 'PLAYER_SUBMISSION_OUTCOME_UNKNOWN'));
          await atomicJson(journalPath, { schema_version: 1, stage, request_id: request.request_id, operation, response });
          return response;
        };
        let journal = await readJson(journalPath);
        if (journal?.response) return { ...journal.response, request_id: request.request_id };
        if (journal?.stage === 'submitting') return errorResponse(request, 'PLAYER_SUBMISSION_OUTCOME_UNKNOWN');
        const bridges = bridgeFactory({ settings, request, bundleDirectory, env });
        let operation = request.requested_action;
        const options = optionsFor(settings, request);
        if (operation === 'claim') {
          const state = await bridges.reader.run('state', { ...options, registry: FROZEN_NETWORK.authRegistry, chat: FROZEN_NETWORK.chat,
            ...(request.chain_state.block_number ? { fromBlock: String(request.chain_state.block_number) } : {}) });
          if (state.error || state.exit_code !== 0 || String(state.parsed?.gameId) !== request.game_id ||
              state.parsed?.chainId !== 84532 || state.parsed?.addresses?.game?.toLowerCase() !== settings.game_address.toLowerCase()) {
            return errorResponse(request, 'PLAYER_SETTLEMENT_STATE_UNVERIFIED');
          }
          if (state.parsed.game.outcome === 'Cancelled') operation = 'refund';
          else if (state.parsed.game.outcome !== 'Winners') return responseFor(request, 'skipped');
        }
        if (operation === 'commit' || operation === 'reveal') {
          const bundlePath = join(bundleDirectory, `game-${request.game_id}-round-${request.round}.json`);
          let bundle = await readJson(bundlePath);
          if (!bundle && operation === 'reveal') return errorResponse(request, 'PLAYER_REVEAL_BUNDLE_MISSING');
          if (!bundle) {
            if (!input.choice) throw new TypeError('PLAYER_CHOICE_REQUIRED');
            journal = { schema_version: 1, stage: 'preparing', request_id: request.request_id };
            await atomicJson(journalPath, journal);
            const prepared = await bridges.player.run('prepare_commit', { ...options, choice: input.choice, out: bundlePath });
            if (prepared.error || prepared.exit_code !== 0) return persistError(
              classifyPlayerBridgeError(prepared, 'PLAYER_PREPARE_FAILED'), 'prepare_commit', 'preparing');
            bundle = await readJson(bundlePath);
          }
          // Validate without copying private material into a journal, result, or log.
          if (bundle?.schemaVersion !== 'prisoners-daolemma/commit-bundle-v0') throw new TypeError('PLAYER_BUNDLE_INVALID');
          if (bundle.chainId !== 84532 || String(bundle.gameId) !== request.game_id || bundle.round !== request.round ||
              bundle.game?.toLowerCase() !== settings.game_address.toLowerCase() ||
              bundle.wallet?.toLowerCase() !== seat.wallet_address.toLowerCase() || !HASH.test(bundle.salt) || !HASH.test(bundle.commitment)) {
            throw new TypeError('PLAYER_BUNDLE_IDENTITY_INVALID');
          }
          await chmod(bundlePath, 0o600);
          const bundleHandle = await open(bundlePath, 'r');
          try { await bundleHandle.sync(); } finally { await bundleHandle.close(); }
          const bundleDirHandle = await open(bundleDirectory, 'r');
          try { await bundleDirHandle.sync(); } finally { await bundleDirHandle.close(); }
          options.input = bundlePath;
        } else if (operation === 'join') options.causeId = String(seat.cause_id);
        await atomicJson(journalPath, { schema_version: 1, stage: 'submitting', request_id: request.request_id, operation });
        let result;
        try { result = await bridges.player.run(operation, options); }
        catch { return persistError('PLAYER_SUBMISSION_OUTCOME_UNKNOWN', operation); }
        const parsed = result.parsed;
        if (result.error || result.exit_code !== 0 || !HASH.test(parsed?.txHash) || parsed.chainId !== 84532 ||
            String(parsed.gameId) !== request.game_id || parsed.wallet?.toLowerCase() !== seat.wallet_address.toLowerCase() ||
            parsed.game?.toLowerCase() !== settings.game_address.toLowerCase()) {
          return persistError(classifyPlayerBridgeError(result), operation);
        }
        const response = responseFor(request, 'submitted', { transaction_hash: parsed.txHash.toLowerCase() });
        await atomicJson(journalPath, { schema_version: 1, stage: 'done', request_id: request.request_id, operation, response });
        return response;
      } finally { await release(); }
    },
    async diagnose(input) {
      const snapshot = structuredClone(input);
      validateRuntimeDiagnosticInput(snapshot);
      const request = snapshot.request;
      if (request.seat_id !== seat.seat_id || request.team !== seat.team ||
          request.chain_state.game_address.toLowerCase() !== settings.game_address.toLowerCase()) {
        throw new TypeError('PLAYER_REQUEST_IDENTITY_INVALID');
      }
      assertNoPrivilegedRole();
      assertWallet();
      await inspectFiles();
      await privateDirectoryImpl(settings.state_directory);
      const release = await lockSeatImpl(settings.state_directory);
      try {
        const reader = diagnosticReaderFactory({ settings, env });
        if (!reader || typeof reader.run !== 'function') throw new Error('PLAYER_DIAGNOSTIC_WRAPPER_CHECK_FAILED');
        const auth = await reader.run('wallet_auth_status', { network: 'base-sepolia', chainId: settings.chain_id,
          rpcUrl: settings.rpc_url, game: settings.game_address, identityRegistry: FROZEN_NETWORK.identityRegistry,
          authRegistry: FROZEN_NETWORK.authRegistry, wallet: seat.wallet_address });
        if (auth?.error || auth?.exit_code !== 0 || auth.parsed?.wallet?.toLowerCase() !== seat.wallet_address.toLowerCase() ||
            auth.parsed?.isAuthorized !== true) {
          throw new Error('PLAYER_DIAGNOSTIC_WRAPPER_CHECK_FAILED');
        }
        const chain = await diagnosticChainVerifier({ rpcUrl: settings.rpc_url, expectedChainId: settings.chain_id });
        if (chain?.chainId !== settings.chain_id) throw new Error('CHAIN_ID_MISMATCH');
        const contract = await diagnosticContractVerifier({ rpcUrl: settings.rpc_url,
          gameAddress: settings.game_address, causeId: seat.cause_id,
          blockNumber: request.chain_state.confirmed_block_number,
          blockHash: request.chain_state.confirmed_block_hash });
        if (contract?.contract_read !== true || Object.keys(contract).length !== 1) {
          throw new Error('PLAYER_DIAGNOSTIC_CONTRACT_CHECK_FAILED');
        }
      } finally { await release(); }
      return { schema_version: 1, type: 'runtime-diagnostic-response', request_id: request.request_id,
        seat_id: request.seat_id, team: request.team, mode: request.mode, status: 'ready',
        checks: { stdin: true, wallet_identity: true, checkout: true, dependencies: true, wrapper: true,
          private_state: true, seat_lock: true, chain_id: true, contract_read: true } };
    },
    async inspect() {
      const wallet = assertWallet();
      await inspectFiles();
      await privateDirectoryImpl(settings.state_directory);
      return { schema_version: 1, seat_id: seat.seat_id, wallet_address: wallet,
        chain_id: 84532, persistent_storage_writable: true, gameplay_execution_proven: false };
    }
  });
}
