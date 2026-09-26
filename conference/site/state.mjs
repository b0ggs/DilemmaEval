export const POLL_INTERVAL_MS = 5_000;
export const STALE_AFTER_MS = 20_000;
const phases = new Set(['idle', 'join', 'commit', 'reveal', 'terminal']);
const statuses = new Set(['starting', 'playing', 'intermission', 'stopped', 'degraded']);
const isCount = value => Number.isSafeInteger(value) && value >= 0;

export function validateState(state) {
  if (!state || state.schema_version !== 1 || state.chain_id !== 84532 || state.network !== 'Base Sepolia'
      || !['live', 'fixture'].includes(state.mode) || !statuses.has(state.status)
      || (state.proof_label !== undefined && state.proof_label !== 'Saved proof · read-only snapshot')
      || !Number.isFinite(Date.parse(state.updated_at)) || typeof state.run_id !== 'string'
      || !Array.isArray(state.roster) || !Array.isArray(state.earnings)
      || !isCount(state.counts?.completed) || !isCount(state.counts?.cancelled)
      || !Array.isArray(state.messages?.openclaw) || !Array.isArray(state.messages?.hermes)) {
    throw new Error('Invalid public spectator state');
  }
  if (state.roster.some(seat => !seat || typeof seat.seat_id !== 'string' || !['openclaw', 'hermes'].includes(seat.team))) {
    throw new Error('Invalid public roster');
  }
  const game = state.current_game;
  if (game !== null && (!game || !phases.has(game.phase) || !/^\d+$/.test(String(game.game_id))
      || !isCount(Number(game.round)) || !isCount(Number(game.alive_count))
      || !isCount(Number(game.committed_count)) || !isCount(Number(game.revealed_count)))) {
    throw new Error('Invalid public game');
  }
  return state;
}

export function rosterCounts(roster) {
  return { openclaw: roster.filter(seat => seat.team === 'openclaw').length, hermes: roster.filter(seat => seat.team === 'hermes').length, total: roster.length };
}

export function phaseActivity(game, rosterSize) {
  if (!game || ['idle', 'terminal'].includes(game.phase)) return { label: 'Awaiting the next game', count: null, total: null, percentage: 0 };
  const [label, count, total] = game.phase === 'commit'
    ? ['Commitments confirmed', Number(game.committed_count), Number(game.alive_count)]
    : game.phase === 'reveal'
      ? ['Reveals confirmed', Number(game.revealed_count), Number(game.committed_count)]
      : ['Players joined', Number(game.alive_count), rosterSize];
  return { label, count, total, percentage: total > 0 ? Math.min(100, Math.max(0, count / total * 100)) : 0 };
}

export function formatWei(value) {
  if (!/^\d+$/.test(String(value))) return '—';
  const wei = BigInt(value);
  const whole = wei / 10n ** 18n;
  const remainder = wei % 10n ** 18n;
  if (wei > 0n && whole === 0n && remainder < 10n ** 12n) return '<0.000001';
  const fraction = remainder.toString().padStart(18, '0').slice(0, 6).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function safeLink(value, kind) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return null;
    if (kind === 'telegram') return url.hostname === 't.me' && /^\/(?:\+[\w-]+|[\w-]+)(?:\/[\w-]+)?\/?$/.test(url.pathname) ? url.href : null;
    if (url.hostname !== 'sepolia.basescan.org') return null;
    const pattern = kind === 'transaction' ? /^\/tx\/0x[0-9a-f]{64}$/i : /^\/address\/0x[0-9a-f]{40}$/i;
    return pattern.test(url.pathname) ? url.href : null;
  } catch { return null; }
}

export function resultLink(result) {
  if (!result || !['completed', 'cancelled'].includes(result.outcome) || !/^0x[0-9a-f]{64}$/i.test(result.transaction_hash ?? '')) return null;
  // Construct from the result's actual transaction hash, never a contract or latest transaction link.
  const expected = `https://sepolia.basescan.org/tx/${result.transaction_hash}`;
  const supplied = safeLink(result.transaction_url, 'transaction');
  return supplied && supplied.toLowerCase() === expected.toLowerCase() ? supplied : null;
}

export function freshness(state, now = Date.now(), failed = false) {
  if (failed) return { kind: 'error', label: 'Reconnecting · showing the last received state' };
  if (state.proof_label === 'Saved proof · read-only snapshot') return { kind: 'proof', label: 'Saved proof · read-only snapshot' };
  const elapsed = now - Date.parse(state.updated_at);
  if (elapsed > STALE_AFTER_MS || elapsed < -30_000) return { kind: 'stale', label: 'Updates delayed · showing the last received state' };
  if (state.mode === 'fixture') return { kind: 'fixture', label: 'Fixture preview · synthetic game state' };
  if (state.status === 'degraded' || state.health?.ok === false) return { kind: 'degraded', label: 'Service degraded · waiting for healthy updates' };
  if (state.status === 'stopped') return { kind: 'stopped', label: 'Run stopped · final confirmed state' };
  if (state.status === 'starting') return { kind: 'starting', label: 'Starting · waiting for confirmed game activity' };
  return { kind: 'live', label: 'Live updates · confirmed on Base Sepolia' };
}

export function phaseDeadline(clock) {
  if (!clock || !/^\d+$/.test(String(clock.current)) || !/^\d+$/.test(String(clock.deadline))) return 'Waiting for chain deadline';
  const left = BigInt(clock.deadline) - BigInt(clock.current);
  if (left < 0n) return 'Deadline passed · awaiting phase advancement';
  if (clock.unit === 'block') return `${left} blocks to deadline · block ${clock.deadline}`;
  if (clock.unit === 'timestamp') return `${left}s to join deadline · chain time`;
  return 'Waiting for chain deadline';
}

export function nextGameLabel(state, now = Date.now()) {
  if (state.status === 'stopped') return 'New games stopped';
  if (state.status !== 'intermission') return '';
  const remaining = Date.parse(state.next_game_at) - now;
  return Number.isFinite(remaining) && remaining > 0 ? `Next game in ${Math.ceil(remaining / 1000)}s` : 'Next game starting';
}
