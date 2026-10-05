import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createTelegramMirror, formatDealerEvent, formatAgentMessages, verifyTelegramGroups } from '../../src/telegram/index.mjs';

const wallets = ['1', '2', '3'].map((digit) => `0x${digit.repeat(40)}`);
const tx = `0x${'a'.repeat(64)}`;
const config = {
  schema_version: 1, run_id: 'telegram-fixture', mode: 'fixture', chain_id: 84532,
  roster: [
    { seat_id: 'oc-1', team: 'openclaw', wallet_address: wallets[0] },
    { seat_id: 'oc-2', team: 'openclaw', wallet_address: wallets[1] },
    { seat_id: 'hs-1', team: 'hermes', wallet_address: wallets[2] },
  ],
  telegram: { openclaw: { chat_id: '-100111' }, hermes: { chat_id: '-100222' } },
};
const sharedRoomConfig = {
  ...config,
  run_id: 'telegram-shared-room-fixture',
  telegram: { openclaw: { chat_id: '-100333' }, hermes: { chat_id: '-100333' } },
};
function event(kind, data = {}, index = 0) {
  return { id: `${tx}:${index}`, game_id: '3', round: 2, kind, block_number: '100', transaction_hash: tx, log_index: index, data };
}
function message(overrides = {}) {
  return { schema_version: 1, game_id: '3', round: 2, phase: 'commit', team: 'openclaw', seat_id: 'oc-1', sequence: 1, received_at: '2026-09-24T19:00:00Z', request_id: 'discussion-oc-1', message: '  Catch is an action. <Do not rewrite> & **verbatim**.\nSecond line 🦀  ', ...overrides };
}
function response(payload, status = 200) { return { status, json: async () => payload }; }
async function fixture(t, fetchImpl, extra = {}) {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'conference-telegram-test-'));
  t.after(() => fs.rm(runtimeDir, { recursive: true, force: true }));
  let time = Date.parse('2026-09-24T19:00:00Z');
  const options = { config, runtimeDir, token: 'fixture-not-a-real-token', fetchImpl, now: () => time, ...extra };
  return { runtimeDir, options, mirror: createTelegramMirror(options), advance(ms = 5000) { time += ms; } };
}

test('accepted text remains verbatim and isolated; sent IDs deduplicate across restart', async (t) => {
  const sends = [];
  const f = await fixture(t, async (url, request) => { sends.push({ url, ...JSON.parse(request.body) }); return response({ ok: true, result: { message_id: sends.length } }); });
  const input = { messages: { openclaw: [message()], hermes: [] } };
  await f.mirror.publish(input);
  await f.mirror.publish(input);
  f.advance();
  await createTelegramMirror(f.options).publish(input);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].chat_id, '-100111');
  assert.equal(sends[0].text, `oc-1 (OpenClaw) · Game 3 · Round 2\n${message().message}`);
  assert.equal(sends[0].parse_mode, undefined);
  const stored = await fs.readFile(path.join(f.runtimeDir, 'telegram/outbox.json'), 'utf8');
  assert.ok(!stored.includes(f.options.token));
  assert.equal((await f.mirror.health()).sent, 1);
});

test('both rooms receive completed result before existing chat backlog', async (t) => {
  const sends = [];
  const f = await fixture(t, async (_, request) => { sends.push(JSON.parse(request.body)); return response({ ok: true, result: { message_id: sends.length } }); });
  const completion = event('completed', { awards: [{ wallet_address: wallets[0], award_wei: '100000000000000' }] });
  const hermes = message({ team: 'hermes', seat_id: 'hs-1', message: 'My own plan.', request_id: 'hs1' });
  await f.mirror.publish({ messages: { openclaw: [message()], hermes: [hermes] }, events: [completion] });
  assert.equal(sends.length, 2);
  assert.ok(sends.every((send) => send.text.includes('Game completed')));
  assert.deepEqual(sends.map((send) => send.chat_id).sort(), ['-100111', '-100222']);
  assert.equal((await f.mirror.health()).pending, 2);
  f.advance();
  await f.mirror.flush();
  assert.equal(sends[2].text.endsWith(message().message), true);
  assert.equal(sends[3].text.endsWith('My own plan.'), true);
});

test('a shared proof room enqueues and delivers each Dealer event once across restart', async (t) => {
  const sends = [];
  const f = await fixture(t, async (_, request) => {
    sends.push(JSON.parse(request.body));
    return response({ ok: true, result: { message_id: sends.length } });
  }, { config: sharedRoomConfig });
  const completion = event('completed', { awards: [{ wallet_address: wallets[0], award_wei: '100000000000000' }] });
  await f.mirror.publish({ events: [completion] });
  await f.mirror.publish({ events: [completion] });
  f.advance();
  const restarted = createTelegramMirror(f.options);
  await restarted.publish({ events: [completion] });
  assert.equal(sends.length, 1);
  assert.equal(sends[0].chat_id, '-100333');
  assert.match(sends[0].text, /Game completed/);
  assert.deepEqual(await restarted.health(), {
    ok: true, enabled: true, pending: 0, inflight: 0, sent: 1, uncertain: 0, rejected: 0, issues: [], retry_at: null,
  });
  const stored = JSON.parse(await fs.readFile(path.join(f.runtimeDir, 'telegram/outbox.json'), 'utf8'));
  assert.equal(stored.entries.length, 1);
});

test('a shared proof room serializes both teams while preserving labeled agent text', async (t) => {
  const sends = [];
  let active = 0;
  let maxActive = 0;
  const f = await fixture(t, async (_, request) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await Promise.resolve();
    sends.push(JSON.parse(request.body));
    active -= 1;
    return response({ ok: true, result: { message_id: sends.length } });
  }, { config: sharedRoomConfig });
  const openclaw = message();
  const hermes = message({ team: 'hermes', seat_id: 'hs-1', message: 'My own exact plan. & <unchanged>', request_id: 'hs1' });
  await Promise.all([
    f.mirror.publish({ messages: { openclaw: [openclaw] } }),
    f.mirror.publish({ messages: { hermes: [hermes] } }),
  ]);
  assert.equal(sends.length, 1);
  assert.equal((await f.mirror.health()).pending, 1);
  f.advance(1100);
  await f.mirror.flush();
  assert.equal(sends.length, 2);
  assert.equal(maxActive, 1);
  assert.ok(sends.every((send) => send.chat_id === '-100333'));
  assert.deepEqual(sends.map((send) => send.text), [
    `oc-1 (OpenClaw) · Game 3 · Round 2\n${openclaw.message}`,
    `hs-1 (Hermes) · Game 3 · Round 2\n${hermes.message}`,
  ]);
});

test('429 is persisted and respects retry_after across restart', async (t) => {
  let calls = 0;
  const f = await fixture(t, async () => {
    calls += 1;
    return calls === 1 ? response({ ok: false, error_code: 429, parameters: { retry_after: 12 } }, 429) : response({ ok: true, result: { message_id: 9 } });
  });
  await f.mirror.publish({ messages: { openclaw: [message()] } });
  const restarted = createTelegramMirror(f.options);
  f.advance(11999);
  assert.equal((await restarted.flush()).pending, 1);
  assert.equal(calls, 1);
  f.advance(1);
  assert.equal((await restarted.flush()).sent, 1);
  assert.equal(calls, 2);
});

test('network ambiguity never retries and never exposes raw provider errors', async (t) => {
  let calls = 0;
  const f = await fixture(t, async () => { calls += 1; throw new Error(`https://api.telegram.org/botSECRET/sendMessage`); });
  await f.mirror.publish({ messages: { openclaw: [message()] } });
  f.advance();
  await createTelegramMirror(f.options).publish({ messages: { openclaw: [message()] } });
  assert.equal(calls, 1);
  const health = await f.mirror.health();
  assert.equal(health.uncertain, 1);
  assert.equal(health.ok, false);
  assert.ok(!JSON.stringify(health).includes('SECRET'));
  assert.ok(!(await fs.readFile(path.join(f.runtimeDir, 'telegram/outbox.json'), 'utf8')).includes('SECRET'));
});

test('a crashed inflight send becomes uncertain; no resend on startup', async (t) => {
  let calls = 0;
  const f = await fixture(t, async () => { calls += 1; return response({ ok: true, result: { message_id: 1 } }); });
  await f.mirror.publish({ messages: { openclaw: [message()] } });
  const filename = path.join(f.runtimeDir, 'telegram/outbox.json');
  const state = JSON.parse(await fs.readFile(filename, 'utf8'));
  state.entries[0].status = 'inflight';
  await fs.writeFile(filename, JSON.stringify(state));
  f.advance();
  const health = await createTelegramMirror(f.options).flush();
  assert.equal(calls, 1);
  assert.equal(health.uncertain, 1);
});

test('explicit service rejection retries after backoff but ambiguous HTTP 502 does not', async (t) => {
  let calls = 0;
  const f = await fixture(t, async () => {
    calls += 1;
    return calls === 1 ? response({ ok: false, error_code: 503 }, 503) : response({ ok: true, result: { message_id: 1 } });
  });
  const outage = await f.mirror.publish({ messages: { openclaw: [message()] } });
  assert.equal(outage.pending, 1);
  assert.equal(outage.ok, false);
  assert.ok(outage.issues.includes('TELEGRAM_SERVICE_UNAVAILABLE'));
  f.advance(1999);
  await f.mirror.flush();
  assert.equal(calls, 1);
  f.advance(1);
  assert.equal((await f.mirror.flush()).sent, 1);
  const uncertain = await fixture(t, async () => ({ status: 502, json: async () => { throw new Error('proxy HTML'); } }));
  assert.equal((await uncertain.mirror.publish({ messages: { openclaw: [message()] } })).uncertain, 1);
});

test('invalid bot permissions mark rejection without retries or interrupting publishing', async (t) => {
  let calls = 0;
  const f = await fixture(t, async () => { calls += 1; return response({ ok: false, error_code: 403, description: 'SECRET' }, 403); });
  assert.equal((await f.mirror.publish({ messages: { openclaw: [message()] } })).rejected, 1);
  f.advance();
  await f.mirror.flush();
  assert.equal(calls, 1);
  assert.ok(!(await fs.readFile(path.join(f.runtimeDir, 'telegram/outbox.json'), 'utf8')).includes('SECRET'));
});

test('timeout includes a hung response body and is bounded even if fetch ignores abort', async (t) => {
  const f = await fixture(t, async () => ({ status: 200, json: () => new Promise(() => {}) }), { requestTimeoutMs: 100 });
  const start = Date.now();
  const health = await f.mirror.publish({ messages: { openclaw: [message()] } });
  assert.equal(health.uncertain, 1);
  assert.ok(Date.now() - start < 4500);
});

test('default Telegram timeout accepts a response that exceeds the old three-second budget', async (t) => {
  const f = await fixture(t, async () => {
    await new Promise(resolve => setTimeout(resolve, 3200));
    return response({ ok: true, result: { message_id: 9 } });
  });
  assert.equal((await f.mirror.publish({ messages: { openclaw: [message()] } })).sent, 1);
  assert.equal((await f.mirror.health()).uncertain, 0);
});

test('missing credentials queue locally without calling Telegram and can resume after injection', async (t) => {
  let calls = 0;
  const f = await fixture(t, async () => { calls += 1; return response({ ok: true, result: { message_id: 1 } }); }, { token: undefined });
  assert.equal((await f.mirror.publish({ messages: { openclaw: [message()] } })).pending, 1);
  assert.equal(calls, 0);
  assert.equal((await createTelegramMirror({ ...f.options, token: 'fixture-injected' }).flush()).sent, 1);
});

test('mismatched destinations and run scopes fail closed on recovery', async (t) => {
  const f = await fixture(t, async () => response({ ok: true, result: { message_id: 1 } }));
  await f.mirror.health();
  await assert.rejects(createTelegramMirror({ ...f.options, config: { ...config, run_id: 'other-run' } }).flush(), /SCOPE_MISMATCH/);
  await assert.rejects(createTelegramMirror({ ...f.options, config: { ...config, telegram: { ...config.telegram, openclaw: { chat_id: '-100333' } } } }).flush(), /SCOPE_MISMATCH/);
});

test('team identity and conflicting delivery IDs fail without truncation', async (t) => {
  const f = await fixture(t, async () => response({ ok: true, result: { message_id: 1 } }));
  await assert.rejects(f.mirror.publish({ messages: { hermes: [message()] } }), /TEAM_MISMATCH/);
  await f.mirror.publish({ messages: { openclaw: [message()] } });
  await assert.rejects(f.mirror.publish({ messages: { openclaw: [message({ message: 'different words' })] } }), /ID_CONFLICT/);
  await assert.rejects(f.mirror.publish({ messages: { openclaw: [message({ sequence: 2 }), message({ message: 'conflicting old ID' })] } }), /ID_CONFLICT/);
  assert.equal((await f.mirror.health()).pending, 0);
});

test('long Unicode messages split for Telegram, preserve all words, and deduplicate after restart', async t => {
  const sends = [];
  const debugConfig = { ...config, purpose: 'debug' };
  const f = await fixture(t, async (_, request) => {
    sends.push(JSON.parse(request.body));
    return response({ ok: true, result: { message_id: sends.length } });
  }, { config: debugConfig });
  const original = message({ message: '  Consider the team payout. 🦀\n'.repeat(500) });
  const parts = formatAgentMessages(original, 'openclaw', debugConfig);
  assert.ok(parts.length > 2);
  await f.mirror.publish({ messages: { openclaw: [original] } });
  for (const _ of parts) { f.advance(); await f.mirror.flush(); }
  assert.deepEqual(sends.map(send => send.text), parts.map(part => part.text));
  const bodies = sends.map(send => send.text.slice(send.text.indexOf('\n') + 1));
  assert.equal(bodies.join(''), original.message);
  for (const [index, send] of sends.entries()) {
    assert.ok(send.text.length <= 4096);
    assert.match(send.text, new RegExp(`^\\[DEBUG\\].*Part ${index + 1}/${parts.length}\\n`));
    assert.doesNotMatch(bodies[index], /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    assert.equal(send.chat_id, '-100111');
  }
  await createTelegramMirror(f.options).publish({ messages: { openclaw: [original] } });
  assert.equal(sends.length, parts.length);
  const outbox = JSON.parse(await fs.readFile(path.join(f.runtimeDir, 'telegram/outbox.json'), 'utf8'));
  assert.equal(outbox.entries[0].key, 'message:openclaw:3:1');
  assert.equal(outbox.entries[1].key, 'message:openclaw:3:1:part:2');
  assert.ok(outbox.entries.every(entry => entry.status === 'sent' && entry.message_parts === parts.length));
  await assert.rejects(f.mirror.publish({ messages: { openclaw: [{...original, message: original.message + ' Changed.'}] } }), /ID_CONFLICT/);
});

test('Dealer distinguishes defaulted Share, Catch, eliminations and remaining players', () => {
  const text = formatDealerEvent(event('round-resolved', {
    choices: [
      { wallet_address: wallets[0], choice: 'Share', defaulted: true, eliminated: false },
      { wallet_address: wallets[1], choice: 'Steal', defaulted: false, eliminated: true },
      { wallet_address: wallets[2], choice: 'Catch', defaulted: false, eliminated: false },
    ], remaining_players: 2,
  }), config);
  assert.match(text, /oc-1 \(OpenClaw\): Share · DEFAULTED/);
  assert.match(text, /oc-2 \(OpenClaw\): Steal · ELIMINATED/);
  assert.match(text, /hs-1 \(Hermes\): Catch/);
  assert.match(text, /Defaults: oc-1/);
  assert.match(text, /Eliminations: oc-2/);
  assert.match(text, /Remaining players: 2/);
  assert.ok(text.endsWith(`https://sepolia.basescan.org/tx/${tx}`));
  assert.ok(!text.includes('caught stealing'));
});

test('Dealer awards, confirmed claims, refunds and cancellation retain exact values and links', () => {
  const completion = formatDealerEvent(event('completed', { awards: [
    { wallet_address: wallets[0], award_wei: '1000000000000000001' },
    { wallet_address: wallets[2], award_wei: '0' },
  ] }), config);
  assert.match(completion, /1\.000000000000000001 testnet ETH; claim not yet confirmed/);
  assert.match(completion, /0 testnet ETH; no payout due/);
  assert.match(formatDealerEvent(event('claimed', { wallet_address: wallets[0], amount_wei: '1000000000000000001' }), config), /payout claimed 1\.000000000000000001 testnet ETH/);
  assert.match(formatDealerEvent(event('refunded', { wallet_address: wallets[2], amount_wei: '100000000000000' }), config), /refund confirmed 0\.0001 testnet ETH/);
  assert.match(formatDealerEvent(event('cancelled'), config), /not counted as a completed game/);
  assert.throws(() => formatDealerEvent({ ...event('completed'), transaction_hash: 'https://example.org' }, config), /TRANSACTION/);
});

test('read-only setup verification uses metadata only, and flags writable spectators', async () => {
  const methods = [];
  const verified = await verifyTelegramGroups({ config, token: 'fixture', fetchImpl: async (url, request) => {
    const method = url.split('/').at(-1); methods.push(method);
    const body = JSON.parse(request.body);
    if (method === 'getMe') return response({ ok: true, result: { id: 1 } });
    if (method === 'getChatMember') return response({ ok: true, result: { status: 'administrator' } });
    return response({ ok: true, result: { type: 'supergroup', permissions: { can_send_messages: body.chat_id === '-100222' } } });
  } });
  assert.equal(verified.ok, false);
  assert.equal(verified.groups[0].ok, true);
  assert.deepEqual(verified.groups[1].issues, ['SPECTATOR_READ_ONLY_UNVERIFIED']);
  assert.deepEqual(new Set(methods), new Set(['getMe', 'getChat', 'getChatMember']));
});


test('debug prefixes every Dealer and agent send and forbids a scoreboard writer', async t => {
  const sends = [];
  const f = await fixture(t, async (url, request) => {
    assert.ok(url.endsWith('/sendMessage'));
    sends.push(JSON.parse(request.body));
    return response({ ok: true, result: { message_id: sends.length } });
  }, { config: { ...config, purpose: 'debug' } });
  await f.mirror.publish({ messages: { openclaw: [message()], hermes: [] },
    events: [event('completed', { awards: [] })] });
  f.advance(); await f.mirror.flush();
  assert.equal(sends.length, 3);
  assert.ok(sends.every(send => send.text.startsWith('[DEBUG]')));
  assert.throws(() => createTelegramMirror({ ...f.options, scoreboard: {} }), /DEBUG_SCOREBOARD_FORBIDDEN/);
});
