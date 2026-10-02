import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath, link, unlink } from 'node:fs/promises';
import path from 'node:path';
import { REPOSITORY_ROOT, validateConfig } from './config.mjs';
import { configFingerprint, runtimeEvidenceFingerprint, validateControlledRuntimeEvidence } from './readiness.mjs';
import { auditControlledProof } from './proof-audit.mjs';
import { auditPinnedScoreboards } from './telegram/proof-audit.mjs';

const DIGEST = /^[0-9a-f]{64}$/;
const TX = /^0x[0-9a-fA-F]{64}$/;
const UINT = /^(0|[1-9][0-9]*)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
const same = (a, b) => runtimeEvidenceFingerprint(a) === runtimeEvidenceFingerprint(b);
class AuditInputError extends Error { constructor(code) { super(code); this.code = code; } }
function ensure(value, code) { if (!value) throw new AuditInputError(code); }
const contained = (parent, child) => {
  const part = path.relative(parent, child);
  return part === '' || (part !== '..' && !part.startsWith(`..${path.sep}`) && !path.isAbsolute(part));
};

async function canonical(value, { directory = false, outside = false, fresh = false } = {}) {
  ensure(typeof value === 'string' && path.isAbsolute(value) && path.resolve(value) === value && !/[\0\r\n]/.test(value), 'PROOF_RUN_AUDIT_PATH_INVALID');
  try {
    if (fresh) {
      ensure(await realpath(path.dirname(value)) === path.dirname(value), 'PROOF_RUN_AUDIT_PATH_INVALID');
      try { await lstat(value); throw new AuditInputError('PROOF_RUN_AUDIT_OUTPUT_EXISTS'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    } else {
      const metadata = await lstat(value);
      ensure(!metadata.isSymbolicLink() && (directory ? metadata.isDirectory() : metadata.isFile()) && await realpath(value) === value,
        'PROOF_RUN_AUDIT_PATH_INVALID');
    }
    if (outside) {
      const repository = await realpath(REPOSITORY_ROOT);
      ensure(!contained(repository, value) && !contained(value, repository), 'PROOF_RUN_AUDIT_OUTSIDE_REPOSITORY_REQUIRED');
    }
    return value;
  } catch (error) { if (error instanceof AuditInputError) throw error; throw new AuditInputError('PROOF_RUN_AUDIT_PATH_INVALID'); }
}

async function readJson(filename) {
  let handle;
  try {
    await canonical(filename);
    handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat();
    ensure(before.isFile() && before.nlink === 1 && before.size > 0 && before.size <= MAX_INPUT_BYTES, 'PROOF_RUN_AUDIT_FILE_INVALID');
    const bytes = await handle.readFile();
    const after = await handle.stat();
    ensure(bytes.length === before.size && after.size === before.size && after.mtimeMs === before.mtimeMs &&
      after.ino === before.ino && after.dev === before.dev, 'PROOF_RUN_AUDIT_INPUT_CHANGED');
    return { value: JSON.parse(bytes), sha256: digest(bytes) };
  } catch (error) { if (error instanceof AuditInputError) throw error; throw new AuditInputError('PROOF_RUN_AUDIT_FILE_INVALID'); }
  finally { await handle?.close(); }
}

async function writeExclusive(filename, value) {
  const temporary = path.join(path.dirname(filename), `.proof-audit-${randomUUID()}.tmp`);
  let handle;
  try {
    await canonical(filename, { fresh: true, outside: true });
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync(); await handle.close(); handle = undefined;
    // A hard link publishes complete fsynced bytes atomically and refuses an
    // existing target. Rename alone could overwrite another audit's output.
    await link(temporary, filename);
    await unlink(temporary);
    const directory = await open(path.dirname(filename), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } catch (error) {
    if (error instanceof AuditInputError) throw error;
    throw new AuditInputError(error.code === 'EEXIST' ? 'PROOF_RUN_AUDIT_OUTPUT_EXISTS' : 'PROOF_RUN_AUDIT_WRITE_FAILED');
  } finally { await handle?.close().catch(() => {}); await unlink(temporary).catch(() => {}); }
}

const CHAIN_ISSUES = new Set(['PROOF_AUDIT_INPUT_INVALID', 'PROOF_CREATION_UNVERIFIED', 'PROOF_CHAIN_MISMATCH',
  'PROOF_CHAIN_UNCONFIRMED', 'PROOF_CHAIN_REORG', 'PROOF_RECEIPT_UNVERIFIED', 'PROOF_CHAIN_LOG_INVALID',
  'PROOF_RESULT_UNVERIFIED', 'PROOF_ROSTER_UNVERIFIED', 'PROOF_DEFAULTED_ACTIONS', 'PROOF_ACTIONS_UNVERIFIED',
  'PROOF_PLAYER_RECEIPT_UNVERIFIED', 'PROOF_DISPATCH_UNVERIFIED', 'PROOF_TELEGRAM_SCOPE_MISMATCH',
  'PROOF_TELEGRAM_UNDELIVERED', 'PROOF_DISCUSSION_UNVERIFIED', 'PROOF_RESULT_DELIVERY_UNVERIFIED', 'PROOF_AUDIT_UNAVAILABLE']);
const SCOREBOARD_ISSUES = new Set(['SCOREBOARD_CANONICAL_PROOF_REQUIRED', 'SCOREBOARD_BINDINGS_INVALID',
  'SCOREBOARD_LEDGER_SCOPE_MISMATCH', 'SCOREBOARD_LEDGER_UNHEALTHY', 'SCOREBOARD_DUPLICATE_RESULTS',
  'SCOREBOARD_GAME_RESULT_MISMATCH', 'SCOREBOARD_HEALTH_UNVERIFIED', 'SCOREBOARD_AWARDS_UNVERIFIED',
  'SCOREBOARD_WINNER_UNVERIFIED', 'SCOREBOARD_GAME_AWARDS_MISMATCH', 'SCOREBOARD_RESULT_RECEIPT_UNVERIFIED',
  'SCOREBOARD_RESULT_BLOCK_REORG', 'SCOREBOARD_CHAIN_ROSTER_MISMATCH', 'SCOREBOARD_CHAIN_AWARDS_MISMATCH',
  'SCOREBOARD_HEALTH_TOTALS_MISMATCH', 'SCOREBOARD_PIN_UNDELIVERED', 'SCOREBOARD_TOKEN_UNAVAILABLE',
  'SCOREBOARD_PIN_READBACK_MISMATCH', 'SCOREBOARD_CHAT_UNVERIFIED', 'SCOREBOARD_READBACK_UNAVAILABLE', 'SCOREBOARD_AUDIT_UNAVAILABLE']);

function cleanAudit(value, gameId, scoreboard) {
  const known = scoreboard ? SCOREBOARD_ISSUES : CHAIN_ISSUES;
  ensure(value && value.schema_version === 1 && value.game_id === gameId && typeof value.proof_complete === 'boolean' &&
    Array.isArray(value.issues) && value.issues.every(issue => known.has(issue)), 'PROOF_RUN_AUDIT_RESULT_INVALID');
  const result = { schema_version: 1, proof_complete: value.proof_complete, game_id: gameId, issues: [...value.issues] };
  const booleans = scoreboard ? ['ledger_verified', 'chain_awards_verified', 'telegram_verified'] : ['chain_verified', 'telegram_verified'];
  for (const key of booleans) {
    ensure(typeof value[key] === 'boolean', 'PROOF_RUN_AUDIT_RESULT_INVALID'); result[key] = value[key];
  }
  for (const key of scoreboard ? ['result_transaction_hash'] : ['creation_transaction_hash', 'result_transaction_hash']) {
    ensure(value[key] == null || TX.test(value[key]), 'PROOF_RUN_AUDIT_RESULT_INVALID'); result[key] = value[key]?.toLowerCase() ?? null;
  }
  if (!scoreboard) {
    ensure(value.confirmed_block_number == null || typeof value.confirmed_block_number === 'string' && UINT.test(value.confirmed_block_number), 'PROOF_RUN_AUDIT_RESULT_INVALID');
    result.confirmed_block_number = value.confirmed_block_number ?? null;
    for (const key of ['joined_count', 'committed_seat_count', 'revealed_seat_count', 'round_count', 'defaulted_count', 'discussion_message_count']) {
      ensure(Number.isSafeInteger(value[key]) && value[key] >= 0, 'PROOF_RUN_AUDIT_RESULT_INVALID'); result[key] = value[key];
    }
    if (value.result_message_ids !== undefined) {
      ensure(Array.isArray(value.result_message_ids) && value.result_message_ids.length <= 2, 'PROOF_RUN_AUDIT_RESULT_INVALID');
      result.result_message_ids = value.result_message_ids.map(row => {
        ensure(['openclaw', 'hermes'].includes(row?.team) && Number.isSafeInteger(row.message_id) && row.message_id > 0, 'PROOF_RUN_AUDIT_RESULT_INVALID');
        return { team: row.team, message_id: row.message_id };
      });
    }
    if (value.seats !== undefined) {
      ensure(Array.isArray(value.seats) && value.seats.length <= 20, 'PROOF_RUN_AUDIT_RESULT_INVALID');
      result.seats = value.seats.map(row => {
        ensure(/^(?:oc|hs)-(?:[1-9]|10)$/.test(row?.seat_id ?? '') &&
          ['joined', 'committed', 'revealed', 'discussion_delivered'].every(key => typeof row[key] === 'boolean') &&
          (row.join_transaction_hash === null || TX.test(row.join_transaction_hash)) &&
          ['commit_transaction_hashes', 'reveal_transaction_hashes'].every(key => Array.isArray(row[key]) && row[key].every(hash => TX.test(hash))) &&
          Array.isArray(row.discussion_message_ids) && row.discussion_message_ids.every(id => Number.isSafeInteger(id) && id > 0), 'PROOF_RUN_AUDIT_RESULT_INVALID');
        return { seat_id: row.seat_id, joined: row.joined, committed: row.committed, revealed: row.revealed,
          discussion_delivered: row.discussion_delivered, join_transaction_hash: row.join_transaction_hash,
          commit_transaction_hashes: [...row.commit_transaction_hashes], reveal_transaction_hashes: [...row.reveal_transaction_hashes],
          discussion_message_ids: [...row.discussion_message_ids] };
      });
    }
  } else if (value.pins !== undefined) {
    ensure(Array.isArray(value.pins) && value.pins.length <= 2, 'PROOF_RUN_AUDIT_RESULT_INVALID');
    result.pins = value.pins.map(pin => {
      ensure(['openclaw', 'hermes'].includes(pin?.team) && /^-\d+$/.test(pin.chat_id ?? '') &&
        Number.isSafeInteger(pin.message_id) && pin.message_id > 0 && DIGEST.test(pin.text_sha256 ?? '') &&
        typeof pin.verified_at === 'string' && Number.isFinite(Date.parse(pin.verified_at)), 'PROOF_RUN_AUDIT_RESULT_INVALID');
      return { team: pin.team, chat_id: pin.chat_id, message_id: pin.message_id, text_sha256: pin.text_sha256, verified_at: pin.verified_at };
    });
  }
  if (value.proof_complete) ensure(value.issues.length === 0 && booleans.every(key => value[key] === true) &&
    TX.test(result.result_transaction_hash ?? ''), 'PROOF_RUN_AUDIT_RESULT_INVALID');
  return result;
}

// Independently reconstruct the complete serial continuity journal. A matching
// digest authenticates a particular record; it does not establish its coverage.
function verifyContinuityHistory(record, { config, evidence, binding, fuse }) {
  const code = 'PROOF_RUN_AUDIT_VERIFICATION_MISMATCH';
  ensure(exact(record, ['schema_version', 'verification_id', 'continuity_policy', 'evidence_sha256',
    'lifecycle_state_digest', 'status', 'started_at_ms', 'deadline_at_ms', 'cleanup_deadline_at_ms',
    'all_seats_sleeping', 'operations', 'completed_at_ms']) && record.schema_version === 1 &&
    UUID.test(record.verification_id ?? '') && runtimeEvidenceFingerprint(record) === fuse.verification_sha256 &&
    record.status === 'complete' && record.all_seats_sleeping === true &&
    record.evidence_sha256 === binding.runtime_evidence_sha256 && record.lifecycle_state_digest === binding.lifecycle_state_digest &&
    record.continuity_policy === evidence.continuity_policy &&
    ['started_at_ms', 'completed_at_ms', 'deadline_at_ms', 'cleanup_deadline_at_ms'].every(key => Number.isSafeInteger(record[key])) &&
    record.started_at_ms >= Math.max(Date.parse(evidence.verified_at), Date.parse(config.start_time)) &&
    record.completed_at_ms >= record.started_at_ms && record.completed_at_ms <= Date.parse(fuse.attempted_at) &&
    record.deadline_at_ms === binding.stop_new_games_at_ms && record.completed_at_ms < record.deadline_at_ms &&
    record.cleanup_deadline_at_ms === Math.min(binding.hard_stop_at_ms, binding.stop_new_games_at_ms + 60_000) &&
    record.cleanup_deadline_at_ms > record.deadline_at_ms && Array.isArray(record.operations), code);
  const operations = record.operations;
  const expected = [];
  for (const seat of config.roster) {
    expected.push({ kind: 'inventory', seat_id: null });
    for (const kind of ['activation', 'lifecycle-read', 'activation-settle', 'continuity-check', 'lifecycle-read',
      ...Array(9).fill('runtime-read'), 'lifecycle-read', 'sleep', 'lifecycle-read']) {
      expected.push({ kind, seat_id: seat.seat_id });
    }
  }
  expected.push({ kind: 'inventory', seat_id: null }, { kind: 'chain-revalidation', seat_id: null });
  ensure(config.roster.length === 10 && expected.length === 182 && operations.length === expected.length, code);
  for (let index = 0; index < expected.length; index++) {
    const operation = operations[index], previous = operations[index - 1], next = operations[index + 1];
    ensure(exact(operation, ['sequence', 'kind', 'seat_id', 'status', 'started_at_ms', 'completed_at_ms']) &&
      operation.sequence === index + 1 && operation.kind === expected[index].kind && operation.seat_id === expected[index].seat_id &&
      operation.status === 'complete' && Number.isSafeInteger(operation.started_at_ms) && Number.isSafeInteger(operation.completed_at_ms) &&
      operation.started_at_ms >= (previous?.started_at_ms ?? record.started_at_ms) &&
      operation.completed_at_ms >= operation.started_at_ms && operation.completed_at_ms <= record.completed_at_ms, code);
    if (operation.kind === 'continuity-check') {
      // A continuity check encloses initial lifecycle, nine runtime reads and
      // final lifecycle, then completes before the seat's sleep begins.
      const finalNestedRead = operations[index + 11], sleep = operations[index + 12];
      ensure(operation.completed_at_ms >= finalNestedRead?.completed_at_ms && operation.completed_at_ms <= sleep?.started_at_ms, code);
    } else if (next) ensure(operation.completed_at_ms <= next.started_at_ms, code);
  }
}

/** Independent read-only audit of a completed prepared run. It deliberately does
 * not invoke today's creation gates or overwrite any historical evidence. */
export async function auditProofRun({ directory, gameId, scoreboardBindingsPath, outputPath, provider, token, fetchImpl,
  auditChain = auditControlledProof, auditScoreboards = auditPinnedScoreboards } = {}) {
  // Refuse an existing or unsafe output before contacting any external adapter.
  await canonical(outputPath, { fresh: true, outside: true });
  const result = { schema_version: 1, type: 'controlled-proof-audit', proof_complete: false,
    game_id: typeof gameId === 'string' && /^[1-9][0-9]*$/.test(gameId) ? gameId : null,
    verified_at: new Date().toISOString(), input_digests: {}, chain_audit: null, scoreboard_audit: null, issues: [] };
  const files = new Map();
  const read = async filename => {
    const value = await readJson(filename); files.set(filename, value.sha256); return value;
  };
  try {
    ensure(result.game_id && typeof auditChain === 'function' && typeof auditScoreboards === 'function' && provider,
      'PROOF_RUN_AUDIT_INPUT_INVALID');
    await canonical(directory, { directory: true, outside: true });
    const prepared = await read(path.join(directory, 'config.json'));
    const manifest = await read(path.join(directory, 'proof-bindings.json'));
    const consumed = await read(path.join(directory, 'launch-once.json'));
    const reportFile = await read(path.join(directory, 'proof-run.json'));
    result.input_digests = { report_file_sha256: reportFile.sha256, prepared_config_file_sha256: prepared.sha256,
      proof_bindings_file_sha256: manifest.sha256, fuse_file_sha256: consumed.sha256 };
    const binding = manifest.value, fuse = consumed.value, report = reportFile.value;
    const bindingKeys = ['schema_version', 'config_path', 'evidence_path', 'readiness_directory', 'operator_directory',
      'runner_directories', 'directory', 'verification_root', 'stop_new_games_at_ms', 'hard_stop_at_ms', 'source_config_file_sha256',
      'runtime_evidence_file_sha256', 'source_config_sha256', 'prepared_config_sha256', 'runtime_evidence_sha256', 'lifecycle_state_digest'];
    ensure(exact(binding, bindingKeys) && binding.schema_version === 1 && binding.directory === directory &&
      Number.isSafeInteger(binding.stop_new_games_at_ms) && Number.isSafeInteger(binding.hard_stop_at_ms) &&
      binding.stop_new_games_at_ms <= binding.hard_stop_at_ms && Array.isArray(binding.runner_directories) && binding.runner_directories.length > 0 &&
      bindingKeys.filter(key => key.endsWith('sha256') || key.endsWith('digest')).every(key => DIGEST.test(binding[key] ?? '')),
    'PROOF_RUN_AUDIT_BINDINGS_INVALID');
    for (const location of [binding.readiness_directory, binding.operator_directory, binding.verification_root, ...binding.runner_directories]) await canonical(location, { directory: true, outside: true });
    await canonical(binding.evidence_path, { outside: true });
    const source = await read(binding.config_path), evidenceFile = await read(binding.evidence_path);
    Object.assign(result.input_digests, { source_config_file_sha256: source.sha256, runtime_evidence_file_sha256: evidenceFile.sha256 });
    const sourceConfig = validateConfig(source.value), config = validateConfig(prepared.value), evidence = evidenceFile.value;
    ensure(config.roster.length === 10 && ['openclaw', 'hermes'].every(team => config.roster.filter(seat => seat.team === team).length === 5),
      'PROOF_RUN_AUDIT_TEN_SEATS_REQUIRED');
    ensure(source.sha256 === binding.source_config_file_sha256 && evidenceFile.sha256 === binding.runtime_evidence_file_sha256 &&
      configFingerprint(sourceConfig) === binding.source_config_sha256 && configFingerprint(config) === binding.prepared_config_sha256 &&
      runtimeEvidenceFingerprint(evidence) === binding.runtime_evidence_sha256 && evidence.lifecycle_state_digest === binding.lifecycle_state_digest,
    'PROOF_RUN_AUDIT_INPUT_BINDING_MISMATCH');
    ensure(same(config, { ...sourceConfig, start_block: config.start_block, start_time: config.start_time,
      stop_time: new Date(binding.stop_new_games_at_ms).toISOString(), intermission_ms: 0 }), 'PROOF_RUN_AUDIT_PREPARED_CONFIG_MISMATCH');
    ensure(exact(fuse, ['schema_version', 'maximum_fresh_games', 'bindings_sha256', 'runtime_evidence_sha256',
      'action_id', 'source_block_number', 'attempted_at', 'verification_sha256', 'verification_path']) &&
      fuse.schema_version === 1 && fuse.maximum_fresh_games === 1 && fuse.bindings_sha256 === configFingerprint(binding) &&
      fuse.runtime_evidence_sha256 === binding.runtime_evidence_sha256 && /^[A-Za-z0-9:._-]{1,200}$/.test(fuse.action_id ?? '') &&
      UINT.test(fuse.source_block_number ?? '') && Number.isFinite(Date.parse(fuse.attempted_at)) &&
      Date.parse(fuse.attempted_at) < binding.stop_new_games_at_ms && Date.parse(fuse.attempted_at) >= Date.parse(config.start_time) &&
      DIGEST.test(fuse.verification_sha256), 'PROOF_RUN_AUDIT_FUSE_MISMATCH');
    // Validate freshness at creation, not now, and retain the recorded source
    // fingerprint so later audited source changes do not rewrite history.
    ensure(DIGEST.test(evidence.transport_fingerprint ?? '') && evidence.producer_version === 2 &&
      evidence.continuity_policy === 'observed-runtime-continuity-v1', 'PROOF_RUN_AUDIT_EVIDENCE_INVALID');
    try { validateControlledRuntimeEvidence(sourceConfig, evidence, { now: Date.parse(fuse.attempted_at),
      transportFingerprint: evidence.transport_fingerprint, allowDiagnosticsOnly: true }); }
    catch { throw new AuditInputError('PROOF_RUN_AUDIT_EVIDENCE_INVALID'); }
    await canonical(fuse.verification_path, { outside: true });
    ensure(contained(binding.verification_root, fuse.verification_path) && path.basename(fuse.verification_path) === 'continuity-verification.json',
      'PROOF_RUN_AUDIT_VERIFICATION_MISMATCH');
    const verificationFile = await read(fuse.verification_path), verification = verificationFile.value;
    verifyContinuityHistory(verification, { config, evidence, binding, fuse });
    const original = await read(path.join(binding.readiness_directory, 'readiness-v2.json'));
    const lifecycle = await read(path.join(binding.readiness_directory, 'readiness-state.json'));
    const journal = await read(path.join(binding.readiness_directory, 'readiness-journal.json'));
    ensure(original.sha256 === binding.runtime_evidence_file_sha256 && runtimeEvidenceFingerprint(lifecycle.value) === binding.lifecycle_state_digest &&
      lifecycle.value.journal_sha256 === runtimeEvidenceFingerprint(journal.value) && journal.value.status === 'complete' &&
      journal.value.all_seats_sleeping === true && journal.value.diagnostic_run_id === evidence.diagnostic_run_id &&
      lifecycle.value.diagnostic_run_id === evidence.diagnostic_run_id && lifecycle.value.config_fingerprint === binding.source_config_sha256 &&
      lifecycle.value.roster_fingerprint === evidence.roster_fingerprint && lifecycle.value.transport_fingerprint === evidence.transport_fingerprint &&
      Array.isArray(journal.value.operations) && journal.value.operations.every(row => row.status === 'complete') &&
      Array.isArray(lifecycle.value.seats) && lifecycle.value.seats.length === evidence.seats.length && evidence.seats.every(seat => {
        const rows = lifecycle.value.seats.filter(row => row.seat_id === seat.seat_id), row = rows[0];
        return rows.length === 1 && ['agent_id', 'activation_generation', 'artifact_sha256', 'runtime_instance_fingerprint', 'final_agent_status'].every(key => row[key] === seat[key]) &&
          journal.value.operations.some(operation => operation.sequence === seat.activation_generation && operation.kind === 'activation-intent' && operation.seat_id === seat.seat_id);
      }), 'PROOF_RUN_AUDIT_READINESS_HISTORY_MISMATCH');
    ensure(report.schema_version === 1 && report.type === 'controlled-proof-run' && report.run_id === config.run_id &&
      report.game_id === gameId && report.runtime_evidence_sha256 === binding.runtime_evidence_sha256 && report.maximum_fresh_games === 1 &&
      report.launch_attempts === 1 && Array.isArray(report.dispatches) && report.creation?.status === 'accepted' &&
      report.creation.reference?.kind === 'transaction-hash' && TX.test(report.creation.reference.value ?? ''), 'PROOF_RUN_AUDIT_REPORT_MISMATCH');
    const outbox = await read(path.join(directory, 'runtime/telegram/outbox.json'));
    const scoreboardBindings = await read(scoreboardBindingsPath);
    const scoreboard = scoreboardBindings.value;
    ensure(exact(scoreboard, ['seriesId', 'firstGameId', 'messageIds', 'runtimeDir']) && /^[A-Za-z0-9_-]{1,100}$/.test(scoreboard.seriesId ?? '') &&
      /^[1-9][0-9]*$/.test(String(scoreboard.firstGameId)) && exact(scoreboard.messageIds, ['openclaw', 'hermes']) &&
      Object.values(scoreboard.messageIds).every(id => Number.isSafeInteger(id) && id > 0), 'PROOF_RUN_AUDIT_SCOREBOARD_BINDINGS_INVALID');
    await canonical(scoreboard.runtimeDir, { directory: true, outside: true });
    const ledger = await read(path.join(scoreboard.runtimeDir, 'telegram/scoreboard.json'));
    result.input_digests = { report_file_sha256: reportFile.sha256, prepared_config_sha256: binding.prepared_config_sha256,
      prepared_config_file_sha256: prepared.sha256, source_config_file_sha256: source.sha256,
      source_config_sha256: binding.source_config_sha256, proof_bindings_sha256: configFingerprint(binding), proof_bindings_file_sha256: manifest.sha256,
      fuse_file_sha256: consumed.sha256, runtime_evidence_sha256: binding.runtime_evidence_sha256,
      runtime_evidence_file_sha256: evidenceFile.sha256, lifecycle_state_digest: binding.lifecycle_state_digest,
      continuity_verification_sha256: fuse.verification_sha256, continuity_verification_file_sha256: verificationFile.sha256,
      outbox_file_sha256: outbox.sha256, scoreboard_bindings_file_sha256: scoreboardBindings.sha256, scoreboard_ledger_file_sha256: ledger.sha256 };
    let chain;
    try { chain = await auditChain({ config, gameId, provider, report, outbox: outbox.value }); }
    catch { throw new AuditInputError('PROOF_RUN_AUDIT_CHAIN_UNAVAILABLE'); }
    result.chain_audit = cleanAudit(chain, gameId, false);
    let pins;
    try { pins = await auditScoreboards({ config, gameId, bindings: scoreboard, ledger: ledger.value, chainAudit: chain, report, provider, token, fetchImpl }); }
    catch { throw new AuditInputError('PROOF_RUN_AUDIT_SCOREBOARDS_UNAVAILABLE'); }
    result.scoreboard_audit = cleanAudit(pins, gameId, true);
    if (result.chain_audit.proof_complete) ensure(result.chain_audit.creation_transaction_hash === report.creation.reference.value.toLowerCase() &&
      result.chain_audit.defaulted_count === 0 && result.chain_audit.round_count > 0 &&
      result.chain_audit.discussion_message_count >= config.roster.length &&
      ['joined_count', 'committed_seat_count', 'revealed_seat_count'].every(key => result.chain_audit[key] === config.roster.length),
    'PROOF_RUN_AUDIT_RESULT_INVALID');
    if (result.scoreboard_audit.proof_complete) ensure(result.chain_audit.proof_complete &&
      result.scoreboard_audit.result_transaction_hash === result.chain_audit.result_transaction_hash, 'PROOF_RUN_AUDIT_RESULT_INVALID');
    for (const [filename, expected] of files) ensure((await readJson(filename)).sha256 === expected, 'PROOF_RUN_AUDIT_INPUT_CHANGED');
    result.issues = [...new Set([...result.chain_audit.issues, ...result.scoreboard_audit.issues])];
    result.proof_complete = result.chain_audit.proof_complete && result.scoreboard_audit.proof_complete;
    if (!result.proof_complete && result.issues.length === 0) result.issues.push('PROOF_RUN_AUDIT_INCOMPLETE');
  } catch (error) {
    result.proof_complete = false;
    result.issues.push(error instanceof AuditInputError ? error.code : 'PROOF_RUN_AUDIT_INPUT_INVALID');
  }
  await writeExclusive(outputPath, result);
  return result;
}
