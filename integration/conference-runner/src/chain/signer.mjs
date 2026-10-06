import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Contract, getAddress, keccak256 } from 'ethers';
import { GAME_ABI, CONFIG_FIELDS } from './abi.mjs';
import { createChainReader, assertChainConfig, verifyBaseSepoliaRpc } from './reader.mjs';
import { assertSignerDeployment, PINNED_DEPLOYMENT, prepareSignerDirectory } from './guards.mjs';
import { chainFailureCode, safeChainDiagnostic } from './diagnostics.mjs';

const decimal = /^(0|[1-9][0-9]*)$/;
const hash = /^0x[0-9a-fA-F]{64}$/;
const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
const fingerprint = (value) => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const ref = (record) => record.hash ? { reference: { kind: 'transaction-hash', value: record.hash } } : {};
const result = (record) => ({ status: record.status, ...ref(record),
  ...(safeChainDiagnostic(record.diagnostic) ? { diagnostic: safeChainDiagnostic(record.diagnostic) } : {}) });
function exact(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) throw new Error('INVALID_SIGNER_REQUEST');
}
function validateIntent(operation, intent) {
  const deadlineField = Object.hasOwn(intent ?? {}, 'not_after_ms') ? ['not_after_ms'] : [];
  if (deadlineField.length && (!Number.isSafeInteger(intent.not_after_ms) || intent.not_after_ms < 1)) throw new Error('INVALID_SIGNER_DEADLINE');
  if (operation !== 'advance') exact(intent, ['action_id', 'source_block_number', ...deadlineField]);
  else {
    exact(intent, ['schema_version', 'type', 'action_id', 'attempt_id', 'game_id', 'round', 'phase', 'source_block_number', 'source_block_hash', 'source_predicate_token', 'reason', ...deadlineField]);
    if (intent.schema_version !== 1 || intent.type !== 'advance-request' || !['join', 'commit', 'reveal'].includes(intent.phase) || !decimal.test(intent.game_id) || !Number.isInteger(intent.round) || intent.round < 0 || !hash.test(intent.source_block_hash) || !/^[a-f0-9]{64}$/.test(intent.source_predicate_token)) throw new Error('INVALID_ADVANCE_REQUEST');
    const action = `advance:${fingerprint({ game_id: intent.game_id, round: intent.round, phase: intent.phase })}`;
    const attempt = `${action}:${fingerprint({ block_number: intent.source_block_number, block_hash: intent.source_block_hash })}`;
    if (intent.action_id !== action || intent.attempt_id !== attempt || typeof intent.reason !== 'string' || intent.reason.length > 100) throw new Error('INVALID_ADVANCE_IDENTITY');
  }
  if (typeof intent.action_id !== 'string' || !/^[a-zA-Z0-9:._-]{1,200}$/.test(intent.action_id) || typeof intent.source_block_number !== 'string' || !decimal.test(intent.source_block_number)) throw new Error('INVALID_SIGNER_IDENTITY');
}

async function writeAtomic(filename, value) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, filename);
  const directory = await open(path.dirname(filename), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

/** The operator serializes owner creation and phase advancement in one journal. */
export async function createIsolatedSigner({ role, config, provider, signer, directory, deployment = PINNED_DEPLOYMENT, now = Date.now }) {
  if (!['operator', 'launcher', 'phase-executor'].includes(role)) throw new Error('INVALID_SIGNER_ROLE');
  if (typeof now !== 'function') throw new Error('INVALID_SIGNER_CLOCK');
  assertChainConfig(config);
  assertSignerDeployment(config, deployment);
  const signerAddress = getAddress(await signer.getAddress());
  if ((config.roster ?? []).some((seat) => seat.wallet_address.toLowerCase() === signerAddress.toLowerCase())) throw new Error('PLAYER_SIGNER_FORBIDDEN');
  if (['operator', 'launcher'].includes(role) && signerAddress.toLowerCase() !== config.expected_owner.toLowerCase()) throw new Error('OWNER_SIGNER_REQUIRED');
  if (role === 'phase-executor' && signerAddress.toLowerCase() === config.expected_owner.toLowerCase()) throw new Error('SEPARATE_PHASE_SIGNER_REQUIRED');
  directory = await prepareSignerDirectory(directory);
  const lockPath = path.join(directory, 'signer.lock');
  const lockToken = randomUUID();
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const previous = JSON.parse(await readFile(lockPath, 'utf8'));
    if (!Number.isInteger(previous.pid) || previous.pid <= 0) throw new Error('SIGNER_LOCK_INVALID');
    try { process.kill(previous.pid, 0); throw new Error('SIGNER_ALREADY_RUNNING'); } catch (probe) {
      if (probe.code !== 'ESRCH') throw probe;
    }
    // Check the recorded identity again before removing a dead process's lock.
    if (JSON.parse(await readFile(lockPath, 'utf8')).token !== previous.token) throw new Error('SIGNER_LOCK_RACE');
    await unlink(lockPath);
    lock = await open(lockPath, 'wx', 0o600);
  }
  await lock.writeFile(JSON.stringify({ pid: process.pid, token: lockToken }));
  await lock.sync(); await lock.close();
  const journalPath = path.join(directory, 'transactions.json');
  let journal = { schema_version: 1, role, chain_id: 84532, contract: getAddress(config.game_address), signer: signerAddress, records: {} };
  try {
    const saved = JSON.parse(await readFile(journalPath, 'utf8'));
    if (saved.schema_version !== 1 || saved.role !== role || saved.chain_id !== 84532 || saved.contract !== journal.contract || saved.signer !== signerAddress || !saved.records) throw new Error('SIGNER_JOURNAL_IDENTITY_MISMATCH');
    journal = saved;
  } catch (error) {
    if (error.code !== 'ENOENT') { await unlink(lockPath); throw error; }
  }
  const persist = () => writeAtomic(journalPath, journal);
  const reader = createChainReader({ config: { ...config, confirmations: 1 }, provider });
  const contract = new Contract(config.game_address, GAME_ABI, provider);
  let tail = Promise.resolve();
  let closed = false;
  async function reconcile(record) {
    const startedAt = now();
    await verifyBaseSepoliaRpc(provider);
    if (!record.hash) {
      // No broadcast is reachable before the hash has been durably saved.
      if (record.stage === 'reserved') { record.status = 'rejected-before-submit'; record.stage = 'rejected'; await persist(); }
      return result(record);
    }
    if (record.stage === 'confirmed') return result(record);
    const receipt = await provider.getTransactionReceipt(record.hash);
    if (receipt) {
      const tip = await provider.getBlockNumber();
      const canonical = await provider.getBlock(receipt.blockNumber);
      if (canonical?.hash === receipt.blockHash && tip - receipt.blockNumber + 1 >= (config.confirmations ?? 2)) {
        record.status = Number(receipt.status) === 1 ? 'accepted' : 'confirmed-revert';
        if (record.status === 'confirmed-revert') record.diagnostic ??= { stage: 'confirmation', code: 'TRANSACTION_REVERTED', elapsed_ms: Math.max(0, now() - startedAt) };
        record.stage = 'confirmed'; await persist(); return result(record);
      }
    }
    const transaction = await provider.getTransaction(record.hash);
    record.status = transaction ? 'accepted' : 'race-or-revert';
    record.stage = 'uncertain';
    record.observed_nonce = await provider.getTransactionCount(signerAddress, 'latest');
    await persist();
    return result(record);
  }
  async function submit(operation, intent, configure, signal) {
    if (closed) throw new Error('SIGNER_CLOSED');
    validateIntent(operation, intent);
    const key = fingerprint(intent.action_id);
    const existing = journal.records[key];
    if (existing) {
      const existingOperation = existing.operation ?? (role === 'phase-executor' ? 'advance' : existing.intent.action_id.startsWith('configure:') ? 'configure-defaults' : 'create');
      if (existingOperation !== operation) return { status: 'rejected-before-submit' };
    }
    // A semantic action keeps its earliest accepted expiry across retries,
    // including a replay which omits the optional deadline entirely.
    const originalDeadline = existing?.intent?.not_after_ms;
    if (originalDeadline !== undefined && (!Number.isSafeInteger(originalDeadline) || originalDeadline < 1)) throw new Error('INVALID_SIGNER_DEADLINE');
    const expiry = Math.min(originalDeadline ?? Infinity, intent.not_after_ms ?? Infinity);
    intent = Object.freeze({ ...intent, ...(expiry === Infinity ? {} : { not_after_ms: expiry }) });
    if (existing && expiry !== Infinity && existing.intent.not_after_ms !== expiry) {
      existing.intent = { ...existing.intent, not_after_ms: expiry };
      await persist();
    }
    // Persist a new bounded action's expiry before any awaited reconciliation.
    // A provider failure or queue obstruction cannot erase the original bound.
    if (!existing && expiry !== Infinity) {
      journal.records[key] = { operation, intent, stage: 'reserved', status: 'rejected-before-submit' };
      await persist();
    }
    const rejectCurrent = async (code = 'SIGNER_EXECUTION_EXPIRED') => {
      if (existing) return result(existing);
      journal.records[key] = { operation, intent, stage: 'rejected', status: 'rejected-before-submit',
        diagnostic: { stage: 'signer_request', code, elapsed_ms: 0 } };
      await persist();
      return result(journal.records[key]);
    };
    const permitted = () => {
      const current = now();
      return Number.isSafeInteger(current) && current >= 0 && !signal?.aborted && current < expiry;
    };
    const assertPermitted = () => { if (!permitted()) throw new Error('SIGNER_EXECUTION_EXPIRED'); };
    if (!permitted()) return rejectCurrent();
    if (existing) {
      await reconcile(existing);
      if (!permitted()) return result(existing);
      if (!['confirmed-revert', 'rejected-before-submit'].includes(existing.status) || BigInt(intent.source_block_number) <= BigInt(existing.intent.source_block_number)) return result(existing);
    }
    // A pending/unknown nonce for any action prevents all additional submissions.
    for (const [otherKey, other] of Object.entries(journal.records)) {
      if (otherKey === key || other.stage === 'confirmed' || other.stage === 'rejected') continue;
      await reconcile(other);
      if (!permitted()) return rejectCurrent();
      if (other.stage !== 'confirmed' && other.stage !== 'rejected') return rejectCurrent('SIGNER_UNRESOLVED_OPERATION');
    }
    const record = { operation, intent, stage: 'reserved', status: 'rejected-before-submit' };
    journal.records[key] = record;
    await persist(); // Intent precedes RPC estimation, signing, and broadcast.
    const startedAt = now();
    let diagnosticStage = 'preflight';
    const diagnose = error => { record.diagnostic ??= {
      stage: diagnosticStage, code: chainFailureCode(error), elapsed_ms: Math.max(0, now() - startedAt) }; };
    try {
      assertPermitted();
      const preflight = await reader.preflight();
      assertPermitted();
      if (BigInt(intent.source_block_number) > BigInt(preflight.block_number)) throw new Error('FUTURE_SOURCE_BLOCK');
      let tx;
      if (operation !== 'advance') {
        if (preflight.active_game_id !== '0') throw new Error('GAME_ALREADY_ACTIVE');
        if (operation === 'configure-defaults') {
          exact(configure, CONFIG_FIELDS);
          for (const field of CONFIG_FIELDS) if (!decimal.test(String(configure[field]))) throw new Error('INVALID_DEFAULT_CONFIG');
          for (const field of ['creatorFeeBps', 'causeFeeBps']) if (String(configure[field]) !== preflight.config[field]) throw new Error('FEE_BPS_MUST_BE_PRESERVED');
          tx = await contract.configureDefaults.populateTransaction(CONFIG_FIELDS.map((field) => configure[field]));
        } else tx = await contract.createGame.populateTransaction();
      } else {
        diagnosticStage = 'phase_check';
        if (preflight.active_game_id !== intent.game_id) throw new Error('ACTIVE_GAME_CHANGED');
        const sourceBlock = await provider.getBlock(Number(intent.source_block_number));
        assertPermitted();
        if (sourceBlock?.hash?.toLowerCase() !== intent.source_block_hash.toLowerCase()) throw new Error('SOURCE_BLOCK_REORGED');
        const snapshot = await reader.readSnapshot({ gameId: intent.game_id });
        assertPermitted();
        if (snapshot.phase !== intent.phase || snapshot.round !== intent.round || !await contract.canAdvancePhase(intent.game_id, { blockTag: Number(snapshot.block_number) })) throw new Error('PHASE_NOT_ELIGIBLE');
        tx = await contract.advancePhase.populateTransaction(intent.game_id);
      }
      assertPermitted();
      diagnosticStage = 'nonce_check';
      const [latestNonce, pendingNonce] = await Promise.all([provider.getTransactionCount(signerAddress, 'latest'), provider.getTransactionCount(signerAddress, 'pending')]);
      assertPermitted();
      if (latestNonce !== pendingNonce) throw new Error('UNTRACKED_PENDING_SIGNER_NONCE');
      diagnosticStage = 'prepare_transaction';
      const populated = await signer.populateTransaction({ ...tx, chainId: 84532, value: 0n });
      assertPermitted();
      if (Number(populated.chainId) !== 84532 || getAddress(populated.to) !== getAddress(config.game_address) || BigInt(populated.value ?? 0) !== 0n || Number(populated.nonce) !== pendingNonce) throw new Error('UNSAFE_POPULATED_TRANSACTION');
      await verifyBaseSepoliaRpc(provider);
      assertPermitted();
      diagnosticStage = 'sign';
      const raw = await signer.signTransaction(populated);
      record.nonce = Number(populated.nonce);
      record.hash = keccak256(raw);
      record.stage = 'prepared'; record.status = 'race-or-revert';
      // The raw transaction and key never enter coordinator state or this journal.
      await persist();
      try {
        diagnosticStage = 'broadcast';
        assertPermitted();
        await verifyBaseSepoliaRpc(provider);
        assertPermitted();
        const broadcast = await provider.broadcastTransaction(raw);
        if (broadcast.hash.toLowerCase() !== record.hash.toLowerCase()) throw new Error('BROADCAST_HASH_MISMATCH');
        record.stage = 'broadcast'; record.status = 'accepted';
      } catch (error) { diagnose(error); record.stage = 'uncertain'; record.status = 'race-or-revert'; }
      await persist();
      return result(record);
    } catch (error) {
      diagnose(error);
      // If a hash has been saved, a broadcast may have occurred. Never call it a safe retry.
      record.status = record.hash ? 'race-or-revert' : 'rejected-before-submit';
      record.stage = record.hash ? 'uncertain' : 'rejected';
      await persist();
      return result(record);
    }
  }
  const serialized = (fn) => { const pending = tail.then(fn); tail = pending.catch(() => {}); return pending; };
  return Object.freeze({
    create: (intent, { signal } = {}) => {
      if (!['operator', 'launcher'].includes(role)) throw new Error('ROLE_OPERATION_FORBIDDEN');
      const captured = Object.freeze(structuredClone(intent));
      return serialized(() => submit('create', captured, undefined, signal));
    },
    advance: (intent, { signal } = {}) => {
      if (!['operator', 'phase-executor'].includes(role)) throw new Error('ROLE_OPERATION_FORBIDDEN');
      const captured = Object.freeze(structuredClone(intent));
      return serialized(() => submit('advance', captured, undefined, signal));
    },
    configureDefaults: ({ action_id, source_block_number, defaults }) => {
      if (!['operator', 'launcher'].includes(role)) throw new Error('ROLE_OPERATION_FORBIDDEN');
      return serialized(() => submit('configure-defaults', { action_id, source_block_number }, defaults));
    },
    reconcile: () => serialized(async () => {
      const statuses = [];
      for (const record of Object.values(journal.records)) statuses.push({ action_id: record.intent.action_id, ...await reconcile(record) });
      return statuses;
    }),
    close: async () => {
      closed = true; await tail;
      try {
        if (JSON.parse(await readFile(lockPath, 'utf8')).token === lockToken) await unlink(lockPath);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    },
  });
}
