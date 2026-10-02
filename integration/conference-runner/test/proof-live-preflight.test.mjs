import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import os from 'node:os';
import { fixtureConfig } from '../src/fixture.mjs';
import { inspectProofOperator, verifyProofSpectators } from '../src/proof-live-preflight.mjs';

// These files, credentials and Telegram replies are synthetic local fixtures.
const now = Date.parse('2026-10-02T18:00:00.000Z');
const digest = text => createHash('sha256').update(text).digest('hex');
const response = payload => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });

async function directory(t) {
  const result = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'conference-live-preflight-fixture-')));
  t.after(() => fs.rm(result, { recursive: true, force: true }));
  return result;
}

async function fixture(t) {
  const root = await directory(t);
  const config = await fixtureConfig({ now, runId: 'synthetic-current-proof', teamSizes: { openclaw: 5, hermes: 5 } });
  config.telegram.openclaw.chat_id = '-100111';
  config.telegram.hermes.chat_id = '-100222';
  config.spectator_timeout_ms = 30;
  const scoreboard = { seriesId: 'synthetic-existing-series', firstGameId: '12', runtimeDir: root, messageIds: { openclaw: 11, hermes: 22 } };
  const text = 'Synthetic 5 vs 5 scoreboard. Local fixture only.';
  const chats = { openclaw: '-100111', hermes: '-100222' };
  const pin = () => ({ status: 'sent', sent_digest: digest(text), desired_digest: digest(text), text,
    retry_at: 0, ready_at: 0, attempts: 0, reason: null, updated_at: new Date(now - 1000).toISOString() });
  const ledger = {
    schema_version: 1, scope: { series_id: scoreboard.seriesId, first_game_id: scoreboard.firstGameId, chain_id: 84532,
      game_address: config.game_address.toLowerCase(), roster: config.roster.map(seat => ({ wallet: seat.wallet_address.toLowerCase(), team: seat.team })).sort((a, b) => a.wallet.localeCompare(b.wallet)),
      chats, message_ids: scoreboard.messageIds }, results: [], cancelled: [], rejected_results: [], defaults: {}, stage: null, retry_at: 0,
    pins: { openclaw: pin(), hermes: pin() }
  };
  const message = 'Synthetic historical dealer message.';
  const outbox = { schema_version: 1, run_id: 'synthetic-prior-proof', chats: { ...chats }, retry_at: 0, chat_ready_at: { openclaw: 0, hermes: 0 }, entries: [{
    key: 'event:openclaw:synthetic-history', team: 'openclaw', text: message, priority: 0, digest: digest(message), status: 'sent', attempts: 1, retry_at: 0,
    order: 0, created_at: new Date(now - 2000).toISOString(), message_id: 99, delivered_at: new Date(now - 1000).toISOString(), reason: null
  }] };
  const files = { ledger: path.join(root, 'telegram', 'scoreboard.json'), outbox: path.join(root, 'telegram', 'outbox.json') };
  await fs.mkdir(path.dirname(files.ledger));
  async function write() {
    await fs.writeFile(files.ledger, JSON.stringify(ledger), { mode: 0o600 });
    await fs.writeFile(files.outbox, JSON.stringify(outbox), { mode: 0o600 });
  }
  await write();
  const calls = [];
  const bot = { id: 12345, is_bot: true };
  const chatsById = Object.fromEntries(Object.entries(chats).map(([team, id]) => [id, {
    id: Number(id), type: 'supergroup', permissions: { can_send_messages: false, can_send_photos: false },
    pinned_message: { message_id: scoreboard.messageIds[team], text, from: bot, chat: { id: Number(id) } }
  }]));
  const member = { user: bot, status: 'administrator', can_pin_messages: true };
  const options = { config, scoreboard, token: '12345:synthetic-local-credential', now,
    fetchImpl: async (url, request) => {
      const method = new URL(url).pathname.split('/').at(-1);
      const body = JSON.parse(request.body);
      calls.push({ method, body });
      assert.equal(request.method, 'POST');
      assert.equal(request.redirect, 'error');
      assert.ok(['getMe', 'getChat', 'getChatMember'].includes(method), 'preflight cannot publish, edit, pin or consume spectator messages');
      return response({ ok: true, result: method === 'getMe' ? bot : method === 'getChat' ? chatsById[body.chat_id] : member });
    }
  };
  return { root, config, scoreboard, ledger, outbox, files, calls, bot, chatsById, member, options, write };
}

test('readonly spectator preflight verifies existing ten-seat ledger and both pins without initializing or modifying files', async t => {
  const f = await fixture(t);
  const before = await Promise.all(Object.values(f.files).map(async filename => ({ bytes: await fs.readFile(filename, 'utf8'), stat: await fs.stat(filename) })));
  assert.deepEqual(await verifyProofSpectators(f.options), { schema_version: 1, verified: true });
  assert.deepEqual(f.calls.map(call => call.method), ['getMe', 'getChat', 'getChatMember', 'getChat', 'getChatMember']);
  const after = await Promise.all(Object.values(f.files).map(async filename => ({ bytes: await fs.readFile(filename, 'utf8'), stat: await fs.stat(filename) })));
  for (let index = 0; index < before.length; index++) {
    assert.equal(after[index].bytes, before[index].bytes);
    assert.equal(after[index].stat.mtimeMs, before[index].stat.mtimeMs);
    assert.equal(after[index].stat.mode, before[index].stat.mode);
  }
  assert.deepEqual((await fs.readdir(path.join(f.root, 'telegram'))).sort(), ['outbox.json', 'scoreboard.json']);
});

test('changed bot, chat, pinned destination or pin author fail without exposing provider fields', async t => {
  for (const mutate of [
    f => { f.bot.is_bot = false; },
    f => { f.member.user = { id: 999, is_bot: true }; },
    f => { f.chatsById['-100111'].id = -100999; },
    f => { f.chatsById['-100111'].pinned_message.message_id = 999; },
    f => { f.chatsById['-100111'].pinned_message.chat.id = -100999; },
    f => { f.chatsById['-100111'].pinned_message.text = 'synthetic raw provider-private-text'; },
    f => { f.chatsById['-100111'].pinned_message.from = { id: 888, is_bot: true }; }
  ]) {
    const f = await fixture(t); mutate(f);
    await assert.rejects(verifyProofSpectators(f.options), error => /^PROOF_TELEGRAM_(IDENTITY|PIN)_UNVERIFIED$/.test(error.code) && !String(error).includes('private'));
  }
});

test('spectator send permissions and bot pin/admin rights must still be disabled and granted respectively', async t => {
  for (const mutate of [
    f => { f.member.status = 'member'; },
    f => { delete f.member.can_pin_messages; },
    f => { f.member.can_pin_messages = false; },
    f => { f.chatsById['-100111'].permissions.can_send_messages = true; },
    f => { f.chatsById['-100111'].permissions.can_send_photos = true; },
    f => { delete f.chatsById['-100111'].permissions; }
  ]) {
    const f = await fixture(t); mutate(f);
    await assert.rejects(verifyProofSpectators(f.options), error => /^PROOF_TELEGRAM_(IDENTITY|PERMISSIONS)_UNVERIFIED$/.test(error.code));
  }
});

test('unresolved historical deliveries, rejected/defaulted results and changed pin digests block before network reads', async t => {
  for (const mutate of [
    ...['pending', 'inflight', 'uncertain', 'rejected'].map(status => f => { f.outbox.entries[0].status = status; }),
    f => { f.outbox.chats.openclaw = '-100999'; },
    f => { f.ledger.rejected_results.push({ game_id: '12', reason: 'synthetic' }); },
    f => { f.ledger.defaults['12'] = ['synthetic unresolved default']; },
    f => { f.ledger.pins.openclaw.sent_digest = '0'.repeat(64); },
    f => { f.ledger.pins.openclaw.status = 'inflight'; },
    f => { f.ledger.retry_at = now + 1000; },
    f => { f.ledger.stage = { game_id: '12', round: 1, phase: 'commit' }; }
  ]) {
    const f = await fixture(t); mutate(f); await f.write();
    await assert.rejects(verifyProofSpectators(f.options), error => /^PROOF_(SCOREBOARD|SPECTATOR_OUTBOX)_(UNRESOLVED|SCOPE_INVALID)$/.test(error.code));
    assert.equal(f.calls.length, 0);
  }
});

test('series, game, chain, threshold, ten-seat roster and distinct chat scope must match exactly', async t => {
  for (const mutate of [
    f => { f.ledger.scope.series_id = 'other-series'; },
    f => { f.ledger.scope.first_game_id = '13'; },
    f => { f.ledger.scope.chain_id = 1; },
    f => { f.ledger.scope.game_address = `0x${'f'.repeat(40)}`; },
    f => { f.ledger.scope.roster.pop(); },
    f => { f.scoreboard.messageIds = { openclaw: 33, hermes: 22 }; },
    f => { f.config.roster.pop(); },
    f => { f.config.telegram.hermes.chat_id = f.config.telegram.openclaw.chat_id; },
    f => { f.scoreboard.extra = true; }
  ]) {
    const f = await fixture(t); mutate(f); await f.write();
    await assert.rejects(verifyProofSpectators(f.options), error => ['PROOF_SCOREBOARD_SCOPE_INVALID', 'PROOF_SPECTATOR_CONFIG_INVALID'].includes(error.code));
    assert.equal(f.calls.length, 0);
  }
});

test('healthy historical accounting is accepted while duplicate results or inconsistent ten-seat award sums fail closed', async t => {
  const addHistory = f => {
    const tx = `0x${'ab'.repeat(32)}`;
    const cancelledTx = `0x${'cd'.repeat(32)}`;
    f.ledger.results.push({ game_id: '12', result_id: `${tx}:0`, transaction_hash: tx, block_number: '100',
      awards: f.ledger.scope.roster.map(row => ({ wallet: row.wallet, award_wei: '1' })),
      awards_wei: { openclaw: '5', hermes: '5' }, winner: 'tie' });
    f.ledger.cancelled.push({ game_id: '13', result_id: `${cancelledTx}:0`, transaction_hash: cancelledTx });
    f.ledger.stage = { game_id: '13', round: 0, phase: 'cancelled' };
  };
  const healthy = await fixture(t); addHistory(healthy); await healthy.write();
  assert.deepEqual(await verifyProofSpectators(healthy.options), { schema_version: 1, verified: true });
  for (const mutate of [
    f => { f.ledger.results[0].awards_wei.openclaw = '6'; },
    f => { f.ledger.results[0].awards.pop(); },
    f => { f.ledger.results[0].winner = 'hermes'; },
    f => { f.ledger.results.push(structuredClone(f.ledger.results[0])); },
    f => { f.ledger.cancelled[0].game_id = '12'; },
    f => { f.ledger.results[0].result_id = 'synthetic-invalid-result'; }
  ]) {
    const f = await fixture(t); addHistory(f); mutate(f); await f.write();
    await assert.rejects(verifyProofSpectators(f.options), /PROOF_SCOREBOARD_UNRESOLVED/);
    assert.equal(f.calls.length, 0);
  }
});

test('preflight does not repair missing files and refuses aliases, symlinks and changes during its live reads', async t => {
  const missing = await fixture(t);
  await fs.unlink(missing.files.outbox);
  await assert.rejects(verifyProofSpectators(missing.options), /PROOF_PREFLIGHT_FILE_INVALID/);
  await assert.rejects(fs.access(missing.files.outbox), { code: 'ENOENT' });
  const alias = await fixture(t);
  const aliasPath = path.join(await directory(t), 'alias');
  await fs.symlink(alias.root, aliasPath);
  await assert.rejects(verifyProofSpectators({ ...alias.options, scoreboard: { ...alias.scoreboard, runtimeDir: aliasPath } }), /PROOF_PREFLIGHT_PATH_INVALID/);
  const linked = await fixture(t);
  const saved = `${linked.files.outbox}.saved`;
  await fs.rename(linked.files.outbox, saved); await fs.symlink(saved, linked.files.outbox);
  await assert.rejects(verifyProofSpectators(linked.options), /PROOF_PREFLIGHT_FILE_INVALID/);
  const changed = await fixture(t);
  const fetch = changed.options.fetchImpl;
  changed.options.fetchImpl = async (...args) => {
    if (!changed.calls.length) { changed.outbox.run_id = 'synthetic-changed-run'; await changed.write(); }
    return fetch(...args);
  };
  await assert.rejects(verifyProofSpectators(changed.options), /PROOF_SPECTATOR_STATE_CHANGED/);
});

test('ignored abort, hanging response body, oversized body and raw provider failures are bounded and sanitized', async t => {
  for (const handler of [
    () => new Promise(() => {}),
    () => ({ status: 200, text: () => new Promise(() => {}) }),
    () => new Response('x'.repeat(1024 * 1024 + 1), { status: 200 }),
    () => response({ ok: false, description: 'synthetic provider-private-payload' }),
    () => { throw new Error('https://api.telegram.org/botSYNTHETIC-CREDENTIAL/getMe'); }
  ]) {
    const f = await fixture(t);
    const begun = Date.now();
    await assert.rejects(verifyProofSpectators({ ...f.options, fetchImpl: handler }), error =>
      error.code === 'PROOF_TELEGRAM_READ_FAILED' && String(error) === 'Error: PROOF_TELEGRAM_READ_FAILED');
    assert.ok(Date.now() - begun < 1000);
  }
});

async function operatorFixture(t, pid = process.pid) {
  const operatorDirectory = await directory(t);
  const filename = path.join(operatorDirectory, 'signer.lock');
  await fs.writeFile(filename, JSON.stringify({ pid, token: 'synthetic-operator-ownership' }), { mode: 0o600 });
  return { operatorDirectory, filename, expectedPid: pid };
}

test('operator inspection returns only exact immutable ownership for a specified living PID without changing its lock', async t => {
  const f = await operatorFixture(t);
  const before = await fs.readFile(f.filename, 'utf8');
  const descriptor = await inspectProofOperator(f);
  assert.deepEqual(Object.keys(descriptor).sort(), ['directory', 'pid', 'role', 'token']);
  assert.equal(descriptor.role, 'operator'); assert.equal(descriptor.directory, f.operatorDirectory); assert.equal(descriptor.pid, process.pid);
  assert.equal(descriptor.token, 'synthetic-operator-ownership'); assert.ok(Object.isFrozen(descriptor));
  assert.equal(await fs.readFile(f.filename, 'utf8'), before);
});

test('operator inspection refuses wrong, dead or missing PID ownership and recovery ambiguity', async t => {
  const f = await operatorFixture(t);
  await assert.rejects(inspectProofOperator({ ...f, expectedPid: 0 }), /PROOF_OPERATOR_PID_INVALID/);
  await assert.rejects(inspectProofOperator({ ...f, expectedPid: process.pid + 1 }), /PROOF_OPERATOR_LOCK_AMBIGUOUS/);
  await fs.writeFile(`${f.filename}.recovery`, 'synthetic recovery');
  await assert.rejects(inspectProofOperator(f), /PROOF_OPERATOR_LOCK_AMBIGUOUS/);
  await fs.unlink(`${f.filename}.recovery`); await fs.unlink(f.filename);
  await assert.rejects(inspectProofOperator(f), /PROOF_OPERATOR_LOCK_MISSING/);
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await once(child, 'exit');
  const dead = await operatorFixture(t, child.pid);
  await assert.rejects(inspectProofOperator(dead), /PROOF_OPERATOR_PID_UNVERIFIED/);
});

test('operator lock replacement during inspection fails closed without returning its token', async t => {
  const f = await operatorFixture(t);
  const probe = process.kill;
  t.mock.method(process, 'kill', (pid, signal) => {
    const result = probe(pid, signal);
    writeFileSync(f.filename, JSON.stringify({ pid, token: 'synthetic-replacement-ownership' }));
    return result;
  });
  await assert.rejects(inspectProofOperator(f), error => error.code === 'PROOF_OPERATOR_LOCK_CHANGED' && !String(error).includes('ownership'));
});

test('operator inspection rejects malformed or aliased lock files without repair', async t => {
  const f = await operatorFixture(t);
  await fs.writeFile(f.filename, JSON.stringify({ pid: process.pid, token: 'synthetic', unexpected: true }));
  await assert.rejects(inspectProofOperator(f), /PROOF_OPERATOR_LOCK_AMBIGUOUS/);
  const alias = `${f.filename}.saved`;
  await fs.rename(f.filename, alias); await fs.symlink(alias, f.filename);
  await assert.rejects(inspectProofOperator(f), /PROOF_PREFLIGHT_FILE_INVALID/);
  assert.ok((await fs.lstat(f.filename)).isSymbolicLink());
});
