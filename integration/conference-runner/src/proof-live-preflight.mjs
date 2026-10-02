import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { REPOSITORY_ROOT, validateConfig } from './config.mjs';

const TEAMS = ['openclaw', 'hermes'];
const UINT = /^(0|[1-9][0-9]*)$/;
const DIGEST = /^[0-9a-f]{64}$/;
const TX = /^0x[0-9a-fA-F]{64}$/;
const digest = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw Object.assign(new Error(code), { code }); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const same = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
const nonnegative = value => Number.isSafeInteger(value) && value >= 0;
const contains = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

async function canonicalDirectory(directory) {
  try {
    if (typeof directory !== 'string' || !path.isAbsolute(directory) || path.resolve(directory) !== directory || /[\r\n\0]/.test(directory)) fail('invalid');
    if (await fs.realpath(directory) !== directory || !(await fs.lstat(directory)).isDirectory()) fail('invalid');
    const repository = await fs.realpath(REPOSITORY_ROOT);
    if (contains(repository, directory) || contains(directory, repository)) fail('invalid');
    return directory;
  } catch { fail('PROOF_PREFLIGHT_PATH_INVALID'); }
}

async function exists(filename) {
  try { await fs.lstat(filename); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; fail('PROOF_PREFLIGHT_FILE_INVALID'); }
}

async function readDocument(filename, limit = 8 * 1024 * 1024) {
  let handle;
  try {
    if (await fs.realpath(filename) !== filename) fail('invalid');
    const before = await fs.lstat(filename);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > limit) fail('invalid');
    handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino) fail('invalid');
    const bytes = await handle.readFile();
    const after = await fs.lstat(filename);
    if (bytes.length > limit || after.dev !== before.dev || after.ino !== before.ino || after.size !== bytes.length ||
        after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || after.nlink !== 1) fail('invalid');
    return { value: JSON.parse(bytes.toString('utf8')), fingerprint: digest(bytes),
      identity: [after.dev, after.ino, after.size, after.mtimeMs, after.ctimeMs] };
  } catch { fail('PROOF_PREFLIGHT_FILE_INVALID'); }
  finally { await handle?.close().catch(() => {}); }
}

/** Ownership capability only. Never serialize this descriptor or its token. */
export async function inspectProofOperator({ operatorDirectory, expectedPid } = {}) {
  if (!Number.isSafeInteger(expectedPid) || expectedPid < 1) fail('PROOF_OPERATOR_PID_INVALID');
  const directory = await canonicalDirectory(operatorDirectory);
  const filename = path.join(directory, 'signer.lock');
  if (await exists(`${filename}.recovery`)) fail('PROOF_OPERATOR_LOCK_AMBIGUOUS');
  if (!await exists(filename)) fail('PROOF_OPERATOR_LOCK_MISSING');
  const initial = await readDocument(filename, 4096);
  const lock = initial.value;
  if (!exact(lock, ['pid', 'token']) || lock.pid !== expectedPid || typeof lock.token !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,200}$/.test(lock.token)) fail('PROOF_OPERATOR_LOCK_AMBIGUOUS');
  try { process.kill(expectedPid, 0); } catch { fail('PROOF_OPERATOR_PID_UNVERIFIED'); }
  const final = await readDocument(filename, 4096);
  if (await exists(`${filename}.recovery`) || initial.fingerprint !== final.fingerprint || !same(initial.identity, final.identity)) fail('PROOF_OPERATOR_LOCK_CHANGED');
  return Object.freeze({ role: 'operator', directory, pid: expectedPid, token: lock.token });
}

function validateLedger(ledger, expected, now) {
  if (!exact(ledger, ['schema_version', 'scope', 'results', 'cancelled', 'rejected_results', 'defaults', 'stage', 'retry_at', 'pins']) ||
      ledger.schema_version !== 1 || !same(ledger.scope, expected)) fail('PROOF_SCOREBOARD_SCOPE_INVALID');
  if (!Array.isArray(ledger.results) || !Array.isArray(ledger.cancelled) || !Array.isArray(ledger.rejected_results) ||
      ledger.rejected_results.length || !exact(ledger.pins, TEAMS) || !ledger.defaults || Array.isArray(ledger.defaults) ||
      typeof ledger.defaults !== 'object' || Object.entries(ledger.defaults).some(([game, rows]) => !UINT.test(game) || !Array.isArray(rows)) ||
      !nonnegative(ledger.retry_at) || ledger.retry_at > now) fail('PROOF_SCOREBOARD_UNRESOLVED');
  const games = new Set(), resultIds = new Set();
  const walletTeams = new Map(expected.roster.map(row => [row.wallet, row.team]));
  for (const result of [...ledger.results, ...ledger.cancelled]) {
    if (!result || typeof result.game_id !== 'string' || !UINT.test(result.game_id) || BigInt(result.game_id) < BigInt(expected.first_game_id) ||
        games.has(result.game_id) || !TX.test(result.transaction_hash ?? '') || typeof result.result_id !== 'string' ||
        !result.result_id.startsWith(`${result.transaction_hash.toLowerCase()}:`) || !UINT.test(result.result_id.slice(67)) || resultIds.has(result.result_id)) fail('PROOF_SCOREBOARD_UNRESOLVED');
    games.add(result.game_id); resultIds.add(result.result_id);
  }
  for (const result of ledger.cancelled) if (!exact(result, ['game_id', 'transaction_hash', 'result_id'])) fail('PROOF_SCOREBOARD_UNRESOLVED');
  for (const result of ledger.results) {
    if (!exact(result, ['game_id', 'result_id', 'transaction_hash', 'block_number', 'awards', 'awards_wei', 'winner']) ||
        typeof result.block_number !== 'string' || !UINT.test(result.block_number) || !Array.isArray(result.awards) ||
        result.awards.length !== 10 || !exact(result.awards_wei, TEAMS)) fail('PROOF_SCOREBOARD_UNRESOLVED');
    const seen = new Set(), sums = { openclaw: 0n, hermes: 0n };
    for (const award of result.awards) {
      if (!exact(award, ['wallet', 'award_wei']) || !walletTeams.has(award.wallet) || seen.has(award.wallet) ||
          typeof award.award_wei !== 'string' || !UINT.test(award.award_wei)) fail('PROOF_SCOREBOARD_UNRESOLVED');
      seen.add(award.wallet); sums[walletTeams.get(award.wallet)] += BigInt(award.award_wei);
    }
    if (TEAMS.some(team => result.awards_wei[team] !== sums[team].toString()) ||
        result.winner !== (sums.openclaw === sums.hermes ? 'tie' : sums.openclaw > sums.hermes ? 'openclaw' : 'hermes')) fail('PROOF_SCOREBOARD_UNRESOLVED');
  }
  // Defaults from a completed historical game remain truthful series history;
  // they do not certify healthy play for the separately audited current proof.
  const completedGames = new Set(ledger.results.map(result => result.game_id));
  const defaultRows = new Set();
  for (const [game, rows] of Object.entries(ledger.defaults)) {
    if (rows.length && !completedGames.has(game)) fail('PROOF_SCOREBOARD_UNRESOLVED');
    for (const row of rows) {
      const fields = typeof row === 'string' && /^(0x[0-9a-f]{64}):(0|[1-9][0-9]*):(0x[0-9a-f]{40})$/.exec(row);
      if (!fields || fields[0] !== row || !Number.isSafeInteger(Number(fields[2])) || !walletTeams.has(fields[3]) || defaultRows.has(row)) fail('PROOF_SCOREBOARD_UNRESOLVED');
      defaultRows.add(row);
    }
  }
  if (ledger.stage !== null && (!exact(ledger.stage, ['game_id', 'round', 'phase']) || !UINT.test(ledger.stage.game_id ?? '') ||
      !nonnegative(ledger.stage.round) || !['idle', 'completed', 'cancelled'].includes(ledger.stage.phase))) fail('PROOF_SCOREBOARD_UNRESOLVED');
  for (const pin of Object.values(ledger.pins)) {
    if (!pin || Object.keys(pin).some(key => !['status', 'sent_digest', 'desired_digest', 'text', 'retry_at', 'ready_at', 'attempts', 'reason', 'updated_at'].includes(key)) ||
        pin.status !== 'sent' || pin.reason !== null || !nonnegative(pin.retry_at) || pin.retry_at > now ||
        !nonnegative(pin.ready_at) || !nonnegative(pin.attempts) || typeof pin.text !== 'string' || !pin.text || pin.text.length > 4096 ||
        !DIGEST.test(pin.sent_digest ?? '') || pin.sent_digest !== pin.desired_digest || pin.sent_digest !== digest(pin.text) ||
        !Number.isFinite(Date.parse(pin.updated_at)) || Date.parse(pin.updated_at) > now) fail('PROOF_SCOREBOARD_UNRESOLVED');
  }
  if (ledger.pins.openclaw.text !== ledger.pins.hermes.text) fail('PROOF_SCOREBOARD_UNRESOLVED');
}

function validateOutbox(outbox, chats, now) {
  if (!exact(outbox, ['schema_version', 'run_id', 'chats', 'retry_at', 'chat_ready_at', 'entries']) || outbox.schema_version !== 1 ||
      typeof outbox.run_id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(outbox.run_id) || !same(outbox.chats, chats) ||
      !nonnegative(outbox.retry_at) || outbox.retry_at > now || !exact(outbox.chat_ready_at, TEAMS) ||
      TEAMS.some(team => !nonnegative(outbox.chat_ready_at[team])) || !Array.isArray(outbox.entries)) fail('PROOF_SPECTATOR_OUTBOX_UNRESOLVED');
  const keys = new Set(), orders = new Set();
  for (const entry of outbox.entries) {
    if (!entry || Object.keys(entry).some(key => !['key', 'team', 'text', 'priority', 'digest', 'status', 'attempts', 'retry_at', 'order', 'created_at', 'message_id', 'delivered_at', 'reason'].includes(key)) ||
        typeof entry.key !== 'string' || !entry.key || keys.has(entry.key) || !TEAMS.includes(entry.team) || entry.status !== 'sent' || entry.reason !== null ||
        typeof entry.text !== 'string' || !entry.text || entry.text.length > 4096 || entry.digest !== digest(entry.text) ||
        !nonnegative(entry.priority) || !nonnegative(entry.attempts) || !nonnegative(entry.order) || orders.has(entry.order) ||
        !nonnegative(entry.retry_at) || entry.retry_at > now || !Number.isSafeInteger(entry.message_id) || entry.message_id < 1 ||
        !Number.isFinite(Date.parse(entry.created_at)) || !Number.isFinite(Date.parse(entry.delivered_at)) || Date.parse(entry.delivered_at) > now) fail('PROOF_SPECTATOR_OUTBOX_UNRESOLVED');
    keys.add(entry.key); orders.add(entry.order);
  }
}

async function telegramRead({ method, body, token, fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST',
          headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal, redirect: 'error' });
        if (!response || !Number.isInteger(response.status) || response.status < 200 || response.status >= 300) fail('invalid');
        const limit = 1024 * 1024;
        if (Number(response.headers?.get?.('content-length')) > limit) fail('invalid');
        let text;
        if (response.body?.getReader) {
          const reader = response.body.getReader();
          const chunks = []; let size = 0;
          try {
            for (;;) {
              const { value, done } = await reader.read();
              if (done) break;
              size += value.length;
              if (size > limit) { void reader.cancel().catch(() => {}); fail('invalid'); }
              chunks.push(Buffer.from(value));
            }
          } finally { reader.releaseLock(); }
          text = Buffer.concat(chunks).toString('utf8');
        } else text = await response.text();
        if (typeof text !== 'string' || Buffer.byteLength(text) > limit) fail('invalid');
        const payload = JSON.parse(text);
        if (payload?.ok !== true || !payload.result || typeof payload.result !== 'object') fail('invalid');
        return payload.result;
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, timeoutMs); })
    ]);
  } catch { fail('PROOF_TELEGRAM_READ_FAILED'); }
  finally { clearTimeout(timer); }
}

/** Read-only local and Telegram gate. Never initializes, repairs or edits a mirror. */
export async function verifyProofSpectators({ config, scoreboard, token, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  let configuration;
  try { configuration = validateConfig(config); } catch { fail('PROOF_SPECTATOR_CONFIG_INVALID'); }
  const nowMs = typeof now === 'function' ? now() : now;
  if (!nonnegative(nowMs) || typeof fetchImpl !== 'function' || typeof token !== 'string' || !/^[a-zA-Z0-9:_-]{1,256}$/.test(token) ||
      configuration.roster.length !== 10 || TEAMS.some(team => configuration.roster.filter(seat => seat.team === team).length !== 5) ||
      !exact(scoreboard, ['seriesId', 'firstGameId', 'runtimeDir', 'messageIds']) || !/^[a-zA-Z0-9_-]{1,100}$/.test(scoreboard.seriesId ?? '') ||
      typeof scoreboard.firstGameId !== 'string' || !/^[1-9][0-9]*$/.test(scoreboard.firstGameId) || !exact(scoreboard.messageIds, TEAMS) ||
      TEAMS.some(team => !Number.isSafeInteger(scoreboard.messageIds[team]) || scoreboard.messageIds[team] < 1)) fail('PROOF_SPECTATOR_CONFIG_INVALID');
  const chats = Object.fromEntries(TEAMS.map(team => [team, configuration.telegram[team].chat_id]));
  if (TEAMS.some(team => !/^-\d+$/.test(chats[team] ?? '')) || chats.openclaw === chats.hermes) fail('PROOF_SPECTATOR_CONFIG_INVALID');
  const directory = await canonicalDirectory(scoreboard.runtimeDir);
  const files = [path.join(directory, 'telegram', 'scoreboard.json'), path.join(directory, 'telegram', 'outbox.json')];
  const documents = await Promise.all(files.map(filename => readDocument(filename)));
  const ledger = documents[0].value;
  const expected = { series_id: scoreboard.seriesId, first_game_id: scoreboard.firstGameId, chain_id: configuration.chain_id,
    game_address: configuration.game_address.toLowerCase(),
    roster: configuration.roster.map(seat => ({ wallet: seat.wallet_address.toLowerCase(), team: seat.team })).sort((a, b) => a.wallet.localeCompare(b.wallet)),
    chats, message_ids: scoreboard.messageIds };
  validateLedger(ledger, expected, nowMs);
  validateOutbox(documents[1].value, chats, nowMs);
  const request = (method, body) => telegramRead({ method, body, token, fetchImpl,
    timeoutMs: Math.min(configuration.spectator_timeout_ms ?? 10000, 10000) });
  const bot = await request('getMe', {});
  if (!Number.isSafeInteger(bot.id) || bot.id < 1 || bot.is_bot !== true) fail('PROOF_TELEGRAM_IDENTITY_UNVERIFIED');
  for (const team of TEAMS) {
    const [chat, member] = await Promise.all([request('getChat', { chat_id: chats[team] }), request('getChatMember', { chat_id: chats[team], user_id: bot.id })]);
    if (String(chat.id) !== chats[team] || !['group', 'supergroup'].includes(chat.type) || member.status !== 'administrator' ||
        member.user?.id !== bot.id || member.user?.is_bot !== true || member.can_pin_messages !== true) fail('PROOF_TELEGRAM_IDENTITY_UNVERIFIED');
    const sending = ['can_send_messages', 'can_send_audios', 'can_send_documents', 'can_send_photos', 'can_send_videos', 'can_send_video_notes',
      'can_send_voice_notes', 'can_send_polls', 'can_send_other_messages', 'can_add_web_page_previews'];
    if (chat.permissions?.can_send_messages !== false || sending.some(key => chat.permissions[key] !== undefined && chat.permissions[key] !== false)) fail('PROOF_TELEGRAM_PERMISSIONS_UNVERIFIED');
    const pin = chat.pinned_message;
    if (pin?.message_id !== scoreboard.messageIds[team] || String(pin.chat?.id) !== chats[team] || pin.from?.id !== bot.id || pin.from?.is_bot !== true ||
        pin.text !== ledger.pins[team].text) fail('PROOF_TELEGRAM_PIN_UNVERIFIED');
  }
  const current = await Promise.all(files.map(filename => readDocument(filename)));
  if (documents.some((document, index) => document.fingerprint !== current[index].fingerprint || !same(document.identity, current[index].identity))) fail('PROOF_SPECTATOR_STATE_CHANGED');
  return { schema_version: 1, verified: true };
}
