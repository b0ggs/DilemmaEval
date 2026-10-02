import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fixtureConfig, createFixtureAdapters } from '../src/fixture.mjs';
import { validateConfig } from '../src/config.mjs';
import { createConferenceRunner, createDurableStore } from '../src/runner/index.mjs';
import { createTelegramMirror } from '../src/telegram/index.mjs';
import { buildPublicState } from '../src/public-state.mjs';

// Every agent, block, transaction and Telegram reply in this file is synthetic.
// These tests establish local assembly behavior, never live readiness or proof.
const start = Date.parse('2026-10-02T14:00:00.000Z');
const response = (payload, status = 200) => ({ status, json: async () => payload });

async function setup(t, options = {}) {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'conference-ten-seat-fixture-'));
  const runners = [];
  t.after(async () => {
    for (const runner of runners) await runner.close();
    await fs.rm(runtimeDir, { recursive: true, force: true });
  });
  let time = start;
  const now = () => time;
  const config = validateConfig(await fixtureConfig({ now: time, runId: 'synthetic-ten-seat-assembly', teamSizes: { openclaw: 5, hermes: 5 } }));
  Object.assign(config, { agent_timeout_ms: 2000, adapter_timeout_ms: 2000, spectator_timeout_ms: 2000 }, options.config);
  config.telegram.openclaw.chat_id = '-100111';
  config.telegram.hermes.chat_id = '-100222';
  const adapters = createFixtureAdapters({ config, now, cancelGameIds: options.cancelGameIds });
  const calls = [];
  const agent = adapters.agents.dispatch;
  adapters.agents = { dispatch: async input => {
    calls.push(structuredClone({ seat: input.seat, request: input.request, deadline_at_ms: input.deadline_at_ms }));
    return options.dispatch ? options.dispatch(input, agent) : agent(input);
  } };
  const deliveries = [];
  let deliveryId = 1;
  const mirrorOptions = {
    config, runtimeDir, token: 'synthetic-fixture-token', now,
    scoreboard: { seriesId: 'synthetic-ten-seat', firstGameId: '1', messageIds: { openclaw: 11, hermes: 22 }, runtimeDir: path.join(runtimeDir, 'series') },
    fetchImpl: async (url, request) => {
      const call = { method: url.split('/').at(-1), body: JSON.parse(request.body) };
      deliveries.push(call);
      const rejection = await options.deliver?.(call);
      return rejection ?? response({ ok: true, result: { message_id: call.method === 'editMessageText' ? call.body.message_id : deliveryId++ } });
    }
  };
  let mirror = createTelegramMirror(mirrorOptions);
  let runner;
  function makeRunner() {
    runner = createConferenceRunner({ config, runtimeDir, ...adapters, spectator: mirror, now });
    runners.push(runner);
    return runner;
  }
  makeRunner();
  return {
    config, runtimeDir, adapters, fixtureDispatch: agent, calls, deliveries, now,
    get runner() { return runner; }, get mirror() { return mirror; },
    setTime(value) { time = value; }, advance(ms = 1000) { time += ms; },
    async restart() { await runner.close(); mirror = createTelegramMirror(mirrorOptions); makeRunner(); return runner.initialize(); },
    async tick() { const state = await runner.tick(); time += 1000; return state; },
    async until(predicate, limit = 60) {
      for (let index = 0; index < limit; index++) { const state = await this.tick(); if (predicate(state)) return state; }
      assert.fail(`Synthetic assembly did not reach expected state: ${JSON.stringify(runner.getState().health)}`);
    },
    records() { return createDurableStore({ directory: path.join(runtimeDir, 'coordinator') }).entries('dispatch:'); },
    outbox() { return fs.readFile(path.join(runtimeDir, 'telegram', 'outbox.json'), 'utf8').then(JSON.parse); }
  };
}

function seatsFor(config, team) { return config.roster.filter(seat => !team || seat.team === team).map(seat => seat.seat_id).sort(); }
function actionCalls(calls, game, action) { return calls.filter(({ request }) => request.game_id === game && (request.type === 'discussion' ? 'discussion' : request.requested_action) === action); }

test('synthetic configuration supports ten distinct seats and adapters reject live mode', async () => {
  const config = validateConfig(await fixtureConfig({ teamSizes: { openclaw: 5, hermes: 5 } }));
  assert.equal(config.mode, 'fixture');
  assert.equal(config.roster.length, 10);
  assert.equal(new Set(config.roster.map(seat => seat.wallet_address)).size, 10);
  assert.equal(new Set(config.roster.map(seat => seat.agent_id)).size, 10);
  assert.equal((await fixtureConfig()).roster.length, 3, 'preserve the existing default fixture');
  assert.throws(() => createFixtureAdapters({ config: { ...config, mode: 'live' } }), /FIXTURE_MODE_REQUIRED/);
  await assert.rejects(fixtureConfig({ teamSizes: { openclaw: 11, hermes: 5 } }), /FIXTURE_TEAM_SIZE_INVALID/);
});

test('repeated ten-seat games assemble discussion, joins, commits, reveals, refunds, claims and isolated recoverable scoreboards', async t => {
  const firstSend = new Set();
  const f = await setup(t, {
    cancelGameIds: ['2'],
    deliver(call) {
      if (call.method !== 'sendMessage' || firstSend.has(call.body.chat_id)) return;
      firstSend.add(call.body.chat_id);
      return call.body.chat_id === '-100111'
        ? response({ ok: false, error_code: 503 }, 503)
        : response({ ok: false, error_code: 429, parameters: { retry_after: 2 } }, 429);
    },
    async dispatch(input, dispatch) {
      const { request } = input;
      if (request.requested_action === 'commit') {
        assert.deepEqual(request.team_chat.messages.map(message => message.seat_id).sort(), seatsFor(f.config, request.team));
        assert.ok(request.team_chat.messages.every(message => message.team === request.team && message.game_id === request.game_id && message.round === request.round));
      }
      return dispatch(input);
    }
  });
  let state = await f.until(state => state.snapshot.phase === 'join' && state.snapshot.alive_count === 10);
  assert.deepEqual(buildPublicState({ config: f.config, state, now: f.now() }).counts, { completed: 0, cancelled: 0 });
  assert.equal(actionCalls(f.calls, '1', 'join').length, 10);
  await f.restart();
  state = await f.until(state => state.completed_game_ids.length === 1 && state.cancelled_game_ids.length === 1);
  await f.restart();
  state = await f.until(state => state.completed_game_ids.length === 3);
  f.setTime(Date.parse(f.config.stop_time) + 1);
  await f.tick();
  await f.restart();
  await f.tick();
  for (let index = 0; index < 160 && (await f.mirror.health()).pending; index++) { f.advance(1100); await f.mirror.flush(); }
  state = await f.runner.tick();
  const publicState = buildPublicState({ config: f.config, state, now: f.now() });
  assert.deepEqual(publicState.counts, { completed: 3, cancelled: 1 });
  assert.equal(publicState.mode, 'fixture');
  assert.equal(publicState.roster.length, 10);
  assert.equal(publicState.status, 'stopped');
  assert.deepEqual(state.health, []);
  const allSeats = seatsFor(f.config);
  for (const game of ['1', '3', '4']) {
    for (const action of ['join', 'discussion', 'commit', 'reveal', 'claim']) {
      assert.deepEqual(actionCalls(f.calls, game, action).map(({ seat }) => seat.seat_id).sort(), allSeats, `${game}:${action} exactly once for every seat`);
    }
    const events = state.events.filter(event => event.game_id === game);
    assert.equal(events.filter(event => event.kind === 'joined').length, 10);
    assert.equal(events.filter(event => event.kind === 'claimed').length, 10);
    assert.equal(events.filter(event => event.kind === 'completed').length, 1);
    assert.equal(events.find(event => event.kind === 'round-resolved').data.choices.length, 10);
    assert.ok(events.find(event => event.kind === 'round-resolved').data.choices.every(choice => !choice.defaulted));
  }
  assert.deepEqual(actionCalls(f.calls, '2', 'claim').map(({ seat }) => seat.seat_id).sort(), allSeats);
  assert.equal(actionCalls(f.calls, '2', 'discussion').length, 0);
  assert.equal(state.events.filter(event => event.game_id === '2' && event.kind === 'refunded').length, 10);
  assert.equal(state.events.filter(event => event.game_id === '2' && event.kind === 'claimed').length, 0);
  for (const earnings of publicState.earnings) {
    assert.equal(earnings.awarded_wei, '294030000000000');
    assert.equal(earnings.claimed_wei, earnings.awarded_wei);
    assert.equal(earnings.refunded_wei, '100000000000000');
  }
  const health = await f.mirror.health();
  assert.equal(health.ok, true);
  assert.equal(health.pending, 0);
  assert.equal(health.uncertain, 0);
  assert.equal(health.scoreboard.completed, 3);
  assert.equal(health.scoreboard.cancelled, 1);
  assert.equal(health.scoreboard.ties, 3);
  assert.deepEqual(health.scoreboard.wins, { openclaw: 0, hermes: 0 });
  assert.deepEqual(health.scoreboard.awards_wei, { openclaw: '1470150000000000', hermes: '1470150000000000' });
  const outbox = await f.outbox();
  assert.equal(outbox.entries.filter(entry => entry.key.startsWith('message:')).length, 30);
  assert.ok(outbox.entries.every(entry => entry.status === 'sent'));
  for (const call of f.deliveries) {
    assert.ok(['sendMessage', 'editMessageText'].includes(call.method), 'spectator input never enters agent context');
    if (call.body.text.startsWith('oc-')) assert.equal(call.body.chat_id, '-100111');
    if (call.body.text.startsWith('hs-')) assert.equal(call.body.chat_id, '-100222');
    if (call.method === 'editMessageText') assert.equal(call.body.message_id, call.body.chat_id === '-100111' ? 11 : 22);
  }
  const sentCount = f.deliveries.length;
  await f.restart();
  await f.runner.tick();
  assert.equal(f.deliveries.length, sentCount, 'restart cannot resend delivered messages or unchanged scoreboard edits');
  const replayed = buildPublicState({ config: f.config, state: { ...state, events: [...state.events, ...state.events] }, now: f.now() });
  assert.deepEqual(replayed.counts, publicState.counts);
  assert.deepEqual(replayed.earnings, publicState.earnings);
});

test('one ambiguous join retains nine confirmed successes and cannot replay after restart', async t => {
  let uncertainInput;
  const f = await setup(t, { dispatch: async (input, dispatch) => {
    if (input.request.requested_action === 'join' && input.seat.seat_id === 'hs-5') {
      uncertainInput = input;
      throw Object.assign(new Error('synthetic private provider payload'), { ambiguous: true });
    }
    return dispatch(input);
  } });
  const state = await f.until(state => state.snapshot.phase === 'join' && state.snapshot.alive_count === 9);
  assert.equal(f.calls.length, 10);
  const before = buildPublicState({ config: f.config, state, now: f.now() });
  assert.deepEqual(before.counts, { completed: 0, cancelled: 0 });
  assert.equal(before.current_game.alive_count, 9);
  f.setTime(start + 1000);
  await f.restart();
  await f.runner.tick();
  assert.equal(f.calls.length, 10, 'the nine successful and one uncertain attempts retain their identity');
  assert.ok(f.runner.getState().health.some(issue => issue.code === 'AGENT_ACTION_UNCERTAIN' && issue.seat_id === 'hs-5'));
  const record = (await f.records()).find(({ value }) => value.seat_id === 'hs-5').value;
  assert.equal(record.state, 'unknown');
  assert.equal(JSON.stringify(record).includes('provider'), false);
  // A late authoritative synthetic chain observation reconciles the old request.
  // The runner never invokes the adapter for it again.
  await f.fixtureDispatch(uncertainInput);
  await f.restart();
  assert.equal((await f.records()).find(({ value }) => value.seat_id === 'hs-5').value.state, 'chain-confirmed');
  assert.ok(!f.runner.getState().health.some(issue => issue.code === 'AGENT_ACTION_UNCERTAIN'));
  assert.equal(f.calls.length, 10);
});

test('ten-seat discussion retries only proven pre-submit rejection after restart and preserves the complete team barrier', async t => {
  let expired = false;
  const f = await setup(t, { dispatch: async (input, dispatch) => {
    if (input.request.type === 'discussion' && input.seat.seat_id === 'hs-5' && !expired) {
      expired = true;
      throw Object.assign(new Error('MARITIME_DISPATCH_EXPIRED'), { code: 'MARITIME_DISPATCH_EXPIRED', ambiguous: false, retryable: true });
    }
    if (input.request.requested_action === 'commit') {
      assert.deepEqual(input.request.team_chat.messages.map(message => message.seat_id).sort(), seatsFor(f.config, input.seat.team));
    }
    return dispatch(input);
  } });
  await f.until(() => expired);
  assert.equal(actionCalls(f.calls, '1', 'discussion').length, 10);
  assert.equal(actionCalls(f.calls, '1', 'commit').length, 0);
  await f.restart();
  await f.until(state => state.completed_game_ids.length === 1);
  const discussions = actionCalls(f.calls, '1', 'discussion');
  assert.equal(discussions.length, 11);
  assert.equal(new Set(discussions.map(({ request }) => request.request_id)).size, 10);
  assert.deepEqual(discussions.filter(({ seat }) => seat.seat_id !== 'hs-5').map(({ seat }) => seat.seat_id).sort(), seatsFor(f.config).filter(seat => seat !== 'hs-5'));
  assert.equal(actionCalls(f.calls, '1', 'commit').length, 10);
  assert.equal(f.runner.getState().messages.openclaw.length, 5);
  assert.equal(f.runner.getState().messages.hermes.length, 5);
});

test('ten-seat pending non-signing discussions survive actual process termination without redispatch or commit', async t => {
  const f = await setup(t);
  await f.until(state => state.snapshot.phase === 'commit');
  assert.equal(actionCalls(f.calls, '1', 'discussion').length, 0);
  await f.runner.close();
  const inputFile = path.join(f.runtimeDir, 'synthetic-child-input.json');
  await fs.writeFile(inputFile, JSON.stringify({ config: { ...f.config, agent_timeout_ms: 60000 }, snapshot: await f.adapters.chain.readSnapshot(), now: f.now(), runtimeDir: f.runtimeDir }), { flag: 'wx', mode: 0o600 });
  const childSource = `
    import { readFile } from 'node:fs/promises';
    import { createConferenceRunner } from ${JSON.stringify(new URL('../src/runner/index.mjs', import.meta.url).href)};
    const { config, snapshot, now, runtimeDir } = JSON.parse(await readFile(process.argv[1], 'utf8'));
    let calls = 0;
    const runner = createConferenceRunner({ config, runtimeDir, now: () => now,
      chain: { readSnapshot: async () => snapshot, readEvents: async () => [] },
      agents: { dispatch: async ({ request }) => {
        if (request.type !== 'discussion') throw new Error('UNEXPECTED_SYNTHETIC_SIGNING_REQUEST');
        if (++calls === 10) process.send({ pending: calls });
        return new Promise(() => {});
      } },
      launcher: { create: async () => { throw new Error('UNEXPECTED_SYNTHETIC_LAUNCH'); } },
      phaseExecutor: { advance: async () => { throw new Error('UNEXPECTED_SYNTHETIC_ADVANCE'); } }
    });
    await runner.tick();
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', childSource, inputFile], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  const exited = once(child, 'exit');
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await exited; });
  let timeout;
  try {
    const [message] = await Promise.race([
      once(child, 'message'),
      exited.then(() => { throw new Error(`Synthetic child exited before durable reservation: ${stderr}`); }),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Synthetic child did not reach ten pending requests')), 10000); })
    ]);
    assert.deepEqual(message, { pending: 10 });
  } finally { clearTimeout(timeout); }
  const before = (await f.records()).filter(({ value }) => value.action === 'discussion');
  assert.equal(before.length, 10);
  assert.ok(before.every(({ value }) => value.state === 'reserved'));
  child.kill('SIGKILL');
  const [, signal] = await exited;
  assert.equal(signal, 'SIGKILL');
  await f.restart();
  const callsBefore = f.calls.length;
  const state = await f.runner.tick();
  assert.equal(f.calls.length, callsBefore, 'all ten reserved discussions remain blocked, never replayed');
  assert.equal(actionCalls(f.calls, '1', 'commit').length, 0);
  assert.equal(state.health.filter(issue => issue.code === 'AGENT_ACTION_UNCERTAIN').length, 10);
  assert.deepEqual((await f.records()).filter(({ value }) => value.action === 'discussion'), before, 'crash recovery preserves all ten original reservations');
  assert.deepEqual(buildPublicState({ config: f.config, state, now: f.now() }).counts, { completed: 0, cancelled: 0 });
});

test('ambiguous Telegram sends remain isolated and never replay while ten-seat chain results stay authoritative', async t => {
  let uncertainText;
  const f = await setup(t, { deliver(call) {
    if (call.method === 'sendMessage' && call.body.chat_id === '-100111' && !uncertainText) {
      uncertainText = call.body.text;
      throw new Error('synthetic token-bearing transport failure');
    }
  } });
  await f.until(state => state.completed_game_ids.length === 1);
  f.setTime(Date.parse(f.config.stop_time) + 1);
  await f.runner.tick();
  await f.restart();
  for (let index = 0; index < 60 && (await f.mirror.health()).pending; index++) { f.advance(1100); await f.mirror.flush(); }
  const state = await f.runner.tick();
  assert.equal((await f.mirror.health()).uncertain, 1);
  assert.equal(f.deliveries.filter(call => call.method === 'sendMessage' && call.body.chat_id === '-100111' && call.body.text === uncertainText).length, 1);
  assert.equal((await f.outbox()).entries.filter(entry => entry.status === 'uncertain').length, 1);
  assert.equal(JSON.stringify(await f.outbox()).includes('token-bearing'), false);
  const publicState = buildPublicState({ config: f.config, state, now: f.now() });
  assert.deepEqual(publicState.counts, { completed: 1, cancelled: 0 });
  assert.equal(publicState.earnings.length, 10);
  assert.ok(publicState.earnings.every(row => row.awarded_wei === '98010000000000' && row.claimed_wei === row.awarded_wei));
  assert.ok(publicState.health.issues.includes('telegram-unavailable'));
  assert.equal((await f.mirror.health()).scoreboard.completed, 1);
});

test('ten submitted ACKs without confirmed joins do not advance the game, public counters or scoreboards', async t => {
  const f = await setup(t, { dispatch: async ({ request }) => ({
    schema_version: 1, request_id: request.request_id, game_id: request.game_id, round: request.round,
    phase: request.phase, seat_id: request.seat_id, status: 'submitted', transaction_hash: `0x${'ab'.repeat(32)}`
  }) });
  await f.tick();
  await f.tick();
  f.setTime(start + 1000);
  await f.restart();
  const state = await f.runner.tick();
  assert.equal(f.calls.length, 10, 'acknowledged but unconfirmed operations are not replayed');
  assert.equal(state.snapshot.phase, 'join');
  assert.equal(state.snapshot.alive_count, 0);
  assert.equal(state.events.filter(event => event.kind === 'joined').length, 0);
  assert.equal((await f.records()).filter(({ value }) => value.state === 'chain-confirmed').length, 0);
  assert.deepEqual(buildPublicState({ config: f.config, state, now: f.now() }).counts, { completed: 0, cancelled: 0 });
  assert.equal((await f.mirror.health()).scoreboard.completed, 0);
});
