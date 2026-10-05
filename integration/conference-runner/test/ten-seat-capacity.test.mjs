import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { fixtureConfig } from '../src/fixture.mjs';
import { createMaritimeAdapter } from '../src/maritime/index.mjs';
import { poke, reply, jsonResponse } from './maritime/fixtures.mjs';

// Local HTTP fixtures exercise the real scheduler. No Maritime calls, signing,
// player execution or live readiness evidence are produced by these tests.
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function eventually(predicate) {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return;
    await delay(5);
  }
  assert.fail('Synthetic lifecycle did not reach its expected barrier');
}

async function setup({ unrelated = [], inventory, chat, sleep, timeoutMs = 1000 } = {}) {
  const config = await fixtureConfig({ runId: 'synthetic-ten-seat-capacity', teamSizes: { openclaw: 5, hermes: 5 } });
  const status = new Map([...config.roster.map(seat => [seat.agent_id, 'sleeping']), ...unrelated.map(agent => [agent.id, agent.status])]);
  const runtimeEvidence = { schema_version: 2, run_id: config.run_id, seats: config.roster.map(seat => ({
    seat_id: seat.seat_id, agent_id: seat.agent_id,
    gameplay_command: ['node', `/volume/synthetic/${seat.seat_id}/player-cli.mjs`, `/volume/synthetic/${seat.seat_id}/seat.json`]
  })) };
  const calls = [];
  const lateChats = [];
  let maximumAwake = 0;
  const awake = () => [...status.values()].filter(value => !['sleeping', 'stopped'].includes(value)).length;
  const fetchImpl = async (url, options) => {
    const pathname = new URL(url).pathname;
    if (options.method === 'GET') {
      assert.equal(pathname, '/api/agents');
      calls.push({ kind: 'inventory' });
      const rows = [...status].map(([id, state]) => ({ id, status: state }));
      return jsonResponse(inventory ? inventory(rows) : rows);
    }
    const seat = config.roster.find(row => row.agent_id === pathname.split('/')[3]);
    assert.ok(seat, 'the scheduler must never mutate unrelated agents');
    const kind = pathname.split('/').at(-1);
    const call = { kind, seat_id: seat.seat_id };
    calls.push(call);
    const body = options.body && JSON.parse(options.body);
    if (kind === 'reload-env') {
      assert.equal(status.get(seat.agent_id), 'sleeping');
      status.set(seat.agent_id, 'active');
      maximumAwake = Math.max(maximumAwake, awake());
      assert.ok(awake() <= 5, 'account-wide awake count exceeded five');
      return jsonResponse({ status: 'active' });
    }
    if (kind === 'exec') {
      const command = body.command;
      if (command.includes('--configure-hermes-config')) {
        call.kind = 'hermes-config';
        assert.equal(seat.harness, 'hermes');
        return jsonResponse({ exitCode: 0, stderr: '', stdout: JSON.stringify({
          schema_version: 1, seat_id: seat.seat_id, configured: true, variable: 'GAMEPLAY_WALLET_PRIVATE_KEY',
          config_owner_configured: true, private_state_owner_configured: true, runtime_identity: { uid: 10000, gid: 10000 }
        }) });
      }
      if (command.includes('--configure-model')) {
        call.kind = 'model-config';
        return jsonResponse({ exitCode: 0, stderr: '', stdout: JSON.stringify({
          schema_version: 1, seat_id: seat.seat_id, harness: seat.harness, configured: true, model: 'gpt-6.1-sol',
          reasoning_effort: 'low', max_output_tokens: 2048, automatic_fallback: false,
          fallback_model: null, response_metadata_required: true
        }) });
      }
      call.kind = 'stage';
      assert.equal(command[1], '--input-type=module');
      assert.ok(command[3].includes('stagePublicRequest'));
      const spec = JSON.parse(command[4]);
      assert.deepEqual(JSON.parse(spec.content), { request: poke('join', seat) });
      return jsonResponse({ exitCode: 0, stderr: '', stdout: JSON.stringify({ ready: true, sha256: spec.sha256 }) });
    }
    if (kind === 'chat') {
      const request = JSON.parse(body.message.split('REQUEST_JSON\n')[1]);
      assert.deepEqual(request, poke('join', seat));
      const value = jsonResponse({ response: JSON.stringify(reply(request)) });
      return chat ? chat({ seat, request, signal: options.signal, value, lateChats }) : value;
    }
    if (kind === 'sleep') {
      const custom = await sleep?.({ seat, call });
      const result = custom ?? jsonResponse({ status: 'sleeping' });
      if (result.status === 200 && (await result.clone().json()).status === 'sleeping') {
        status.set(seat.agent_id, 'sleeping');
        calls.push({ kind: 'sleep-confirmed', seat_id: seat.seat_id });
      }
      return result;
    }
    assert.fail('Unexpected synthetic HTTP operation');
  };
  const adapter = createMaritimeAdapter({ config, apiKey: 'synthetic-capacity-credential', runtimeEvidence, fetchImpl,
    maxAwake: 5, maxAgents: 20, wakeDelayMs: 0, timeoutMs });
  const parameters = config.roster.map(seat => ({ seat, request: poke('join', seat) }));
  return { adapter, config, calls, lateChats, status, parameters, awake, get maximumAwake() { return maximumAwake; },
    burst(deadline = Date.now() + 3000, signals = []) {
      return Promise.allSettled(parameters.map((input, index) => adapter.dispatch({ ...input,
        deadline_at_ms: deadline, ...(signals[index] ? { signal: signals[index] } : {}) })));
    }
  };
}

function count(fixture, kind) { return fixture.calls.filter(call => call.kind === kind).length; }
function assertExpired(outcome) {
  assert.equal(outcome.status, 'rejected');
  assert.equal(outcome.reason.code, 'MARITIME_DISPATCH_EXPIRED');
  assert.equal(outcome.reason.ambiguous, false);
  assert.equal(outcome.reason.retryable, true);
}

test('ten-seat transport rotates two full waves only after all occupied permits confirm sleep', async t => {
  const chatGate = deferred();
  const gate = deferred();
  t.after(() => { chatGate.resolve(); gate.resolve(); });
  const f = await setup({
    chat: async ({ seat, value }) => { if (seat.team === 'openclaw') await chatGate.promise; return value; },
    sleep: async ({ seat }) => { if (seat.team === 'openclaw') await gate.promise; }
  });
  const outcomes = f.burst();
  await eventually(() => count(f, 'chat') === 5);
  assert.equal(count(f, 'reload-env'), 5, 'slow chat keeps all five permits occupied');
  assert.equal(count(f, 'sleep'), 0);
  chatGate.resolve();
  await eventually(() => count(f, 'sleep') === 5);
  assert.equal(count(f, 'reload-env'), 5);
  assert.equal(count(f, 'chat'), 5);
  assert.equal(count(f, 'sleep-confirmed'), 0);
  assert.equal(f.awake(), 5);
  gate.resolve();
  assert.ok((await outcomes).every(outcome => outcome.status === 'fulfilled'));
  assert.equal(f.maximumAwake, 5);
  assert.equal(f.awake(), 0);
  assert.equal(count(f, 'reload-env'), 10);
  assert.equal(count(f, 'sleep-confirmed'), 10);
  for (const seat of f.config.roster) {
    assert.deepEqual(f.calls.filter(call => call.seat_id === seat.seat_id).map(call => call.kind), [
      'reload-env', ...(seat.harness === 'hermes' ? ['hermes-config'] : []), 'model-config', 'stage', 'chat', 'sleep', 'sleep-confirmed'
    ]);
  }
  const before = f.calls.length;
  await Promise.all(f.parameters.map(input => f.adapter.dispatch(input)));
  assert.equal(f.calls.length, before, 'a stable completed identity is never dispatched twice');
});

test('all ten seats share only the three slots left by unrelated awake account consumers', async t => {
  const gate = deferred();
  t.after(() => gate.resolve());
  const unrelated = [{ id: 'synthetic-unrelated-active', status: 'active' }, { id: 'synthetic-unrelated-restoring', status: 'restoring' }];
  let sleeping = 0;
  const f = await setup({ unrelated, sleep: async () => { if (++sleeping <= 3) await gate.promise; } });
  const outcomes = f.burst();
  await eventually(() => count(f, 'sleep') === 3);
  assert.equal(count(f, 'reload-env'), 3);
  assert.equal(f.awake(), 5);
  gate.resolve();
  assert.ok((await outcomes).every(outcome => outcome.status === 'fulfilled'));
  assert.equal(f.maximumAwake, 5);
  assert.equal(f.awake(), 2);
  assert.equal(count(f, 'sleep-confirmed'), 10);
  for (const agent of unrelated) assert.equal(f.status.get(agent.id), agent.status);
});

test('malformed inventory and a fully occupied unrelated account fail all ten seats before any POST', async () => {
  for (const inventory of [() => ({}), rows => rows.slice(1), rows => [...rows, rows[0]], rows => [...rows, null], rows => rows.map((row, index) => index ? row : { id: row.id })]) {
    const f = await setup({ inventory });
    const outcomes = await f.burst();
    assert.ok(outcomes.every(outcome => outcome.status === 'rejected' && outcome.reason.code === 'MARITIME_INVENTORY_INVALID' && !outcome.reason.ambiguous));
    assert.equal(f.calls.filter(call => call.kind !== 'inventory').length, 0);
  }
  const f = await setup({ unrelated: Array.from({ length: 5 }, (_, index) => ({ id: `synthetic-unrelated-${index}`, status: 'active' })) });
  (await f.burst(Date.now() + 60)).forEach(assertExpired);
  assert.equal(f.calls.filter(call => call.kind !== 'inventory').length, 0);
  assert.ok(count(f, 'inventory') <= 2, 'capacity exhaustion must park until the deadline rather than spin');
});

test('ten-seat timeout, ignored abort and explicit chat rejection retain the five occupied permits without replay', async () => {
  for (const failure of ['timeout', 'abort', 'rejected']) {
    const signals = Array.from({ length: 10 }, () => new AbortController());
    const observedSignals = [];
    const f = await setup({ timeoutMs: failure === 'timeout' ? 100 : 1000, chat: ({ value, signal, lateChats }) => {
      observedSignals.push(signal);
      if (failure === 'rejected') return new Response('{}', { status: 403 });
      const late = deferred();
      lateChats.push(() => late.resolve(value));
      // Intentionally ignore AbortSignal as a remote chat/provider may do.
      return late.promise;
    } });
    const pending = f.burst(Date.now() + 400, signals.map(controller => controller.signal));
    await eventually(() => count(f, 'chat') === 5);
    if (failure === 'abort') signals.slice(0, 5).forEach(controller => controller.abort());
    const outcomes = await pending;
    for (const outcome of outcomes.slice(0, 5)) {
      assert.equal(outcome.status, 'rejected');
      assert.equal(outcome.reason.code, failure === 'rejected' ? 'MARITIME_HTTP_403' : 'MARITIME_TIMEOUT');
      assert.equal(outcome.reason.ambiguous, failure !== 'rejected');
    }
    outcomes.slice(5).forEach(assertExpired);
    assert.equal(count(f, 'reload-env'), 5);
    assert.equal(count(f, 'chat'), 5);
    assert.equal(count(f, 'sleep'), 0);
    assert.equal(f.awake(), 5);
    if (failure !== 'rejected') assert.ok(observedSignals.every(signal => signal.aborted));
    f.lateChats.forEach(resolve => resolve());
    await delay(0);
    const before = f.calls.length;
    const replay = await Promise.allSettled(f.parameters.slice(0, 5).map(input => f.adapter.dispatch(input)));
    assert.ok(replay.every(outcome => outcome.status === 'rejected'));
    assert.equal(f.calls.length, before, 'late responses cannot cause sleep, release or a replay');
  }
});

test('ten-seat explicit sleep rejection preserves the validated result and blocks rotation and fresh requests', async () => {
  const f = await setup({ sleep: () => new Response('{}', { status: 400 }) });
  const outcomes = await f.burst(Date.now() + 100);
  assert.ok(outcomes.slice(0, 5).every(outcome => outcome.status === 'fulfilled'));
  outcomes.slice(5).forEach(assertExpired);
  assert.equal(count(f, 'sleep'), 5);
  assert.equal(count(f, 'sleep-confirmed'), 0);
  assert.equal(count(f, 'reload-env'), 5);
  assert.equal(f.awake(), 5);
  const before = f.calls.length;
  const input = f.parameters[0];
  await assert.rejects(f.adapter.dispatch({ ...input, request: { ...input.request, request_id: `${input.request.request_id}:new` } }),
    error => error.code === 'MARITIME_ONE_AWAKE_RECONCILIATION_REQUIRED' && !error.ambiguous);
  assert.equal(f.calls.length, before);
});

test('ten-seat HTTP success with an unconfirmed sleep never releases any of the five permits', async () => {
  const f = await setup({ sleep: () => jsonResponse({ status: 'active' }) });
  const outcomes = await f.burst(Date.now() + 100);
  assert.ok(outcomes.slice(0, 5).every(outcome => outcome.status === 'rejected' && outcome.reason.code === 'MARITIME_SLEEP_UNCONFIRMED' && outcome.reason.ambiguous));
  outcomes.slice(5).forEach(assertExpired);
  assert.equal(count(f, 'reload-env'), 5);
  assert.equal(count(f, 'sleep'), 5);
  assert.equal(count(f, 'sleep-confirmed'), 0);
  assert.equal(f.awake(), 5);
});
