import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createPinnedScoreboard } from './scoreboard.mjs';

const TEAMS = ['openclaw', 'hermes'];
const TX = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const INTEGER = /^(0|[1-9][0-9]*)$/;
const PRIORITY = { completed: 0, cancelled: 0, 'round-resolved': 1, claimed: 1, refunded: 1, created: 2, joined: 2 };
const REQUEST_TIMEOUT_MS = 10000;
const CHAT_GAP_MS = 1100;
const MAX_TEXT_LENGTH = 4096;

function ensure(condition, code) {
  if (!condition) throw new Error(code);
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function seatLabel(wallet, config) {
  ensure(typeof wallet === 'string' && ADDRESS.test(wallet), 'INVALID_PUBLIC_WALLET');
  const seat = config.roster.find((candidate) => candidate.wallet_address?.toLowerCase() === wallet.toLowerCase());
  return seat ? `${seat.seat_id} (${seat.team === 'openclaw' ? 'OpenClaw' : 'Hermes'})` : wallet;
}

function ether(wei) {
  ensure(typeof wei === 'string' && INTEGER.test(wei), 'INVALID_PUBLIC_WEI');
  const value = BigInt(wei);
  const decimals = (value % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '');
  return `${value / 10n ** 18n}${decimals ? `.${decimals}` : ''} testnet ETH`;
}

function validateEvent(event) {
  ensure(event && typeof event === 'object' && Object.hasOwn(PRIORITY, event.kind), 'INVALID_DEALER_EVENT');
  ensure(typeof event.id === 'string' && event.id.length > 0 && event.id.length <= 256, 'INVALID_EVENT_ID');
  ensure(typeof event.game_id === 'string' && INTEGER.test(event.game_id), 'INVALID_GAME_ID');
  ensure(Number.isSafeInteger(event.round) && event.round >= 0, 'INVALID_EVENT_ROUND');
  ensure(typeof event.transaction_hash === 'string' && TX.test(event.transaction_hash), 'INVALID_EVENT_TRANSACTION');
}

/** Format confirmed, normalized events only. Never infer a choice from an agent acknowledgement. */
export function formatDealerEvent(event, config) {
  validateEvent(event);
  ensure(config?.chain_id === 84532 && Array.isArray(config.roster), 'INVALID_TELEGRAM_CONFIGURATION');
  const data = event.data ?? {};
  const lines = [`Dealer · Game ${event.game_id} · Round ${event.round}`];
  if (event.kind === 'round-resolved') {
    lines.push('Round resolved');
    const choices = data.choices ?? [];
    ensure(Array.isArray(choices), 'INVALID_RESOLVED_CHOICES');
    for (const item of choices) {
      ensure(['Share', 'Steal', 'Catch'].includes(item.choice), 'INVALID_RESOLVED_CHOICE');
      const details = [item.choice];
      if (item.defaulted === true) details.push('DEFAULTED (effective choice, not a voluntary move)');
      if (item.eliminated === true) details.push('ELIMINATED');
      lines.push(`${seatLabel(item.wallet_address, config)}: ${details.join(' · ')}`);
    }
    if (choices.length === 0) lines.push('Choices unavailable in confirmed event data.');
    if (choices.length && choices.every((item) => typeof item.defaulted === 'boolean')) {
      const defaults = choices.filter((item) => item.defaulted).map((item) => seatLabel(item.wallet_address, config));
      lines.push(`Defaults: ${defaults.length ? defaults.join(', ') : 'none'}`);
    }
    if (choices.length && choices.every((item) => typeof item.eliminated === 'boolean')) {
      const eliminated = choices.filter((item) => item.eliminated).map((item) => seatLabel(item.wallet_address, config));
      lines.push(`Eliminations: ${eliminated.length ? eliminated.join(', ') : 'none'}`);
    }
    if (Array.isArray(data.remaining_players)) {
      lines.push(`Remaining players: ${data.remaining_players.length}${data.remaining_players.length ? ` (${data.remaining_players.map((wallet) => seatLabel(wallet, config)).join(', ')})` : ''}`);
    } else if (INTEGER.test(String(data.remaining_players))) {
      lines.push(`Remaining players: ${data.remaining_players}`);
    } else {
      lines.push('Remaining players: unavailable in confirmed event data.');
    }
  } else if (event.kind === 'completed') {
    lines.push('Game completed');
    ensure(Array.isArray(data.awards ?? []), 'INVALID_PUBLIC_AWARDS');
    for (const award of data.awards ?? []) {
      const awarded = ether(award.award_wei);
      const claim = award.claimed_wei === undefined
        ? (BigInt(award.award_wei) === 0n ? 'no payout due' : 'claim not yet confirmed')
        : `claimed ${ether(award.claimed_wei)}`;
      lines.push(`${seatLabel(award.wallet_address, config)}: awarded ${awarded}; ${claim}`);
    }
    if (!data.awards?.length) lines.push('Awards unavailable in confirmed event data.');
    lines.push('Award and claim amounts are separate; a claim does not add another award.');
  } else if (event.kind === 'cancelled') {
    lines.push('Game cancelled; not counted as a completed game.', 'Refunds are shown when confirmed.');
  } else if (event.kind === 'claimed' || event.kind === 'refunded') {
    lines.push(`${seatLabel(data.wallet_address, config)}: ${event.kind === 'claimed' ? 'payout claimed' : 'refund confirmed'} ${ether(data.amount_wei)}`);
  } else if (event.kind === 'created') {
    lines.push('Game created. Joining is open.');
  } else if (event.kind === 'joined') {
    lines.push(`${seatLabel(data.wallet_address, config)} joined.`);
  }
  lines.push(`https://sepolia.basescan.org/tx/${event.transaction_hash}`);
  const text = `${config.purpose === 'debug' ? '[DEBUG] ' : ''}${lines.join('\n')}`;
  ensure(text.length <= MAX_TEXT_LENGTH, 'DEALER_MESSAGE_TOO_LONG');
  return text;
}

function formatAgentMessage(message, team, config) {
  ensure(message && message.team === team, 'MESSAGE_TEAM_MISMATCH');
  const seat = config.roster.find((candidate) => candidate.seat_id === message.seat_id);
  ensure(seat?.team === team, 'MESSAGE_SEAT_MISMATCH');
  ensure(typeof message.game_id === 'string' && INTEGER.test(message.game_id), 'INVALID_GAME_ID');
  ensure(Number.isSafeInteger(message.round) && message.round >= 0, 'INVALID_MESSAGE_ROUND');
  ensure(Number.isSafeInteger(message.sequence) && message.sequence > 0, 'INVALID_MESSAGE_SEQUENCE');
  ensure(typeof message.request_id === 'string' && message.request_id.length > 0, 'INVALID_MESSAGE_REQUEST');
  ensure(typeof message.message === 'string' && message.message.length > 0, 'INVALID_MESSAGE_TEXT');
  const text = `${config.purpose === 'debug' ? '[DEBUG] ' : ''}${seat.seat_id} (${team === 'openclaw' ? 'OpenClaw' : 'Hermes'}) · Game ${message.game_id} · Round ${message.round}\n${message.message}`;
  // Accepted words are preserved, including whitespace and punctuation. Never silently truncate.
  ensure(text.length <= MAX_TEXT_LENGTH, 'AGENT_MESSAGE_TOO_LONG');
  return text;
}

/** A timeout covers both response headers and body, including non-cooperative injected transports. */
async function request({ token, method, body, fetchImpl, timeoutMs = REQUEST_TIMEOUT_MS }) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body), signal: controller.signal, redirect: 'error',
        });
        const payload = await response.json();
        return { status: response.status, payload };
      })(),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('TELEGRAM_TIMEOUT')); }, timeoutMs); }),
    ]);
  } catch {
    // Fetch errors may contain the URL, which contains a bot token. Do not retain or expose them.
    return { status: null, payload: null };
  } finally {
    clearTimeout(timer);
  }
}

/** Single writer: the coordinator must hold its runtime lock before using this mirror. */
export function createTelegramMirror({ config, runtimeDir, token, fetchImpl = globalThis.fetch, now = Date.now, requestTimeoutMs = REQUEST_TIMEOUT_MS, scoreboard }) {
  ensure(config?.chain_id === 84532 && typeof config.run_id === 'string' && Array.isArray(config.roster), 'INVALID_TELEGRAM_CONFIGURATION');
  ensure(typeof runtimeDir === 'string' && path.isAbsolute(runtimeDir), 'TELEGRAM_RUNTIME_MUST_BE_ABSOLUTE');
  ensure(typeof fetchImpl === 'function' && typeof now === 'function', 'INVALID_TELEGRAM_ADAPTER');
  ensure(Number.isFinite(requestTimeoutMs) && requestTimeoutMs > 0 && requestTimeoutMs <= 30_000, 'INVALID_TELEGRAM_TIMEOUT');
  const chats = Object.fromEntries(TEAMS.map((team) => [team, config.telegram?.[team]?.chat_id == null ? null : String(config.telegram[team].chat_id)]));
  const enabled = typeof token === 'string' && token.length > 0 && (config.mode === 'live' || fetchImpl !== globalThis.fetch);
  ensure(config.purpose !== 'debug' || scoreboard === undefined, 'DEBUG_SCOREBOARD_FORBIDDEN');
  const pinned = scoreboard ? createPinnedScoreboard({ config, options: scoreboard, chats, now, enabled,
    request: ({ method, body }) => request({ token, method, body, fetchImpl, timeoutMs: requestTimeoutMs }),
  }) : null;
  const directory = path.join(runtimeDir, 'telegram');
  const filename = path.join(directory, 'outbox.json');
  let state;
  let queue = Promise.resolve();
  let storageFailure = false;

  async function persist() {
    const temporary = path.join(directory, `.outbox-${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await fs.open(temporary, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(state));
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.rename(temporary, filename);
      const directoryHandle = await fs.open(directory, 'r');
      try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    } catch {
      storageFailure = true;
      throw new Error('TELEGRAM_STORAGE_FAILURE');
    } finally {
      await handle?.close().catch(() => {});
      await fs.unlink(temporary).catch(() => {});
    }
  }

  async function initialize() {
    if (state) return;
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    let parsed;
    try { parsed = JSON.parse(await fs.readFile(filename, 'utf8')); } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('TELEGRAM_OUTBOX_UNREADABLE');
    }
    if (parsed) {
      ensure(parsed.schema_version === 1 && parsed.run_id === config.run_id && JSON.stringify(parsed.chats) === JSON.stringify(chats), 'TELEGRAM_OUTBOX_SCOPE_MISMATCH');
      ensure(Array.isArray(parsed.entries) && Number.isFinite(parsed.retry_at) && parsed.chat_ready_at && TEAMS.every((team) => Number.isFinite(parsed.chat_ready_at[team])), 'TELEGRAM_OUTBOX_INVALID');
      ensure(parsed.entries.every((entry) => entry && typeof entry.key === 'string' && typeof entry.text === 'string' && TEAMS.includes(entry.team) && ['pending', 'inflight', 'sent', 'uncertain', 'rejected'].includes(entry.status) && Number.isFinite(entry.retry_at)), 'TELEGRAM_OUTBOX_INVALID');
      ensure(new Set(parsed.entries.map(entry => entry.key)).size === parsed.entries.length && parsed.entries.every(entry =>
        entry.digest === hash(entry.text) && entry.text.length > 0 && entry.text.length <= MAX_TEXT_LENGTH &&
        (entry.status !== 'sent' || Number.isSafeInteger(entry.message_id) && entry.message_id > 0 && Number.isFinite(Date.parse(entry.delivered_at)))),
      'TELEGRAM_OUTBOX_INVALID');
      state = parsed;
      for (const entry of state.entries) {
        if (entry.status === 'inflight') { entry.status = 'uncertain'; entry.reason = 'PROCESS_EXIT_DURING_SEND'; }
      }
    } else {
      state = { schema_version: 1, run_id: config.run_id, chats, retry_at: 0, chat_ready_at: { openclaw: 0, hermes: 0 }, entries: [] };
    }
    await persist();
    await pinned?.initialize();
    if (pinned && pinned.retryAt() > state.retry_at) {
      // A new proof run has a fresh outbox, but the bot's series cooldown survives.
      state.retry_at = pinned.retryAt();
      await persist();
    }
  }

  function summary() {
    const counts = { pending: 0, inflight: 0, sent: 0, uncertain: 0, rejected: 0 };
    for (const entry of state.entries) counts[entry.status] += 1;
    const issues = [];
    if (!enabled) issues.push('TELEGRAM_DISABLED');
    if (TEAMS.some((team) => !chats[team])) issues.push('TELEGRAM_GROUP_NOT_CONFIGURED');
    if (counts.uncertain) issues.push('TELEGRAM_DELIVERY_UNCERTAIN');
    if (counts.rejected) issues.push('TELEGRAM_DELIVERY_REJECTED');
    if (state.entries.some((entry) => entry.status === 'pending' && entry.reason === 'SERVICE_REJECTED')) issues.push('TELEGRAM_SERVICE_UNAVAILABLE');
    if (state.retry_at > now()) issues.push('TELEGRAM_RATE_LIMITED');
    if (storageFailure) issues.push('TELEGRAM_STORAGE_FAILURE');
    return { ok: issues.length === 0, enabled, ...counts, issues, retry_at: state.retry_at > now() && state.retry_at <= 8640000000000000 ? new Date(state.retry_at).toISOString() : null,
      ...(pinned ? { scoreboard: pinned.health() } : {}),
    };
  }

  function serialize(operation) {
    const pending = queue.then(async () => { await initialize(); return operation(); });
    queue = pending.catch(() => {});
    return pending;
  }

  async function flushUnsafe() {
    if (!enabled || storageFailure || state.retry_at > now()) return summary();
    await pinned?.flush({
      canUseChat: team => state.chat_ready_at[team] <= now(),
      onAttempt: async teams => {
        for (const team of teams) state.chat_ready_at[team] = now() + CHAT_GAP_MS;
        await persist();
      },
      onRateLimit: async retryAt => { state.retry_at = Math.max(state.retry_at, retryAt); await persist(); },
    });
    if (state.retry_at > now()) return summary();
    // One per physical chat per flush; results take precedence over agent chat backlog.
    // Selection and writes are serial. Independent physical chats send in parallel within one timeout budget.
    const teamsByChat = new Map();
    for (const team of TEAMS) {
      if (!chats[team]) continue;
      const teams = teamsByChat.get(chats[team]) ?? [];
      teams.push(team);
      teamsByChat.set(chats[team], teams);
    }
    const selected = [...teamsByChat.entries()].flatMap(([chatId, teams]) => {
      if (teams.some((team) => state.chat_ready_at[team] > now())) return [];
      const eligible = state.entries.filter((entry) => teams.includes(entry.team) && entry.status === 'pending' && entry.retry_at <= now());
      eligible.sort((a, b) => a.priority - b.priority || a.order - b.order);
      return eligible.length ? [{ entry: eligible[0], chatId, teams }] : [];
    });
    if (!selected.length) return summary();
    for (const { entry, teams } of selected) {
      entry.status = 'inflight'; entry.attempts += 1;
      for (const team of teams) state.chat_ready_at[team] = now() + CHAT_GAP_MS;
    }
    await persist();
    const replies = await Promise.all(selected.map(({ entry, chatId }) => request({ token, method: 'sendMessage', timeoutMs: requestTimeoutMs, body: {
      chat_id: chatId, text: entry.text, link_preview_options: { is_disabled: true },
    }, fetchImpl })));
    for (let index = 0; index < selected.length; index += 1) {
      const { entry } = selected[index];
      const { status, payload } = replies[index];
      if (status >= 200 && status < 300 && payload?.ok === true && Number.isSafeInteger(payload.result?.message_id) && payload.result.message_id > 0 &&
          (payload.result.chat?.id === undefined || String(payload.result.chat.id) === selected[index].chatId)) {
        entry.status = 'sent'; entry.message_id = payload.result.message_id;
        entry.delivered_at = new Date(now()).toISOString(); entry.reason = null;
      } else if (payload?.ok === false && (status === 429 || payload.error_code === 429)) {
        const seconds = Number(payload.parameters?.retry_after);
        const delay = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, Number.MAX_SAFE_INTEGER) : 30000;
        entry.status = 'pending'; entry.reason = 'RATE_LIMITED'; entry.retry_at = now() + delay;
        state.retry_at = Math.max(state.retry_at, entry.retry_at);
      } else if (payload?.ok === false && Number.isInteger(payload.error_code) && payload.error_code >= 500) {
        // Telegram explicitly rejected this attempt. A transport error alone is not enough to retry.
        entry.status = 'pending'; entry.reason = 'SERVICE_REJECTED';
        entry.retry_at = now() + Math.min(60000, 2000 * 2 ** Math.min(entry.attempts - 1, 5));
      } else if (payload?.ok === false && Number.isInteger(payload.error_code) && payload.error_code >= 400 && payload.error_code < 500) {
        entry.status = 'rejected'; entry.reason = 'API_REJECTED';
      } else {
        entry.status = 'uncertain'; entry.reason = 'SEND_OUTCOME_UNKNOWN';
      }
    }
    await persist();
    return summary();
  }

  return Object.freeze({
    publish({ messages = {}, events = [], snapshot } = {}) {
      return serialize(async () => {
        const additions = [];
        for (const event of events) {
          const text = formatDealerEvent(event, config);
          const eventTeams = chats.openclaw && chats.openclaw === chats.hermes ? [TEAMS[0]] : TEAMS;
          for (const team of eventTeams) additions.push({ key: `event:${team}:${event.id}`, team, text, priority: PRIORITY[event.kind] });
        }
        for (const team of TEAMS) {
          ensure(Array.isArray(messages[team] ?? []), 'INVALID_TEAM_MESSAGES');
          for (const message of messages[team] ?? []) additions.push({
            key: `message:${team}:${message.game_id}:${message.sequence}`,
            team, text: formatAgentMessage(message, team, config), priority: 3,
          });
        }
        const existing = new Map(state.entries.map((entry) => [entry.key, entry]));
        const staged = [];
        for (const addition of additions) {
          addition.digest = hash(addition.text);
          const previous = existing.get(addition.key);
          ensure(!previous || previous.digest === addition.digest, 'TELEGRAM_DELIVERY_ID_CONFLICT');
          if (!previous) {
            const entry = { ...addition, status: 'pending', attempts: 0, retry_at: 0, order: state.entries.length + staged.length, created_at: new Date(now()).toISOString() };
            staged.push(entry); existing.set(entry.key, entry);
          }
        }
        await pinned?.ingest({ events, snapshot });
        state.entries.push(...staged);
        await persist();
        return flushUnsafe();
      });
    },
    flush() { return serialize(flushUnsafe); },
    health() { return serialize(async () => summary()); },
  });
}

/** Read-only setup evidence. Does not post messages, change permissions or consume group updates. */
export async function verifyTelegramGroups({ config, token, fetchImpl = globalThis.fetch }) {
  ensure(typeof token === 'string' && token.length > 0, 'TELEGRAM_TOKEN_REQUIRED');
  const me = await request({ token, method: 'getMe', body: {}, fetchImpl });
  if (me.payload?.ok !== true || !Number.isSafeInteger(me.payload.result?.id)) return { ok: false, issues: ['TELEGRAM_BOT_IDENTITY_UNVERIFIED'], groups: [] };
  const botId = me.payload.result.id;
  const groups = await Promise.all(TEAMS.map(async (team) => {
    const chatId = config.telegram?.[team]?.chat_id;
    if (chatId == null) return { team, ok: false, issues: ['GROUP_NOT_CONFIGURED'] };
    const [chat, member] = await Promise.all([
      request({ token, method: 'getChat', body: { chat_id: chatId }, fetchImpl }),
      request({ token, method: 'getChatMember', body: { chat_id: chatId, user_id: botId }, fetchImpl }),
    ]);
    const issues = [];
    if (chat.payload?.ok !== true || !['group', 'supergroup'].includes(chat.payload.result?.type)) issues.push('GROUP_UNVERIFIED');
    if (member.payload?.ok !== true || member.payload.result?.status !== 'administrator') issues.push('BOT_ADMIN_UNVERIFIED');
    const permissions = chat.payload?.result?.permissions;
    const sending = ['can_send_messages', 'can_send_audios', 'can_send_documents', 'can_send_photos', 'can_send_videos', 'can_send_video_notes', 'can_send_voice_notes', 'can_send_polls', 'can_send_other_messages', 'can_add_web_page_previews'];
    if (!permissions || permissions.can_send_messages !== false || sending.some((permission) => permissions[permission] === true)) issues.push('SPECTATOR_READ_ONLY_UNVERIFIED');
    return { team, ok: issues.length === 0, issues };
  }));
  return { ok: groups.every((group) => group.ok), issues: [], groups };
}
