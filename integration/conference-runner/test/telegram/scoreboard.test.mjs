import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createTelegramMirror } from '../../src/telegram/index.mjs';

// All chain events and Telegram responses here are local fixtures, not live evidence.
const roster = Array.from({ length: 10 }, (_, index) => ({ seat_id: `${index < 5 ? 'oc' : 'hs'}-${index % 5 + 1}`, team: index < 5 ? 'openclaw' : 'hermes', wallet_address: `0x${(index + 1).toString(16).padStart(40, '0')}` }));
const config = { run_id: 'fixture-attempt-a', mode: 'fixture', chain_id: 84532, game_address: `0x${'a'.repeat(40)}`, roster, telegram: { hermes: { chat_id: '-100222' }, openclaw: { chat_id: '-100111' } } };
const tx = game => `0x${Number(game).toString(16).padStart(64, '0')}`;
function event(game, kind, data = {}, index = 0) {
  return { id: `${tx(game)}:${index}`, game_id: String(game), round: 1, kind, block_number: String(1000 + Number(game)), transaction_hash: tx(game), log_index: index, data };
}
function completed(game, amounts = Array(10).fill('0')) {
  return event(game, 'completed', { awards: roster.map((seat, index) => ({ wallet_address: seat.wallet_address, award_wei: String(amounts[index]) })) });
}
const response = (payload, status = 200) => ({ status, json: async () => payload });
async function fixture(t, handler) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'conference-scoreboard-fixture-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let time = Date.parse('2026-09-25T17:00:00Z');
  const calls = [];
  const fetchImpl = async (url, request) => {
    const call = { method: url.split('/').at(-1), body: JSON.parse(request.body) };
    calls.push(call);
    if (handler) return handler(call, calls);
    return response({ ok: true, result: { message_id: call.method === 'editMessageText' ? 3 : 100 + calls.length, chat: { id: call.body.chat_id } } });
  };
  const scoreboard = { seriesId: 'fixture-five-v-five', firstGameId: '17', messageIds: { hermes: 3, openclaw: 3 }, runtimeDir: path.join(directory, 'series') };
  const options = { config, runtimeDir: path.join(directory, 'run-a'), scoreboard, token: 'fixture-secret', fetchImpl, now: () => time };
  return { directory, options, calls, mirror: createTelegramMirror(options), advance: (ms = 5000) => { time += ms; }, edits: () => calls.filter(call => call.method === 'editMessageText'), ledger: () => fs.readFile(path.join(scoreboard.runtimeDir, 'telegram/scoreboard.json'), 'utf8').then(JSON.parse) };
}

test('scoreboards edit only existing pins, preserve outbox summary, and do not edit unchanged state', async t => {
  const f = await fixture(t);
  const health = await f.mirror.publish();
  assert.equal(health.sent, 0);
  assert.equal(health.pending, 0);
  assert.equal(health.scoreboard.completed, 0);
  assert.equal(f.edits().length, 2);
  assert.deepEqual(f.edits().map(call => [call.body.chat_id, call.body.message_id]).sort(), [['-100111', 3], ['-100222', 3]]);
  assert.ok(f.calls.every(call => call.method === 'editMessageText'));
  assert.ok(f.edits().every(call => call.body.text.includes('OpenClaw 0 — Hermes 0')));
  assert.ok(f.edits().every(call => call.body.parse_mode === undefined));
  f.advance(); await f.mirror.flush(); await f.mirror.publish();
  assert.equal(f.calls.length, 2);
  assert.ok(!JSON.stringify(await f.ledger()).includes(f.options.token));
  assert.equal((await fs.stat(path.join(f.options.scoreboard.runtimeDir, 'telegram/scoreboard.json'))).mode & 0o777, 0o600);
});

test('wins use all five awards per team, ties and cumulative prizes are exact BigInt sums', async t => {
  const f = await fixture(t);
  const events = [
    completed(17, ['3000000000000000001', 3, 3, 3, 3, '3000000000000000010', 0, 0, 0, 0]),
    completed(18, [0, 0, 0, 0, 1, 1, 1, 1, 1, 1]),
    completed(19, [2, 2, 2, 2, 2, 10, 0, 0, 0, 0]),
  ];
  const health = await f.mirror.publish({ events });
  assert.deepEqual(health.scoreboard.wins, { openclaw: 1, hermes: 1 });
  assert.equal(health.scoreboard.ties, 1);
  assert.equal(health.scoreboard.completed, 3);
  assert.deepEqual(health.scoreboard.awards_wei, { openclaw: '3000000000000000024', hermes: '3000000000000000025' });
  assert.ok(f.edits().every(call => call.body.text.includes('OpenClaw 1 — Hermes 1')));
  assert.ok(f.edits().every(call => call.body.text.includes('3.000000000000000024 ETH')));
  for (const result of events) assert.ok(f.edits()[0].body.text.includes(`https://sepolia.basescan.org/tx/${result.transaction_hash}`));
});

test('historical games, claims, refunds and cancellation never add wins or duplicate awards', async t => {
  const f = await fixture(t);
  const events = [
    completed(16, Array(10).fill('999999')),
    completed(17, [7, 0, 0, 0, 0, 2, 0, 0, 0, 0]),
    event(17, 'claimed', { wallet_address: roster[0].wallet_address, amount_wei: '7' }, 1),
    event(18, 'cancelled'),
    event(18, 'refunded', { wallet_address: roster[0].wallet_address, amount_wei: '999999' }, 1),
  ];
  const snapshot = { game_id: '19', round: 0, phase: 'join', players: roster.map(seat => ({ ...seat, balance_wei: '9999999999999999999999', award_wei: '999999' })) };
  const { scoreboard } = await f.mirror.publish({ events, snapshot });
  assert.equal(scoreboard.completed, 1); assert.equal(scoreboard.cancelled, 1);
  assert.deepEqual(scoreboard.wins, { openclaw: 1, hermes: 0 });
  assert.deepEqual(scoreboard.awards_wei, { openclaw: '7', hermes: '2' });
  assert.ok(f.edits()[0].body.text.includes('Game 19 · Round 0 · join'));
  assert.deepEqual((await f.ledger()).results.map(item => item.game_id), ['17']);
});

test('same game/result deduplicates across replay, changed event IDs and fresh proof run directories', async t => {
  const f = await fixture(t);
  const result = completed(17, [0, 0, 0, 0, 0, 10, 0, 0, 0, 0]);
  await f.mirror.publish({ events: [result, result] });
  f.advance();
  const restarted = createTelegramMirror({ ...f.options, config: { ...config, run_id: 'fixture-attempt-b' }, runtimeDir: path.join(f.directory, 'run-b') });
  const { scoreboard } = await restarted.publish({ events: [{ ...result, id: 'same-confirmed-result-new-observation' }] });
  assert.equal(scoreboard.completed, 1); assert.equal(scoreboard.wins.hermes, 1);
  assert.equal(scoreboard.awards_wei.hermes, '10');
  assert.equal(f.edits().length, 2);
  assert.equal((await f.ledger()).results.length, 1);
});

test('incomplete, foreign and duplicate roster awards are rejected without affecting scores', async t => {
  const f = await fixture(t);
  const incomplete = completed(17); incomplete.data.awards.pop();
  const foreign = completed(18); foreign.data.awards[0].wallet_address = `0x${'f'.repeat(40)}`;
  const duplicate = completed(19); duplicate.data.awards[0] = duplicate.data.awards[1];
  const unconfirmed = { ...completed(20), confirmed: false };
  const removed = { ...completed(21), removed: true };
  const { scoreboard } = await f.mirror.publish({ events: [incomplete, foreign, duplicate, unconfirmed, removed] });
  assert.equal(scoreboard.ok, false); assert.equal(scoreboard.completed, 0);
  assert.equal(scoreboard.rejected_results.length, 5);
  assert.deepEqual(scoreboard.awards_wei, { openclaw: '0', hermes: '0' });
  assert.ok(f.edits()[0].body.text.includes('Accounting blocked for 5 game(s)'));
});

test('conflicting awards, reusing a result ID for another game, and cancelled completions fail closed', async t => {
  const f = await fixture(t);
  const valid = completed(17, [1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  await f.mirror.publish({ events: [valid, event(19, 'cancelled')] });
  const conflict = completed(17, [100, 0, 0, 0, 0, 0, 0, 0, 0, 0]); conflict.id = 'conflicting-observation';
  const reused = { ...valid, id: 'foreign-game-reusing-result', game_id: '18' };
  const cancelled = completed(19); cancelled.id = 'cancelled-then-completed'; cancelled.log_index = 2;
  const { scoreboard } = await f.mirror.publish({ events: [conflict, reused, cancelled] });
  assert.equal(scoreboard.completed, 1); assert.equal(scoreboard.awards_wei.openclaw, '1');
  assert.equal(scoreboard.rejected_results.length, 3);
  assert.equal(scoreboard.cancelled, 1);
});

test('zero awards tie and late confirmed defaults remain visibly marked after restart', async t => {
  const f = await fixture(t);
  await f.mirror.publish({ events: [completed(17)] });
  assert.ok(f.edits()[0].body.text.includes('ZERO AWARDS'));
  f.advance();
  const defaults = event(17, 'round-resolved', { choices: [{ wallet_address: roster[0].wallet_address, choice: 'Share', defaulted: true }], remaining_players: 0 }, 2);
  const { scoreboard } = await createTelegramMirror(f.options).publish({ events: [defaults, defaults] });
  assert.equal(scoreboard.ties, 1); assert.equal(scoreboard.defaulted_games, 1);
  assert.ok(f.edits().at(-1).body.text.includes('DEFAULTS OBSERVED'));
  assert.ok(f.edits().at(-1).body.text.includes('not healthy-play proof'));
  assert.equal((await f.ledger()).defaults['17'].length, 1);
});

test('unknown edit outcomes retry the same target/text safely, including not-modified success', async t => {
  let editCalls = 0;
  const f = await fixture(t, async call => {
    assert.equal(call.method, 'editMessageText'); editCalls += 1;
    if (editCalls <= 2) throw new Error('https://api.telegram.org/botSECRET/editMessageText');
    return response({ ok: false, error_code: 400, description: 'Bad Request: message is not modified: specified new message content is exactly the same' }, 400);
  });
  const initial = await f.mirror.publish();
  assert.ok(initial.scoreboard.issues.includes('SCOREBOARD_EDIT_RETRY_PENDING'));
  assert.equal(initial.uncertain, 0);
  f.advance(4999); await f.mirror.flush(); assert.equal(f.calls.length, 2);
  f.advance(1);
  const final = await createTelegramMirror(f.options).flush();
  assert.equal(f.calls.length, 4);
  assert.deepEqual(f.calls.slice(0, 2), f.calls.slice(2));
  assert.equal(final.scoreboard.ok, true);
  assert.ok(Object.values(final.scoreboard.pins).every(pin => pin.status === 'sent'));
  assert.ok(!JSON.stringify(final).includes('SECRET'));
  assert.ok(!JSON.stringify(await f.ledger()).includes('SECRET'));
});

test('inflight edit resumes after process exit without ever sending a new scoreboard', async t => {
  const f = await fixture(t); await f.mirror.publish();
  const ledger = await f.ledger();
  ledger.pins.openclaw.status = 'inflight'; ledger.pins.openclaw.sent_digest = null;
  await fs.writeFile(path.join(f.options.scoreboard.runtimeDir, 'telegram/scoreboard.json'), JSON.stringify(ledger));
  f.advance();
  const health = await createTelegramMirror(f.options).flush();
  assert.equal(f.calls.length, 3);
  assert.ok(f.calls.every(call => call.method === 'editMessageText' && call.body.message_id === 3));
  assert.equal(health.scoreboard.pins.openclaw.status, 'sent');
});

test('429 cooldown survives a new run and blocks sends and edits until retry_after', async t => {
  let edits = 0;
  const f = await fixture(t, async call => {
    if (call.method === 'editMessageText' && ++edits <= 2) return response({ ok: false, error_code: 429, parameters: { retry_after: 12 } }, 429);
    return response({ ok: true, result: { message_id: call.method === 'editMessageText' ? 3 : 90 } });
  });
  await f.mirror.publish();
  f.advance(11999);
  const restarted = createTelegramMirror({ ...f.options, config: { ...config, run_id: 'fixture-attempt-b' }, runtimeDir: path.join(f.directory, 'run-b') });
  await restarted.publish({ events: [event(17, 'created')] }); assert.equal(f.calls.length, 2);
  f.advance(1); await restarted.flush(); assert.equal(f.calls.length, 4);
});

test('permanent edit rejection is sanitized and never creates replacement messages', async t => {
  const f = await fixture(t, async () => response({ ok: false, error_code: 403, description: 'SECRET permissions unavailable' }, 403));
  const health = await f.mirror.publish();
  assert.ok(health.scoreboard.issues.includes('SCOREBOARD_EDIT_REJECTED'));
  f.advance(); await f.mirror.flush();
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every(call => call.method === 'editMessageText'));
  assert.ok(!JSON.stringify(await f.ledger()).includes('SECRET'));
});

test('snapshot updates stage only and cannot fabricate confirmed outcomes or funding awards', async t => {
  const f = await fixture(t);
  const snapshot = { game_id: '17', round: 2, phase: 'completed', outcome: 'completed', players: roster.map(seat => ({ ...seat, award_wei: '9999999999999999' })) };
  const health = await f.mirror.publish({ snapshot });
  assert.equal(health.scoreboard.completed, 0);
  assert.deepEqual(health.scoreboard.wins, { openclaw: 0, hermes: 0 });
  assert.ok(f.edits()[0].body.text.includes('Game 17 · Round 2 · completed'));
  f.advance();
  await f.mirror.publish({ snapshot: { ...snapshot, game_id: '16', phase: 'cancelled' } });
  assert.equal(f.edits().length, 2);
});

test('series destination, roster, threshold and ID changes fail closed while run changes are allowed', async t => {
  const f = await fixture(t); await f.mirror.health();
  const variants = [
    { ...f.options, scoreboard: { ...f.options.scoreboard, seriesId: 'other-series' } },
    { ...f.options, scoreboard: { ...f.options.scoreboard, firstGameId: '18' } },
    { ...f.options, scoreboard: { ...f.options.scoreboard, messageIds: { hermes: 4, openclaw: 3 } } },
    { ...f.options, config: { ...config, roster: roster.map((seat, index) => index === 0 ? { ...seat, wallet_address: `0x${'f'.repeat(40)}` } : seat) } },
  ];
  for (const options of variants) await assert.rejects(createTelegramMirror(options).health(), /SCOREBOARD_SCOPE_MISMATCH/);
});

test('edits respect room cooldown and real agent text stays in its own room', async t => {
  const f = await fixture(t);
  const messages = Object.fromEntries(['openclaw', 'hermes'].map(team => [team, [{ team, seat_id: team === 'openclaw' ? 'oc-1' : 'hs-1', game_id: '17', round: 1, sequence: 1, request_id: `${team}-discussion`, message: `${team} private team strategy` }]]));
  const initial = await f.mirror.publish({ messages });
  assert.equal(initial.pending, 2); assert.equal(f.calls.length, 2);
  f.advance(1099); await f.mirror.flush(); assert.equal(f.calls.length, 2);
  f.advance(1); await f.mirror.flush();
  const sends = f.calls.filter(call => call.method === 'sendMessage');
  assert.equal(sends.length, 2);
  assert.ok(sends.find(call => call.body.chat_id === '-100111').body.text.includes('openclaw private team strategy'));
  assert.ok(sends.find(call => call.body.chat_id === '-100222').body.text.includes('hermes private team strategy'));
  assert.ok(sends.every(call => !call.body.text.includes('Scoreboard')));
});
