import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rm, stat, symlink, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fixtureConfig } from '../src/fixture.mjs';
import { buildControlledRuntimeEvidence, configFingerprint, rosterFingerprint, runtimeEvidenceFingerprint, TRANSPORT_FINGERPRINT } from '../src/readiness.mjs';
import { auditProofRun } from '../src/proof-run-audit.mjs';

const start = Date.parse('2026-09-25T12:00:00Z');
const H = value => `0x${value.toString(16).padStart(64, '0')}`;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const PRIVATE_TEXT = 'PRIVATE_FIXTURE_PROVIDER_TEXT';

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'proof-run-audit-fixture-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'prepared'), readiness = path.join(root, 'readiness'), scoreboardRoot = path.join(root, 'series');
  const verificationRoot = path.join(root, 'verifications');
  for (const location of [directory, readiness, path.join(root, 'operator'), path.join(root, 'runner'),
    verificationRoot, path.join(directory, 'runtime/telegram'), path.join(scoreboardRoot, 'telegram')]) await mkdir(location, { recursive: true, mode: 0o700 });
  const source = await fixtureConfig({ now: start, teamSizes: { openclaw: 5, hermes: 5 } });
  source.telegram = { openclaw: { chat_id: '-100111', invite_url: null }, hermes: { chat_id: '-100222', invite_url: null } };
  const prepared = { ...source, start_block: '100', start_time: new Date(start).toISOString(),
    stop_time: new Date(start + 300_000).toISOString(), intermission_ms: 0 };
  const runId = '01234567-89ab-4cde-8fab-0123456789ab';
  const response = (seat, index, mode) => ({ schema_version: 1, type: 'runtime-diagnostic-response',
    request_id: `${runId}:${seat.seat_id}:${index + 1}:${mode.replace('-', '_')}`, seat_id: seat.seat_id, team: seat.team,
    mode, status: 'ready', checks: Object.fromEntries(['stdin', 'wallet_identity', 'checkout', 'dependencies', 'wrapper',
      'private_state', 'seat_lock', 'chain_id', 'contract_read'].map(key => [key, true])) });
  const rows = source.roster.map((seat, index) => ({ seat_id: seat.seat_id, agent_id: seat.agent_id, harness: seat.harness,
    wallet_address: seat.wallet_address, framework_status_verified: true, direct_runtime_inspection_verified: true,
    wallet_identity_verified: true, persistent_storage_verified: true, tool_execution_verified: true,
    gameplay_command: ['node', `/volume/${seat.seat_id}/player-cli.mjs`, `/volume/${seat.seat_id}/seat.json`],
    artifact_sha256: 'ab'.repeat(32), activation_generation: index + 1, runtime_instance_fingerprint: 'cd'.repeat(32),
    diagnostic_generations: { gameplay_input: index + 1, commit_input: index + 1 }, final_agent_status: 'sleeping',
    sleep_confirmed: true, lifecycle_ambiguous: false, model_profile: { model_endpoint: 'https://chatgpt.com/backend-api/codex',
      model: 'gpt-6.1-sol', reasoning_effort: 'low', max_output_tokens: 2048, automatic_fallback: false },
    diagnostics: { gameplay_input: response(seat, index, 'gameplay-input'), commit_input: response(seat, index, 'commit-input') } }));
  const journal = { schema_version: 1, producer_version: 2, diagnostic_run_id: runId, status: 'complete', all_seats_sleeping: true,
    operations: source.roster.map((seat, index) => ({ kind: 'activation-intent', sequence: index + 1, seat_id: seat.seat_id, status: 'complete' })) };
  const lifecycle = { schema_version: 1, diagnostic_run_id: runId, config_fingerprint: configFingerprint(source),
    roster_fingerprint: rosterFingerprint(source), transport_fingerprint: TRANSPORT_FINGERPRINT, generation_scope: 'diagnostic-run-intent-v1',
    journal_sha256: runtimeEvidenceFingerprint(journal), seats: rows.map(({ seat_id, agent_id, activation_generation,
      artifact_sha256, runtime_instance_fingerprint, final_agent_status }) => ({ seat_id, agent_id, activation_generation,
      artifact_sha256, runtime_instance_fingerprint, final_agent_status })) };
  const evidence = buildControlledRuntimeEvidence(source, { now: start - 1000, confirmedBlockNumber: '100', confirmedBlockHash: H(100), seats: rows,
    producer: { producer_version: 2, diagnostic_run_id: runId, chain_id: 84532, game_address: source.game_address.toLowerCase(),
      game_code_hash: H(101), chain_defaults_fingerprint: 'de'.repeat(32), generation_scope: 'diagnostic-run-intent-v1',
      lifecycle_state_digest: runtimeEvidenceFingerprint(lifecycle), remote_generation_attested: false, diagnostics_complete: true,
      continuity_policy: 'observed-runtime-continuity-v1' } });
  const bindings = { schema_version: 1, config_path: path.join(root, 'source.json'), evidence_path: path.join(readiness, 'readiness-v2.json'),
    readiness_directory: readiness, operator_directory: path.join(root, 'operator'), runner_directories: [path.join(root, 'runner')], directory, verification_root: verificationRoot,
    stop_new_games_at_ms: start + 300_000, hard_stop_at_ms: start + 600_000, source_config_file_sha256: digest(json(source)),
    runtime_evidence_file_sha256: digest(json(evidence)), source_config_sha256: configFingerprint(source),
    prepared_config_sha256: configFingerprint(prepared), runtime_evidence_sha256: runtimeEvidenceFingerprint(evidence),
    lifecycle_state_digest: evidence.lifecycle_state_digest };
  const verification = { schema_version: 1, verification_id: runId, continuity_policy: evidence.continuity_policy,
    evidence_sha256: bindings.runtime_evidence_sha256, lifecycle_state_digest: evidence.lifecycle_state_digest, status: 'complete',
    all_seats_sleeping: true, started_at_ms: start + 1, completed_at_ms: null, deadline_at_ms: start + 300_000,
    cleanup_deadline_at_ms: start + 360_000, operations: [] };
  let operationClock = verification.started_at_ms;
  const record = (kind, seat_id = null) => {
    const operation = { sequence: verification.operations.length + 1, kind, seat_id, status: 'complete',
      started_at_ms: operationClock++, completed_at_ms: operationClock++ };
    verification.operations.push(operation); return operation;
  };
  for (const seat of source.roster) {
    record('inventory', seat.seat_id); record('activation', seat.seat_id); record('lifecycle-read', seat.seat_id);
    record('activation-settle', seat.seat_id);
    const continuity = record('continuity-check', seat.seat_id);
    record('lifecycle-read', seat.seat_id);
    for (let read = 0; read < 9; read++) record('runtime-read', seat.seat_id);
    record('lifecycle-read', seat.seat_id); continuity.completed_at_ms = operationClock;
    record('sleep', seat.seat_id); record('lifecycle-read', seat.seat_id);
  }
  record('inventory'); record('chain-revalidation'); verification.completed_at_ms = operationClock;
  const fuse = { schema_version: 1, maximum_fresh_games: 1, bindings_sha256: configFingerprint(bindings),
    runtime_evidence_sha256: bindings.runtime_evidence_sha256, verification_sha256: runtimeEvidenceFingerprint(verification),
    verification_path: path.join(verificationRoot, 'continuity-verification.json'),
    action_id: 'fixture:create:20', source_block_number: '100', attempted_at: new Date(start + 400).toISOString() };
  const report = { schema_version: 1, type: 'controlled-proof-run', run_id: source.run_id, game_id: '20',
    runtime_evidence_sha256: bindings.runtime_evidence_sha256, maximum_fresh_games: 1, launch_attempts: 1, dispatches: [],
    creation: { status: 'accepted', reference: { kind: 'transaction-hash', value: H(1100) } },
    candidate_proof_complete: true, proof_complete: false, raw_reply: PRIVATE_TEXT,
    result: { game_id: '20', outcome: 'completed', events: [] }, telegram: { ok: true, scoreboard: {} } };
  const scoreboardBindings = { seriesId: 'audit-fixture', firstGameId: '18', messageIds: { openclaw: 3, hermes: 4 }, runtimeDir: scoreboardRoot };
  const outbox = { schema_version: 1, run_id: source.run_id, chats: { openclaw: '-100111', hermes: '-100222' },
    entries: [{ text: PRIVATE_TEXT }] };
  const ledger = { schema_version: 1, fixture: true, raw_text: PRIVATE_TEXT };
  const documents = new Map([[bindings.config_path, source], [bindings.evidence_path, evidence],
    [path.join(directory, 'config.json'), prepared], [path.join(directory, 'proof-bindings.json'), bindings],
    [path.join(directory, 'launch-once.json'), fuse], [fuse.verification_path, verification], [path.join(directory, 'proof-run.json'), report],
    [path.join(readiness, 'readiness-state.json'), lifecycle], [path.join(readiness, 'readiness-journal.json'), journal],
    [path.join(directory, 'runtime/telegram/outbox.json'), outbox], [path.join(root, 'scoreboard-bindings.json'), scoreboardBindings],
    [path.join(scoreboardRoot, 'telegram/scoreboard.json'), ledger]]);
  for (const [filename, value] of documents) await writeFile(filename, json(value), { mode: 0o600 });
  const calls = [];
  const chain = { schema_version: 1, proof_complete: true, chain_verified: true, telegram_verified: true, game_id: '20',
    confirmed_block_number: '122', joined_count: 10, committed_seat_count: 10, revealed_seat_count: 10, round_count: 2,
    defaulted_count: 0, discussion_message_count: 10, creation_transaction_hash: H(1100), result_transaction_hash: H(1120), issues: [],
    result_message_ids: [{ team: 'openclaw', message_id: 50 }, { team: 'hermes', message_id: 51 }],
    seats: source.roster.map((seat, index) => ({ seat_id: seat.seat_id, joined: true, committed: true, revealed: true,
      discussion_delivered: true, join_transaction_hash: H(2000 + index), commit_transaction_hashes: [H(3000 + index)],
      reveal_transaction_hashes: [H(4000 + index)], discussion_message_ids: [100 + index] })) };
  const scores = { schema_version: 1, proof_complete: true, ledger_verified: true, chain_awards_verified: true,
    telegram_verified: true, game_id: '20', result_transaction_hash: H(1120), issues: [],
    pins: ['openclaw', 'hermes'].map(team => ({ team, chat_id: source.telegram[team].chat_id,
      message_id: scoreboardBindings.messageIds[team], text_sha256: digest(PRIVATE_TEXT), verified_at: new Date(start).toISOString() })) };
  const options = { directory, gameId: '20', scoreboardBindingsPath: path.join(root, 'scoreboard-bindings.json'),
    outputPath: path.join(root, 'independent-audit.json'), provider: {}, token: 'fixture-only-token',
    auditChain: async args => { calls.push('chain'); assert.deepEqual(args.config, prepared); assert.deepEqual(args.report, report); assert.deepEqual(args.outbox, outbox); return structuredClone(chain); },
    auditScoreboards: async args => { calls.push('scoreboard'); assert.deepEqual(args.report, report); assert.deepEqual(args.ledger, ledger);
      assert.equal(args.chainAudit.proof_complete, chain.proof_complete); return structuredClone(scores); } };
  return { root, directory, readiness, bindings, fuse, verification, source, prepared, evidence, lifecycle, journal, report, options, calls, chain, scores, documents,
    save: async (filename, value) => writeFile(filename, json(value), { mode: 0o600 }) };
}


// Timed fixture: overlap complete seat lifecycles without changing their order.
function interleaveLifecycles(record, seats, width = 5, repeatCapacityRead = false) {
  const histories = seats.map(seat => record.operations.filter(row => row.seat_id === seat.seat_id));
  if (repeatCapacityRead) histories[0].unshift(structuredClone(histories[0][0]));
  const tail = record.operations.slice(-2), output = [];
  let clock = record.started_at_ms;
  const append = row => { row.started_at_ms = clock++; row.completed_at_ms = clock++; output.push(row); };
  for (let first = 0; first < histories.length; first += width) {
    const batch = histories.slice(first, first + width);
    for (let step = 0; step < Math.max(...batch.map(rows => rows.length)); step++) {
      for (const rows of batch) if (rows[step]) append(rows[step]);
    }
    for (const rows of batch) {
      const check = rows.findIndex(row => row.kind === 'continuity-check');
      rows[check].completed_at_ms = rows[check + 11].completed_at_ms;
    }
  }
  tail.forEach(append);
  output.forEach((row, index) => { row.sequence = index + 1; });
  record.operations = output; record.completed_at_ms = clock;
}

test('independent audit accepts complete five-seat interleaving and extra preactivation capacity reads', async t => {
  const f = await fixture(t);
  interleaveLifecycles(f.verification, f.source.roster, 5, true);
  await f.save(f.fuse.verification_path, f.verification);
  f.fuse.verification_sha256 = runtimeEvidenceFingerprint(f.verification);
  await f.save(path.join(f.directory, 'launch-once.json'), f.fuse);
  const result = await auditProofRun(f.options);
  assert.equal(result.proof_complete, true, JSON.stringify(result));
  assert.deepEqual(f.calls, ['chain', 'scoreboard']);
});

test('independent audit refuses a sixth occupied slot or a premature final inventory', async t => {
  for (const kind of ['six-awake', 'early-final-inventory', 'late-capacity']) await t.test(kind, async t => {
    const f = await fixture(t);
    interleaveLifecycles(f.verification, f.source.roster, kind === 'six-awake' ? 6 : 5);
    if (kind === 'early-final-inventory') f.verification.operations.at(-3).completed_at_ms = f.verification.operations.at(-2).started_at_ms + 1;
    if (kind === 'late-capacity') f.verification.operations.find(row => row.kind === 'activation-settle').kind = 'inventory';
    await f.save(f.fuse.verification_path, f.verification);
    f.fuse.verification_sha256 = runtimeEvidenceFingerprint(f.verification);
    await f.save(path.join(f.directory, 'launch-once.json'), f.fuse);
    const result = await auditProofRun(f.options);
    assert.equal(result.proof_complete, false);
    assert.deepEqual(result.issues, ['PROOF_RUN_AUDIT_VERIFICATION_MISMATCH']);
    assert.deepEqual(f.calls, []);
  });
});

test('expired original readiness can be audited after completion with both independent auditors and immutable inputs', async t => {
  const f = await fixture(t);
  assert.equal(f.verification.operations.length, 182);
  assert.equal(f.verification.operations.filter(operation => operation.kind === 'activation-settle').length, 10);
  for (const seat of f.source.roster) assert.equal(f.verification.operations.filter(operation => operation.seat_id === seat.seat_id && operation.kind === 'runtime-read').length, 9);
  assert.ok(Date.parse(f.evidence.expires_at) < Date.now());
  const before = new Map(await Promise.all([...f.documents.keys()].map(async file => [file, await readFile(file, 'utf8')])));
  const result = await auditProofRun(f.options);
  assert.equal(result.proof_complete, true, JSON.stringify(result));
  assert.deepEqual(f.calls, ['chain', 'scoreboard']);
  assert.equal(result.input_digests.report_file_sha256, digest(before.get(path.join(f.directory, 'proof-run.json'))));
  assert.equal(result.input_digests.runtime_evidence_sha256, f.bindings.runtime_evidence_sha256);
  assert.equal(result.chain_audit.seats.length, 10); assert.equal(result.scoreboard_audit.pins.length, 2);
  assert.deepEqual(JSON.parse(await readFile(f.options.outputPath, 'utf8')), result);
  assert.equal((await stat(f.options.outputPath)).mode & 0o777, 0o600);
  assert.ok(!JSON.stringify(result).includes(PRIVATE_TEXT)); assert.ok(!JSON.stringify(result).includes(f.options.token));
  for (const [file, content] of before) assert.equal(await readFile(file, 'utf8'), content);
  assert.ok(!(await readdir(f.root)).some(name => name.startsWith('.proof-audit-')));
});

test('both chain and pin audit must succeed; helper candidates and one successful auditor are insufficient', async t => {
  for (const failed of ['chain', 'scores']) {
    const f = await fixture(t);
    f[failed].proof_complete = false;
    f[failed].issues = [failed === 'chain' ? 'PROOF_ACTIONS_UNVERIFIED' : 'SCOREBOARD_PIN_READBACK_MISMATCH'];
    if (failed === 'chain') { f.scores.proof_complete = false; f.scores.issues = ['SCOREBOARD_CANONICAL_PROOF_REQUIRED']; }
    const result = await auditProofRun(f.options);
    assert.equal(result.proof_complete, false);
    assert.deepEqual(f.calls, ['chain', 'scoreboard']);
    assert.deepEqual(result.issues, [...new Set([...f.chain.issues, ...f.scores.issues])]);
  }
});

test('changed evidence, manifests, config, fuse, lifecycle and report fail before external auditing', async t => {
  const cases = [
    ['source bytes', f => f.save(f.bindings.config_path, { ...f.source, poll_interval_ms: 500 }), 'PROOF_RUN_AUDIT_INPUT_BINDING_MISMATCH'],
    ['evidence bytes', f => f.save(f.bindings.evidence_path, { ...f.evidence, verified_at: new Date(start - 2000).toISOString() }), 'PROOF_RUN_AUDIT_INPUT_BINDING_MISMATCH'],
    ['prepared config', f => f.save(path.join(f.directory, 'config.json'), { ...f.prepared, poll_interval_ms: 500 }), 'PROOF_RUN_AUDIT_INPUT_BINDING_MISMATCH'],
    ['fuse digest', f => f.save(path.join(f.directory, 'launch-once.json'), { ...f.fuse, bindings_sha256: 'aa'.repeat(32) }), 'PROOF_RUN_AUDIT_FUSE_MISMATCH'],
    ['verification record drift', f => f.save(f.fuse.verification_path, { ...f.verification, all_seats_sleeping: false }), 'PROOF_RUN_AUDIT_VERIFICATION_MISMATCH'],
    ['lifecycle manifest', f => f.save(path.join(f.readiness, 'readiness-state.json'), { ...f.lifecycle, journal_sha256: 'aa'.repeat(32) }), 'PROOF_RUN_AUDIT_READINESS_HISTORY_MISMATCH'],
    ['journal ambiguity', f => f.save(path.join(f.readiness, 'readiness-journal.json'), { ...f.journal, status: 'failed' }), 'PROOF_RUN_AUDIT_READINESS_HISTORY_MISMATCH'],
    ['wrong report game', f => f.save(path.join(f.directory, 'proof-run.json'), { ...f.report, game_id: '19' }), 'PROOF_RUN_AUDIT_REPORT_MISMATCH'],
    ['wrong report evidence', f => f.save(path.join(f.directory, 'proof-run.json'), { ...f.report, runtime_evidence_sha256: 'aa'.repeat(32) }), 'PROOF_RUN_AUDIT_REPORT_MISMATCH'],
  ];
  for (const [name, corrupt, code] of cases) await t.test(name, async t => {
    const f = await fixture(t); await corrupt(f);
    const result = await auditProofRun(f.options);
    assert.equal(result.proof_complete, false); assert.deepEqual(result.issues, [code]); assert.deepEqual(f.calls, []);
  });
});

test('consumed fuse must bind a completed original continuity verification before creation', async t => {
  for (const change of [record => { record.completed_at_ms = start + 401; },
    record => { record.operations[0].status = 'unknown'; }, record => { record.all_seats_sleeping = false; },
    record => { record.evidence_sha256 = 'aa'.repeat(32); }, record => { record.continuity_policy = 'invented-remote-epoch'; }]) {
    const f = await fixture(t); change(f.verification);
    await f.save(f.fuse.verification_path, f.verification);
    f.fuse.verification_sha256 = runtimeEvidenceFingerprint(f.verification);
    await f.save(path.join(f.directory, 'launch-once.json'), f.fuse);
    const result = await auditProofRun(f.options);
    assert.equal(result.proof_complete, false); assert.deepEqual(result.issues, ['PROOF_RUN_AUDIT_VERIFICATION_MISMATCH']);
    assert.deepEqual(f.calls, []);
  }
});

test('recomputed verification digests cannot conceal incomplete, reordered or private lifecycle histories', async t => {
  const cases = [
    ['empty history', record => { record.operations = []; }],
    ['missing seat history', record => { record.operations.splice(162, 18); }],
    ['same-length substituted seat', record => { for (const operation of record.operations) if (operation.seat_id === 'hs-5') operation.seat_id = 'hs-4'; }],
    ['absent activation settles', record => {
      record.operations = record.operations.filter(operation => operation.kind !== 'activation-settle');
      record.operations.forEach((operation, index) => { operation.sequence = index + 1; });
    }],
    ['activation settle after guest access', record => {
      const settle = record.operations.find(operation => operation.kind === 'activation-settle');
      const guest = record.operations.find(operation => operation.kind === 'runtime-read');
      [settle.kind, guest.kind] = [guest.kind, settle.kind];
    }],
    ['unknown activation settle', record => { record.operations.find(operation => operation.kind === 'activation-settle').status = 'unknown'; }],
    ['unknown operation', record => { record.operations[6].kind = 'configure-model'; }],
    ['missing original receipt read', record => { record.operations[14].kind = 'lifecycle-read'; }],
    ['missing nested lifecycle object', record => { record.operations[15] = null; }],
    ['unknown operation outcome', record => { record.operations[17].status = 'unknown'; }],
    ['duplicate sequence', record => { record.operations[5].sequence = 5; }],
    ['extra operation', record => { record.operations.push(structuredClone(record.operations.at(-1))); }],
    ['private top-level structure', record => { record.session = { raw_reply: PRIVATE_TEXT }; }],
    ['private nested structure', record => { record.operations[6].provider_response = { private_key: PRIVATE_TEXT }; }],
    ['invalid verification ID', record => { record.verification_id = PRIVATE_TEXT; }],
    ['cleanup deadline drift', record => { record.cleanup_deadline_at_ms++; }],
    ['regressed operation start', record => { record.operations[2].started_at_ms = record.operations[1].started_at_ms - 1; }],
    ['overlapping serialized operation', record => { record.operations[1].completed_at_ms = record.operations[2].started_at_ms + 1; }],
    ['continuity finished before nested reads', record => { record.operations[4].completed_at_ms = record.operations[4].started_at_ms; }],
    ['continuity completed after sleep began', record => { record.operations[4].completed_at_ms = record.operations[16].started_at_ms + 1; }],
    ['operation exceeds completed record', record => { record.operations.at(-1).completed_at_ms = record.completed_at_ms + 1; }],
    ['verification predates prepared run', record => { record.started_at_ms = start - 1; }],
  ];
  for (const [name, corrupt] of cases) await t.test(name, async t => {
    const f = await fixture(t); corrupt(f.verification);
    await f.save(f.fuse.verification_path, f.verification);
    f.fuse.verification_sha256 = runtimeEvidenceFingerprint(f.verification);
    await f.save(path.join(f.directory, 'launch-once.json'), f.fuse);
    const result = await auditProofRun(f.options);
    assert.equal(result.proof_complete, false);
    assert.deepEqual(result.issues, ['PROOF_RUN_AUDIT_VERIFICATION_MISMATCH']);
    assert.deepEqual(f.calls, []);
    assert.ok(!JSON.stringify(result).includes(PRIVATE_TEXT));
  });
});

test('two successful auditor flags cannot hide mismatched transaction or incomplete roster counts', async t => {
  for (const change of [f => { f.scores.result_transaction_hash = H(999); }, f => { f.chain.joined_count = 9; }]) {
    const f = await fixture(t); change(f);
    const result = await auditProofRun(f.options);
    assert.equal(result.proof_complete, false); assert.deepEqual(result.issues, ['PROOF_RUN_AUDIT_RESULT_INVALID']);
  }
});

test('input drift during independent auditing invalidates the complete candidate', async t => {
  const f = await fixture(t), auditor = f.options.auditScoreboards;
  f.options.auditScoreboards = async args => {
    const result = await auditor(args);
    await f.save(path.join(f.directory, 'proof-run.json'), { ...f.report, failure: { code: 'PROOF_HARD_DEADLINE' } });
    return result;
  };
  const result = await auditProofRun(f.options);
  assert.equal(result.proof_complete, false); assert.deepEqual(result.issues, ['PROOF_RUN_AUDIT_INPUT_CHANGED']);
});

test('provider errors and unexpected auditor fields never leak into the separate public artifact', async t => {
  const f = await fixture(t);
  f.chain.raw_reply = PRIVATE_TEXT; f.scores.session = PRIVATE_TEXT;
  assert.ok(!JSON.stringify(await auditProofRun(f.options)).includes(PRIVATE_TEXT));
  const unavailable = await fixture(t);
  unavailable.options.auditChain = async () => { throw new Error(PRIVATE_TEXT); };
  const result = await auditProofRun(unavailable.options);
  assert.deepEqual(result.issues, ['PROOF_RUN_AUDIT_CHAIN_UNAVAILABLE']);
  assert.ok(!JSON.stringify(result).includes(PRIVATE_TEXT));
  const invalid = await fixture(t); invalid.chain.issues = [PRIVATE_TEXT];
  assert.deepEqual((await auditProofRun(invalid.options)).issues, ['PROOF_RUN_AUDIT_RESULT_INVALID']);
});

test('audit output is exclusive and rejects existing files or concurrent races without replacing bytes', async t => {
  const f = await fixture(t); await writeFile(f.options.outputPath, 'preserve existing artifact');
  await assert.rejects(auditProofRun(f.options), /PROOF_RUN_AUDIT_OUTPUT_EXISTS/);
  assert.equal(await readFile(f.options.outputPath, 'utf8'), 'preserve existing artifact'); assert.deepEqual(f.calls, []);
  const racing = await fixture(t), auditor = racing.options.auditScoreboards;
  racing.options.auditScoreboards = async args => { await writeFile(racing.options.outputPath, 'concurrent artifact'); return auditor(args); };
  await assert.rejects(auditProofRun(racing.options), /PROOF_RUN_AUDIT_OUTPUT_EXISTS/);
  assert.equal(await readFile(racing.options.outputPath, 'utf8'), 'concurrent artifact');
});

test('symlink aliases and oversized input files are rejected without invoking auditors', async t => {
  const f = await fixture(t), alias = path.join(f.root, 'aliased');
  await symlink(f.directory, alias);
  const linked = await auditProofRun({ ...f.options, directory: alias });
  assert.deepEqual(linked.issues, ['PROOF_RUN_AUDIT_PATH_INVALID']); assert.deepEqual(f.calls, []);
  const huge = await fixture(t);
  await writeFile(path.join(huge.directory, 'proof-run.json'), 'x'.repeat(8 * 1024 * 1024 + 1));
  assert.deepEqual((await auditProofRun(huge.options)).issues, ['PROOF_RUN_AUDIT_FILE_INVALID']); assert.deepEqual(huge.calls, []);
  const leaf = await fixture(t), reportPath = path.join(leaf.directory, 'proof-run.json');
  await rm(reportPath); await symlink(leaf.bindings.config_path, reportPath);
  assert.deepEqual((await auditProofRun(leaf.options)).issues, ['PROOF_RUN_AUDIT_PATH_INVALID']); assert.deepEqual(leaf.calls, []);
});
