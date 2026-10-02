import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { Interface } from 'ethers';
import { fixtureConfig, createFixtureAdapters } from '../src/fixture.mjs';
import { buildControlledRuntimeEvidence, configFingerprint, runtimeEvidenceFingerprint } from '../src/readiness.mjs';
import { playerFundingBudget } from '../src/player-funding.mjs';
import { prepareControlledProof } from '../src/proof-control.mjs';
import { runControlledProof } from '../src/proof-run.mjs';
import { auditPinnedScoreboards } from '../src/telegram/proof-audit.mjs';
import { GAME_ABI } from '../src/chain/abi.mjs';

const hash = value => `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const json = (filename, value) => writeFile(filename, JSON.stringify(value));

async function fixture(t, { cancelled = false, hardStopOffset = 60000, adapterTimeout = 1000 } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'proof-run-fixture-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let time = Date.parse('2026-10-02T18:00:00Z');
  const now = () => time;
  const config = await fixtureConfig({ now: time, teamSizes: { openclaw: 5, hermes: 5 } });
  config.telegram.openclaw.chat_id = '-100111'; config.telegram.hermes.chat_id = '-100222';
  config.agent_timeout_ms = 10000; config.adapter_timeout_ms = adapterTimeout; config.spectator_timeout_ms = 1000;
  const defaults = { entryFeeWei: '100000000000000', creatorFeeBps: '100', causeFeeBps: '100',
    joinDurationSeconds: '60', commitDurationBlocks: '60', revealDurationBlocks: '40', minPlayers: '10', maxPlayers: '10', maxCauses: '2' };
  const runId = '00000000-0000-4000-8000-000000000111';
  const diagnostic = (seat, mode) => ({ schema_version: 1, type: 'runtime-diagnostic-response',
    request_id: `${runId}:${seat.seat_id}:1:${mode.replace('-', '_')}`, seat_id: seat.seat_id,
    team: seat.team, mode, status: 'ready', checks: Object.fromEntries(['stdin', 'wallet_identity', 'checkout', 'dependencies',
      'wrapper', 'private_state', 'seat_lock', 'chain_id', 'contract_read'].map(key => [key, true])) });
  const evidence = buildControlledRuntimeEvidence(config, { confirmedBlockNumber: '10', confirmedBlockHash: hash(10), now: time,
    producer: { producer_version: 1, diagnostic_run_id: runId, chain_id: 84532,
      game_address: config.game_address.toLowerCase(), game_code_hash: hash(999), chain_defaults_fingerprint: configFingerprint(defaults),
      generation_scope: 'diagnostic-run-intent-v1', remote_generation_attested: false, diagnostics_complete: true,
      lifecycle_state_digest: 'aa'.repeat(32) },
    seats: config.roster.map(seat => ({ seat_id: seat.seat_id, agent_id: seat.agent_id, harness: seat.harness,
      wallet_address: seat.wallet_address, framework_status_verified: true, direct_runtime_inspection_verified: true,
      wallet_identity_verified: true, persistent_storage_verified: true, tool_execution_verified: true,
      gameplay_command: ['node', `/volume/${seat.seat_id}/player-cli.mjs`, `/volume/${seat.seat_id}/seat.json`],
      artifact_sha256: 'ab'.repeat(32), activation_generation: 1, runtime_instance_fingerprint: 'de'.repeat(32),
      diagnostic_generations: { gameplay_input: 1, commit_input: 1 }, final_agent_status: 'sleeping', sleep_confirmed: true,
      lifecycle_ambiguous: false, model_profile: { model_endpoint: 'https://api.maritime.sh/api/llm/v1', model: 'gpt-5.4-mini',
        reasoning_effort: 'low', max_output_tokens: 2048, automatic_fallback: false },
      diagnostics: { gameplay_input: diagnostic(seat, 'gameplay-input'), commit_input: diagnostic(seat, 'commit-input') } })) });
  for (const name of ['readiness', 'operator', 'other-runner']) await mkdir(path.join(root, name));
  const adapters = createFixtureAdapters({ config, now, cancelGameIds: cancelled ? ['1'] : [] });
  adapters.chain.preflight = async () => {
    const snapshot = await adapters.chain.readSnapshot();
    return { chain_id: 84532, game_address: config.game_address, owner: config.expected_owner,
      active_game_id: snapshot.active_game_id, block_number: snapshot.block_number, block_hash: snapshot.block_hash,
      code_hash: hash(999), config: defaults, player_funding: playerFundingBudget(defaults.entryFeeWei, '5000000'),
      players: config.roster.map(seat => ({ seat_id: seat.seat_id, wallet_address: seat.wallet_address,
        admitted: true, cause_whitelisted: true, balance_wei: '15000000000000000' })) };
  };
  const options = { configPath: path.join(root, 'source.json'), evidencePath: path.join(root, 'readiness', 'readiness-v2.json'),
    readinessDirectory: path.join(root, 'readiness'), directory: path.join(root, 'prepared'),
    operatorDirectory: path.join(root, 'operator'), runnerDirectories: [path.join(root, 'other-runner')],
    stopNewGamesAtMs: time + Math.min(10000, hardStopOffset), hardStopAtMs: time + hardStopOffset, now,
    chain: adapters.chain, provider: { getTransactionCount: async () => 0 },
    validateReadinessCurrent: async ({ evidence: value }) => ({ ready: true,
      evidence_sha256: runtimeEvidenceFingerprint(value), lifecycle_state_digest: value.lifecycle_state_digest }) };
  await json(options.configPath, config); await json(options.evidencePath, evidence);
  await prepareControlledProof(options);
  let creates = 0, publishes = 0, advances = 0, dispatches = 0;
  const counts = () => ({ creates, publishes, advances, dispatches });
  const dependencies = { proofOptions: options, now, pause: async () => { time += 1000; },
    agents: { dispatch: async args => { dispatches++; return adapters.agents.dispatch(args); } },
    launcher: { create: async (intent, context) => {
      assert.equal(context?.signal instanceof AbortSignal, true);
      assert.equal(context.signal.aborted, false);
      creates++; return adapters.launcher.create(intent);
    } },
    phaseExecutor: { advance: async intent => { advances++; return adapters.phaseExecutor.advance(intent); } },
    spectator: { publish: async () => { publishes++; }, health: async () => ({ ok: true, pending: 0, inflight: 0 }),
      flush: async () => ({ ok: true, pending: 0, inflight: 0 }) } };
  return { root, config, evidence, options, adapters, dependencies, counts, advanceClock: amount => { time += amount; } };
}

test('real prepare, creation guard and runner produce one ten-seat completed candidate with claims and sanitized durable report', async t => {
  const f = await fixture(t);
  const teams = ['openclaw', 'hermes'];
  const bindings = { seriesId: 'proof-run-fixture', firstGameId: '1', messageIds: { openclaw: 3, hermes: 4 } };
  const scoreboard = { ok: true, series_id: bindings.seriesId, first_game_id: '1', completed: 1, ties: 1,
    wins: { openclaw: 0, hermes: 0 }, awards_wei: { openclaw: '490050000000000', hermes: '490050000000000' },
    pins: Object.fromEntries(teams.map(team => [team, { chat_id: f.config.telegram[team].chat_id,
      message_id: bindings.messageIds[team], status: 'sent' }])) };
  f.dependencies.spectator.health = async () => ({ ok: true, pending: 0, inflight: 0,
    scoreboard: { ...scoreboard, raw_provider_response: 'never-report-this' } });
  const report = await runControlledProof(f.dependencies);
  assert.equal(report.status, 'candidate-complete', JSON.stringify(report));
  assert.equal(report.proof_complete, false);
  assert.equal(report.candidate_proof_complete, true);
  assert.equal(report.awaiting_independent_audit, true);
  assert.equal(report.game_id, '1');
  assert.equal(report.final_chain.active_game_id, '0');
  assert.equal(report.final_chain.players, 10);
  assert.equal(report.runner_stopped, true);
  assert.equal(report.pending_dispatches, 0);
  assert.equal(f.counts().creates, 1);
  assert.equal(report.launch_attempts, 1);
  assert.equal(report.dispatches.length, 50);
  assert.deepEqual(report.telegram.scoreboard, scoreboard);
  assert.equal(report.result.game_id, '1'); assert.equal(report.result.outcome, 'completed');
  assert.equal(report.result.events.length, 1); assert.equal(report.result.events[0].data.awards.length, 10);
  assert.ok(!JSON.stringify(report).includes('never-report-this'));
  for (const seat of f.config.roster) for (const operation of ['join', 'discussion', 'commit', 'reveal', 'claim']) {
    assert.ok(report.dispatches.some(row => row.seat_id === seat.seat_id && row.operation === operation && ['submitted', 'observed'].includes(row.status)));
  }
  const saved = JSON.parse(await readFile(path.join(f.options.directory, 'proof-run.json')));
  assert.deepEqual(saved, report);
  for (const key of ['raw_reply', 'prompt', 'session', 'private_key', 'team_message']) assert.ok(!JSON.stringify(saved).includes(`"${key}"`));
  await access(path.join(f.options.directory, 'launch-once.json'));
  await assert.rejects(access(path.join(f.options.directory, 'runtime', 'runner.lock')), { code: 'ENOENT' });
  const before = f.counts();
  await assert.rejects(runControlledProof(f.dependencies), /ONE_GAME_FUSE_USED/);
  assert.deepEqual(f.counts(), before);

  // The run report is consumed unchanged by the independent scoreboard auditor.
  // ABI receipts, ledger and pin readbacks below are synthetic test evidence.
  const terminal = report.result.events[0];
  const text = 'Fixture scoreboard'; const textDigest = createHash('sha256').update(text).digest('hex');
  const awards = terminal.data.awards.map(award => ({ wallet: award.wallet_address, award_wei: award.award_wei })).sort((a, b) => a.wallet.localeCompare(b.wallet));
  const scope = { series_id: bindings.seriesId, first_game_id: '1', chain_id: 84532,
    game_address: f.config.game_address.toLowerCase(), roster: f.config.roster.map(seat => ({ wallet: seat.wallet_address.toLowerCase(), team: seat.team })).sort((a, b) => a.wallet.localeCompare(b.wallet)),
    chats: Object.fromEntries(teams.map(team => [team, f.config.telegram[team].chat_id])), message_ids: bindings.messageIds };
  const ledger = { schema_version: 1, scope, rejected_results: [], cancelled: [], defaults: {},
    results: [{ game_id: '1', transaction_hash: terminal.transaction_hash, result_id: `${terminal.transaction_hash}:${terminal.log_index}`,
      block_number: terminal.block_number, awards, awards_wei: scoreboard.awards_wei, winner: 'tie' }],
    pins: Object.fromEntries(teams.map(team => [team, { status: 'sent', text, sent_digest: textDigest, desired_digest: textDigest }])) };
  const abi = new Interface(GAME_ABI);
  const receipt = { status: 1, hash: terminal.transaction_hash, to: f.config.game_address,
    blockNumber: Number(terminal.block_number), blockHash: hash(terminal.block_number), logs: [{ address: f.config.game_address,
      index: terminal.log_index, removed: false, ...abi.encodeEventLog(abi.getEvent('GameEnded'), [1, 1, 2, 10, 0]) }] };
  const audit = await auditPinnedScoreboards({ config: f.config, gameId: '1', bindings, ledger, report,
    chainAudit: { proof_complete: true, defaulted_count: 0, game_id: '1', result_transaction_hash: terminal.transaction_hash,
      confirmed_block_number: report.final_chain.block_number }, token: 'fixture-audit-token',
    provider: { getTransactionReceipt: async () => receipt, getBlock: async number => ({ number, hash: hash(number) }),
      call: async transaction => {
        const { name, args } = abi.parseTransaction(transaction);
        if (name === 'playerCount') return abi.encodeFunctionResult(name, [10]);
        if (name === 'playerAt') return abi.encodeFunctionResult(name, [f.config.roster[Number(args[1])].wallet_address]);
        const value = awards.find(award => award.wallet === args[1].toLowerCase()).award_wei;
        return abi.encodeFunctionResult(name, [value, 0, value, true]);
      } },
    fetchImpl: async (_url, request) => { const { chat_id } = JSON.parse(request.body);
      const team = teams.find(team => scope.chats[team] === chat_id);
      return { status: 200, json: async () => ({ ok: true, result: { id: chat_id,
        pinned_message: { message_id: bindings.messageIds[team], chat: { id: chat_id }, text } } }) };
    } });
  assert.equal(audit.proof_complete, true, JSON.stringify(audit));
  assert.equal(audit.chain_awards_verified, true); assert.equal(audit.telegram_verified, true);
});

test('cancelled game refunds all ten seats without presenting a successful independent proof', async t => {
  const f = await fixture(t, { cancelled: true });
  const report = await runControlledProof(f.dependencies);
  assert.equal(report.status, 'terminal-incomplete', JSON.stringify(report));
  assert.equal(report.final_chain.outcome, 'cancelled');
  assert.equal(report.candidate_proof_complete, false);
  assert.equal(report.proof_complete, false);
  assert.equal(f.counts().creates, 1);
  assert.equal(report.dispatches.filter(row => row.operation === 'claim' && row.status === 'submitted').length, 10);
});

test('accepted creation waits through delayed confirmed visibility without retrying or guessing game identity', async t => {
  const f = await fixture(t);
  const idle = await f.adapters.chain.readSnapshot();
  const readSnapshot = f.adapters.chain.readSnapshot, readEvents = f.adapters.chain.readEvents;
  let visible = false, waitingPolls = 0;
  f.adapters.chain.readSnapshot = args => visible ? readSnapshot(args) : structuredClone(idle);
  f.adapters.chain.readEvents = args => visible ? readEvents(args) : [];
  const pause = f.dependencies.pause;
  f.dependencies.pause = async () => {
    if (visible) return pause();
    const pending = JSON.parse(await readFile(path.join(f.options.directory,'proof-run.json')));
    assert.equal(pending.creation.status,'accepted');
    assert.equal(pending.game_id,null);
    assert.equal(pending.dispatches.length,0);
    assert.equal(f.counts().creates,1);
    if (++waitingPolls === 3) visible = true;
  };
  const report = await runControlledProof(f.dependencies);
  assert.equal(waitingPolls,3);
  assert.equal(report.status,'candidate-complete',JSON.stringify(report));
  assert.equal(report.game_id,'1');
  assert.equal(report.failure,null);
  assert.equal(report.launch_attempts,1);
  assert.equal(f.counts().creates,1);
  assert.equal(report.dispatches.length,50);
  assert.ok(report.dispatches.every(row=>row.game_id==='1'));
  assert.equal(report.runner_stopped,true);
  assert.equal(report.pending_dispatches,0);
});

test('unconfirmed accepted creation remains bounded by the original hard deadline', async t => {
  const f = await fixture(t);
  const idle = await f.adapters.chain.readSnapshot();
  f.adapters.chain.readSnapshot = async () => structuredClone(idle);
  f.adapters.chain.readEvents = async () => [];
  f.dependencies.pause = async () => { f.advanceClock(60001); };
  const report = await runControlledProof(f.dependencies);
  assert.equal(report.failure.code,'PROOF_HARD_DEADLINE');
  assert.equal(report.game_id,null);
  assert.equal(report.creation.status,'accepted');
  assert.equal(f.counts().creates,1);
  assert.equal(f.counts().dispatches,0);
  assert.equal(f.counts().advances,0);
  assert.equal(report.runner_stopped,true);
});

test('accepted creation cannot dispatch against a different transaction, duplicate creation or mismatched snapshot', async t => {
  for (const kind of ['transaction','duplicate','snapshot']) await t.test(kind, async t => {
    const f = await fixture(t);
    if (kind === 'transaction') {
      const create = f.dependencies.launcher.create;
      f.dependencies.launcher.create = async (...args) => ({...await create(...args),
        reference:{kind:'transaction-hash',value:hash(999)}});
    } else if (kind === 'duplicate') {
      const readEvents = f.adapters.chain.readEvents;
      f.adapters.chain.readEvents = async args => {
        const events = await readEvents(args), created = events.find(event=>event.kind==='created');
        return created ? [...events,{...created,id:`${hash(999)}:0`}] : events;
      };
    } else {
      const readSnapshot = f.adapters.chain.readSnapshot;
      f.adapters.chain.readSnapshot = async args => {
        const snapshot = await readSnapshot(args);
        return snapshot.game_id === '0' ? snapshot : {...snapshot,game_id:'2',active_game_id:'2'};
      };
    }
    const report = await runControlledProof(f.dependencies);
    assert.equal(report.failure.code,kind==='transaction'?'PROOF_GAME_IDENTITY_UNVERIFIED':
      kind==='duplicate'?'PROOF_MULTIPLE_GAMES_OBSERVED':'PROOF_GAME_IDENTITY_CHANGED');
    assert.equal(f.counts().creates,1);
    assert.equal(f.counts().dispatches,0);
    assert.equal(f.counts().advances,0);
    assert.equal(report.runner_stopped,true);
    assert.equal(report.candidate_proof_complete,false);
  });
});

test('readiness refusal occurs before agent, spectator, phase or launch effect and before any execution state', async t => {
  const f = await fixture(t);
  f.options.validateReadinessCurrent = async () => { throw new Error('READINESS_REMOTE_GENERATION_UNATTESTED'); };
  const before = await readdir(f.options.directory);
  await assert.rejects(runControlledProof(f.dependencies), /READINESS_REMOTE_GENERATION_UNATTESTED/);
  assert.deepEqual(f.counts(), { creates: 0, publishes: 0, advances: 0, dispatches: 0 });
  assert.deepEqual(await readdir(f.options.directory), before);
});

test('one ambiguous join preserves nine late outcomes and stops without another game or phase mutation', async t => {
  const f = await fixture(t);
  const original = f.dependencies.agents.dispatch;
  let started = 0; let release;
  const allStarted = new Promise(resolve => { release = resolve; });
  f.dependencies.agents.dispatch = async args => {
    if (args.request.requested_action !== 'join') return original(args);
    started++; if (started === 10) release(); await allStarted;
    if (args.seat.seat_id === 'oc-1') throw Object.assign(new Error('provider-secret-never-serialize'), { ambiguous: true });
    await delay(30);
    return original(args);
  };
  const report = await runControlledProof(f.dependencies);
  assert.equal(started, 10);
  assert.equal(report.status, 'stopped');
  assert.equal(report.candidate_proof_complete, false);
  assert.equal(report.dispatches.filter(row => row.status === 'ambiguous').length, 1);
  assert.equal(report.dispatches.filter(row => row.status === 'submitted').length, 9);
  assert.equal(report.pending_dispatches, 0);
  assert.equal(f.counts().creates, 1); assert.equal(f.counts().advances, 0);
  assert.ok(!JSON.stringify(report).includes('provider-secret'));
});

test('absolute hard deadline prevents further actions and preserves the consumed fuse', async t => {
  const f = await fixture(t, { hardStopOffset: 5000 });
  f.dependencies.pause = async () => { f.advanceClock(6000); };
  const report = await runControlledProof(f.dependencies);
  assert.equal(report.status, 'stopped');
  assert.equal(report.failure.code, 'PROOF_HARD_DEADLINE');
  assert.equal(report.proof_complete, false); assert.equal(report.runner_stopped, true);
  assert.equal(f.counts().creates, 1); assert.equal(f.counts().dispatches, 0);
  await access(path.join(f.options.directory, 'launch-once.json'));
});

test('uncertain creation never retries, preserves fuse and sanitizes report', async t => {
  const f = await fixture(t); let calls = 0;
  f.dependencies.launcher.create = async () => { calls++; throw new Error('raw-rpc-key'); };
  const report = await runControlledProof(f.dependencies);
  assert.equal(calls, 1); assert.equal(report.launch_attempts, 1);
  assert.equal(report.failure.code, 'PROOF_CREATION_UNCERTAIN');
  assert.equal(report.proof_complete, false); assert.equal(report.runner_stopped, true);
  assert.ok(!JSON.stringify(report).includes('raw-rpc-key'));
  await access(path.join(f.options.directory, 'launch-once.json'));
  await assert.rejects(runControlledProof(f.dependencies), /ONE_GAME_FUSE_USED/);
});

test('existing execution state is never overwritten, even when no creation fuse exists', async t => {
  const f = await fixture(t);
  const filename = path.join(f.options.directory, 'proof-run.json'); await json(filename, { preserve: true });
  await assert.rejects(runControlledProof(f.dependencies), /PROOF_RUN_ALREADY_STARTED/);
  assert.deepEqual(JSON.parse(await readFile(filename)), { preserve: true });
  assert.equal(f.counts().creates, 0);
});

test('hangs after dispatched joins terminate at the absolute deadline and account for every started dispatch', async t => {
  const f = await fixture(t);
  // Cross the absolute deadline only after a raw dispatch has begun. Slow
  // fsync before launch cannot accidentally turn this into a no-dispatch test.
  f.dependencies.pause = async () => {};
  let started = 0;
  f.dependencies.agents.dispatch = () => {
    started++;
    if (started === 1) f.advanceClock(60001);
    return new Promise(() => {});
  };
  const startedAt = Date.now();
  const report = await runControlledProof(f.dependencies);
  assert.ok(Date.now() - startedAt < 15000);
  assert.ok(started > 0 && started <= 10);
  assert.equal(report.hard_stop_reached, true);
  assert.ok(['PROOF_HARD_DEADLINE', 'PROOF_RUNNER_HEALTH_BLOCKED'].includes(report.failure.code));
  assert.equal(report.pending_dispatches, 0);
  assert.ok(report.dispatches.length >= started && report.dispatches.length <= 10);
  assert.ok(report.dispatches.every(row => ['ambiguous', 'cancelled-after-submit', 'rejected-before-submit'].includes(row.status)));
  assert.equal(report.dispatches.filter(row => ['ambiguous', 'cancelled-after-submit'].includes(row.status)).length, started);
  assert.equal(report.runner_stopped, true);
  assert.equal(f.counts().creates, 1);
});

test('last readiness gate refusal after initialization produces no raw create and remains blocked on restart', async t => {
  const f = await fixture(t); const verify = f.options.validateReadinessCurrent;
  let checks = 0;
  f.options.validateReadinessCurrent = async args => {
    checks++;
    if (checks >= 3) throw new Error('READINESS_REMOTE_GENERATION_UNATTESTED');
    return verify(args);
  };
  const report = await runControlledProof(f.dependencies);
  assert.equal(report.status, 'stopped');
  assert.equal(report.candidate_proof_complete, false);
  assert.equal(report.failure.code, 'READINESS_REMOTE_GENERATION_UNATTESTED');
  assert.equal(f.counts().creates, 0);
  assert.equal(f.counts().dispatches, 0);
  await assert.rejects(access(path.join(f.options.directory, 'launch-once.json')), { code: 'ENOENT' });
  f.options.validateReadinessCurrent = verify;
  await assert.rejects(runControlledProof(f.dependencies), /PROOF_RUN_ALREADY_STARTED/);
});

test('serial readiness verification can exceed ordinary adapter timeout while launch remains bounded by explicit cutoff', async t => {
  const f = await fixture(t, { adapterTimeout: 10 });
  const verify = f.options.validateReadinessCurrent;
  f.options.validateReadinessCurrent = async args => {
    if (args.readOnly !== true) await delay(75);
    return verify(args);
  };
  f.dependencies.pause = async () => { f.advanceClock(60001); };
  const report = await runControlledProof(f.dependencies);
  assert.equal(f.counts().creates, 1);
  assert.equal(report.creation.status, 'accepted');
  assert.equal(report.failure.code, 'PROOF_HARD_DEADLINE');
  assert.equal(report.runner_stopped, true);
});
