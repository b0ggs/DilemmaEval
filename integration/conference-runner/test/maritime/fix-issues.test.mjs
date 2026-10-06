import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMaritimeAdapter } from '../../src/maritime/transport.mjs';
import { createSeatQuarantine } from '../../src/maritime/quarantine.mjs';
import { createConferenceRunner } from '../../src/runner/index.mjs';
import { createProofDispatchJournal } from '../../../../conference/operations/saved-helpers/proof-dispatch-journal.mjs';
import { TeamLogStore } from '../../../team-logs/src/index.js';
import { config, poke, reply, discussion, discussionReply, jsonResponse } from './fixtures.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const seats = Array.from({ length: 10 }, (_, index) => {
  const team = index < 5 ? 'openclaw' : 'hermes', id = `${index < 5 ? 'oc' : 'hs'}-${index % 5 + 1}`;
  return { seat_id: id, team, harness: team, agent_id: id, maritime_agent: id,
    wallet_address: `0x${(index + 1).toString(16).padStart(40, '0')}`, cause_id: index < 5 ? 1 : 2 };
});

async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(join(tmpdir(), 'conference-fix-issues-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const configuration = { ...config, purpose: 'debug', roster: seats, agent_timeout_ms: 5000,
    start_block: '100', start_time: new Date(Date.now() - 1000).toISOString(),
    stop_time: new Date(Date.now() + 3600_000).toISOString(), ...options.config };
  const quarantine = await createSeatQuarantine({ directory, config: configuration });
  const runtimeEvidence = { schema_version: 2, run_id: configuration.run_id, seats: seats.map(seat => ({
    seat_id: seat.seat_id, agent_id: seat.agent_id,
    gameplay_command: ['node', `/volume/${seat.seat_id}/player-cli.mjs`, `/volume/${seat.seat_id}/seat.json`]
  })) };
  const statuses = new Map(seats.map(seat => [seat.agent_id, 'sleeping']));
  const calls = [], chats = [], verifications = new Map();
  let maximum = 0;
  const adapterOptions = { config: configuration, apiKey: 'fixture-credential', runtimeEvidence,
    maxAwake: 5, maxAgents: 10, debug: true, quarantine, wakeDelayMs: 0, cleanupTimeoutMs: 3000,
    verifyRecoveredResponse: async () => true, verifyPublicReferences: async () => true,
    runtimeContinuity: {
      verify: async context => {
        const { seat } = context;
        const count = (verifications.get(seat.seat_id) ?? 0) + 1;
        verifications.set(seat.seat_id, count);
        await options.verify?.(seat, count, context);
        return { schema_version: 1, verified: true };
      },
      prepareAction: async () => ({ schema_version: 1, verified: true })
    },
    fetchImpl: async (url, init) => {
      const path = new URL(url).pathname, id = path.split('/')[3];
      const seat = seats.find(row => row.agent_id === id);
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ path, method: init.method });
      if (path === '/api/agents') return jsonResponse(seats.map(row => ({ id: row.agent_id,
        framework: row.harness, status: statuses.get(row.agent_id) })));
      if (init.method === 'GET') {
        await options.read?.(seat, statuses.get(id));
        return jsonResponse({ id, framework: seat.harness, status: statuses.get(id) });
      }
      if (path.endsWith('/start')) {
        statuses.set(id, 'active'); maximum = Math.max(maximum, [...statuses.values()].filter(value => value === 'active').length);
        return jsonResponse({ id, framework: seat.harness, status: 'active' });
      }
      if (path.endsWith('/sleep')) {
        await options.sleep?.(seat);
        statuses.set(id, 'sleeping');
        return jsonResponse({ id, framework: seat.harness, status: 'sleeping' });
      }
      if (path.endsWith('/exec')) {
        if (body.command[3]?.includes('stagePublicRequest')) {
          const spec = JSON.parse(body.command[4]);
          return jsonResponse({ exitCode: 0, stdout: JSON.stringify({ ready: true, sha256: spec.sha256 }), stderr: '' });
        }
        if (options.inspection) return options.inspection(body.command);
        assert.equal(body.command.length, 4, 'recovery is a read-only sanitized journal command');
        return jsonResponse({ exitCode: 0, stdout: JSON.stringify(options.recovered), stderr: '' });
      }
      assert.ok(path.endsWith('/chat'));
      const request = JSON.parse(body.message.split('REQUEST_JSON\n')[1]);
      chats.push({ seat, request, ...body });
      if (options.chat) return options.chat({ seat, request, body, count: chats.filter(row => row.request.request_id === request.request_id).length });
      return jsonResponse({ response: JSON.stringify(request.type === 'discussion' ?
        discussionReply(request, { team_message: 'Consider the team payout.' }) : reply(request)) });
    }
  };
  const adapter = createMaritimeAdapter(adapterOptions);
  return { directory, config: configuration, adapter, adapterOptions, quarantine, calls, chats, statuses, get maximum() { return maximum; } };
}

for (const stage of ['pre-chat', 'chat', 'completed-cleanup']) {
  test(`timeout evidence names ${stage} without releasing unknown work or repeating chat`, async t => {
    const f = await fixture(t, {
      ...(stage === 'chat' ? { chat: () => new Promise(() => {}) } : {
        inspection: () => new Promise(() => {}),
        verify: async (_seat, count, { execute, on_check: onCheck }) => {
          onCheck('model_route');
          if (count === (stage === 'pre-chat' ? 1 : 2)) await execute(['node', 'fixture-inspection']);
        }
      })
    });
    const adapter = createMaritimeAdapter({ ...f.adapterOptions, timeoutMs: 25, cleanupTimeoutMs: 25 });
    const report = { dispatches: [] };
    const journal = createProofDispatchJournal({ adapter, report, persist: async () => {},
      stopController: new AbortController(), debug: true });
    const request = poke('join', seats[0]);
    await assert.rejects(journal.dispatch({ seat: seats[0], request }), error => {
      assert.equal(error.transport_code ?? error.code, 'MARITIME_TIMEOUT');
      assert.equal(error.diagnostic_code, `MARITIME_${stage.toUpperCase().replaceAll('-', '_')}_TIMEOUT`);
      return true;
    });
    assert.equal(report.dispatches[0].diagnostic_code, `MARITIME_${stage.toUpperCase().replaceAll('-', '_')}_TIMEOUT`);
    const evidence = report.dispatches[0].dispatch_diagnostics;
    assert.equal(evidence.failure.stage, stage === 'pre-chat' ? 'runtime_verify' : stage === 'chat' ? 'chat' : 'final_verify');
    assert.equal(evidence.failure.timeout_source, stage === 'chat' ? 'http_request' : 'runtime_verification');
    if (stage !== 'chat') assert.equal(evidence.failure.check, 'model_route');
    assert.ok(evidence.failure.timeout_ms > 0 && evidence.failure.elapsed_ms >= 0);
    assert.equal(evidence.remote_work, 'unknown'); assert.equal(evidence.cleanup_confirmed, false);
    assert.equal(f.chats.length, stage === 'pre-chat' ? 0 : 1);
    assert.equal(f.calls.filter(row => row.path.endsWith('/sleep')).length, 0);
    assert.deepEqual(await f.quarantine.reservedAgentIds(), [seats[0].agent_id]);
  });
}

for (const oversized of [false, true]) {
  test(`completed ${oversized ? 'oversized' : 'malformed'} discussion gets one deterministic repair without another wake`, async t => {
    const f = await fixture(t, { chat: ({ request, count }) => jsonResponse({ response: count === 1 ?
      oversized ? 'x'.repeat(16_385) : '{invalid rejected text' : JSON.stringify(discussionReply(request, { team_message: 'Consider the payout.' })) }) });
    const request = discussion(seats[0]);
    const result = await f.adapter.dispatch({ seat: seats[0], request });
    assert.equal(result.team_message, 'Consider the payout.');
    assert.equal(f.chats.length, 2);
    assert.deepEqual(f.chats.map(row => row.request), [request, request]);
    assert.equal(f.chats[1].message.includes('invalid rejected text'), false);
    assert.equal(f.chats[1].conversation_id, `${f.chats[0].conversation_id}${oversized ? ':discussion-retry-1' : ''}`);
    assert.equal(f.calls.filter(row => row.path.endsWith('/start')).length, 1);
    assert.deepEqual(await f.quarantine.reservedAgentIds(), []);
    assert.deepEqual(await f.adapter.dispatch({ seat: seats[0], request }), result);
    assert.equal(f.chats.length, 2, 'completed cached request is not replayed');
    const restarted = createMaritimeAdapter(f.adapterOptions);
    f.chats.length = 0;
    await restarted.dispatch({ seat: seats[0], request });
    assert.equal(f.chats[1].conversation_id, `${f.chats[0].conversation_id}${oversized ? ':discussion-retry-1' : ''}`);
  });
}

test('five completed discussion failures release capacity after confirmed sleep and debug commits remain eligible', async t => {
  let firstWave = 0, release;
  const admitted = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { sleep: () => delay(15), chat: async ({ seat, request, count }) => {
    if (request.type === 'discussion' && seat.team === 'openclaw' && count === 1) {
      if (++firstWave === 5) release();
      await admitted;
    }
    return jsonResponse({ response:
    request.type === 'discussion' && seat.team === 'openclaw' ? '{bad' : JSON.stringify(request.type === 'discussion' ?
      discussionReply(request, { team_message: 'Consider the payout.' }) : reply(request)) });
  } });
  const snapshot = { schema_version: 1, chain_id: 84532, game_address: f.config.game_address,
    game_id: '7', active_game_id: '7', round: 1, phase: 'commit', outcome: null,
    block_number: '100', block_hash: `0x${'a'.repeat(64)}`, block_timestamp: '1000',
    alive_count: 10, committed_count: 0, revealed_count: 0, clock: { unit: 'block', current: '100', deadline: '999' },
    config: { entryFeeWei: '100', minPlayers: '10', maxPlayers: '10' },
    players: seats.map(seat => ({ wallet_address: seat.wallet_address, joined: true, alive: true, committed: false, revealed: false })) };
  const report = { dispatches: [] };
  const journal = createProofDispatchJournal({ adapter: f.adapter, report, persist: async () => {}, stopController: new AbortController(), debug: true });
  const runner = createConferenceRunner({ config: f.config, runtimeDir: join(f.directory, 'runner'), agents: journal,
    chain: { readSnapshot: async () => snapshot, readEvents: async () => [] },
    launcher: { create: async () => assert.fail('no creation') }, phaseExecutor: { advance: async () => assert.fail('no advance') } });
  t.after(() => runner.close());
  await runner.tick();
  assert.equal(f.chats.filter(row => row.request.type === 'discussion').length, 15);
  assert.equal(f.chats.filter(row => row.request.requested_action === 'commit').length, 10);
  assert.equal(report.dispatches.filter(row => row.operation === 'discussion' && row.cleanup_confirmed).length, 5);
  assert.deepEqual(await f.quarantine.reservedAgentIds(), []); assert.equal(f.maximum, 5);
});

test('real runner and transport admit a second wave after the first action allowance, with separate completed cleanup', async t => {
  let release;
  const allEnqueued = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { config: { agent_timeout_ms: 1000 },
    verify: (seat, count) => count === 2 ? delay(700) : undefined,
    read: (seat, status) => status === 'sleeping' ? delay(400) : undefined,
    chat: async ({ request }) => { await allEnqueued; await delay(50); return jsonResponse({ response: JSON.stringify(reply(request)) }); } });
  const snapshot = { schema_version: 1, chain_id: 84532, game_address: f.config.game_address,
    game_id: '7', active_game_id: '7', round: 1, phase: 'reveal', outcome: null,
    block_number: '100', block_hash: `0x${'a'.repeat(64)}`, block_timestamp: '1000', alive_count: 10,
    committed_count: 10, revealed_count: 0, clock: { unit: 'block', current: '100', deadline: '999' },
    config: { entryFeeWei: '100', minPlayers: '10', maxPlayers: '10' },
    players: seats.map(seat => ({ wallet_address: seat.wallet_address, joined: true, alive: true, committed: true, revealed: false })) };
  const report = { dispatches: [] };
  const journal = createProofDispatchJournal({ adapter: f.adapter, report,
    persist: async () => { if (report.dispatches.length === 10) release(); }, stopController: new AbortController(), debug: true });
  const runner = createConferenceRunner({ config: f.config, runtimeDir: join(f.directory, 'runner'), agents: journal,
    chain: { readSnapshot: async () => snapshot, readEvents: async () => [] },
    launcher: { create: async () => assert.fail('no creation') }, phaseExecutor: { advance: async () => assert.fail('no advance') } });
  t.after(() => runner.close());
  const started = Date.now(); await runner.tick();
  assert.ok(Date.now() - started > 2200);
  assert.equal(f.chats.length, 10); assert.equal(f.maximum, 5);
  assert.deepEqual(await f.quarantine.reservedAgentIds(), []);
  assert.deepEqual(runner.getState().health, []);
  const secondWave = report.dispatches.map(row => row.dispatch_diagnostics).sort((a, b) => b.queue_ms - a.queue_ms)[0];
  assert.ok(secondWave.queue_ms > 1000);
  assert.ok(secondWave.action_ms < 1000 && secondWave.cleanup_ms >= 1000);
  assert.equal(secondWave.cleanup_confirmed, true);
});

for (const step of ['sleep', 'sleep_confirm']) {
  test(`completed chat records the exact ${step} timeout while retaining the seat`, async t => {
    const f = await fixture(t, { ...(step === 'sleep' ? { sleep: () => new Promise(() => {}) }
      : { read: (_seat, status) => status === 'sleeping' ? new Promise(() => {}) : undefined }) });
    const adapter = createMaritimeAdapter({ ...f.adapterOptions, timeoutMs: 100, cleanupTimeoutMs: 25 });
    const report = { dispatches: [] };
    const journal = createProofDispatchJournal({ adapter, report, persist: async () => {}, stopController: new AbortController(), debug: true });
    await assert.rejects(journal.dispatch({ seat: seats[0], request: poke('join', seats[0]) }));
    const evidence = report.dispatches[0].dispatch_diagnostics;
    assert.equal(evidence.failure.stage, step);
    assert.equal(evidence.failure.timeout_source, 'http_request');
    assert.equal(evidence.cleanup_confirmed, false);
    assert.equal(evidence.remote_work, step === 'sleep' ? 'unknown' : 'completed');
    assert.deepEqual(await f.quarantine.reservedAgentIds(), [seats[0].agent_id]);
    assert.equal(f.chats.length, 1);
  });
}

test('cleanup failure preserves the original invalid reply and excludes rejected text and provider prose', async t => {
  const f = await fixture(t, { chat: () => jsonResponse({ response: '{SECRET_REJECTED_REPLY' }),
    sleep: () => { throw new Error('SECRET_PROVIDER_BODY'); } });
  const report = { dispatches: [] };
  const journal = createProofDispatchJournal({ adapter: f.adapter, report, persist: async () => {}, stopController: new AbortController(), debug: true });
  await assert.rejects(journal.dispatch({ seat: seats[0], request: discussion(seats[0]) }));
  const evidence = report.dispatches[0].dispatch_diagnostics;
  assert.equal(evidence.failure.stage, 'reply_validation');
  assert.equal(evidence.failure.code, 'MARITIME_REPLY_INVALID_JSON');
  assert.equal(evidence.cleanup_failure.stage, 'sleep');
  assert.equal(evidence.cleanup_failure.code, 'MARITIME_NETWORK_OUTCOME_UNKNOWN');
  assert.equal(JSON.stringify(report).includes('SECRET_'), false);
  assert.equal(f.chats.length, 2);
});

test('outer action timer retains the active stage even when the adapter never returns', async t => {
  const f = await fixture(t, { config: { agent_timeout_ms: 25 } });
  const snapshot = { schema_version: 1, chain_id: 84532, game_address: f.config.game_address,
    game_id: '7', active_game_id: '7', round: 1, phase: 'reveal', outcome: null,
    block_number: '100', block_hash: `0x${'a'.repeat(64)}`, block_timestamp: '1000',
    alive_count: 1, committed_count: 1, revealed_count: 0, clock: { unit: 'block', current: '100', deadline: '999' },
    config: { entryFeeWei: '100', minPlayers: '10', maxPlayers: '10' },
    players: seats.map((seat, i) => ({ wallet_address: seat.wallet_address, joined: true, alive: i === 0, committed: i === 0, revealed: false })) };
  const report = { dispatches: [] };
  const journal = createProofDispatchJournal({ adapter: { capacityManaged: true, dispatch: async args => {
    await args.on_admitted(); args.diagnostics.stage('chat'); args.diagnostics.remoteWork('unknown');
    return new Promise(() => {});
  } }, report, persist: async () => {}, stopController: new AbortController(), debug: true });
  const runtimeDir = join(f.directory, 'outer-timer');
  const runner = createConferenceRunner({ config: f.config, runtimeDir, agents: journal,
    chain: { readSnapshot: async () => snapshot, readEvents: async () => [] },
    launcher: { create: async () => assert.fail('no creation') }, phaseExecutor: { advance: async () => assert.fail('no advance') } });
  t.after(() => runner.close());
  await runner.tick();
  assert.equal(report.dispatches.length, 1);
  assert.equal(report.dispatches[0].dispatch_diagnostics.failure.stage, 'chat');
  assert.equal(report.dispatches[0].dispatch_diagnostics.failure.timeout_source, 'action_allowance');
  const records = JSON.parse(await fs.readFile(join(runtimeDir, 'coordinator/records.json'), 'utf8'));
  const unknown = records.entries.find(row => row.value.action === 'reveal').value;
  assert.equal(unknown.state, 'unknown');
  assert.equal(unknown.dispatch_diagnostics.failure.stage, 'chat');
});

for (const failure of ['502', 'timeout']) {
  test(`lost ${failure} reply recovers one canonical action but reserves a running job until later completion and sleep`, async t => {
    const request = poke('reveal', seats[0]);
    const recovered = reply(request, { status: 'submitted', transaction_hash: `0x${'b'.repeat(64)}` });
    const f = await fixture(t, { recovered, chat: ({ request: current }) => current.request_id !== request.request_id ?
      jsonResponse({ response: JSON.stringify(reply(current)) }) : failure === '502' ? new Response('{}', { status: 502 }) : new Promise(() => {}) });
    const adapter = createMaritimeAdapter({ ...f.adapterOptions, timeoutMs: 10 });
    await assert.rejects(adapter.dispatch({ seat: seats[0], request }), error => {
      assert.deepEqual(error.recovered_response, recovered); assert.equal(error.ambiguous, true); return true;
    });
    assert.equal(f.chats.length, 1); assert.equal(f.calls.filter(row => row.path.endsWith('/sleep')).length, 0);
    await assert.rejects(adapter.dispatch({ seat: seats[0], request: poke('commit', seats[0]) }), /MARITIME_SEAT_QUARANTINED/);
    assert.deepEqual(await f.quarantine.reservedAgentIds(), [seats[0].agent_id]);
    await assert.rejects(adapter.resolveSeat({ seat: seats[0], requestId: request.request_id, jobEndedAtMs: Date.now(),
      sleepingObservedAtMs: Date.now() - 1, status: 'sleeping' }), /MARITIME_QUARANTINE_INVALID/);
    const jobEndedAtMs = Date.now(); await delay(2);
    f.statuses.set(seats[0].agent_id, 'sleeping');
    await adapter.resolveSeat({ seat: seats[0], requestId: request.request_id, jobEndedAtMs,
      sleepingObservedAtMs: Date.now(), status: 'sleeping' });
    assert.deepEqual(await f.quarantine.reservedAgentIds(), []);
    assert.equal((await adapter.dispatch({ seat: seats[0], request: poke('commit', seats[0]) })).status, 'observed');
    assert.equal(f.chats.filter(row => row.request.request_id === request.request_id).length, 1, 'lost signing request was never sent twice');
  });
}

test('verified public transaction dialogue survives durable log restart and inference context', async t => {
  const hash = `0x${'b'.repeat(64)}`, request = poke('reveal', seats[0]);
  const f = await fixture(t, { chat: ({ request }) => jsonResponse({ response: JSON.stringify(reply(request, {
    status: 'submitted', transaction_hash: hash, team_message: `Read transaction ${hash}.`
  })) }) });
  const response = await f.adapter.dispatch({ seat: seats[0], request });
  const options = { runtimeRoot: f.directory, gameId: request.game_id, seats, limits: { maxMessageChars: null, maxSnapshotChars: null } };
  const logs = new TeamLogStore(options);
  assert.equal((await logs.acceptResponse(response, request)).accepted, true);
  const restored = await new TeamLogStore(options).buildSnapshot(seats[0]);
  assert.equal(restored.messages[0].message, response.team_message);
  assert.deepEqual(restored.messages[0].public_transaction_hashes, [hash]);
});

test('completed chat does not release an unknown remote inspection job', async t => {
  const f = await fixture(t, { inspection: () => new Promise(() => {}),
    verify: async (seat, count, context) => { if (count === 2) await context.execute(['node', '/fixture/inspect.mjs']); } });
  const adapter = createMaritimeAdapter({ ...f.adapterOptions, timeoutMs: 50 });
  await assert.rejects(adapter.dispatch({ seat: seats[0], request: discussion(seats[0]) }),
    error => error.ambiguous === true);
  assert.deepEqual(await f.quarantine.reservedAgentIds(), [seats[0].agent_id]);
  assert.equal(f.calls.filter(row => row.path.endsWith('/sleep')).length, 0);
  await assert.rejects(adapter.dispatch({ seat: seats[0], request: poke('commit', seats[0]) }), /MARITIME_SEAT_QUARANTINED/);
});

test('expired queued phase prevents a fresh wake and signing dispatch through the real runner', async t => {
  let admitted = 0, release;
  const firstWave = new Promise(resolve => { release = resolve; });
  let snapshot;
  const f = await fixture(t, { chat: async ({ request }) => {
    if (++admitted === 5) release();
    await firstWave;
    return jsonResponse({ response: JSON.stringify(reply(request)) });
  }, sleep: () => { snapshot.clock = { unit: 'block', current: '100', deadline: '99' }; } });
  snapshot = { schema_version: 1, chain_id: 84532, game_address: f.config.game_address,
    game_id: '7', active_game_id: '7', round: 1, phase: 'reveal', outcome: null,
    block_number: '100', block_hash: `0x${'a'.repeat(64)}`, block_timestamp: '1000', alive_count: 10,
    committed_count: 10, revealed_count: 0, clock: { unit: 'block', current: '100', deadline: '999' },
    config: { entryFeeWei: '100', minPlayers: '10', maxPlayers: '10' },
    players: seats.map(seat => ({ wallet_address: seat.wallet_address, joined: true, alive: true, committed: true, revealed: false })) };
  const runner = createConferenceRunner({ config: f.config, runtimeDir: join(f.directory, 'runner'), agents: f.adapter,
    chain: { readSnapshot: async () => structuredClone(snapshot), readEvents: async () => [] },
    launcher: { create: async () => assert.fail('no creation') }, phaseExecutor: { advance: async () => {
      snapshot.phase = 'terminal'; snapshot.active_game_id = '0';
      return { status: 'accepted', reference: { kind: 'transaction-hash', value: `0x${'b'.repeat(64)}` } };
    } } });
  t.after(() => runner.close()); await runner.tick();
  assert.equal(f.chats.length, 5); assert.equal(f.calls.filter(row => row.path.endsWith('/start')).length, 5);
  assert.ok(f.chats.every(row => row.seat.team === 'openclaw'));
  assert.deepEqual(await f.quarantine.reservedAgentIds(), []);
});
