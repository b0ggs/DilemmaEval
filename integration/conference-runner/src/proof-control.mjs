import { createHash } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath } from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';
import { REPOSITORY_ROOT, validateConfig } from './config.mjs';
import { assessControlledChainReadiness, configFingerprint, runtimeEvidenceFingerprint,
  validateControlledRuntimeEvidence } from './readiness.mjs';

export const PROOF_CONTROL_VERSION = 1;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const UINT = /^(0|[1-9][0-9]*)$/;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new Error(code); };
const contained = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

function clock(options) {
  const value = typeof options.now === 'function' ? options.now() : options.now ?? Date.now();
  if (!Number.isSafeInteger(value)) fail('PROOF_CLOCK_INVALID');
  return value;
}

function deadlines(options) {
  const nowMs = clock(options);
  if (!Number.isSafeInteger(options.stopNewGamesAtMs) || !Number.isSafeInteger(options.hardStopAtMs) ||
      options.stopNewGamesAtMs > options.hardStopAtMs) fail('PROOF_DEADLINE_INVALID');
  if (nowMs >= options.stopNewGamesAtMs || nowMs >= options.hardStopAtMs) fail('PROOF_WINDOW_CLOSED');
  return nowMs;
}

async function bounded(options, callback, code = 'PROOF_READ_FAILED') {
  const nowMs = deadlines(options);
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(callback).catch(error => fail(code === 'PROOF_CURRENT_READINESS_UNVERIFIED' &&
        error?.message === 'READINESS_REMOTE_GENERATION_UNATTESTED' ? 'READINESS_REMOTE_GENERATION_UNATTESTED' : code)),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('PROOF_DEADLINE_EXCEEDED')),
        Math.min(options.stopNewGamesAtMs - nowMs, 2 ** 31 - 1)); })
    ]);
  } finally { clearTimeout(timer); }
}

async function existing(filename) {
  try { return await lstat(filename); }
  catch (error) { if (error.code === 'ENOENT') return null; fail('PROOF_PATH_UNREADABLE'); }
}

async function canonicalPath(value, { directory = false, fresh = false, outside = false } = {}) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\0\r\n]/.test(value)) fail('PROOF_ABSOLUTE_PATH_REQUIRED');
  const requested = path.resolve(value);
  let canonical;
  try {
    canonical = fresh ? path.join(await realpath(path.dirname(requested)), path.basename(requested)) : await realpath(requested);
  } catch { fail('PROOF_PATH_UNAVAILABLE'); }
  // Bind canonical locations; aliases resolving through macOS /tmp remain supported.
  if (outside) {
    const repository = await realpath(REPOSITORY_ROOT);
    if (contained(repository, canonical) || contained(canonical, repository)) fail('PROOF_STATE_MUST_BE_OUTSIDE_REPOSITORY');
  }
  const stat = await existing(canonical);
  if (fresh) { if (stat) fail('PROOF_DIRECTORY_EXISTS'); }
  else if (!stat || stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) fail('PROOF_PATH_TYPE_INVALID');
  return canonical;
}

async function paths(options, { fresh }) {
  if (!Array.isArray(options.runnerDirectories) || !options.runnerDirectories.length) fail('PROOF_RUNNER_DIRECTORIES_REQUIRED');
  const selected = {
    config_path: await canonicalPath(options.configPath),
    evidence_path: await canonicalPath(options.evidencePath, { outside: true }),
    readiness_directory: await canonicalPath(options.readinessDirectory, { directory: true, outside: true }),
    operator_directory: await canonicalPath(options.operatorDirectory, { directory: true, outside: true }),
    runner_directories: await Promise.all(options.runnerDirectories.map(value => canonicalPath(value, { directory: true, outside: true }))),
    directory: await canonicalPath(options.directory, { directory: true, fresh, outside: true })
  };
  if (new Set(selected.runner_directories).size !== selected.runner_directories.length) fail('PROOF_DUPLICATE_RUNNER_DIRECTORY');
  for (const other of [selected.config_path, selected.evidence_path, selected.readiness_directory,
    selected.operator_directory, ...selected.runner_directories]) {
    if (contained(selected.directory, other) || contained(other, selected.directory)) fail('PROOF_PATH_OVERLAP');
  }
  return selected;
}

async function readJson(filename) {
  try {
    const stat = await lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) fail('invalid');
    const bytes = await readFile(filename);
    return { value: JSON.parse(bytes), sha256: digest(bytes) };
  } catch { fail('PROOF_FILE_INVALID'); }
}

async function inspectLock(filename, runner, owner) {
  if (await existing(`${filename}.recovery`)) fail('PROOF_LOCK_RECOVERY_UNRESOLVED');
  if (!await existing(filename)) {
    if (owner) fail('PROOF_OWNED_LOCK_MISSING');
    return;
  }
  const { value } = await readJson(filename);
  if (!Number.isSafeInteger(value?.pid) || value.pid < 1 || typeof value.token !== 'string' || !value.token ||
      (runner && value.hostname !== hostname()) || (value.hostname !== undefined && value.hostname !== hostname())) fail('PROOF_LOCK_AMBIGUOUS');
  try { process.kill(value.pid, 0); }
  catch (error) { if (error.code === 'ESRCH' && !owner) return; fail('PROOF_LOCK_AMBIGUOUS'); }
  if (owner) {
    const expected = { pid: owner.pid, token: owner.token, ...(owner.hostname === undefined ? {} : { hostname: owner.hostname }) };
    if (configFingerprint(value) !== configFingerprint(expected)) fail('PROOF_OWNED_LOCK_CHANGED');
    return;
  }
  fail('PROOF_PROCESS_RUNNING');
}

async function inspectProcesses(selected, owners = []) {
  if (!Array.isArray(owners) || owners.length > 2) fail('PROOF_OWNED_PROCESSES_INVALID');
  const permitted = new Map();
  for (const owner of owners) {
    if (!owner || Object.keys(owner).some(key => !['role', 'directory', 'pid', 'token', 'hostname'].includes(key)) ||
        !['operator', 'runner'].includes(owner.role) || !Number.isSafeInteger(owner.pid) || owner.pid < 1 ||
        typeof owner.token !== 'string' || !owner.token || owner.token.length > 200 || permitted.has(owner.role) ||
        (owner.role === 'runner' && owner.hostname !== hostname()) ||
        (owner.hostname !== undefined && owner.hostname !== hostname())) fail('PROOF_OWNED_PROCESSES_INVALID');
    const directory = await canonicalPath(owner.directory, { directory: true, outside: true });
    if (directory !== (owner.role === 'operator' ? selected.operator_directory : path.join(selected.directory, 'runtime'))) fail('PROOF_OWNED_PROCESS_PATH_INVALID');
    permitted.set(owner.role, owner);
  }
  await inspectLock(path.join(selected.operator_directory, 'signer.lock'), false, permitted.get('operator'));
  for (const directory of selected.runner_directories) await inspectLock(path.join(directory, 'runner.lock'), true);
  await inspectLock(path.join(selected.directory, 'runtime', 'runner.lock'), true, permitted.get('runner'));
}

async function inspectJournal(options, selected, config, preflight) {
  const filename = path.join(selected.operator_directory, 'transactions.json');
  if (!await existing(filename)) return;
  const { value: journal } = await readJson(filename);
  const fields = ['schema_version', 'role', 'chain_id', 'contract', 'signer', 'records'];
  if (!journal || Object.keys(journal).sort().join() !== fields.sort().join() || journal.schema_version !== 1 ||
      !['operator', 'launcher'].includes(journal.role) || journal.chain_id !== 84532 ||
      journal.contract?.toLowerCase() !== config.game_address.toLowerCase() ||
      journal.signer?.toLowerCase() !== config.expected_owner.toLowerCase() ||
      !journal.records || typeof journal.records !== 'object' || Array.isArray(journal.records)) fail('PROOF_JOURNAL_INVALID');
  for (const [key, record] of Object.entries(journal.records)) {
    if (!DIGEST.test(key) || !record || Object.keys(record).some(field =>
      !['operation', 'intent', 'stage', 'status', 'nonce', 'hash', 'observed_nonce'].includes(field))) fail('PROOF_JOURNAL_INVALID');
    const operation = record.operation ?? (record.intent?.action_id?.startsWith('configure:') ? 'configure-defaults' : 'create');
    const intentFields = operation === 'advance'
      ? ['schema_version', 'type', 'action_id', 'attempt_id', 'game_id', 'round', 'phase', 'source_block_number', 'source_block_hash', 'source_predicate_token', 'reason']
      : ['action_id', 'source_block_number'];
    if (!['create', 'advance', 'configure-defaults'].includes(operation) || !record.intent ||
        Object.keys(record.intent).sort().join() !== intentFields.sort().join() ||
        !/^[a-zA-Z0-9:._-]{1,200}$/.test(record.intent.action_id ?? '') ||
        !UINT.test(record.intent.source_block_number ?? '') || configFingerprint(record.intent.action_id) !== key) fail('PROOF_JOURNAL_INVALID');
    if (operation === 'advance' && (record.intent.schema_version !== 1 || record.intent.type !== 'advance-request' ||
        !UINT.test(record.intent.game_id ?? '') || !Number.isSafeInteger(record.intent.round) || record.intent.round < 0 ||
        !['join', 'commit', 'reveal'].includes(record.intent.phase) || !HASH.test(record.intent.source_block_hash ?? '') ||
        !DIGEST.test(record.intent.source_predicate_token ?? '') || typeof record.intent.attempt_id !== 'string' ||
        !/^[a-zA-Z0-9:._-]{1,200}$/.test(record.intent.attempt_id) ||
        typeof record.intent.reason !== 'string' || !/^[a-z-]{1,100}$/.test(record.intent.reason))) fail('PROOF_JOURNAL_INVALID');
    if (record.stage === 'rejected' && record.status === 'rejected-before-submit' && record.hash === undefined) continue;
    if (record.stage !== 'confirmed' || !['accepted', 'confirmed-revert'].includes(record.status) || !HASH.test(record.hash ?? '')) fail('PROOF_JOURNAL_UNRESOLVED');
    const receipt = await bounded(options, () => options.provider.getTransactionReceipt(record.hash), 'PROOF_JOURNAL_RECEIPT_UNAVAILABLE');
    if (!receipt || !Number.isSafeInteger(receipt.blockNumber) || !HASH.test(receipt.blockHash ?? '') ||
        receipt.hash?.toLowerCase() !== record.hash.toLowerCase() ||
        receipt.from?.toLowerCase() !== config.expected_owner.toLowerCase() ||
        receipt.to?.toLowerCase() !== config.game_address.toLowerCase() ||
        BigInt(receipt.blockNumber) > BigInt(preflight.block_number) ||
        Number(receipt.status) !== (record.status === 'accepted' ? 1 : 0)) fail('PROOF_JOURNAL_UNRESOLVED');
    const block = await bounded(options, () => options.provider.getBlock(receipt.blockNumber), 'PROOF_JOURNAL_RECEIPT_UNAVAILABLE');
    if (block?.hash?.toLowerCase() !== receipt.blockHash.toLowerCase()) fail('PROOF_JOURNAL_REORGED');
  }
}

async function inputState(options, selected) {
  const nowMs = deadlines(options);
  const source = await readJson(selected.config_path);
  const evidenceFile = await readJson(selected.evidence_path);
  const config = validateConfig(source.value);
  const evidence = validateControlledRuntimeEvidence(config, evidenceFile.value, { now: nowMs, allowDiagnosticsOnly: true });
  if (evidence.chain_id !== 84532 || evidence.game_address?.toLowerCase() !== config.game_address.toLowerCase() ||
      !HASH.test(evidence.game_code_hash ?? '') || !DIGEST.test(evidence.chain_defaults_fingerprint ?? '') ||
      !DIGEST.test(evidence.lifecycle_state_digest ?? '')) fail('PROOF_READINESS_BINDINGS_REQUIRED');
  return { source, evidenceFile, config, evidence };
}

async function refresh(options, selected, inputs) {
  if (typeof options.chain?.preflight !== 'function' || typeof options.chain?.readBlockHash !== 'function' ||
      typeof options.provider?.getTransactionCount !== 'function') fail('PROOF_READ_ADAPTER_REQUIRED');
  if (typeof options.validateReadinessCurrent !== 'function') fail('PROOF_CURRENT_READINESS_REQUIRED');
  await inspectProcesses(selected, options.ownedProcesses);
  const { config, evidence } = inputs;
  const preflight = await bounded(options, () => options.chain.preflight(), 'PROOF_CHAIN_READ_FAILED');
  if (preflight?.active_game_id !== '0' || !UINT.test(preflight.block_number ?? '') || !HASH.test(preflight.block_hash ?? '') ||
      preflight.game_address?.toLowerCase() !== config.game_address.toLowerCase() ||
      preflight.owner?.toLowerCase() !== config.expected_owner.toLowerCase() || !assessControlledChainReadiness(config, preflight).ready ||
      preflight.code_hash?.toLowerCase() !== evidence.game_code_hash.toLowerCase() ||
      configFingerprint(preflight.config) !== evidence.chain_defaults_fingerprint ||
      BigInt(preflight.block_number) < BigInt(evidence.confirmed_block_number)) fail('PROOF_CHAIN_NOT_READY');
  for (const [number, hash] of [[evidence.confirmed_block_number, evidence.confirmed_block_hash], [preflight.block_number, preflight.block_hash]]) {
    const canonical = await bounded(options, () => options.chain.readBlockHash({ blockNumber: number }), 'PROOF_CANONICAL_BLOCK_UNAVAILABLE');
    if (canonical?.toLowerCase() !== hash.toLowerCase()) fail('PROOF_CANONICAL_BLOCK_CHANGED');
  }
  await inspectJournal(options, selected, config, preflight);
  for (const address of [config.expected_owner, ...config.roster.map(seat => seat.wallet_address)]) {
    const [latest, pending] = await bounded(options, () => Promise.all([
      options.provider.getTransactionCount(address, 'latest'), options.provider.getTransactionCount(address, 'pending')
    ]), 'PROOF_NONCE_UNAVAILABLE');
    if (!Number.isSafeInteger(latest) || latest < 0 || !Number.isSafeInteger(pending) || pending !== latest) fail('PROOF_PENDING_NONCE');
  }
  const current = await bounded(options, () => options.validateReadinessCurrent({ config, evidence,
    chain: options.chain, provider: options.provider, readinessDirectory: selected.readiness_directory,
    nowMs: clock(options), deadlineAtMs: options.stopNewGamesAtMs }), 'PROOF_CURRENT_READINESS_UNVERIFIED');
  if (current?.ready !== true || current.evidence_sha256 !== runtimeEvidenceFingerprint(evidence) ||
      current.lifecycle_state_digest !== evidence.lifecycle_state_digest) fail('PROOF_CURRENT_READINESS_UNVERIFIED');
  deadlines(options);
  validateControlledRuntimeEvidence(config, evidence, { now: clock(options), allowDiagnosticsOnly: true });
  return { chain_id: 84532, game_address: config.game_address, block_number: preflight.block_number,
    block_hash: preflight.block_hash, active_game_id: '0', code_hash: evidence.game_code_hash,
    chain_defaults_fingerprint: evidence.chain_defaults_fingerprint };
}

function bindingsFor(options, selected, inputs, preparedConfig) {
  return { schema_version: 1, ...selected, stop_new_games_at_ms: options.stopNewGamesAtMs,
    hard_stop_at_ms: options.hardStopAtMs, source_config_file_sha256: inputs.source.sha256,
    runtime_evidence_file_sha256: inputs.evidenceFile.sha256,
    source_config_sha256: configFingerprint(inputs.config), prepared_config_sha256: configFingerprint(preparedConfig),
    runtime_evidence_sha256: runtimeEvidenceFingerprint(inputs.evidence), lifecycle_state_digest: inputs.evidence.lifecycle_state_digest };
}

async function assertInputsUnchanged(selected, inputs) {
  if ((await readJson(selected.config_path)).sha256 !== inputs.source.sha256 ||
      (await readJson(selected.evidence_path)).sha256 !== inputs.evidenceFile.sha256) fail('PROOF_INPUT_CHANGED_DURING_VALIDATION');
}

/** Read-only preparation checks. Never loads a signer, creates state, or changes a lock. */
export async function planControlledProof(options) {
  deadlines(options);
  if (options.ownedProcesses !== undefined && (!Array.isArray(options.ownedProcesses) || options.ownedProcesses.length)) fail('PROOF_PREPARATION_REQUIRES_STOPPED_PROCESSES');
  const selected = await paths(options, { fresh: true });
  const inputs = await inputState(options, selected);
  const preflight = await refresh(options, selected, inputs);
  const preparedConfig = validateConfig({ ...inputs.config, start_block: preflight.block_number,
    start_time: new Date(clock(options)).toISOString(), stop_time: new Date(options.stopNewGamesAtMs).toISOString(),
    intermission_ms: 0 });
  await assertInputsUnchanged(selected, inputs);
  deadlines(options);
  return { schema_version: 1, status: 'ready', bindings: bindingsFor(options, selected, inputs, preparedConfig), preflight, preparedConfig };
}

async function writeExclusive(filename, value) {
  let handle;
  try {
    handle = await open(filename, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync();
  } catch { fail('PROOF_EXCLUSIVE_WRITE_FAILED'); }
  finally { await handle?.close(); }
}

async function syncDirectory(directory) {
  const handle = await open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

/** A new directory is the prepare transaction. Partial failures remain for inspection. */
export async function prepareControlledProof(options) {
  const plan = await planControlledProof(options);
  deadlines(options);
  try { await mkdir(plan.bindings.directory, { mode: 0o700 }); }
  catch { fail('PROOF_DIRECTORY_EXISTS'); }
  await syncDirectory(path.dirname(plan.bindings.directory));
  await writeExclusive(path.join(plan.bindings.directory, 'config.json'), plan.preparedConfig);
  await writeExclusive(path.join(plan.bindings.directory, 'preflight.json'), plan.preflight);
  await writeExclusive(path.join(plan.bindings.directory, 'proof-bindings.json'), plan.bindings);
  await syncDirectory(plan.bindings.directory);
  return { ...plan, status: 'prepared' };
}

/** Read-only status gate: recompute exact input bindings and independently refresh current state. */
export async function validatePreparedProof(options) {
  deadlines(options);
  const selected = await paths(options, { fresh: false });
  if (await existing(path.join(selected.directory, 'launch-once.json'))) fail('PROOF_ONE_GAME_FUSE_USED');
  const inputs = await inputState(options, selected);
  const preparedFile = await readJson(path.join(selected.directory, 'config.json'));
  const preparedConfig = preparedFile.value;
  validateConfig(preparedConfig);
  const bindingsFile = await readJson(path.join(selected.directory, 'proof-bindings.json'));
  const bindings = bindingsFile.value;
  const expected = bindingsFor(options, selected, inputs, preparedConfig);
  if (configFingerprint(bindings) !== configFingerprint(expected)) fail('PROOF_BINDINGS_CHANGED');
  if (preparedConfig.stop_time !== new Date(options.stopNewGamesAtMs).toISOString() ||
      preparedConfig.intermission_ms !== 0) fail('PROOF_PREPARED_CONFIG_INVALID');
  const preflight = await refresh(options, selected, inputs);
  await assertInputsUnchanged(selected, inputs);
  if ((await readJson(path.join(selected.directory, 'config.json'))).sha256 !== preparedFile.sha256 ||
      (await readJson(path.join(selected.directory, 'proof-bindings.json'))).sha256 !== bindingsFile.sha256) fail('PROOF_INPUT_CHANGED_DURING_VALIDATION');
  deadlines(options);
  return { schema_version: 1, status: 'ready', bindings, preflight, preparedConfig };
}

/** Only a verified current lifecycle may cross this boundary. The one-game fuse survives every outcome. */
export async function createGuardedLauncher(options) {
  if (typeof options.launcher?.create !== 'function') fail('PROOF_LAUNCHER_REQUIRED');
  // Ownership capabilities remain in memory and are pinned before validation;
  // no token can enter evidence, bindings, the fuse, or a returned status.
  options = { ...options, ownedProcesses: structuredClone(options.ownedProcesses ?? []) };
  const prepared = await validatePreparedProof(options);
  const pinnedBindings = configFingerprint(prepared.bindings);
  return Object.freeze({ create: async intent => {
    if (!intent || Object.keys(intent).sort().join() !== 'action_id,source_block_number' ||
        !/^[a-zA-Z0-9:._-]{1,200}$/.test(intent.action_id ?? '') || !UINT.test(intent.source_block_number ?? '')) fail('PROOF_CREATE_INTENT_INVALID');
    const current = await validatePreparedProof(options);
    if (configFingerprint(current.bindings) !== pinnedBindings) fail('PROOF_BINDINGS_CHANGED');
    if (BigInt(intent.source_block_number) > BigInt(current.preflight.block_number)) fail('PROOF_CREATE_SOURCE_BLOCK_INVALID');
    deadlines(options);
    await writeExclusive(path.join(current.bindings.directory, 'launch-once.json'), {
      schema_version: 1, maximum_fresh_games: 1, bindings_sha256: pinnedBindings,
      runtime_evidence_sha256: current.bindings.runtime_evidence_sha256,
      action_id: intent.action_id, source_block_number: intent.source_block_number,
      attempted_at: new Date(clock(options)).toISOString()
    });
    await syncDirectory(current.bindings.directory);
    deadlines(options);
    const source = await readJson(current.bindings.config_path);
    const evidence = await readJson(current.bindings.evidence_path);
    if (source.sha256 !== current.bindings.source_config_file_sha256 || evidence.sha256 !== current.bindings.runtime_evidence_file_sha256) fail('PROOF_BINDINGS_CHANGED');
    const latestPrepared = await readJson(path.join(current.bindings.directory, 'config.json'));
    const latestBindings = await readJson(path.join(current.bindings.directory, 'proof-bindings.json'));
    if (configFingerprint(latestPrepared.value) !== current.bindings.prepared_config_sha256 ||
        configFingerprint(latestBindings.value) !== pinnedBindings) fail('PROOF_BINDINGS_CHANGED');
    await inspectProcesses(current.bindings, options.ownedProcesses);
    validateControlledRuntimeEvidence(source.value, evidence.value, { now: clock(options), allowDiagnosticsOnly: true });
    const result = await bounded(options, () => options.launcher.create(structuredClone(intent)), 'PROOF_CREATION_UNCERTAIN');
    if (!['accepted', 'race-or-revert', 'rejected-before-submit'].includes(result?.status) ||
        (result.reference !== undefined && (result.reference?.kind !== 'transaction-hash' || !HASH.test(result.reference.value ?? '')))) fail('PROOF_CREATION_UNCERTAIN');
    return { status: result.status, ...(result.reference ? { reference: { kind: 'transaction-hash', value: result.reference.value } } : {}) };
  } });
}
