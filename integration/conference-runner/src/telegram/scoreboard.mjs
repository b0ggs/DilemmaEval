import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const TEAMS = ['openclaw', 'hermes'];
const INTEGER = /^(0|[1-9][0-9]*)$/;
const TX = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const EDIT_GAP_MS = 5000;
const digest = value => createHash('sha256').update(value).digest('hex');
function ensure(value, code) { if (!value) throw new Error(code); }
function ether(wei) {
  const value = BigInt(wei);
  const decimals = (value % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '');
  return `${value / 10n ** 18n}${decimals ? `.${decimals}` : ''}`;
}

/** Private series ledger. The enclosing mirror owns serialization and confirmed event input. */
export function createPinnedScoreboard({ config, options, chats, now, enabled, request }) {
  ensure(options && typeof options.seriesId === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(options.seriesId), 'INVALID_SCOREBOARD_SERIES');
  const firstGameId = String(options.firstGameId);
  ensure(INTEGER.test(firstGameId) && BigInt(firstGameId) > 0n, 'INVALID_SCOREBOARD_FIRST_GAME');
  ensure(typeof options.runtimeDir === 'string' && path.isAbsolute(options.runtimeDir), 'SCOREBOARD_RUNTIME_MUST_BE_ABSOLUTE');
  const messageIds = Object.fromEntries(TEAMS.map(team => [team, options.messageIds?.[team]]));
  ensure(TEAMS.every(team => chats[team] && Number.isSafeInteger(messageIds[team]) && messageIds[team] > 0), 'INVALID_SCOREBOARD_DESTINATION');
  ensure(chats.openclaw !== chats.hermes, 'SCOREBOARD_REQUIRES_DISTINCT_TEAM_ROOMS');
  const roster = config.roster.map(seat => ({ wallet: seat.wallet_address?.toLowerCase(), team: seat.team })).sort((a, b) => String(a.wallet).localeCompare(String(b.wallet)));
  ensure(roster.length > 0 && roster.every(seat => ADDRESS.test(seat.wallet) && TEAMS.includes(seat.team)) && new Set(roster.map(seat => seat.wallet)).size === roster.length && TEAMS.every(team => roster.some(seat => seat.team === team)), 'INVALID_SCOREBOARD_ROSTER');
  const teamByWallet = new Map(roster.map(seat => [seat.wallet, seat.team]));
  const scope = { series_id: options.seriesId, first_game_id: firstGameId, chain_id: config.chain_id, game_address: config.game_address?.toLowerCase() ?? null, roster, chats, message_ids: messageIds };
  const directory = path.join(options.runtimeDir, 'telegram');
  const filename = path.join(directory, 'scoreboard.json');
  let state;
  let storageFailure = false;

  async function persist() {
    const temporary = path.join(directory, `.scoreboard-${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await fs.open(temporary, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(state));
      await handle.sync(); await handle.close(); handle = null;
      await fs.rename(temporary, filename);
      const dir = await fs.open(directory, 'r');
      try { await dir.sync(); } finally { await dir.close(); }
    } catch {
      storageFailure = true;
      throw new Error('TELEGRAM_SCOREBOARD_STORAGE_FAILURE');
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
      if (error.code !== 'ENOENT') throw new Error('TELEGRAM_SCOREBOARD_UNREADABLE');
    }
    if (parsed) {
      ensure(parsed.schema_version === 1 && JSON.stringify(parsed.scope) === JSON.stringify(scope), 'TELEGRAM_SCOREBOARD_SCOPE_MISMATCH');
      ensure(Array.isArray(parsed.results) && Array.isArray(parsed.cancelled) && Array.isArray(parsed.rejected_results) && parsed.defaults && parsed.pins && Number.isFinite(parsed.retry_at), 'TELEGRAM_SCOREBOARD_INVALID');
      ensure(TEAMS.every(team => parsed.pins[team] && Number.isFinite(parsed.pins[team].retry_at) && Number.isFinite(parsed.pins[team].ready_at)), 'TELEGRAM_SCOREBOARD_INVALID');
      state = parsed;
      for (const pin of Object.values(state.pins)) {
        // Repeating the exact edit is idempotent, unlike repeating sendMessage.
        if (pin.status === 'inflight') { pin.status = 'pending'; pin.reason = 'EDIT_OUTCOME_UNKNOWN'; }
      }
    } else {
      state = { schema_version: 1, scope, results: [], cancelled: [], defaults: {}, rejected_results: [], stage: null, retry_at: 0, pins: Object.fromEntries(TEAMS.map(team => [team, { status: 'pending', sent_digest: null, desired_digest: null, text: null, retry_at: 0, ready_at: 0, attempts: 0, reason: null }])) };
    }
    refreshText();
    await persist();
  }

  function totals() {
    const result = { wins: { openclaw: 0, hermes: 0 }, ties: 0, awards_wei: { openclaw: '0', hermes: '0' }, completed: state.results.length, cancelled: state.cancelled.length, defaulted_games: 0 };
    for (const game of state.results) {
      for (const team of TEAMS) result.awards_wei[team] = (BigInt(result.awards_wei[team]) + BigInt(game.awards_wei[team])).toString();
      if (game.winner === 'tie') result.ties += 1; else result.wins[game.winner] += 1;
      if (state.defaults[game.game_id]?.length) result.defaulted_games += 1;
    }
    return result;
  }

  function refreshText() {
    const score = totals();
    const counts = Object.fromEntries(TEAMS.map(team => [team, roster.filter(seat => seat.team === team).length]));
    const lines = [
      `DilemmaEval · ${counts.openclaw} vs ${counts.hermes} · Scoreboard`,
      `Series: ${scope.series_id}`, '',
      `OpenClaw ${score.wins.openclaw} — Hermes ${score.wins.hermes}`,
      `Ties: ${score.ties} · Completed games: ${score.completed} · Cancelled: ${score.cancelled}`, '',
      'Total confirmed prize awards (Base Sepolia test ETH)',
      `OpenClaw: ${ether(score.awards_wei.openclaw)} ETH`,
      `Hermes: ${ether(score.awards_wei.hermes)} ETH`, '',
      'Higher combined team award wins; equal awards tie.',
      'Funding, refunds, claims and earlier games do not add to these totals.',
      `Games with observed defaults: ${score.defaulted_games}`,
      'Payouts alone do not establish healthy play. Defaulted outcomes are not healthy-play proof.', '',
      state.stage ? `Last observed: Game ${state.stage.game_id} · Round ${state.stage.round} · ${state.stage.phase}` : 'Work in progress · Awaiting a confirmed series game.',
    ];
    if (state.rejected_results.length) lines.push(`Accounting blocked for ${new Set(state.rejected_results.map(item => item.game_id)).size} game(s): invalid or conflicting result evidence.`);
    const recent = [...state.results].sort((a, b) => BigInt(a.game_id) < BigInt(b.game_id) ? -1 : 1).slice(-5);
    if (recent.length) lines.push('', 'Recent confirmed results (full history retained in series ledger):');
    for (const game of recent) {
      const label = game.winner === 'tie' ? 'Tie' : `${game.winner === 'openclaw' ? 'OpenClaw' : 'Hermes'} wins`;
      const zero = BigInt(game.awards_wei.openclaw) === 0n && BigInt(game.awards_wei.hermes) === 0n;
      lines.push(`Game ${game.game_id}: ${label}${zero ? ' · ZERO AWARDS' : ''}${state.defaults[game.game_id]?.length ? ' · DEFAULTS OBSERVED' : ''} · OC ${ether(game.awards_wei.openclaw)} / H ${ether(game.awards_wei.hermes)} ETH`, `https://sepolia.basescan.org/tx/${game.transaction_hash}`);
    }
    const text = lines.join('\n');
    ensure(text.length <= 4096, 'TELEGRAM_SCOREBOARD_TOO_LONG');
    const nextDigest = digest(text);
    for (const pin of Object.values(state.pins)) {
      if (pin.desired_digest !== nextDigest) {
        pin.desired_digest = nextDigest; pin.text = text;
        if (pin.status !== 'rejected') pin.status = pin.sent_digest === nextDigest ? 'sent' : 'pending';
      }
    }
  }

  function reject(event, reason) {
    const key = `${event.game_id}:${event.transaction_hash}:${event.log_index}:${reason}`;
    if (!state.rejected_results.some(item => item.key === key)) state.rejected_results.push({ key, game_id: event.game_id, reason });
  }

  function confirmedEvent(event) {
    return event.confirmed !== false && event.removed !== true && TX.test(event.transaction_hash) && typeof event.block_number === 'string' && INTEGER.test(event.block_number) && Number.isSafeInteger(event.log_index) && event.log_index >= 0;
  }

  function applyEvent(event) {
    if (!INTEGER.test(event.game_id) || BigInt(event.game_id) < BigInt(firstGameId)) return;
    if (!['completed', 'cancelled', 'round-resolved'].includes(event.kind)) return;
    if (!confirmedEvent(event)) { reject(event, 'UNCONFIRMED_RESULT_EVIDENCE'); return; }
    const existing = state.results.find(result => result.game_id === event.game_id);
    const cancellation = state.cancelled.find(result => result.game_id === event.game_id);
    if (event.kind === 'round-resolved') {
      const defaults = (event.data?.choices ?? []).filter(choice => choice.defaulted === true && teamByWallet.has(choice.wallet_address?.toLowerCase())).map(choice => `${event.transaction_hash.toLowerCase()}:${event.log_index}:${choice.wallet_address.toLowerCase()}`);
      if (defaults.length) state.defaults[event.game_id] = [...new Set([...(state.defaults[event.game_id] ?? []), ...defaults])].sort();
      return;
    }
    const resultId = `${event.transaction_hash.toLowerCase()}:${event.log_index}`;
    if ([...state.results, ...state.cancelled].some(result => result.result_id === resultId && result.game_id !== event.game_id)) { reject(event, 'CONFLICTING_RESULT_ID'); return; }
    if (!state.stage || BigInt(event.game_id) >= BigInt(state.stage.game_id)) state.stage = { game_id: event.game_id, round: event.round, phase: event.kind };
    if (event.kind === 'cancelled') {
      if (existing || cancellation && cancellation.result_id !== resultId) { reject(event, 'CONFLICTING_TERMINAL_RESULT'); return; }
      if (!cancellation) state.cancelled.push({ game_id: event.game_id, transaction_hash: event.transaction_hash.toLowerCase(), result_id: `${event.transaction_hash.toLowerCase()}:${event.log_index}` });
      return;
    }
    const awards = event.data?.awards;
    if (!Array.isArray(awards) || awards.length !== roster.length) { reject(event, 'INCOMPLETE_ROSTER_AWARDS'); return; }
    const seen = new Set();
    const normalized = [];
    const summed = { openclaw: 0n, hermes: 0n };
    for (const award of awards) {
      const wallet = award.wallet_address?.toLowerCase();
      if (!teamByWallet.has(wallet) || seen.has(wallet) || typeof award.award_wei !== 'string' || !INTEGER.test(award.award_wei)) { reject(event, 'INVALID_ROSTER_AWARDS'); return; }
      seen.add(wallet); normalized.push({ wallet, award_wei: award.award_wei });
      summed[teamByWallet.get(wallet)] += BigInt(award.award_wei);
    }
    normalized.sort((a, b) => a.wallet.localeCompare(b.wallet));
    const result = {
      game_id: event.game_id, result_id: `${event.transaction_hash.toLowerCase()}:${event.log_index}`,
      transaction_hash: event.transaction_hash.toLowerCase(), block_number: event.block_number,
      awards: normalized, awards_wei: Object.fromEntries(TEAMS.map(team => [team, summed[team].toString()])),
      winner: summed.openclaw === summed.hermes ? 'tie' : summed.openclaw > summed.hermes ? 'openclaw' : 'hermes',
    };
    if (cancellation || existing && JSON.stringify(existing) !== JSON.stringify(result)) { reject(event, 'CONFLICTING_TERMINAL_RESULT'); return; }
    if (!existing) state.results.push(result);
    // A fully validated replay can resolve an earlier incomplete observation of this same result.
    state.rejected_results = state.rejected_results.filter(item => item.game_id !== event.game_id || item.reason === 'CONFLICTING_TERMINAL_RESULT');
  }

  async function ingest({ events = [], snapshot } = {}) {
    await initialize();
    for (const event of events) applyEvent(event);
    if (snapshot && typeof snapshot.game_id === 'string' && INTEGER.test(snapshot.game_id) && BigInt(snapshot.game_id) >= BigInt(firstGameId) && Number.isSafeInteger(snapshot.round) && snapshot.round >= 0 && ['idle', 'join', 'commit', 'reveal', 'completed', 'cancelled'].includes(snapshot.phase)) {
      if (!state.stage || BigInt(snapshot.game_id) >= BigInt(state.stage.game_id)) state.stage = { game_id: snapshot.game_id, round: snapshot.round, phase: snapshot.phase };
    }
    refreshText();
    await persist();
  }

  function health() {
    const issues = [];
    if (!enabled) issues.push('TELEGRAM_DISABLED');
    if (storageFailure) issues.push('TELEGRAM_SCOREBOARD_STORAGE_FAILURE');
    if (state.rejected_results.length) issues.push('SCOREBOARD_RESULT_REJECTED');
    if (Object.values(state.pins).some(pin => pin.status === 'rejected')) issues.push('SCOREBOARD_EDIT_REJECTED');
    if (Object.values(state.pins).some(pin => pin.reason === 'EDIT_OUTCOME_UNKNOWN')) issues.push('SCOREBOARD_EDIT_RETRY_PENDING');
    if (Object.values(state.pins).some(pin => pin.reason === 'SERVICE_REJECTED')) issues.push('SCOREBOARD_SERVICE_UNAVAILABLE');
    if (state.retry_at > now()) issues.push('SCOREBOARD_RATE_LIMITED');
    return { ok: issues.length === 0, series_id: scope.series_id, first_game_id: firstGameId, ...totals(), rejected_results: state.rejected_results.map(item => ({ game_id: item.game_id, reason: item.reason })), pins: Object.fromEntries(TEAMS.map(team => [team, { chat_id: chats[team], message_id: messageIds[team], status: state.pins[team].status, updated_at: state.pins[team].updated_at ?? null }])), issues };
  }

  async function flush({ canUseChat, onAttempt, onRateLimit }) {
    await initialize();
    if (!enabled || storageFailure || state.retry_at > now()) return;
    const selected = TEAMS.filter(team => {
      const pin = state.pins[team];
      return pin.status === 'pending' && pin.retry_at <= now() && pin.ready_at <= now() && canUseChat(team);
    });
    if (!selected.length) return;
    for (const team of selected) {
      const pin = state.pins[team];
      pin.status = 'inflight'; pin.attempts += 1; pin.ready_at = now() + EDIT_GAP_MS;
    }
    await persist();
    await onAttempt(selected);
    const replies = await Promise.all(selected.map(team => request({ method: 'editMessageText', body: { chat_id: chats[team], message_id: messageIds[team], text: state.pins[team].text, link_preview_options: { is_disabled: true } } })));
    for (let index = 0; index < selected.length; index += 1) {
      const pin = state.pins[selected[index]];
      const { status, payload } = replies[index];
      const unchanged = status === 400 && payload?.ok === false && payload.error_code === 400 && /^Bad Request: message is not modified\b/i.test(payload.description ?? '');
      const accepted = status >= 200 && status < 300 && payload?.ok === true && payload.result?.message_id === messageIds[selected[index]] && (payload.result.chat?.id === undefined || String(payload.result.chat.id) === chats[selected[index]]);
      if (accepted || unchanged) {
        pin.status = 'sent'; pin.sent_digest = pin.desired_digest; pin.reason = null; pin.retry_at = 0; pin.attempts = 0; pin.updated_at = new Date(now()).toISOString();
      } else if (payload?.ok === false && (status === 429 || payload.error_code === 429)) {
        const seconds = Number(payload.parameters?.retry_after);
        const delay = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, Number.MAX_SAFE_INTEGER) : 30000;
        pin.status = 'pending'; pin.reason = 'RATE_LIMITED'; pin.retry_at = now() + delay;
        state.retry_at = Math.max(state.retry_at, pin.retry_at); await onRateLimit(pin.retry_at);
      } else if (payload?.ok === false && Number.isInteger(payload.error_code) && payload.error_code >= 400 && payload.error_code < 500) {
        pin.status = 'rejected'; pin.reason = 'API_REJECTED';
      } else {
        pin.status = 'pending'; pin.reason = payload?.ok === false ? 'SERVICE_REJECTED' : 'EDIT_OUTCOME_UNKNOWN';
        pin.retry_at = now() + Math.min(60000, 2000 * 2 ** Math.min(pin.attempts - 1, 5));
      }
    }
    await persist();
  }

  return Object.freeze({ initialize, ingest, flush, health, retryAt: () => state.retry_at });
}
