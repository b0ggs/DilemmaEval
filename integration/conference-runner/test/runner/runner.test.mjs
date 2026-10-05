import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createConferenceRunner, createDurableStore } from '../../src/runner/index.mjs';

const hash = (number) => `0x${number.toString(16).padStart(64, '0')}`;
const wallet = (number) => `0x${number.toString(16).padStart(40, '0')}`;
const roster = [
  { seat_id: 'oc-1', team: 'openclaw', harness: 'openclaw', wallet_address: wallet(1), agent_id: 'oc-1' },
  { seat_id: 'oc-2', team: 'openclaw', harness: 'openclaw', wallet_address: wallet(2), agent_id: 'oc-2' },
  { seat_id: 'hs-1', team: 'hermes', harness: 'hermes', wallet_address: wallet(3), agent_id: 'hs-1' }
];

async function fixture(t, options = {}) {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'conference-runner-'));
  t.after(() => fs.rm(runtimeDir, { recursive: true, force: true }));
  let clock = Date.parse('2026-09-25T14:00:00.000Z');
  const config = {
    schema_version: 1, run_id: 'fixture-conference', mode: 'fixture', chain_id: 84532,
    game_address: wallet(100), start_block: '100', start_time: new Date(clock - 1000).toISOString(),
    stop_time: new Date(clock + 3600_000).toISOString(), intermission_ms: 20_000,
    agent_timeout_ms: 500, adapter_timeout_ms: 500, spectator_timeout_ms: 20, roster,
    ...options.config
  };
  let snapshot = {
    schema_version: 1, chain_id: 84532, game_address: config.game_address,
    game_id: '1', active_game_id: '1', round: 1, phase: 'commit', outcome: null,
    block_number: '100', block_hash: hash(100), block_timestamp: String(Math.floor(clock / 1000)),
    alive_count: 3, committed_count: 0, revealed_count: 0,
    clock: { unit: 'block', current: '100', deadline: '120' },
    config: { entryFeeWei: '100', minPlayers: '3', maxPlayers: '3' }, transaction_hash: null,
    players: roster.map((seat) => ({ wallet_address: seat.wallet_address, joined: true, alive: true,
      committed: false, revealed: false, award_wei: '0', claimed_wei: '0', refunded_wei: '0' })),
    ...options.snapshot
  };
  const history = new Map();
  const events = [];
  const dispatches = [];
  const advances = [];
  const launches = [];
  const publications = [];
  function response(request, overrides = {}) {
    return request.type === 'discussion' ? {
      schema_version: 1, type: 'discussion-response', request_id: request.request_id,
      game_id: request.game_id, round: request.round, phase: 'commit', seat_id: request.seat_id,
      team: request.team, status: 'observed', team_message: `${request.seat_id} discussion`, ...overrides
    } : {
      schema_version: 1, request_id: request.request_id, game_id: request.game_id, round: request.round,
      phase: request.phase, seat_id: request.seat_id, status: 'observed', ...overrides
    };
  }
  const dependencies = {
    config, runtimeDir, now: () => clock,
    chain: {
      readBlockHash: async ({ blockNumber }) => hash(Number(blockNumber)),
      readSnapshot: async ({ gameId } = {}) => structuredClone(gameId && gameId !== snapshot.game_id ? history.get(gameId) : snapshot),
      readEvents: async ({ fromBlock, toBlock }) => structuredClone(events.filter((event) => BigInt(event.block_number) >= BigInt(fromBlock) && BigInt(event.block_number) <= BigInt(toBlock)))
    },
    agents: { dispatch: async ({ seat, request, deadline_at_ms, signal }) => {
      dispatches.push({ seat, request, deadline_at_ms, signal });
      return options.dispatch ? options.dispatch({ seat, request, deadline_at_ms, signal, response }) : response(request);
    } },
    launcher: { create: async (intent) => { launches.push(intent); return options.launch ? options.launch(intent) : { status: 'accepted', reference: { kind: 'transaction-hash', value: hash(400) } }; } },
    phaseExecutor: { advance: async (intent) => { advances.push(intent); return options.advance ? options.advance(intent) : { status: 'accepted', reference: { kind: 'transaction-hash', value: hash(500) } }; } },
    spectator: { publish: async (value) => { publications.push(value); return options.publish?.(value); } }
  };
  let runner = createConferenceRunner(dependencies);
  const runners = [runner];
  t.after(async () => { for (const item of runners) await item.close(); });
  return {
    config, runtimeDir, dispatches, advances, launches, publications, history, events, dependencies,
    get runner() { return runner; }, get snapshot() { return snapshot; },
    setSnapshot(value) { snapshot = { ...snapshot, ...value }; },
    setClock(value) { clock = value; }, addTime(amount) { clock += amount; },
    nextBlock() { const next = (BigInt(snapshot.block_number) + 1n).toString(); snapshot.block_number = next; snapshot.block_hash = hash(Number(next)); if (snapshot.clock?.unit === 'block') snapshot.clock.current = next; },
    async restart() { await runner.close(); runner = createConferenceRunner(dependencies); runners.push(runner); await runner.initialize(); return runner; }
  };
}

function event(kind, gameId = '1', block = 100, index = 0, data = {}) {
  const transaction_hash = hash(1000 + block);
  return { id: `${transaction_hash}:${index}`, game_id: gameId, round: 1, kind,
    block_number: String(block), transaction_hash, log_index: index, data };
}

test('durable stores atomically serialize concurrent reservations and compare-and-set across instances', async (t) => {
  const f = await fixture(t);
  const directory = path.join(f.runtimeDir, 'independent');
  const a = createDurableStore({ directory });
  const b = createDurableStore({ directory });
  const reserved = await Promise.all(Array.from({ length: 12 }, (_, index) => (index % 2 ? a : b).putIfAbsent('one', { revision: 0, winner: index })));
  assert.equal(reserved.filter((item) => item.inserted).length, 1);
  const updates = await Promise.all([a.compareAndSet('one', 0, { revision: 1 }), b.compareAndSet('one', 0, { revision: 2 })]);
  assert.equal(updates.filter((item) => item.updated).length, 1);
  assert.equal((await createDurableStore({ directory }).entries()).length, 1);
  assert.equal((await fs.stat(path.join(directory, 'records.json'))).mode & 0o777, 0o600);
  await fs.writeFile(path.join(directory, 'records.json'), '{partial');
  await assert.rejects(a.get('one'), /DURABLE_STORE_CORRUPT/);
});

test('single runner lock rejects living owners, recovers proven dead owners, and refuses corrupt locks', async (t) => {
  const f = await fixture(t);
  await f.runner.initialize();
  const other = createConferenceRunner(f.dependencies);
  await assert.rejects(other.initialize(), /RUNNER_ALREADY_LOCKED/);
  await f.runner.close();
  await fs.writeFile(path.join(f.runtimeDir, 'runner.lock'), JSON.stringify({ pid: 2147483647, hostname: os.hostname(), token: 'dead' }));
  await other.initialize();
  await other.close();
  await fs.writeFile(path.join(f.runtimeDir, 'runner.lock'), '{}');
  const corrupt = createConferenceRunner(f.dependencies);
  await assert.rejects(corrupt.initialize(), /RUNNER_LOCK_UNVERIFIABLE/);
});

test('discussion is concurrent for three seats and commits see fresh same-team messages; ACKs never advance', async (t) => {
  const waiting = [];
  const f = await fixture(t, { dispatch: ({ request, response }) => {
    if (request.type !== 'discussion') return response(request, { status: 'submitted', transaction_hash: hash(600) });
    return new Promise((resolve) => {
      waiting.push(() => resolve(response(request)));
      if (waiting.length === 3) waiting.forEach((done) => done());
    });
  } });
  const [first, duplicate] = await Promise.all([f.runner.tick(), f.runner.tick()]);
  assert.deepEqual(first, duplicate);
  assert.equal(f.dispatches.length, 6);
  assert.equal(f.advances.length, 0);
  for (const { request } of f.dispatches.filter(({ request }) => !request.type)) {
    assert.equal(request.team_chat.messages.length, request.team === 'openclaw' ? 2 : 1);
    assert.ok(request.team_chat.messages.every((message) => message.team === request.team));
    assert.deepEqual(request.team_chat.messages.map((message) => message.message).sort(), roster.filter((seat) => seat.team === request.team).map((seat) => `${seat.seat_id} discussion`).sort());
  }
  assert.deepEqual(first.health, []);
  await f.restart();
  await f.runner.tick();
  assert.equal(f.dispatches.length, 6, 'restart must not redispatch acknowledged actions');
  assert.equal(f.runner.getState().messages.openclaw.length, 2);
});

test('long discussion does not block commits or disappear from same-team context after restart', async t => {
  const message = 'Consider the team payout. 🦀\n'.repeat(500);
  const f = await fixture(t, { dispatch: ({ request, response }) => response(request,
    request.type === 'discussion' ? { team_message: message } : { status: 'submitted', transaction_hash: hash(600) }) });
  await f.runner.tick();
  assert.equal(f.dispatches.filter(row => row.request.requested_action === 'commit').length, roster.length);
  for (const { request } of f.dispatches) {
    assert.equal(Object.hasOwn(request, 'max_message_chars'), false);
    if (request.type === 'discussion') continue;
    assert.ok(request.team_chat.messages.every(row => row.message === message && row.team === request.team));
  }
  await f.restart();
  const state = f.runner.getState();
  assert.deepEqual(state.health, []);
  assert.equal(state.messages.openclaw[0].message, message);
  assert.equal(state.messages.hermes[0].message, message);
});

for (const failure of ['timeout', 'missing', 'empty', 'skipped', 'error']) {
  test(`incomplete ${failure} discussion blocks all commits, including after restart`, async t => {
    const f = await fixture(t, { config: { agent_timeout_ms: 25 }, dispatch: ({ request, response }) => {
      if (request.type !== 'discussion' || request.seat_id !== 'oc-1') return response(request);
      if (failure === 'timeout') return new Promise(() => {});
      const r = response(request);
      if (failure === 'missing') delete r.team_message;
      else if (failure === 'empty') r.team_message = '   ';
      else { r.status = failure; delete r.team_message; }
      return r;
    } });
    await f.runner.tick();
    assert.equal(f.dispatches.length, 3);
    assert.ok(f.dispatches.every(({ request }) => request.type === 'discussion'));
    assert.ok(f.runner.getState().health.some(issue => issue.code === 'AGENT_ACTION_UNCERTAIN' && issue.seat_id === 'oc-1'));
    await f.restart();
    await f.runner.tick();
    assert.equal(f.dispatches.length, 3, 'unknown discussion is not replayed and no commit follows');
  });
}

test('join deadline is strictly greater even with zero players and commit uses actual acted counts', async (t) => {
  const f = await fixture(t, { snapshot: { phase: 'join', round: 0, alive_count: 0, players: [], clock: { unit: 'timestamp', current: '1000', deadline: '1000' } } });
  await f.runner.tick();
  assert.equal(f.advances.length, 0);
  assert.equal(f.dispatches.length, 3);
  f.setSnapshot({ clock: { unit: 'timestamp', current: '1001', deadline: '1000' } });
  await f.runner.tick();
  assert.equal(f.advances.length, 1);
  assert.equal(f.advances[0].reason, 'join-deadline-reached');
  assert.equal(f.runner.getState().snapshot.alive_count, 0);
});

test('discussion cannot produce a stale commit after its chain deadline passes', async (t) => {
  let f;
  f = await fixture(t, { dispatch: ({ request, response }) => {
    f.setSnapshot({ block_number: '121', block_hash: hash(121), clock: { unit: 'block', current: '121', deadline: '120' } });
    return response(request);
  } });
  await f.runner.tick();
  assert.equal(f.dispatches.length, 3);
  assert.ok(f.dispatches.every(({ request }) => request.type === 'discussion'));
  assert.equal(f.advances.length, 1);
});

test('authoritative phase expiry aborts active and queued discussions before the agent timeout', async t => {
  let equalityObserved;
  const equality = new Promise(resolve => { equalityObserved = resolve; });
  const f = await fixture(t, {
    config: { agent_timeout_ms: 10_000 },
    snapshot: { block_number: '120', block_hash: hash(120), clock: { unit: 'block', current: '120', deadline: '120' } },
    dispatch: ({ request, signal }) => {
      if (request.seat_id === 'hs-1') return new Promise(() => {}); // Non-cooperative active call.
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('sanitized'),
        request.seat_id === 'oc-2'
          ? { code: 'MARITIME_DISPATCH_EXPIRED', ambiguous: false, retryable: true } // Still queued, never posted.
          : { code: 'MARITIME_TIMEOUT', ambiguous: true } // Already posted.
      )), { once: true }));
    }
  });
  const read = f.dependencies.chain.readSnapshot;
  f.dependencies.chain.readSnapshot = async args => {
    const snapshot = await read(args);
    if (f.dispatches.length === 3 && snapshot.clock.current === '120') equalityObserved();
    return snapshot;
  };
  let guard;
  try {
    const tick = f.runner.tick();
    const boundedTick = Promise.race([tick, new Promise((_, reject) => {
      guard = setTimeout(() => reject(new Error('phase guard leaked the full agent timeout')), 5000);
    })]);
    await Promise.race([equality, boundedTick]);
    assert.equal(f.dispatches.length, 3);
    assert.ok(f.dispatches.every(call => !call.signal.aborted), 'the contract still permits the deadline block itself');
    f.setSnapshot({ block_number: '121', block_hash: hash(121), clock: { unit: 'block', current: '121', deadline: '120' } });
    await boundedTick;
  } finally { clearTimeout(guard); }
  assert.equal(f.dispatches.length, 3, 'no commit or replacement discussion is sent');
  assert.ok(f.dispatches.every(call => call.signal.aborted));
  assert.equal(f.advances.length, 1, 'expired commit phase can advance without waiting for discussion acknowledgements');
  const records = JSON.parse(await fs.readFile(path.join(f.runtimeDir, 'coordinator/records.json'), 'utf8'));
  const states = records.entries.map(entry => entry.value).filter(record => record.action === 'discussion');
  assert.equal(states.length, 3);
  assert.equal(states.find(record => record.seat_id === 'oc-2').state, 'rejected-before-submit');
  assert.ok(states.filter(record => record.seat_id !== 'oc-2').every(record => record.state === 'unknown'));
  await f.restart();
  await f.runner.tick();
  assert.equal(f.dispatches.length, 3, 'expired discussion work is not replayed after restart');
});

test('a confirmed phase change aborts pending discussion and cannot dispatch a stale commit', async t => {
  let f;
  f = await fixture(t, { config: { agent_timeout_ms: 10_000 }, dispatch: () => {
    f.setSnapshot({ phase: 'reveal', committed_count: 3 });
    f.snapshot.players.forEach(player => { player.committed = true; });
    return new Promise(() => {});
  } });
  let guard;
  try {
    await Promise.race([f.runner.tick(), new Promise((_, reject) => {
      guard = setTimeout(() => reject(new Error('phase change did not stop discussion')), 3000);
    })]);
  } finally { clearTimeout(guard); }
  assert.equal(f.dispatches.length, 3);
  assert.ok(f.dispatches.every(call => call.signal.aborted && call.request.type === 'discussion'));
  assert.equal(f.runner.getState().snapshot.phase, 'reveal');
});

test('lost authoritative phase reads abort discussion and block commits', async t => {
  const f = await fixture(t, { config: { agent_timeout_ms: 10_000 }, dispatch: () => new Promise(() => {}) });
  const read = f.dependencies.chain.readSnapshot;
  f.dependencies.chain.readSnapshot = args => {
    if (f.dispatches.length) throw new Error('CHAIN_UNAVAILABLE');
    return read(args);
  };
  let guard;
  try {
    await Promise.race([f.runner.tick(), new Promise((_, reject) => {
      guard = setTimeout(() => reject(new Error('missing chain clock did not stop discussion')), 3000);
    })]);
  } finally { clearTimeout(guard); }
  assert.equal(f.dispatches.length, 3);
  assert.ok(f.dispatches.every(call => call.signal.aborted && call.request.type === 'discussion'));
  assert.ok(f.runner.getState().health.some(issue => issue.code === 'CHAIN_UNAVAILABLE'));
  assert.equal(f.advances.length, 0);
});

test('runner propagates one absolute deadline, aborts it, and bounds an adapter that ignores abort', async (t) => {
  const f = await fixture(t, {
    config: { agent_timeout_ms: 25 },
    snapshot: { phase: 'reveal', committed_count: 3 },
    dispatch: () => new Promise(() => {})
  });
  f.snapshot.players.forEach((player) => { player.committed = true; });
  let guard;
  try {
    await Promise.race([
      f.runner.tick(),
      new Promise((_, reject) => { guard = setTimeout(() => reject(new Error('abort-ignoring adapter hung the tick')), 3_000); })
    ]);
  } finally { clearTimeout(guard); }
  assert.equal(f.dispatches.length, 3);
  for (const call of f.dispatches) {
    assert.equal(call.deadline_at_ms, Date.parse('2026-09-25T14:00:00.000Z') + 25);
    assert.equal(call.signal.aborted, true);
  }
  const records = JSON.parse(await fs.readFile(path.join(f.runtimeDir, 'coordinator/records.json'), 'utf8'));
  assert.ok(Object.entries(records).filter(([key]) => key.startsWith('dispatch:')).every(([, value]) => value.state === 'unknown'));
  assert.equal(f.runner.getState().health.filter((issue) => issue.code === 'AGENT_ACTION_UNCERTAIN').length, 3);
});

test('explicit pre-submit expiry retries safely with the same stable request identity while current', async (t) => {
  const attempts = new Map();
  const f = await fixture(t, {
    config: { agent_timeout_ms: 50 },
    snapshot: { phase: 'reveal', committed_count: 3 },
    dispatch: ({ request, response, deadline_at_ms, signal }) => {
      assert.equal(deadline_at_ms, Date.parse('2026-09-25T14:00:00.000Z') + 50);
      assert.equal(signal.aborted, false);
      const count = (attempts.get(request.seat_id) ?? 0) + 1;
      attempts.set(request.seat_id, count);
      if (count === 1) return new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(
        new Error('sanitized'), { code: request.seat_id === 'oc-2' ? 'MARITIME_ONE_AWAKE_RECONCILIATION_REQUIRED' : 'MARITIME_DISPATCH_EXPIRED', ambiguous: false, retryable: true }
      )), { once: true }));
      return response(request);
    }
  });
  f.snapshot.players.forEach((player) => { player.committed = true; });
  await f.runner.tick();
  assert.equal(f.dispatches.length, 3);
  assert.equal(f.runner.getState().health.filter((issue) => issue.code === 'AGENT_DISPATCH_EXPIRED').length, 3);
  let records = JSON.parse(await fs.readFile(path.join(f.runtimeDir, 'coordinator/records.json'), 'utf8'));
  assert.ok(Object.entries(records).filter(([key]) => key.startsWith('dispatch:')).every(([key, value]) =>
    value.state === 'rejected-before-submit' && value.code === (key.includes(':oc-2:') ? 'MARITIME_ONE_AWAKE_RECONCILIATION_REQUIRED' : 'MARITIME_DISPATCH_EXPIRED') &&
    value.ambiguous === false && value.retryable === true));

  await f.runner.tick();
  assert.equal(f.dispatches.length, 6);
  for (const seat of roster) {
    const ids = f.dispatches.filter(({ request }) => request.seat_id === seat.seat_id).map(({ request }) => request.request_id);
    assert.equal(new Set(ids).size, 1, `${seat.seat_id} must retain one request identity`);
  }
  records = JSON.parse(await fs.readFile(path.join(f.runtimeDir, 'coordinator/records.json'), 'utf8'));
  assert.ok(Object.entries(records).filter(([key]) => key.startsWith('dispatch:')).every(([, value]) =>
    value.state === 'acknowledged' && value.attempt_count === 2));
  assert.equal(f.runner.getState().health.filter((issue) => issue.code === 'AGENT_DISPATCH_EXPIRED').length, 0);
  assert.equal(f.runner.getState().health.filter((issue) => issue.code === 'AGENT_ACTION_UNCERTAIN').length, 0);
});

test('ambiguous submissions are not redispatched after restart and chain evidence clears health', async (t) => {
  const f = await fixture(t, { snapshot: { phase: 'reveal', committed_count: 3 }, dispatch: () => {
    throw Object.assign(new Error('Bearer should-never-be-persisted'), { code: 'MARITIME_TIMEOUT', ambiguous: true, retryable: false });
  } });
  f.snapshot.players.forEach((player) => { player.committed = true; });
  await f.runner.tick();
  assert.equal(f.dispatches.length, 3);
  assert.equal(f.runner.getState().health.filter((issue) => issue.code === 'AGENT_ACTION_UNCERTAIN').length, 3);
  await f.restart();
  await f.runner.tick();
  assert.equal(f.dispatches.length, 3);
  f.snapshot.players.forEach((player) => { player.revealed = true; });
  f.setSnapshot({ revealed_count: 3 });
  await f.runner.tick();
  assert.equal(f.advances.length, 1);
  assert.equal(f.runner.getState().health.filter((issue) => issue.code === 'AGENT_ACTION_UNCERTAIN').length, 0);
  assert.ok(!(await fs.readFile(path.join(f.runtimeDir, 'coordinator/records.json'), 'utf8')).includes('should-never-be-persisted'));
});

test('invalid CLI responses preserve only fixed diagnostics and remain unknown across restart', async (t) => {
  const privateText = 'private-provider-text-must-not-persist';
  const diagnostics = new Map([
    ['hs-1', 'PLAYER_CHOICE_LOCATION_INVALID'], ['oc-1', privateText], ['oc-2', 'PLAYER_TOOL_FAILED']
  ]);
  const f = await fixture(t, {
    snapshot: { phase: 'reveal', committed_count: 3 },
    dispatch: ({ request }) => {
      throw Object.assign(new Error(privateText), {
        code: request.seat_id === 'oc-2' ? 'UNEXPECTED_ERROR' : 'MARITIME_AGENT_RESPONSE_INVALID',
        diagnostic_code: diagnostics.get(request.seat_id), ambiguous: true, raw_response: privateText
      });
    }
  });
  f.snapshot.players.forEach(player => { player.committed = true; });
  await f.runner.tick();
  await f.restart();
  await f.runner.tick();
  assert.equal(f.dispatches.length, 3, 'invalid responses must never replay');
  const store = createDurableStore({ directory: path.join(f.runtimeDir, 'coordinator') });
  assert.deepEqual(await store.entries('response:'), []);
  for (const { value } of await store.entries('dispatch:')) {
    assert.equal(value.state, 'unknown');
    assert.equal(value.error_code, value.seat_id === 'hs-1' ? 'PLAYER_CHOICE_LOCATION_INVALID' : undefined);
    assert.equal(value.transaction_hash, undefined);
  }
  const contents = await fs.readFile(path.join(f.runtimeDir, 'coordinator/records.json'), 'utf8');
  assert.ok(!contents.includes(privateText));
  assert.ok(!contents.includes('raw_response'));
});

test('transport metadata survives discussion failure and restart without changing unknown states or replaying', async t => {
  const secret = 'fixture-private-native-error';
  const f = await fixture(t, { dispatch: ({ request }) => {
    const metadata = request.seat_id === 'oc-1'
      ? { code: 'PROOF_AGENT_OPERATION_FAILED', transport_code: 'MARITIME_HTTP_502', diagnostic_code: 'MARITIME_REPLY_PROVIDER_ERROR' }
      : request.seat_id === 'hs-1'
        ? { code: 'MARITIME_AGENT_RESPONSE_INVALID', diagnostic_code: 'PLAYER_CHOICE_LOCATION_INVALID' }
        : { code: `MARITIME_HTTP_502_${secret}`, transport_code: `MARITIME_TIMEOUT_${secret}`,
          diagnostic_code: `MARITIME_REPLY_PROVIDER_ERROR_${secret}` };
    throw Object.assign(new Error(secret), { ...metadata, ambiguous: true, retryable: false, raw_response: secret });
  } });
  await f.runner.tick();
  await f.restart();
  await f.runner.tick();
  assert.equal(f.dispatches.length, 3, 'unknown discussions are not replayed after restart');
  assert.ok(f.dispatches.every(row => row.request.type === 'discussion'));
  const store = createDurableStore({ directory: path.join(f.runtimeDir, 'coordinator') });
  assert.deepEqual(await store.entries('response:'), []);
  for (const { value } of await store.entries('dispatch:')) {
    assert.equal(value.state, 'unknown');
    assert.equal(value.error_code, value.seat_id === 'hs-1' ? 'PLAYER_CHOICE_LOCATION_INVALID' : undefined);
    assert.equal(value.transport_code, value.seat_id === 'oc-1' ? 'MARITIME_HTTP_502'
      : value.seat_id === 'hs-1' ? 'MARITIME_AGENT_RESPONSE_INVALID' : undefined);
    assert.equal(value.diagnostic_code, value.seat_id === 'oc-1' ? 'MARITIME_REPLY_PROVIDER_ERROR'
      : value.seat_id === 'hs-1' ? 'PLAYER_CHOICE_LOCATION_INVALID' : undefined);
    assert.equal(value.transaction_hash, undefined);
  }
  const saved = await fs.readFile(path.join(f.runtimeDir, 'coordinator/records.json'), 'utf8');
  assert.ok(!saved.includes(secret)); assert.ok(!saved.includes('raw_response'));
});

test('reported player errors retain only allowlisted codes across restart without replay', async (t) => {
  const privateMessage = 'Internal provider fixture details must never persist';
  const unknownCode = 'UNKNOWN_ERROR_FIXTURE_SECRET_MUST_NEVER_PERSIST';
  const reportedCodes = new Map([
    ['oc-1', 'PLAYER_SUBMISSION_OUTCOME_UNKNOWN'],
    ['oc-2', 'REVISION_CHECK_FAILED'],
    ['hs-1', unknownCode]
  ]);
  const expectedCodes = new Map([...reportedCodes].map(([seatId, code]) => [seatId,
    code === unknownCode ? 'AGENT_REPORTED_ERROR' : code]));
  const f = await fixture(t, {
    snapshot: { phase: 'join', round: 0, alive_count: 0, players: [],
      clock: { unit: 'timestamp', current: '1000', deadline: '1200' } },
    dispatch: ({ request, response }) => response(request, { status: 'error',
      error: { code: reportedCodes.get(request.seat_id), message: privateMessage } })
  });
  await f.runner.tick();
  assert.equal(f.dispatches.length, 3);
  assert.equal(f.runner.getState().health.filter((issue) => issue.code === 'AGENT_REPORTED_ERROR').length, 3);

  await f.restart();
  await f.runner.tick();
  assert.equal(f.dispatches.length, 3, 'acknowledged errors must not replay after restart');
  assert.equal(f.runner.getState().health.filter((issue) => issue.code === 'AGENT_REPORTED_ERROR').length, 3);
  const restartedStore = createDurableStore({ directory: path.join(f.runtimeDir, 'coordinator') });
  const dispatchRecords = await restartedStore.entries('dispatch:');
  const responseRecords = await restartedStore.entries('response:');
  assert.equal(dispatchRecords.length, 3);
  assert.equal(responseRecords.length, 3);
  for (const { value } of dispatchRecords) {
    assert.equal(value.state, 'acknowledged');
    assert.equal(value.status, 'error');
    assert.equal(value.error_code, expectedCodes.get(value.seat_id));
    assert.equal(value.transaction_hash, undefined);
  }
  for (const { value: { response } } of responseRecords) {
    assert.deepEqual(response.error, { code: expectedCodes.get(response.seat_id),
      message: 'Agent reported an execution error.' });
  }
  for (const file of await fs.readdir(f.runtimeDir, { recursive: true })) {
    const location = path.join(f.runtimeDir, file);
    if (!(await fs.stat(location)).isFile()) continue;
    const contents = await fs.readFile(location, 'utf8');
    assert.ok(!contents.includes(privateMessage), `${file} persisted a raw error message`);
    assert.ok(!contents.includes(unknownCode), `${file} persisted an unallowlisted error code`);
  }

  f.setSnapshot({ alive_count: 3, players: roster.map((seat) => ({ wallet_address: seat.wallet_address,
    joined: true, alive: true, committed: false, revealed: false, award_wei: '0', claimed_wei: '0', refunded_wei: '0' })) });
  await f.runner.tick();
  assert.equal(f.dispatches.length, 3);
  assert.equal(f.runner.getState().health.filter((issue) => issue.code === 'AGENT_REPORTED_ERROR').length, 0,
    'confirmed chain evidence must still reconcile reported errors');
});

test('secret-shaped error codes and messages remain rejected without persistence or replay', async (t) => {
  const privateCode = 'Bearer fixture-code-must-never-persist';
  const privateMessage = `0x${'ab'.repeat(32)}`;
  const f = await fixture(t, {
    snapshot: { phase: 'join', round: 0, alive_count: 0, players: [],
      clock: { unit: 'timestamp', current: '1000', deadline: '1200' } },
    dispatch: ({ request, response }) => response(request, { status: 'error', error: request.seat_id === 'oc-1'
      ? { code: privateCode, message: 'Execution failed.' }
      : { code: 'REVISION_CHECK_FAILED', message: privateMessage } })
  });
  await f.runner.tick();
  await f.restart();
  await f.runner.tick();
  assert.equal(f.dispatches.length, 3);
  assert.equal(f.runner.getState().health.filter((issue) => issue.code === 'AGENT_ACTION_UNCERTAIN').length, 3);
  const restartedStore = createDurableStore({ directory: path.join(f.runtimeDir, 'coordinator') });
  assert.deepEqual(await restartedStore.entries('response:'), []);
  assert.ok((await restartedStore.entries('dispatch:')).every(({ value }) => value.state === 'unknown'));
  for (const file of await fs.readdir(f.runtimeDir, { recursive: true })) {
    const location = path.join(f.runtimeDir, file);
    if (!(await fs.stat(location)).isFile()) continue;
    const contents = await fs.readFile(location, 'utf8');
    assert.ok(!contents.includes(privateCode), `${file} persisted a secret-shaped code`);
    assert.ok(!contents.includes(privateMessage), `${file} persisted a secret-shaped message`);
  }
});

test('only confirmed outcomes for created-in-run games count and intermission survives restart', async (t) => {
  const f = await fixture(t, { snapshot: { phase: 'terminal', active_game_id: '0', outcome: 'completed', alive_count: 1, committed_count: 3, revealed_count: 3, clock: null } });
  f.events.push(event('completed', '88', 100, 0), event('created', '1', 100, 1));
  await f.runner.initialize();
  assert.deepEqual(f.runner.getState().completed_game_ids, []);
  f.nextBlock();
  f.events.push(event('completed', '1', 101, 0));
  await f.runner.tick();
  assert.deepEqual(f.runner.getState().completed_game_ids, ['1']);
  assert.equal(f.launches.length, 0);
  const scheduled = f.runner.getState().scheduling.next_game_at;
  await f.restart();
  assert.equal(f.runner.getState().scheduling.next_game_at, scheduled);
  f.addTime(20_000);
  await f.runner.tick();
  assert.equal(f.launches.length, 1);
  await f.runner.tick();
  assert.equal(f.launches.length, 1);
  assert.deepEqual(f.runner.getState().completed_game_ids, ['1']);
});

test('launch intent survives an ambiguous network result and a later active game reconciles it', async (t) => {
  const f = await fixture(t, { snapshot: { phase: 'idle', game_id: '0', active_game_id: '0', round: 0, alive_count: 0, clock: null, players: [] }, launch: () => { throw new Error('ambiguous'); } });
  await f.runner.tick();
  assert.equal(f.launches.length, 1);
  await f.restart();
  await f.runner.tick();
  assert.equal(f.launches.length, 1);
  assert.ok(f.runner.getState().health.some((issue) => issue.code === 'LAUNCH_UNCERTAIN'));
  f.setSnapshot({ phase: 'join', game_id: '1', active_game_id: '1', clock: { unit: 'timestamp', current: '100', deadline: '200' } });
  await f.runner.tick();
  assert.equal(f.launches.length, 1);
  assert.equal(f.dispatches.length, 3);
  assert.ok(!f.runner.getState().health.some((issue) => issue.code === 'LAUNCH_UNCERTAIN'));
});

test('historical refunds complete their dispatch before a new game launches', async (t) => {
  const order = [];
  let f;
  f = await fixture(t, {
    config: { intermission_ms: 0 },
    snapshot: { phase: 'terminal', game_id: '7', active_game_id: '0', outcome: 'cancelled', clock: null,
      players: roster.map((seat, index) => ({ wallet_address: seat.wallet_address, joined: index === 2,
        alive: false, committed: false, revealed: false, award_wei: '0', claimed_wei: '0', refunded_wei: '0' })) },
    dispatch: async ({ request, response }) => {
      order.push(`${request.game_id}:${request.phase}`);
      if (request.phase === 'claim') {
        assert.equal(f.launches.length, 0, 'the refund must finish before creating the next game');
        f.snapshot.players[2].refunded_wei = '100';
        return response(request, { status: 'submitted', transaction_hash: hash(700) });
      }
      return response(request);
    },
    launch: () => {
      order.push('launch');
      assert.equal(f.snapshot.players[2].refunded_wei, '100');
      f.history.set('7', structuredClone(f.snapshot));
      f.setSnapshot({ phase: 'join', game_id: '8', active_game_id: '8', round: 0, outcome: null,
        alive_count: 0, players: [], clock: { unit: 'timestamp', current: '100', deadline: '200' } });
      return { status: 'accepted', reference: { kind: 'transaction-hash', value: hash(800) } };
    }
  });
  await f.runner.tick();
  assert.deepEqual(order, ['7:claim', 'launch']);
  assert.equal(f.runner.getState().snapshot.phase, 'join');
  await f.runner.tick();
  assert.deepEqual(order, ['7:claim', 'launch', '8:join', '8:join', '8:join']);
  assert.equal(f.launches.length, 1);
});

test('cutoff suppresses launches and historical claims wait through active phases until terminal', async (t) => {
  const f = await fixture(t, { snapshot: { phase: 'join', game_id: '2', active_game_id: '2', round: 0, clock: { unit: 'timestamp', current: '100', deadline: '200' } } });
  f.events.push(event('created', '1', 100, 0), event('completed', '1', 100, 1), event('created', '2', 100, 2));
  const previous = { ...structuredClone(f.snapshot), game_id: '1', active_game_id: '2', phase: 'terminal', outcome: 'completed', clock: null,
    players: f.snapshot.players.map((player, index) => ({ ...player, award_wei: index === 0 ? '150' : '0' })) };
  f.history.set('1', previous);
  f.addTime(3601_000);
  await f.runner.tick();
  assert.equal(f.launches.length, 0);
  assert.equal(f.dispatches.length, 0);
  await f.restart();
  await f.runner.tick();
  assert.equal(f.dispatches.length, 0);
  f.setSnapshot({ phase: 'commit', round: 1, clock: { unit: 'block', current: '100', deadline: '120' } });
  await f.runner.tick();
  assert.equal(f.dispatches.length, 6);
  f.setSnapshot({ phase: 'reveal', committed_count: 3 });
  f.snapshot.players.forEach(player => { player.committed = true; });
  await f.runner.tick();
  assert.equal(f.dispatches.length, 9);
  assert.ok(f.dispatches.every(({ request }) => request.game_id === '2' && request.phase !== 'claim'));
  f.setSnapshot({ phase: 'terminal', active_game_id: '0', outcome: 'cancelled', clock: null,
    players: f.snapshot.players.map((player) => ({ ...player, refunded_wei: '100' })) });
  await f.runner.tick();
  const claims = () => f.dispatches.filter(({ request }) => request.phase === 'claim');
  assert.deepEqual(claims().map(({ request }) => [request.game_id, request.seat_id]), [['1', 'oc-1']]);
  previous.players[0].claimed_wei = '150';
  await f.restart();
  await f.runner.tick();
  await f.runner.tick();
  assert.equal(claims().length, 1, 'settlement recovery must not replay an acknowledged claim');
  const records = createDurableStore({ directory: path.join(f.runtimeDir, 'coordinator') });
  const saved = await records.get('conference');
  assert.equal(saved.metadata.terminal_games['1'].settled, true);
  assert.equal(saved.metadata.terminal_games['2'].settled, true);
  assert.equal(f.runner.getState().scheduling.status, 'stopped');
  assert.equal(f.launches.length, 0);
});

test('spectator hangs are bounded and do not start duplicate publisher calls or stop gameplay', async (t) => {
  const f = await fixture(t, { publish: () => new Promise(() => {}) });
  await f.runner.tick();
  assert.equal(f.dispatches.length, 6);
  assert.ok(f.runner.getState().health.some((issue) => issue.code === 'SPECTATOR_UNAVAILABLE'));
  f.setSnapshot({ phase: 'reveal', committed_count: 3 });
  f.snapshot.players.forEach((player) => { player.committed = true; });
  await f.runner.tick();
  assert.equal(f.dispatches.length, 9);
  assert.equal(f.publications.length, 1);
});

test('restart refuses the same runtime with a different run identity', async (t) => {
  const f = await fixture(t);
  await f.runner.initialize();
  await f.runner.close();
  const wrong = createConferenceRunner({ ...f.dependencies, config: { ...f.config, run_id: 'another-run' } });
  await assert.rejects(wrong.initialize(), /RUNTIME_IDENTITY_MISMATCH/);
});

test('new game seats share one team log append queue and asynchronous mirror health is surfaced', async (t) => {
  const f = await fixture(t, { snapshot: { phase: 'idle', game_id: '0', active_game_id: '0', alive_count: 0, players: [], clock: null } });
  f.dependencies.spectator.health = async () => ({ ok: false, issues: ['fixture-outage'] });
  await f.runner.initialize();
  f.setSnapshot({ phase: 'commit', game_id: '2', active_game_id: '2', alive_count: 3,
    clock: { unit: 'block', current: '100', deadline: '120' },
    players: roster.map((seat) => ({ wallet_address: seat.wallet_address, joined: true, alive: true, committed: false,
      revealed: false, award_wei: '0', claimed_wei: '0', refunded_wei: '0' })) });
  await f.runner.tick();
  assert.equal(f.dispatches.length, 6);
  assert.deepEqual(f.runner.getState().messages.openclaw.map((message) => message.sequence), [1, 2]);
  assert.equal(f.runner.getState().messages.hermes.length, 1);
  assert.ok(f.runner.getState().health.some((issue) => issue.code === 'SPECTATOR_UNAVAILABLE'));
});

test('a confirmed same-height fork blocks gameplay and preserves the old cursor', async (t) => {
  const f = await fixture(t);
  await f.runner.initialize();
  f.setSnapshot({ block_hash: hash(999) });
  await f.runner.tick();
  assert.equal(f.dispatches.length, 0);
  assert.equal(f.advances.length, 0);
  assert.equal(f.launches.length, 0);
  assert.equal(f.runner.getState().snapshot.block_hash, hash(100));
  assert.ok(f.runner.getState().health.some((issue) => issue.code === 'CONFIRMED_CHAIN_REORG'));
});

test('a fork below a newer confirmed head blocks gameplay using the durable checkpoint', async (t) => {
  const f = await fixture(t);
  await f.runner.initialize();
  f.dependencies.chain.readBlockHash = async () => hash(999);
  f.nextBlock();
  await f.runner.tick();
  assert.equal(f.dispatches.length, 0);
  assert.ok(f.runner.getState().health.some((issue) => issue.code === 'CONFIRMED_CHAIN_REORG'));
});
