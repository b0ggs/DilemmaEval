import test from 'node:test';
import assert from 'node:assert/strict';
import { access, appendFile, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';
import { fixtureConfig, createFixtureAdapters } from '../src/fixture.mjs';
import { createConferenceRunner } from '../src/runner/index.mjs';
import { playerFundingBudget } from '../src/player-funding.mjs';
import { configFingerprint, rosterFingerprint, runtimeEvidenceFingerprint, TRANSPORT_FINGERPRINT } from '../src/readiness.mjs';
import { planControlledProof, prepareControlledProof, validatePreparedProof, createGuardedLauncher } from '../src/proof-control.mjs';

const HASH = `0x${'ac'.repeat(32)}`;
const CODE_HASH = `0x${'bc'.repeat(32)}`;
const intent = { action_id: 'launch:fixture', source_block_number: '100' };
const json = (filename, value) => writeFile(filename, `${JSON.stringify(value)}\n`);

// Positive current-state attestation is injected only into fixture callbacks. The
// repository's production verifier must never claim this provider proof exists.
async function setup(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'proof-control-fixture-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let nowMs = Date.parse('2026-10-02T16:00:00Z');
  let lifecycleCurrent = true;
  const config = await fixtureConfig({ now: nowMs });
  config.roster = ['openclaw', 'hermes'].flatMap((team, teamIndex) => Array.from({ length: 5 }, (_, i) => {
    const identity = teamIndex * 5 + i + 1;
    return { seat_id: `${teamIndex ? 'hs' : 'oc'}-${i + 1}`, team, harness: team,
      agent_id: `00000000-0000-4000-8000-${String(identity).padStart(12, '0')}`,
      maritime_agent: `fixture-${team}-${i + 1}`, wallet_address: `0x${identity.toString(16).padStart(40, '0')}`,
      cause_id: teamIndex + 1 };
  }));
  const defaults = { entryFeeWei: '100000000000000', creatorFeeBps: '100', causeFeeBps: '100',
    joinDurationSeconds: '60', commitDurationBlocks: '60', revealDurationBlocks: '40', minPlayers: '10', maxPlayers: '10', maxCauses: '2' };
  const diagnostic = (seat, mode) => ({ schema_version: 1, type: 'runtime-diagnostic-response',
    request_id: `00000000-0000-4000-8000-000000000111:${seat.seat_id}:1:${mode.replace('-', '_')}`, seat_id: seat.seat_id, team: seat.team, mode, status: 'ready',
    checks: Object.fromEntries(['stdin', 'wallet_identity', 'checkout', 'dependencies', 'wrapper', 'private_state', 'seat_lock', 'chain_id', 'contract_read'].map(key => [key, true])) });
  const evidence = { schema_version: 2, run_id: config.run_id, roster_fingerprint: rosterFingerprint(config),
    config_fingerprint: configFingerprint(config), transport_fingerprint: TRANSPORT_FINGERPRINT,
    verified_at: new Date(nowMs - 1000).toISOString(), expires_at: new Date(nowMs + 599000).toISOString(),
    confirmed_block_number: '100', confirmed_block_hash: HASH, chain_id: 84532, game_address: config.game_address.toLowerCase(),
    game_code_hash: CODE_HASH, chain_defaults_fingerprint: configFingerprint(defaults), lifecycle_state_digest: 'cd'.repeat(32),
    diagnostic_run_id: '00000000-0000-4000-8000-000000000111', producer_version: 1,
    generation_scope: 'diagnostic-run-intent-v1', diagnostics_complete: true, remote_generation_attested: false,
    sdk: { package: 'maritime-sdk', version: '0.6.0', maxRetries: 0 }, ready_for_controlled_gameplay: false,
    seats: config.roster.map(seat => ({ seat_id: seat.seat_id, agent_id: seat.agent_id, harness: seat.harness,
      wallet_address: seat.wallet_address, framework_status_verified: true, direct_runtime_inspection_verified: true,
      wallet_identity_verified: true, persistent_storage_verified: true, tool_execution_verified: true,
      gameplay_command: ['node', `/volume/${seat.seat_id}/player-cli.mjs`, `/volume/${seat.seat_id}/seat.json`],
      artifact_sha256: 'ab'.repeat(32), activation_generation: 1, runtime_instance_fingerprint: 'de'.repeat(32),
      diagnostic_generations: { gameplay_input: 1, commit_input: 1 },
      final_agent_status: 'sleeping', sleep_confirmed: true, lifecycle_ambiguous: false,
      model_profile: { model_endpoint: 'https://api.maritime.sh/api/llm/v1', model: 'gpt-5.4-mini',
        reasoning_effort: 'low', max_output_tokens: 2048, automatic_fallback: false },
      diagnostics: { gameplay_input: diagnostic(seat, 'gameplay-input'), commit_input: diagnostic(seat, 'commit-input') } })) };
  const preflight = { chain_id: 84532, game_address: config.game_address, owner: config.expected_owner,
    active_game_id: '0', block_number: '100', block_hash: HASH, code_hash: CODE_HASH, config: defaults,
    player_funding: playerFundingBudget(defaults.entryFeeWei, '5000000'),
    players: config.roster.map(seat => ({ seat_id: seat.seat_id, wallet_address: seat.wallet_address,
      admitted: true, cause_whitelisted: true, balance_wei: '15000000000000000' })) };
  for (const name of ['readiness', 'operator', 'runner']) await mkdir(path.join(root, name));
  const options = { configPath: path.join(root, 'source.json'), evidencePath: path.join(root, 'readiness', 'readiness-v2.json'),
    readinessDirectory: path.join(root, 'readiness'), directory: path.join(root, 'prepared'),
    operatorDirectory: path.join(root, 'operator'), runnerDirectories: [path.join(root, 'runner')],
    stopNewGamesAtMs: nowMs + 300000, hardStopAtMs: nowMs + 600000, now: () => nowMs,
    chain: { preflight: async () => structuredClone(preflight), readBlockHash: async () => HASH },
    provider: { getTransactionCount: async () => 0, getTransactionReceipt: async () => ({ hash: HASH, from: config.expected_owner, to: config.game_address, blockNumber: 99, blockHash: HASH, status: 1 }),
      getBlock: async () => ({ hash: HASH }) },
    validateReadinessCurrent: async ({ evidence: value }) => {
      if (!lifecycleCurrent) throw new Error('fixture provider error');
      return { ready: true, evidence_sha256: runtimeEvidenceFingerprint(value), lifecycle_state_digest: value.lifecycle_state_digest };
    } };
  await json(options.configPath, config); await json(options.evidencePath, evidence);
  return { root, config, evidence, preflight, options, setNow: value => { nowMs = value; },
    setCurrentReady: value => { lifecycleCurrent = value; } };
}

test('ten-seat proof plan is read-only and preparation exclusively writes three bound files', async t => {
  const f = await setup(t);
  const before = await readdir(f.root);
  const plan = await planControlledProof(f.options);
  assert.equal(plan.status, 'ready');
  assert.deepEqual(await readdir(f.root), before);
  const prepared = await prepareControlledProof(f.options);
  assert.equal(prepared.status, 'prepared');
  assert.equal(prepared.bindings.runtime_evidence_sha256, runtimeEvidenceFingerprint(f.evidence));
  assert.deepEqual((await readdir(f.options.directory)).sort(), ['config.json', 'preflight.json', 'proof-bindings.json']);
  assert.equal((await stat(f.options.directory)).mode & 0o777, 0o700);
  assert.equal((await stat(path.join(f.options.directory, 'proof-bindings.json'))).mode & 0o777, 0o600);
  assert.equal((await validatePreparedProof(f.options)).status, 'ready');
  await assert.rejects(prepareControlledProof(f.options), /PROOF_DIRECTORY_EXISTS/);
});

test('proof requires explicit deadlines, paths, current verifier and a fresh outside directory', async t => {
  for (const [field, value, code] of [
    ['stopNewGamesAtMs', undefined, /DEADLINE_INVALID/], ['hardStopAtMs', undefined, /DEADLINE_INVALID/],
    ['directory', '.', /ABSOLUTE_PATH/], ['runnerDirectories', undefined, /RUNNER_DIRECTORIES/],
    ['validateReadinessCurrent', undefined, /CURRENT_READINESS_REQUIRED/]
  ]) {
    const f = await setup(t); f.options[field] = value;
    await assert.rejects(prepareControlledProof(f.options), code);
    await assert.rejects(access(path.join(f.root, 'prepared')), { code: 'ENOENT' });
  }
  const f = await setup(t);
  f.options.directory = path.join(f.root, 'linked-repo', 'proof-output');
  await symlink(new URL('../../../', import.meta.url).pathname, path.join(f.root, 'linked-repo'));
  await assert.rejects(prepareControlledProof(f.options), /OUTSIDE_REPOSITORY/);
});

test('owner and each of ten player latest/pending nonces are checked', async t => {
  const f = await setup(t); const checked = new Map();
  f.options.provider.getTransactionCount = async (address, tag) => {
    checked.set(address, [...(checked.get(address) ?? []), tag]); return 0;
  };
  await planControlledProof(f.options);
  assert.equal(checked.size, 11);
  for (const tags of checked.values()) assert.deepEqual(tags, ['latest', 'pending']);
  for (const address of [f.config.expected_owner, ...f.config.roster.map(seat => seat.wallet_address)]) {
    f.options.provider.getTransactionCount = async (current, tag) => current === address && tag === 'pending' ? 1 : 0;
    await assert.rejects(planControlledProof(f.options), /PENDING_NONCE/);
  }
});

test('preparation fails for stale or future evidence, active chain, changed defaults, code or canonical block', async t => {
  for (const change of [
    f => { f.evidence.verified_at = new Date(f.options.now() + 1).toISOString(); },
    f => { f.evidence.expires_at = new Date(f.options.now()).toISOString(); },
    f => { f.preflight.active_game_id = '19'; }, f => { f.preflight.code_hash = HASH; },
    f => { f.preflight.config.joinDurationSeconds = '61'; },
    f => { f.options.chain.readBlockHash = async () => CODE_HASH; },
    f => { f.options.validateReadinessCurrent = async () => ({ ready: true }); },
    f => { f.options.validateReadinessCurrent = async () => ({ ready: true, evidence_sha256: runtimeEvidenceFingerprint(f.evidence), lifecycle_state_digest: '00'.repeat(32) }); },
    f => { f.evidence.ready_for_controlled_gameplay = true; f.evidence.remote_generation_attested = true; }
  ]) {
    const f = await setup(t); change(f); await json(f.options.evidencePath, f.evidence);
    await assert.rejects(prepareControlledProof(f.options));
    await assert.rejects(access(f.options.directory), { code: 'ENOENT' });
  }
});

test('locks fail closed without deleting live, foreign, malformed or recovery owners', async t => {
  for (const [type, value, code] of [
    ['runner.lock', { pid: process.pid, token: 'fixture', hostname: hostname() }, /PROCESS_RUNNING/],
    ['runner.lock', { pid: 123, token: 'fixture', hostname: 'foreign-host' }, /LOCK_AMBIGUOUS/],
    ['runner.lock', { pid: null }, /LOCK_AMBIGUOUS/],
    ['runner.lock.recovery', {}, /LOCK_RECOVERY_UNRESOLVED/],
    ['signer.lock', { pid: process.pid, token: 'fixture' }, /PROCESS_RUNNING/]
  ]) {
    const f = await setup(t);
    const filename = path.join(type.startsWith('signer') ? f.options.operatorDirectory : f.options.runnerDirectories[0], type);
    await json(filename, value);
    await assert.rejects(planControlledProof(f.options), code);
    assert.deepEqual(JSON.parse(await readFile(filename)), value);
  }
});

test('operator journal unresolved or uncanonical transactions block and are never reconciled or rewritten', async t => {
  for (const record of [
    { stage: 'reserved', status: 'rejected-before-submit' },
    { stage: 'broadcast', status: 'accepted', hash: HASH },
    { stage: 'uncertain', status: 'race-or-revert', hash: HASH },
    { stage: 'confirmed', status: 'accepted', hash: HASH },
    { stage: 'rejected', status: 'accepted' }
  ]) {
    const f = await setup(t);
    const journal = { schema_version: 1, role: 'operator', chain_id: 84532, contract: f.config.game_address,
      signer: f.config.expected_owner, records: { [configFingerprint(intent.action_id)]: { ...record, operation: 'create', intent } } };
    const filename = path.join(f.options.operatorDirectory, 'transactions.json'); await json(filename, journal);
    f.options.provider.getBlock = async () => ({ hash: CODE_HASH });
    await assert.rejects(planControlledProof(f.options), /JOURNAL_(UNRESOLVED|REORGED)/);
    assert.deepEqual(JSON.parse(await readFile(filename)), journal);
  }
});

test('canonical terminal operator transactions permit preparation', async t => {
  const f = await setup(t);
  await json(path.join(f.options.operatorDirectory, 'transactions.json'), { schema_version: 1, role: 'operator',
    chain_id: 84532, contract: f.config.game_address, signer: f.config.expected_owner, records: {
      [configFingerprint(intent.action_id)]: { operation: 'create', intent, stage: 'confirmed', status: 'accepted', hash: HASH },
      [configFingerprint('launch:second')]: { operation: 'create', intent: { ...intent, action_id: 'launch:second' }, stage: 'rejected', status: 'rejected-before-submit' }
    } });
  assert.equal((await planControlledProof(f.options)).status, 'ready');
});

test('prepared proof binds exact bytes, config/evidence paths and both deadlines', async t => {
  for (const mutate of [
    async f => appendFile(f.options.configPath, ' '), async f => appendFile(f.options.evidencePath, ' '),
    async f => { f.options.stopNewGamesAtMs += 1; }, async f => { f.options.hardStopAtMs += 1; },
    async f => { const alias = path.join(f.root, 'config-copy.json'); await json(alias, f.config); f.options.configPath = alias; },
    async f => { const filename = path.join(f.options.directory, 'config.json'); const config = JSON.parse(await readFile(filename)); config.poll_interval_ms += 1; await json(filename, config); }
  ]) {
    const f = await setup(t); await prepareControlledProof(f.options); await mutate(f);
    await assert.rejects(validatePreparedProof(f.options), /BINDINGS_CHANGED/);
  }
});

test('input mutation during current validation fails before any preparation output', async t => {
  const f = await setup(t); const verify = f.options.validateReadinessCurrent;
  f.options.validateReadinessCurrent = async args => { await appendFile(f.options.evidencePath, ' '); return verify(args); };
  await assert.rejects(prepareControlledProof(f.options), /INPUT_CHANGED_DURING_VALIDATION/);
  await assert.rejects(access(f.options.directory), { code: 'ENOENT' });
});

test('prepared configuration and binding mutations during current validation fail closed', async t => {
  for (const filename of ['config.json', 'proof-bindings.json']) {
    const f = await setup(t); await prepareControlledProof(f.options);
    const verify = f.options.validateReadinessCurrent;
    f.options.validateReadinessCurrent = async args => {
      await appendFile(path.join(f.options.directory, filename), ' ');
      return verify(args);
    };
    await assert.rejects(validatePreparedProof(f.options), /INPUT_CHANGED_DURING_VALIDATION/);
  }
});

test('last creation gate refreshes generations and refuses stale digest, nonces or deadlines', async t => {
  for (const mutate of [
    async f => appendFile(f.options.evidencePath, ' '),
    async f => { f.setCurrentReady(false); },
    async f => { f.options.provider.getTransactionCount = async (_, tag) => tag === 'pending' ? 1 : 0; },
    async f => { f.setNow(f.options.stopNewGamesAtMs); }
  ]) {
    const f = await setup(t); await prepareControlledProof(f.options); let calls = 0;
    f.options.launcher = { create: async () => { calls++; return { status: 'accepted' }; } };
    const guarded = await createGuardedLauncher(f.options); await mutate(f);
    await assert.rejects(guarded.create(intent)); assert.equal(calls, 0);
    await assert.rejects(access(path.join(f.options.directory, 'launch-once.json')), { code: 'ENOENT' });
  }
});

test('one-shot fuse exists before remote create, survives uncertain response, and prevents restart or concurrent re-creation', async t => {
  const f = await setup(t); await prepareControlledProof(f.options); let calls = 0;
  f.options.launcher = { create: async () => {
    calls++;
    const fuse = JSON.parse(await readFile(path.join(f.options.directory, 'launch-once.json')));
    assert.equal(fuse.runtime_evidence_sha256, runtimeEvidenceFingerprint(f.evidence));
    assert.equal(fuse.maximum_fresh_games, 1);
    throw new Error('provider raw secret');
  } };
  const guarded = await createGuardedLauncher(f.options);
  const attempts = await Promise.allSettled([guarded.create(intent), guarded.create(intent)]);
  assert.ok(attempts.every(result => result.status === 'rejected'));
  assert.equal(calls, 1);
  assert.ok(attempts.some(result => result.reason.message === 'PROOF_CREATION_UNCERTAIN'));
  assert.ok(attempts.every(result => !result.reason.message.includes('secret')));
  await assert.rejects(createGuardedLauncher(f.options), /ONE_GAME_FUSE_USED/);
  await assert.rejects(guarded.create(intent), /ONE_GAME_FUSE_USED/);
});

test('successful create response is sanitized and still consumes its single fuse', async t => {
  const f = await setup(t); await prepareControlledProof(f.options);
  f.options.launcher = { create: async () => ({ status: 'accepted', reference: { kind: 'transaction-hash', value: HASH }, raw_reply: 'not persisted' }) };
  const guarded = await createGuardedLauncher(f.options);
  assert.deepEqual(await guarded.create(intent), { status: 'accepted', reference: { kind: 'transaction-hash', value: HASH } });
  await assert.rejects(guarded.create(intent), /ONE_GAME_FUSE_USED/);
  assert.ok(!(await readFile(path.join(f.options.directory, 'launch-once.json'), 'utf8')).includes('raw_reply'));
});

test('real initialized fixture runner and designated operator ownership pass only with exact in-memory lock capabilities', async t => {
  const f = await setup(t); const prepared = await prepareControlledProof(f.options);
  const runtimeDir = path.join(f.options.directory, 'runtime');
  const adapters = createFixtureAdapters({ config: prepared.preparedConfig, now: f.options.now });
  const originalSnapshot = adapters.chain.readSnapshot;
  adapters.chain.readSnapshot = async (...args) => ({ ...await originalSnapshot(...args), block_number: '100', block_hash: HASH });
  adapters.chain.readBlockHash = async () => HASH;
  const runner = createConferenceRunner({ config: prepared.preparedConfig, runtimeDir,
    ...adapters, now: f.options.now });
  await runner.initialize();
  try {
    const runnerOwner = JSON.parse(await readFile(path.join(runtimeDir, 'runner.lock')));
    const operatorOwner = { pid: process.pid, token: 'fixture-operator-owned' };
    await json(path.join(f.options.operatorDirectory, 'signer.lock'), operatorOwner);
    const owners = [
      { role: 'runner', directory: runtimeDir, ...runnerOwner },
      { role: 'operator', directory: f.options.operatorDirectory, ...operatorOwner }
    ];
    await assert.rejects(validatePreparedProof(f.options), /PROCESS_RUNNING/);
    assert.equal((await validatePreparedProof({ ...f.options, ownedProcesses: owners })).status, 'ready');
    for (const mutate of [
      value => { value[0].token = 'different'; }, value => { value[1].pid += 1; },
      value => { value[0].directory = f.options.runnerDirectories[0]; },
      value => { value[0].hostname = 'foreign'; }, value => { value.push({ ...value[0] }); }
    ]) {
      const changed = structuredClone(owners); mutate(changed);
      await assert.rejects(validatePreparedProof({ ...f.options, ownedProcesses: changed }), /OWNED_/);
    }
    const otherFilename = path.join(f.options.runnerDirectories[0], 'runner.lock');
    await json(otherFilename, runnerOwner);
    await assert.rejects(validatePreparedProof({ ...f.options, ownedProcesses: owners }), /PROCESS_RUNNING/);
    await rm(otherFilename);
    let calls = 0;
    const guarded = await createGuardedLauncher({ ...f.options, ownedProcesses: owners,
      launcher: { create: async () => { calls++; return { status: 'accepted' }; } } });
    owners[0].token = 'mutated caller capability';
    assert.deepEqual(await guarded.create(intent), { status: 'accepted' });
    assert.equal(calls, 1);
    for (const filename of ['proof-bindings.json', 'launch-once.json', 'preflight.json']) {
      const contents = await readFile(path.join(f.options.directory, filename), 'utf8');
      assert.ok(!contents.includes(runnerOwner.token)); assert.ok(!contents.includes(operatorOwner.token));
    }
  } finally { await runner.close(); }
});

test('owned process capabilities cannot waive missing or changed locks immediately before create', async t => {
  for (const change of ['missing', 'token']) {
    const f = await setup(t); await prepareControlledProof(f.options);
    const filename = path.join(f.options.operatorDirectory, 'signer.lock');
    const owner = { pid: process.pid, token: 'operator-capability-fixture' };
    await json(filename, owner);
    let calls = 0;
    const guarded = await createGuardedLauncher({ ...f.options,
      ownedProcesses: [{ role: 'operator', directory: f.options.operatorDirectory, ...owner }],
      launcher: { create: async () => { calls++; return { status: 'accepted' }; } } });
    if (change === 'missing') await rm(filename); else await json(filename, { ...owner, token: 'changed' });
    await assert.rejects(guarded.create(intent), /OWNED_LOCK_(MISSING|CHANGED)/);
    assert.equal(calls, 0);
  }
});

test('hung read and raw provider error fail closed with fixed errors', async t => {
  const f = await setup(t);
  f.options.stopNewGamesAtMs = f.options.now() + 15;
  f.options.chain.preflight = () => new Promise(() => {});
  await assert.rejects(planControlledProof(f.options), /PROOF_DEADLINE_EXCEEDED/);
  f.options.chain.preflight = async () => { throw new Error('api-key-never-report-this'); };
  await assert.rejects(planControlledProof(f.options), { message: 'PROOF_CHAIN_READ_FAILED' });
});

test('known remote generation blocker survives sanitization while completed diagnostics never supply a permit', async t => {
  const f = await setup(t);
  f.options.validateReadinessCurrent = async () => { throw new Error('READINESS_REMOTE_GENERATION_UNATTESTED'); };
  await assert.rejects(prepareControlledProof(f.options), { message: 'READINESS_REMOTE_GENERATION_UNATTESTED' });
  await assert.rejects(access(f.options.directory), { code: 'ENOENT' });
});

test('operator receipts bind exact hash, sender and target, and nested private intent fields fail closed', async t => {
  for (const change of [
    receipt => { receipt.hash = CODE_HASH; }, receipt => { receipt.from = `0x${'11'.repeat(20)}`; },
    receipt => { receipt.to = `0x${'22'.repeat(20)}`; }
  ]) {
    const f = await setup(t);
    await json(path.join(f.options.operatorDirectory, 'transactions.json'), { schema_version: 1, role: 'operator',
      chain_id: 84532, contract: f.config.game_address, signer: f.config.expected_owner, records: {
        [configFingerprint(intent.action_id)]: { operation: 'create', intent, stage: 'confirmed', status: 'accepted', hash: HASH }
      } });
    const receipt = await f.options.provider.getTransactionReceipt(); change(receipt);
    f.options.provider.getTransactionReceipt = async () => receipt;
    await assert.rejects(planControlledProof(f.options), /JOURNAL_UNRESOLVED/);
  }
  const f = await setup(t);
  await json(path.join(f.options.operatorDirectory, 'transactions.json'), { schema_version: 1, role: 'operator',
    chain_id: 84532, contract: f.config.game_address, signer: f.config.expected_owner, records: {
      [configFingerprint(intent.action_id)]: { operation: 'create', intent: { ...intent, raw_reply: 'forbidden' },
        stage: 'rejected', status: 'rejected-before-submit' }
    } });
  await assert.rejects(planControlledProof(f.options), /JOURNAL_INVALID/);
});

test('uncertain remote creation timeout retains fuse and forbids all retries', async t => {
  const f = await setup(t); await prepareControlledProof(f.options);
  // Use the same bound deadline while moving only the synthetic clock forward.
  f.setNow(f.options.stopNewGamesAtMs - 15);
  const guarded = await createGuardedLauncher({ ...f.options, launcher: { create: () => new Promise(() => {}) } });
  await assert.rejects(guarded.create(intent), /PROOF_DEADLINE_EXCEEDED/);
  await assert.rejects(guarded.create(intent), /ONE_GAME_FUSE_USED/);
});

test('retired historical executable cannot load any signer, mutate files or call live services', async () => {
  await assert.rejects(import('../../../conference/operations/saved-helpers/controlled-proof.mjs'), /PROOF_VERSIONED_CLI_REQUIRED/);
});
