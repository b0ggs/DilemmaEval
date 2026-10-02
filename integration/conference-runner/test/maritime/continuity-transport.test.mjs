import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { fixtureConfig } from '../../src/fixture.mjs';
import { createMaritimeAdapter, MaritimeAdapterError } from '../../src/maritime/transport.mjs';
import { poke, reply, discussion, discussionReply, jsonResponse } from './fixtures.mjs';

// Synthetic API and verifier fixtures only. No runtime files, agents or chain
// state are inspected or changed by this suite.
const verified = () => ({ schema_version: 1, verified: true });
const baseline = { incarnation: 'fixture-incarnation-a', artifact: 'fixture-artifact-a', model: 'fixture-model-a' };

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
  assert.fail('Synthetic continuity barrier did not settle');
}

function diagnostic(config, seat) {
  return { schema_version: 1, type: 'runtime-diagnostic', request_id: `synthetic-diagnostic:${seat.seat_id}`,
    seat_id: seat.seat_id, team: seat.team, mode: 'gameplay-input', chain_state: {
      chain_id: 84532, game_address: config.game_address, confirmed_block_number: '123', confirmed_block_hash: `0x${'ab'.repeat(32)}`
    } };
}
function diagnosticReply(request) {
  return { schema_version: 1, type: 'runtime-diagnostic-response', request_id: request.request_id,
    seat_id: request.seat_id, team: request.team, mode: request.mode, status: 'ready', checks: {
      stdin: true, wallet_identity: true, checkout: true, dependencies: true, wrapper: true,
      private_state: true, seat_lock: true, chain_id: true, contract_read: true
    } };
}

async function setup(options = {}) {
  const config = await fixtureConfig({ runId: 'synthetic-continuity', teamSizes: { openclaw: 5, hermes: 5 } });
  const states = new Map(config.roster.map(seat => [seat.agent_id, 'sleeping']));
  const inspections = new Map(config.roster.map(seat => [seat.agent_id, { ...baseline }]));
  const staged = new Map();
  const calls = [], prepared = [];
  let maximum = 0;
  const unrelated = options.unrelated ?? [];
  const runtimeEvidence = { schema_version: 2, run_id: config.run_id, seats: config.roster.map(seat => ({
    seat_id: seat.seat_id, agent_id: seat.agent_id,
    gameplay_command: ['node', `/volume/synthetic/${seat.seat_id}/player-cli.mjs`, `/volume/synthetic/${seat.seat_id}/seat.json`]
  })) };
  const shape = (seat, status) => ({ id: seat.agent_id, framework: seat.harness, status });
  const actualReply = request => request.type === 'discussion' ? discussionReply(request, { team_message: 'Synthetic same-team discussion.' }) :
    request.type === 'runtime-diagnostic' ? diagnosticReply(request) : reply(request);
  const fetchImpl = async (url, init) => {
    const pathname = new URL(url).pathname;
    if (pathname === '/api/agents') {
      calls.push({ kind: 'inventory' });
      if (options.inventory) return options.inventory();
      return jsonResponse([...config.roster.map(seat => shape(seat, states.get(seat.agent_id))), ...unrelated]);
    }
    const seat = config.roster.find(row => row.agent_id === pathname.split('/')[3]);
    assert.ok(seat, 'only assigned roster agents may be inspected or changed');
    let kind = init.method === 'GET' ? 'get' : pathname.split('/').at(-1);
    const call = { kind, seat_id: seat.seat_id };
    calls.push(call);
    if (kind === 'get') {
      const agent = shape(seat, states.get(seat.agent_id));
      return jsonResponse(options.get ? await options.get(agent, seat) : { ...agent, raw_metadata: 'must not reach injected verifier' });
    }
    if (kind === 'start') {
      assert.equal(states.get(seat.agent_id), 'sleeping');
      states.set(seat.agent_id, 'active');
      const awake = [...states.values()].filter(status => status !== 'sleeping').length + unrelated.filter(agent => !['sleeping', 'stopped'].includes(agent.status)).length;
      maximum = Math.max(maximum, awake);
      assert.ok(awake <= 5);
      return jsonResponse(options.start ? options.start(shape(seat, 'active')) : shape(seat, 'active'));
    }
    if (kind === 'exec') {
      const command = JSON.parse(init.body).command;
      if (command[1] === '/synthetic/inspect.mjs') {
        call.kind = 'inspect';
        return jsonResponse({ exitCode: 0, stdout: JSON.stringify(inspections.get(seat.agent_id)), stderr: '' });
      }
      if (command[1] === '/synthetic/permit.mjs') {
        call.kind = 'prepare';
        return jsonResponse({ exitCode: 0, stdout: JSON.stringify(verified()), stderr: '' });
      }
      assert.equal(command[1], '--input-type=module', 'certified path cannot configure model, harness or environment');
      if (command[3].includes('stagePublicRequest')) {
        call.kind = 'stage';
        if (options.stageFailure) throw new Error('synthetic staging outcome unknown');
        const spec = JSON.parse(command[4]);
        const envelope = JSON.parse(spec.content);
        assert.deepEqual(Object.keys(envelope), ['request']);
        staged.set(seat.agent_id, envelope.request);
        return jsonResponse({ exitCode: 0, stdout: JSON.stringify({ ready: true, sha256: spec.sha256 }), stderr: '' });
      }
      call.kind = 'recover';
      return jsonResponse({ exitCode: 0, stdout: JSON.stringify(actualReply(staged.get(seat.agent_id))), stderr: '' });
    }
    if (kind === 'chat') {
      const prompt = JSON.parse(init.body).message;
      const request = JSON.parse(prompt.split('REQUEST_JSON\n')[1]);
      if (request.type !== 'discussion') {
        assert.deepEqual(request, staged.get(seat.agent_id));
        assert.match(prompt, /stdin is supplied by the command itself/);
      }
      await options.chat?.({ seat, request, inspections });
      return jsonResponse({ response: options.invalidChat ? '{invalid synthetic reply' : JSON.stringify(actualReply(request)) });
    }
    if (kind === 'sleep') {
      await options.sleep?.(seat);
      states.set(seat.agent_id, 'sleeping');
      return jsonResponse(options.sleepReply ? options.sleepReply(shape(seat, 'sleeping')) : shape(seat, 'sleeping'));
    }
    assert.fail(`Unexpected certified fixture operation ${kind}`);
  };
  const runtimeContinuity = {
    async verify(context) {
      if (options.verify) return options.verify(context);
      const agent = await context.getAgent();
      assert.deepEqual(Object.keys(agent).sort(), ['framework', 'id', 'status']);
      const checked = await context.execute(['node', '/synthetic/inspect.mjs']);
      assert.equal(checked.exitCode, 0);
      assert.deepEqual(JSON.parse(checked.stdout), baseline);
      return verified();
    },
    async prepareAction(context) {
      prepared.push({ seat_id: context.seat.seat_id, request: context.request, deadlineAtMs: context.deadlineAtMs });
      if (options.prepareAction) return options.prepareAction(context);
      assert.ok(Number.isSafeInteger(context.deadlineAtMs));
      const result = await context.execute(['node', '/synthetic/permit.mjs', JSON.stringify({ request_id: context.request.request_id, deadline_at_ms: context.deadlineAtMs })]);
      assert.equal(result.exitCode, 0);
      return verified();
    }
  };
  const adapterOptions = { config, apiKey: 'synthetic-continuity-credential', runtimeEvidence, fetchImpl, runtimeContinuity,
    maxAgents: 20, maxAwake: options.maxAwake ?? 5, timeoutMs: options.timeoutMs ?? 1000, wakeDelayMs: 0,
    verifyRecoveredResponse: async () => true };
  const adapter = createMaritimeAdapter(adapterOptions);
  return { config, adapter, adapterOptions, calls, inspections, states, prepared, get maximum() { return maximum; },
    dispatch(seat = config.roster[0], request = poke('join', seat), extra = {}) {
      return adapter.dispatch({ seat, request, deadline_at_ms: Date.now() + 3000, ...extra });
    }
  };
}

test('certified unchanged sleep/resume verifies both harnesses twice and prepares each exact gameplay request without reconfiguration', async () => {
  const f = await setup();
  for (const seat of [f.config.roster[0], f.config.roster[5]]) {
    for (let iteration = 0; iteration < 2; iteration++) {
      const request = { ...poke('join', seat), request_id: `synthetic-certified:${seat.seat_id}:${iteration}` };
      assert.deepEqual(await f.dispatch(seat, request), reply(request));
      assert.equal(f.states.get(seat.agent_id), 'sleeping');
      assert.deepEqual(f.prepared.at(-1).request, request);
    }
    assert.deepEqual(f.calls.filter(call => call.seat_id === seat.seat_id).map(call => call.kind), Array(2).fill([
      'start', 'get', 'get', 'inspect', 'prepare', 'stage', 'chat', 'get', 'inspect', 'sleep', 'get'
    ]).flat());
  }
  assert.equal(f.prepared.length, 4);
});

test('certified discussion and diagnostics verify continuity but never prepare a gameplay action permit', async () => {
  const f = await setup();
  for (const seat of [f.config.roster[0], f.config.roster[5]]) {
    await f.dispatch(seat, discussion(seat));
    const request = diagnostic(f.config, seat);
    assert.deepEqual(await f.adapter.diagnose({ seat, request, deadline_at_ms: Date.now() + 3000 }), diagnosticReply(request));
  }
  assert.equal(f.prepared.length, 0);
  assert.equal(f.calls.filter(call => call.kind === 'inspect').length, 8);
  assert.equal(f.calls.filter(call => call.kind === 'stage').length, 2);
  assert.ok(f.calls.every(call => !['reload-env', 'hermes-config', 'model-config'].includes(call.kind)));
});

test('certified source, incarnation and model drift stop before staging or chat for both harnesses', async () => {
  for (const harness of ['openclaw', 'hermes']) for (const field of ['artifact', 'incarnation', 'model']) {
    const f = await setup();
    const seat = f.config.roster.find(row => row.harness === harness);
    f.inspections.get(seat.agent_id)[field] = 'synthetic-drift';
    await assert.rejects(f.dispatch(seat), error => error.code === 'MARITIME_RUNTIME_CONTINUITY_FAILED' && error.ambiguous);
    assert.ok(f.calls.every(call => !['prepare', 'stage', 'chat', 'sleep'].includes(call.kind)));
    const before = f.calls.length;
    await assert.rejects(f.dispatch(seat), /MARITIME_RUNTIME_CONTINUITY_FAILED/);
    await assert.rejects(f.dispatch(f.config.roster.find(row => row !== seat)), /MARITIME_ONE_AWAKE_RECONCILIATION_REQUIRED/);
    assert.equal(f.calls.length, before);
  }
});

test('certified action-permit failure and malformed continuity results prevent chat and never leak verifier errors', async () => {
  for (const options of [
    { prepareAction: async () => { throw new Error('synthetic provider-private-payload'); } },
    { verify: async () => ({ ...verified(), choice: 'synthetic private field' }) },
    { prepareAction: async () => ({ schema_version: 1, verified: false }) }
  ]) {
    const f = await setup(options);
    await assert.rejects(f.dispatch(), error => error.code === 'MARITIME_RUNTIME_CONTINUITY_FAILED' && error.ambiguous && !String(error).includes('private'));
    assert.ok(f.calls.every(call => !['stage', 'chat', 'sleep'].includes(call.kind)));
  }
});

test('certified after-chat drift is ambiguous, blocks sleep and cannot replay a signing request', async () => {
  const f = await setup({ chat: ({ seat, inspections }) => { inspections.get(seat.agent_id).incarnation = 'synthetic-new-incarnation'; } });
  await assert.rejects(f.dispatch(), error => error.code === 'MARITIME_RUNTIME_CONTINUITY_FAILED' && error.ambiguous);
  assert.equal(f.calls.filter(call => call.kind === 'chat').length, 1);
  assert.equal(f.calls.filter(call => call.kind === 'sleep').length, 0);
  const before = f.calls.length;
  await assert.rejects(f.dispatch(), /MARITIME_RUNTIME_CONTINUITY_FAILED/);
  assert.equal(f.calls.length, before);
});

test('certified receipt recovery is followed by continuity verification and uncertain staging is never replayed', async () => {
  const recovered = await setup({ invalidChat: true });
  assert.deepEqual(await recovered.dispatch(), reply(poke('join', recovered.config.roster[0])));
  const kinds = recovered.calls.map(call => call.kind);
  assert.ok(kinds.indexOf('recover') > kinds.indexOf('chat'));
  assert.ok(kinds.lastIndexOf('inspect') > kinds.indexOf('recover'));
  assert.ok(kinds.indexOf('sleep') > kinds.lastIndexOf('inspect'));
  const failed = await setup({ stageFailure: true });
  await assert.rejects(failed.dispatch(), error => error.code === 'MARITIME_PUBLIC_REQUEST_STAGE_FAILED' && error.ambiguous);
  assert.equal(failed.calls.filter(call => call.kind === 'stage').length, 1);
  assert.equal(failed.calls.filter(call => call.kind === 'chat').length, 0);
});

test('certified account scheduling preserves five-awake capacity and unrelated consumers while waiting for confirmed sleep GETs', async t => {
  const gate = deferred();
  t.after(() => gate.resolve());
  let sleepingReads = 0;
  const f = await setup({ unrelated: [{ id: 'synthetic-unrelated', status: 'active' }],
    get: async agent => {
      if (agent.status === 'sleeping' && ++sleepingReads <= 4) await gate.promise;
      return agent;
    } });
  const results = Promise.allSettled(f.config.roster.map(seat => f.dispatch(seat)));
  await eventually(() => sleepingReads === 4);
  assert.equal(f.calls.filter(call => call.kind === 'start').length, 4);
  assert.equal(f.calls.filter(call => call.kind === 'sleep').length, 4, 'successful sleep POSTs alone do not free permits');
  assert.equal(f.maximum, 5);
  gate.resolve();
  assert.ok((await results).every(result => result.status === 'fulfilled'));
  assert.equal(f.calls.filter(call => call.kind === 'start').length, 10);
  assert.ok([...f.states.values()].every(status => status === 'sleeping'));
});

test('certified start and sleep require exact identity, harness and confirmed status in POST and GET', async () => {
  for (const options of [
    { start: agent => ({ ...agent, id: 'synthetic-wrong-agent' }) },
    { start: agent => ({ ...agent, framework: 'hermes' }) },
    { get: agent => agent.status === 'active' ? { ...agent, status: 'starting' } : agent }
  ]) {
    const f = await setup(options);
    await assert.rejects(f.dispatch(), error => error.code === 'MARITIME_START_UNCONFIRMED' && error.ambiguous);
    assert.equal(f.calls.filter(call => call.kind === 'chat').length, 0);
  }
  for (const options of [
    { sleepReply: agent => ({ ...agent, id: 'synthetic-wrong-agent' }) },
    { get: agent => agent.status === 'sleeping' ? { ...agent, status: 'active' } : agent },
    { get: agent => agent.status === 'sleeping' ? { ...agent, framework: 'hermes' } : agent }
  ]) {
    const f = await setup({ ...options, maxAwake: 1 });
    const results = await Promise.allSettled(f.config.roster.slice(0, 2).map(seat => f.dispatch(seat, poke('join', seat), { deadline_at_ms: Date.now() + 100 })));
    assert.equal(results[0].reason.code, 'MARITIME_SLEEP_UNCONFIRMED');
    assert.equal(results[0].reason.ambiguous, true);
    assert.equal(results[1].reason.code, 'MARITIME_DISPATCH_EXPIRED');
    assert.equal(f.calls.filter(call => call.kind === 'start').length, 1);
  }
});

test('certified callbacks and inventory obey the dispatch deadline even when a verifier ignores cancellation', async () => {
  let lateContext;
  const f = await setup({ verify: context => { lateContext = context; return new Promise(() => {}); }, timeoutMs: 30 });
  await assert.rejects(f.dispatch(), error => error.code === 'MARITIME_RUNTIME_CONTINUITY_FAILED' && error.ambiguous);
  const before = f.calls.length;
  await assert.rejects(lateContext.execute(['node', '/synthetic/inspect.mjs']), /MARITIME_RUNTIME_CONTINUITY_FAILED/);
  assert.equal(f.calls.length, before, 'timed-out verifier capability must no longer issue exec');
  const inventory = await setup({ inventory: () => new Promise(() => {}) });
  await assert.rejects(inventory.dispatch(undefined, undefined, { deadline_at_ms: Date.now() + 30 }),
    error => error.code === 'MARITIME_DISPATCH_EXPIRED' && !error.ambiguous);
  assert.deepEqual(inventory.calls.map(call => call.kind), ['inventory']);
});

test('malformed certified options fail before any HTTP mutation and require the account-wide five-slot bound', async () => {
  const f = await setup();
  for (const runtimeContinuity of [null, {}, { verify: async () => verified() }, { verify: true, prepareAction: async () => verified() },
    { verify: async () => verified(), prepareAction: async () => verified(), extra: true }]) {
    assert.throws(() => createMaritimeAdapter({ ...f.adapterOptions, runtimeContinuity }), /MARITIME_RUNTIME_CONTINUITY_INVALID/);
  }
  for (const maxAwake of [undefined, 6]) assert.throws(() => createMaritimeAdapter({ ...f.adapterOptions, maxAwake }), /MARITIME_RUNTIME_CONTINUITY_INVALID/);
  assert.deepEqual(f.calls, []);
});


test('certified wrappers preserve fixed failure metadata without changing ambiguity or replay', async () => {
  for (const action of ['dispatch', 'diagnose']) for (const phase of ['verify', 'stage', 'sleep']) {
    const fault = () => { const error = new MaritimeAdapterError('MARITIME_HTTP_502', {ambiguous:true});
      error.message='private-certified-fixture';error.cause={private_key:'private-certified-fixture'};throw error; };
    const f = await setup(phase === 'verify' ? {verify:fault} : phase === 'sleep' ? {sleep:fault} : {stageFailure:true});
    const seat=f.config.roster[0],request=action==='dispatch'?poke('join',seat):diagnostic(f.config,seat);
    const invoke=()=>f.adapter[action]({seat,request,deadline_at_ms:Date.now()+3000});
    const code=phase==='verify'?'MARITIME_RUNTIME_CONTINUITY_FAILED':phase==='sleep'?'MARITIME_SLEEP_UNCONFIRMED':'MARITIME_PUBLIC_REQUEST_STAGE_FAILED';
    const underlying=phase==='stage'?'MARITIME_NETWORK_OUTCOME_UNKNOWN':'MARITIME_HTTP_502';
    const check=error=>{
      assert.equal(error.code,code);assert.equal(error.ambiguous,true);assert.equal(error.retryable,false);
      assert.equal(error.transport_code,underlying);assert.equal(error.diagnostic_code,underlying);
      assert.equal(error.cause,undefined);assert.doesNotMatch(JSON.stringify(error),/private-certified|private_key|synthetic staging/);return true;
    };
    await assert.rejects(invoke(),check);
    assert.equal(f.calls.filter(row=>row.kind==='chat').length,phase==='sleep'?1:0);
    if(phase==='stage')assert.equal(f.calls.filter(row=>row.kind==='stage').length,1);
    const count=f.calls.length;await assert.rejects(invoke(),check);assert.equal(f.calls.length,count);
    await assert.rejects(f.dispatch(f.config.roster[1]),/MARITIME_ONE_AWAKE_RECONCILIATION_REQUIRED/);
    assert.equal(f.calls.length,count);
  }
  for (const supplied of ['READINESS_MODEL_INVALID','READINESS_MODEL_INVALID_private-fixture']) {
    const f=await setup({verify:async()=>{throw Object.assign(new Error('private-verifier-fixture'),{code:supplied});}});
    await assert.rejects(f.dispatch(),error=>{
      assert.equal(error.code,'MARITIME_RUNTIME_CONTINUITY_FAILED');assert.equal(error.ambiguous,true);
      assert.equal(error.diagnostic_code,supplied==='READINESS_MODEL_INVALID'?supplied:undefined);
      assert.equal(error.transport_code,undefined);assert.doesNotMatch(JSON.stringify(error),/private-fixture|private-verifier/);return true;
    });
    assert.equal(f.calls.filter(row=>row.kind==='chat').length,0);
  }
});
