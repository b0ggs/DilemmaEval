import { POLL_INTERVAL_MS, validateState, rosterCounts, phaseActivity, formatWei, safeLink, resultLink, freshness, phaseDeadline, nextGameLabel } from './state.mjs';

const $ = id => document.getElementById(id);
const setText = (id, value) => { $(id).textContent = String(value); };
const teamName = team => team === 'openclaw' ? 'OpenClaw' : 'Hermes';
const localTime = value => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Time unavailable';
};
const make = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
};
function setLink(id, url, label, unavailable) {
  const element = $(id);
  element.textContent = url ? label : unavailable;
  if (url) {
    element.href = url;
    element.target = '_blank';
    element.rel = 'noopener noreferrer';
    element.removeAttribute('aria-disabled');
  } else {
    element.removeAttribute('href');
    element.removeAttribute('target');
    element.setAttribute('aria-disabled', 'true');
  }
}

let lastState = null;
let connectionFailed = false;
let inFlight = false;

function renderConnection() {
  if (!lastState) {
    $('connection').dataset.state = connectionFailed ? 'error' : 'starting';
    setText('connection-text', connectionFailed ? 'Connection unavailable · retrying automatically' : 'Connecting to the game…');
    return;
  }
  const status = freshness(lastState, Date.now(), connectionFailed);
  $('connection').dataset.state = status.kind;
  setText('connection-text', status.label);
  setText('updated-at', `Updated ${localTime(lastState.updated_at)}`);
  $('updated-at').title = lastState.updated_at;
  // Do not count down an uncertain next launch while the feed is disconnected or stale.
  setText('next-game', ['error', 'stale'].includes(status.kind) ? '' : nextGameLabel(lastState));
}

function renderGame(state) {
  const game = state.current_game;
  const phase = game?.phase ?? 'idle';
  const intermission = state.status === 'intermission';
  const labels = { idle: 'Preparing', join: 'Joining', commit: 'Committing', reveal: 'Revealing', terminal: 'Resolved' };
  setText('phase-badge', state.status === 'stopped' ? 'Stopped' : intermission ? 'Intermission' : labels[phase]);
  setText('current-title', intermission ? 'Next game starting' : game && phase !== 'idle' ? `Game #${game.game_id}` : state.status === 'stopped' ? 'Run finished' : 'Preparing the table');
  setText('current-round', game && !intermission && !['idle', 'join'].includes(phase) ? `Round ${game.round}` : '');
  const details = {
    idle: 'Waiting for the next confirmed game.',
    join: 'Agents are joining with their own testnet wallets.',
    commit: 'Living agents discuss, then commit their private moves.',
    reveal: 'Agents reveal the moves they already committed.',
    terminal: 'The outcome is confirmed. Awards and claims are reconciled below.',
  };
  setText('game-detail', intermission ? 'The previous result stays below while the next game is prepared.' : details[phase]);
  const activity = phaseActivity(intermission ? null : game, state.roster.length);
  setText('phase-count-label', activity.label);
  setText('phase-count', activity.count === null ? '—' : `${activity.count} / ${activity.total}`);
  $('progress-fill').style.width = `${activity.percentage}%`;
  $('progress-track').setAttribute('aria-valuenow', String(Math.round(activity.percentage)));
  $('progress-track').setAttribute('aria-valuetext', activity.count === null ? activity.label : `${activity.count} of ${activity.total}: ${activity.label}`);
  setText('deadline', intermission ? 'Automatic games · 20-second target intermission' : game?.clock ? phaseDeadline(game.clock) : 'Confirmed activity only');
}

function renderEarnings(state) {
  const cards = state.roster.map(seat => {
    const earning = state.earnings.find(item => item.seat_id === seat.seat_id);
    const card = make('article', 'agent-card');
    card.dataset.team = seat.team;
    const identity = make('div', 'agent-identity');
    identity.append(make('span', 'agent-dot'), make('h3', 'agent-name', seat.seat_id), make('span', 'agent-team', teamName(seat.team)));
    const award = make('div', 'agent-award');
    const value = make('span', 'award-value', formatWei(earning?.awarded_wei));
    value.title = earning ? `${earning.awarded_wei} wei awarded` : 'Awaiting confirmed earnings';
    award.append(value, make('span', 'award-unit', 'ETH'));
    const details = make('div', 'agent-details');
    const claimed = make('span', '', `Claimed ${formatWei(earning?.claimed_wei)}`);
    const refunded = make('span', '', `Refunded ${formatWei(earning?.refunded_wei)}`);
    if (earning) { claimed.title = `${earning.claimed_wei} wei`; refunded.title = `${earning.refunded_wei} wei`; }
    details.append(claimed, refunded);
    card.append(identity, award, make('p', 'award-label', state.mode === 'fixture' ? 'Fixture awards this run' : 'Awarded this demo run'), details);
    return card;
  });
  $('earnings').replaceChildren(...(cards.length ? cards : [make('p', 'empty-state', 'Waiting for the agent roster.')]));
}

function renderMessages(state, team) {
  const seats = state.roster.filter(seat => seat.team === team);
  setText(`${team}-members`, `${seats.length} ${seats.length === 1 ? 'agent · individual plans' : 'agents · team conversation'}`);
  const messages = state.messages[team].filter(message => message && typeof message.message === 'string' && seats.some(seat => seat.seat_id === message.seat_id)).slice(-4);
  const elements = messages.map(message => {
    const row = make('article', 'message');
    const metadata = make('div', 'message-meta');
    const time = make('time', 'message-time', localTime(message.received_at));
    if (Number.isFinite(Date.parse(message.received_at))) time.dateTime = message.received_at;
    metadata.append(make('strong', 'message-author', message.seat_id), make('span', '', `Game ${message.game_id} · R${message.round}`), time);
    row.append(metadata, make('p', 'message-body', message.message));
    return row;
  });
  $('messages-' + team).replaceChildren(...(elements.length ? elements : [make('p', 'empty-state', state.mode === 'fixture' ? 'No fixture messages in this team.' : 'No accepted agent messages yet. Their words will appear here as they play.')]));
  setLink(`telegram-${team}`, safeLink(state.links?.telegram?.[team], 'telegram'), `Open ${teamName(team)} on Telegram ↗`, 'Telegram group not connected');
}

function renderResult(state) {
  const result = state.latest_result;
  const confirmed = result && ['completed', 'cancelled'].includes(result.outcome);
  const link = state.mode === 'live' ? resultLink(result) : null;
  $('result-link').hidden = !link;
  setLink('result-link', link, 'View result on Basescan ↗', 'Result transaction unavailable');
  if (!confirmed) {
    setText('result-title', 'Waiting for a confirmed outcome');
    setText('result-detail', 'Completed games and cancellations are reported separately.');
    $('result-choices').replaceChildren();
    $('result-awards').replaceChildren();
    return;
  }
  setText('result-title', `Game #${result.game_id} · ${result.outcome === 'cancelled' ? 'Cancelled' : 'Completed'}`);
  setText('result-detail', state.mode === 'fixture' ? 'Synthetic result for interface testing. No explorer evidence is claimed.' : result.outcome === 'cancelled' ? 'This cancellation is excluded from the completed-game count.' : 'Confirmed outcome. A defaulted move is shown separately from an agent’s chosen action.');
  const seatName = wallet => state.roster.find(seat => typeof wallet === 'string' && seat.wallet_address?.toLowerCase() === wallet.toLowerCase())?.seat_id ?? (typeof wallet === 'string' ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : 'Unknown seat');
  const choices = Array.isArray(result.choices) ? result.choices.filter(item => ['Share', 'Steal', 'Catch'].includes(item?.choice)) : [];
  $('result-choices').replaceChildren(...choices.map(choice => {
    const chip = make('span', 'choice-chip', `${seatName(choice.wallet_address)} · ${choice.choice}${choice.defaulted ? ' (defaulted)' : ''}${choice.eliminated ? ' · eliminated' : ''}`);
    chip.dataset.defaulted = String(Boolean(choice.defaulted));
    return chip;
  }));
  const awards = Array.isArray(result.awards) ? result.awards : [];
  $('result-awards').replaceChildren(...awards.map(award => make('p', '', `${seatName(award.wallet_address)} awarded ${formatWei(award.award_wei)} testnet ETH`)));
}

function render(state) {
  const savedProof = state.proof_label === 'Saved proof · read-only snapshot';
  const counts = rosterCounts(state.roster);
  $('fixture-banner').hidden = state.mode !== 'fixture' && !savedProof;
  $('fixture-banner').textContent = savedProof ? 'SAVED PROOF · Confirmed real game. Runner stopped; this view starts no new actions.' : 'FIXTURE PREVIEW · Synthetic data for interface testing. No live games or agent messages.';
  setText('roster-summary', `${counts.total} agents · ${counts.openclaw} vs ${counts.hermes} · Base Sepolia testnet`);
  setText('completed-label', state.mode === 'fixture' ? 'Fixture games completed' : savedProof ? 'Saved proof games completed' : 'Games completed');
  setText('completed-count', state.counts.completed.toLocaleString());
  setText('cancelled-count', state.counts.cancelled.toLocaleString());
  setText('count-scope', state.mode === 'fixture' ? 'Synthetic counts · no live activity' : savedProof ? 'Recorded proof · no live updates' : 'Confirmed in this demo run');
  setText('run-id', `Run ${state.run_id} · ${state.mode === 'fixture' ? 'Fixture preview' : savedProof ? 'Saved proof' : 'Live source'} · ${savedProof ? 'Read-only snapshot' : 'Refreshes every 5 seconds'}`);
  setLink('contract-link', safeLink(state.links?.contract, 'contract'), 'Game contract on Basescan ↗', 'Contract awaiting confirmation');
  renderGame(state);
  renderEarnings(state);
  renderMessages(state, 'openclaw');
  renderMessages(state, 'hermes');
  renderResult(state);
  renderConnection();
}

async function refresh() {
  if (inFlight) return;
  inFlight = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch('/api/state', { cache: 'no-store', credentials: 'omit', signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Spectator feed unavailable');
    const state = validateState(await response.json());
    lastState = state;
    connectionFailed = false;
    render(state);
  } catch {
    connectionFailed = true;
    renderConnection();
  } finally {
    clearTimeout(timeout);
    inFlight = false;
  }
}

refresh();
setInterval(refresh, POLL_INTERVAL_MS);
setInterval(renderConnection, 1_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
