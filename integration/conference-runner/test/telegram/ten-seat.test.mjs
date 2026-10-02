import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createTelegramMirror } from '../../src/telegram/index.mjs';

// Synthetic ten-seat traffic only. These fixtures never contact Telegram.
const roster = Array.from({ length: 10 }, (_, index) => ({ seat_id: `${index < 5 ? 'oc' : 'hs'}-${index % 5 + 1}`,
  team: index < 5 ? 'openclaw' : 'hermes', wallet_address: `0x${(index + 1).toString(16).padStart(40, '0')}` }));
const config = { run_id: 'ten-seat-telegram-fixture', mode: 'fixture', chain_id: 84532, roster,
  telegram: { openclaw: { chat_id: '-100111' }, hermes: { chat_id: '-100222' } } };
const H = value => `0x${value.toString(16).padStart(64, '0')}`;
const response = (payload, status = 200) => ({ status, json: async () => payload });
function gameInput(game) {
  const messages = { openclaw: [], hermes: [] };
  for (const round of [1, 2]) for (const seat of roster) messages[seat.team].push({ ...seat, game_id: String(game), round,
    sequence: messages[seat.team].length + 1, request_id: `fixture-${game}-${round}-${seat.seat_id}`,
    message: `  ${seat.team} strategy ${game}/${round}/${seat.seat_id}: <verbatim> & 🦀  ` });
  const result = { id: `${H(game)}:0`, game_id: String(game), round: 2, kind: 'completed', block_number: String(100 + game),
    transaction_hash: H(game), log_index: 0, data: { awards: roster.map(seat => ({ wallet_address: seat.wallet_address, award_wei: '1' })) } };
  return { messages, events: [result] };
}
async function fixture(t, handler) {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ten-seat-telegram-fixture-'));
  t.after(() => fs.rm(runtimeDir, { recursive: true, force: true }));
  let time = Date.parse('2026-10-02T12:00:00Z');
  const calls = [], delivered = [];
  const options = { config, runtimeDir, token: 'fixture-only', now: () => time, fetchImpl: async (url, request) => {
    assert.equal(url.split('/').at(-1), 'sendMessage');
    const body = JSON.parse(request.body); calls.push(body);
    const result = await handler?.(body, calls);
    if (result) return result;
    delivered.push(body);
    return response({ ok: true, result: { message_id: delivered.length, chat: { id: body.chat_id } } });
  } };
  return { options, calls, delivered, mirror: createTelegramMirror(options), advance: (ms = 1100) => { time += ms; },
    filename: path.join(runtimeDir, 'telegram/outbox.json') };
}

test('three ten-seat games keep both rounds in their own rooms through rate limits, outage and restarts', async t => {
  const rejected = new Set();
  const f = await fixture(t, body => {
    if (rejected.has(body.chat_id)) return;
    rejected.add(body.chat_id);
    return body.chat_id === '-100111'
      ? response({ ok: false, error_code: 503, description: 'PRIVATE_PROVIDER_TEXT' }, 503)
      : response({ ok: false, error_code: 429, parameters: { retry_after: 12 } }, 429);
  });
  let mirror = f.mirror;
  for (const game of [18, 19, 20]) {
    const input = gameInput(game);
    await mirror.publish(input);
    if (game === 18) {
      f.advance(11999); mirror = createTelegramMirror(f.options);
      await mirror.flush(); assert.equal(f.calls.length, 2);
      f.advance(1);
    }
    for (let flush = 0; flush < 12; flush++) {
      f.advance();
      if (flush === 4) mirror = createTelegramMirror(f.options);
      await mirror.publish(input);
    }
    const health = await mirror.health();
    assert.equal(health.pending, 0);
    assert.equal(health.sent, (game - 17) * 22);
    assert.equal(health.uncertain, 0);
    const delivered = f.delivered.filter(item => item.text.includes(`Game ${game} ·`));
    assert.equal(delivered.length, 22);
    assert.ok(delivered.slice(0, 2).every(item => item.text.startsWith('Dealer ·')));
    for (const seat of roster) for (const round of [1, 2]) {
      const expected = input.messages[seat.team].find(item => item.seat_id === seat.seat_id && item.round === round);
      const matches = delivered.filter(item => item.text.endsWith(expected.message));
      assert.equal(matches.length, 1);
      assert.equal(matches[0].chat_id, config.telegram[seat.team].chat_id);
    }
  }
  assert.equal(new Set(f.delivered.map(item => `${item.chat_id}:${item.text}`)).size, 66);
  const stored = await fs.readFile(f.filename, 'utf8');
  assert.ok(!stored.includes('PRIVATE_PROVIDER_TEXT'));
  assert.ok(!stored.includes(f.options.token));
});

test('one ambiguous seat stays uncertain across repeated ten-seat publish/restart while other seats deliver once', async t => {
  const f = await fixture(t, body => {
    if (body.text.startsWith('hs-3 ') && body.text.includes('Round 1')) throw new Error('PRIVATE_PROVIDER_TEXT');
  });
  const input = gameInput(21);
  let mirror = f.mirror;
  await mirror.publish(input);
  for (let iteration = 0; iteration < 14; iteration++) {
    f.advance(); mirror = createTelegramMirror(f.options); await mirror.publish(input);
  }
  const health = await mirror.health();
  assert.equal(health.sent, 21); assert.equal(health.uncertain, 1); assert.equal(health.pending, 0);
  assert.equal(f.calls.filter(body => body.text.startsWith('hs-3 ') && body.text.includes('Round 1')).length, 1);
  assert.equal(new Set(f.delivered.map(body => `${body.chat_id}:${body.text}`)).size, 21);
  assert.ok(!(await fs.readFile(f.filename, 'utf8')).includes('PRIVATE_PROVIDER_TEXT'));
});

test('wrong-chat and invalid message acknowledgements never count as sent or retry', async t => {
  for (const result of [{ message_id: 0 }, { message_id: -1 }, { message_id: 5, chat: { id: '-100999' } }]) {
    const f = await fixture(t, () => response({ ok: true, result }));
    await f.mirror.publish(gameInput(22)); f.advance();
    const health = await createTelegramMirror(f.options).health();
    assert.equal(health.sent, 0); assert.equal(health.uncertain, 2);
    assert.equal(f.calls.length, 2);
  }
});

test('tampered persisted ten-seat outboxes fail closed before any send', async t => {
  for (const corrupt of [state => { state.entries[0].text += ' tampered'; },
    state => { state.entries.push(state.entries[0]); }, state => { state.entries[0].message_id = 0; }]) {
    const f = await fixture(t); await f.mirror.publish(gameInput(23));
    const state = JSON.parse(await fs.readFile(f.filename, 'utf8')); corrupt(state);
    await fs.writeFile(f.filename, JSON.stringify(state)); f.advance();
    await assert.rejects(createTelegramMirror(f.options).flush(), /TELEGRAM_OUTBOX_INVALID/);
    assert.equal(f.calls.length, 2);
  }
});
