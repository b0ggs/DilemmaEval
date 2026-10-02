import path from 'node:path';
import * as fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createOrchestratorCore, evaluateChainSnapshot } from '../../../orchestrator-core/src/index.js';
import { TeamLogStore } from '../../../team-logs/src/index.js';
import { parseAndValidateResponse, assertResponseIdentity } from '../../../maritime-transport/src/index.mjs';
import { discussionToLogResponse } from '../maritime/index.mjs';
import { safePlayerErrorCode } from '../maritime/diagnostics.mjs';
import { safeMaritimeErrorCode, safeMaritimeDiagnosticCode } from '../maritime/transport.mjs';
import { createDurableStore } from './store.mjs';
import { acquireRunnerLock } from './lock.mjs';

export { createDurableStore } from './store.mjs';

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clone = (value) => structuredClone(value);
const uint = /^(0|[1-9][0-9]*)$/;
const txHash = /^0x[0-9a-fA-F]{64}$/;
const address = /^0x[0-9a-fA-F]{40}$/;
const phases = new Set(['idle', 'join', 'commit', 'reveal', 'terminal']);
const eventKinds = new Set(['created', 'joined', 'round-resolved', 'completed', 'cancelled', 'claimed', 'refunded']);
const gameConfigKeys = ['joinDurationSeconds', 'commitDurationBlocks', 'revealDurationBlocks', 'minPlayers', 'maxPlayers', 'maxCauses', 'entryFeeWei', 'creatorFeeBps', 'causeFeeBps'];

function bounded(operation, milliseconds, code) {
  let timer;
  return Promise.race([
    Promise.resolve().then(operation),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(code)), milliseconds); })
  ]).finally(() => clearTimeout(timer));
}

function dispatchWithDeadline(operation, milliseconds, deadlineAtMs, phaseSignal) {
  const controller = new AbortController();
  const timeout = Object.assign(new Error('AGENT_TIMEOUT'), { code: 'AGENT_TIMEOUT', ambiguous: true });
  let timer;
  let fallback;
  let abort;
  const result = Promise.resolve().then(() => {
    if (controller.signal.aborted) throw Object.assign(new Error('MARITIME_DISPATCH_EXPIRED'), {
      code: 'MARITIME_DISPATCH_EXPIRED', ambiguous: false, retryable: true
    });
    return operation({ deadline_at_ms: deadlineAtMs, signal: controller.signal });
  }).then(
    (value) => {
      if (controller.signal.aborted) throw timeout;
      return value;
    },
    (error) => { throw error; }
  );
  const boundary = new Promise((_, reject) => {
    abort = () => {
      if (controller.signal.aborted) return;
      controller.abort();
      // An abort-aware adapter can now report whether work expired before any
      // remote mutation. Give that already-signalled rejection one event-loop
      // turn to settle, but never let an adapter that ignores abort hang a tick.
      fallback = setImmediate(() => reject(timeout));
    };
    timer = setTimeout(abort, milliseconds);
    if (phaseSignal?.aborted) abort();
    else phaseSignal?.addEventListener('abort', abort, { once: true });
  });
  return Promise.race([result, boundary]).finally(() => {
    clearTimeout(timer);
    clearImmediate(fallback);
    phaseSignal?.removeEventListener('abort', abort);
  });
}

function isRejectedBeforeSubmit(error) {
  return error?.ambiguous === false && (error.code === 'MARITIME_DISPATCH_EXPIRED' ||
    error.code === 'MARITIME_ONE_AWAKE_RECONCILIATION_REQUIRED' && error.retryable === true);
}

function projectSnapshot(input, config) {
  if (!input || input.chain_id !== 84532 || input.game_address?.toLowerCase() !== config.game_address.toLowerCase() ||
      !phases.has(input.phase) || !uint.test(input.game_id) || !uint.test(input.block_number) || !txHash.test(input.block_hash)) {
    throw new Error('INVALID_CHAIN_SNAPSHOT');
  }
  const snapshot = {};
  for (const key of ['schema_version', 'chain_id', 'game_address', 'game_id', 'active_game_id', 'round', 'phase', 'outcome',
    'block_number', 'block_hash', 'block_timestamp', 'alive_count', 'committed_count', 'revealed_count']) snapshot[key] = input[key];
  snapshot.transaction_hash = txHash.test(input.transaction_hash ?? '') ? input.transaction_hash : null;
  snapshot.clock = input.clock === null ? null : Object.fromEntries(['unit', 'current', 'deadline'].map((key) => [key, input.clock?.[key]]));
  snapshot.config = Object.fromEntries(gameConfigKeys.filter((key) => input.config?.[key] !== undefined).map((key) => [key, input.config[key]]));
  snapshot.players = (input.players ?? []).map((player) => Object.fromEntries([
    'wallet_address', 'joined', 'alive', 'committed', 'revealed', 'award_wei', 'claimed_wei', 'refunded_wei'
  ].map((key) => [key, player[key]])));
  return snapshot;
}

function coreSnapshot(snapshot) {
  return Object.fromEntries(['schema_version', 'game_id', 'round', 'phase', 'block_number', 'block_hash',
    'alive_count', 'committed_count', 'revealed_count', 'clock'].map((key) => [key, snapshot[key]]));
}

function projectEvent(event) {
  if (!event || !eventKinds.has(event.kind) || !uint.test(event.game_id) || !uint.test(event.block_number) ||
      !txHash.test(event.transaction_hash) || !Number.isSafeInteger(event.log_index) || event.log_index < 0 ||
      typeof event.id !== 'string' || !Number.isSafeInteger(event.round) || event.round < 0) throw new Error('INVALID_CHAIN_EVENT');
  const data = {};
  if (event.kind === 'round-resolved') {
    data.choices = (event.data?.choices ?? []).map((choice) => {
      if (!address.test(choice.wallet_address) || !['Share', 'Steal', 'Catch'].includes(choice.choice) ||
          typeof choice.defaulted !== 'boolean' || typeof choice.eliminated !== 'boolean') throw new Error('INVALID_CHAIN_EVENT');
      return { wallet_address: choice.wallet_address, choice: choice.choice, defaulted: choice.defaulted, eliminated: choice.eliminated };
    });
    if (event.data?.remaining_players !== undefined) data.remaining_players = event.data.remaining_players;
  }
  if (event.kind === 'completed') {
    data.awards = (event.data?.awards ?? []).map((award) => {
      if (!address.test(award.wallet_address) || !uint.test(award.award_wei)) throw new Error('INVALID_CHAIN_EVENT');
      return { wallet_address: award.wallet_address, award_wei: award.award_wei };
    });
  }
  if (['claimed', 'refunded', 'joined'].includes(event.kind) && event.data?.wallet_address !== undefined) {
    if (!address.test(event.data.wallet_address)) throw new Error('INVALID_CHAIN_EVENT');
    data.wallet_address = event.data.wallet_address;
  }
  if (event.data?.amount_wei !== undefined && ['claimed', 'refunded', 'joined'].includes(event.kind)) {
    if (!uint.test(event.data.amount_wei)) throw new Error('INVALID_CHAIN_EVENT');
    data.amount_wei = event.data.amount_wei;
  }
  return { id: event.id, game_id: event.game_id, round: event.round, kind: event.kind,
    block_number: event.block_number, transaction_hash: event.transaction_hash, log_index: event.log_index, data };
}

function sortEvents(events) {
  return events.sort((a, b) => BigInt(a.block_number) < BigInt(b.block_number) ? -1 : BigInt(a.block_number) > BigInt(b.block_number) ? 1 : a.log_index - b.log_index);
}

export function createConferenceRunner({ config, runtimeDir, chain, agents, launcher, phaseExecutor, spectator,
  launcherTimeoutMs, now = Date.now }) {
  if (!path.isAbsolute(runtimeDir ?? '') || config?.chain_id !== 84532 || !Array.isArray(config.roster) || config.roster.length < 2) {
    throw new TypeError('Invalid conference runner configuration.');
  }
  for (const [adapter, method] of [[chain, 'readSnapshot'], [chain, 'readEvents'], [agents, 'dispatch'], [launcher, 'create'], [phaseExecutor, 'advance']]) {
    if (typeof adapter?.[method] !== 'function') throw new TypeError(`Missing adapter method ${method}.`);
  }
  if (config.mode === 'live' && typeof chain.readBlockHash !== 'function') throw new TypeError('Live runner requires chain.readBlockHash.');
  const stopAt = Date.parse(config.stop_time);
  const startAt = Date.parse(config.start_time);
  if (!Number.isFinite(stopAt) || !Number.isFinite(startAt) || stopAt <= startAt) throw new TypeError('Invalid run schedule.');
  const limits = {
    agent: config.agent_timeout_ms ?? 45_000,
    adapter: config.adapter_timeout_ms ?? 15_000,
    launcher: launcherTimeoutMs ?? config.adapter_timeout_ms ?? 15_000,
    spectator: config.spectator_timeout_ms ?? 5_000
  };
  for (const value of Object.values(limits)) if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('Timeouts must be positive integers.');
  if (limits.launcher > 2 ** 31 - 1) throw new TypeError('Launcher timeout exceeds timer range.');
  const store = createDurableStore({ directory: path.join(runtimeDir, 'coordinator') });
  const logs = new Map();
  let state = { snapshot: null, events: [], game_ids: [], completed_game_ids: [], cancelled_game_ids: [],
    messages: { openclaw: [], hermes: [] }, health: [], scheduling: { status: 'blocked', next_game_at: null }, updated_at: null };
  let metadata = { cursor: config.start_block, seen_games: [], terminal_games: {}, intermissions: {} };
  let initialized = false;
  let initializing;
  let running;
  let release;
  let closed = false;
  let publishInFlight = null;
  const issues = new Map();
  const issueKey = (code, extra) => `${code}:${extra.seat_id ?? ''}:${extra.game_id ?? ''}`;
  function flag(code, extra = {}) { issues.set(issueKey(code, extra), { code, ...extra }); }
  function clear(code, extra = {}) { issues.delete(issueKey(code, extra)); }
  const stamp = () => new Date(now()).toISOString();
  const readSnapshot = async (options) => {
    const snapshot = projectSnapshot(await bounded(() => chain.readSnapshot(options), limits.adapter, 'CHAIN_TIMEOUT'), config);
    const checkpoint = metadata.confirmed_head;
    if (checkpoint) {
      if (BigInt(snapshot.block_number) < BigInt(checkpoint.block_number)) throw new Error('CHAIN_HEAD_REGRESSED');
      if (snapshot.block_number === checkpoint.block_number) {
        if (snapshot.block_hash.toLowerCase() !== checkpoint.block_hash.toLowerCase()) throw new Error('CONFIRMED_CHAIN_REORG');
      } else if (typeof chain.readBlockHash === 'function') {
        const canonical = await bounded(() => chain.readBlockHash({ blockNumber: checkpoint.block_number }), limits.adapter, 'CHAIN_HASH_TIMEOUT');
        if (typeof canonical !== 'string' || canonical.toLowerCase() !== checkpoint.block_hash.toLowerCase()) throw new Error('CONFIRMED_CHAIN_REORG');
      }
    }
    return snapshot;
  };
  const core = createOrchestratorCore({
    store,
    readChainSnapshot: async () => {
      const snapshot = await readSnapshot();
      state.snapshot = snapshot;
      if (snapshot.phase === 'idle') throw new Error('CHAIN_BECAME_IDLE');
      return coreSnapshot(snapshot);
    },
    requestAdvance: (intent) => bounded(() => phaseExecutor.advance(intent), limits.adapter, 'PHASE_TIMEOUT')
  });

  async function persist() {
    state.health = [...issues.values()];
    state.updated_at = stamp();
    await store.set('conference', { schema_version: 1, metadata, state });
  }

  async function gameLog(gameId) {
    if (!logs.has(gameId)) {
      const pending = (async () => {
        const log = new TeamLogStore({ runtimeRoot: runtimeDir, gameId, seats: config.roster,
          limits: { maxMessageChars: 200 }, clock: () => new Date(now()) });
        await log.initialize();
        return log;
      })();
      // Reserve before awaiting initialization: all seats must share the same
      // append queue when the first snapshot of a new game arrives concurrently.
      logs.set(gameId, pending);
      pending.catch(() => { if (logs.get(gameId) === pending) logs.delete(gameId); });
    }
    return logs.get(gameId);
  }

  async function refreshMessages() {
    const messages = { openclaw: [], hermes: [] };
    for (const gameId of metadata.seen_games) {
      const log = await gameLog(gameId);
      for (const team of ['openclaw', 'hermes']) {
        const seat = config.roster.find((candidate) => candidate.team === team);
        if (seat) messages[team].push(...(await log.buildSnapshot(seat)).messages);
      }
    }
    for (const team of Object.keys(messages)) messages[team] = messages[team].slice(-100);
    state.messages = messages;
  }

  async function refresh() {
    const snapshot = await readSnapshot();
    if (BigInt(snapshot.block_number) < BigInt(metadata.cursor) - 1n) throw new Error('CHAIN_HEAD_REGRESSED');
    let newEvents = [];
    if (BigInt(metadata.cursor) <= BigInt(snapshot.block_number)) {
      const result = await bounded(() => chain.readEvents({ fromBlock: metadata.cursor, toBlock: snapshot.block_number }), limits.adapter, 'CHAIN_EVENTS_TIMEOUT');
      if (!Array.isArray(result)) throw new Error('INVALID_CHAIN_EVENTS');
      newEvents = result.map(projectEvent).filter((event) => BigInt(event.block_number) >= BigInt(config.start_block) && BigInt(event.block_number) <= BigInt(snapshot.block_number));
    }
    const events = new Map(state.events.map((event) => [event.id, event]));
    for (const event of newEvents) {
      if (events.has(event.id) && JSON.stringify(events.get(event.id)) !== JSON.stringify(event)) throw new Error('CONFIRMED_EVENT_CONFLICT');
      events.set(event.id, event);
    }
    state.events = sortEvents([...events.values()]);
    state.snapshot = snapshot;
    metadata.cursor = (BigInt(snapshot.block_number) + 1n).toString();
    metadata.confirmed_head = { block_number: snapshot.block_number, block_hash: snapshot.block_hash };
    for (const event of state.events) {
      if (['completed', 'cancelled'].includes(event.kind) && !metadata.terminal_games[event.game_id]) metadata.terminal_games[event.game_id] = { settled: false };
    }
    if (snapshot.game_id !== '0' && !metadata.seen_games.includes(snapshot.game_id)) metadata.seen_games.push(snapshot.game_id);
    if (snapshot.phase === 'terminal' && !metadata.terminal_games[snapshot.game_id]) metadata.terminal_games[snapshot.game_id] = { settled: false };
    state.game_ids = [...new Set(state.events.filter((event) => event.kind === 'created').map((event) => event.game_id))];
    const inRun = new Set(state.game_ids);
    state.completed_game_ids = [...new Set(state.events.filter((event) => event.kind === 'completed' && inRun.has(event.game_id)).map((event) => event.game_id))];
    state.cancelled_game_ids = [...new Set(state.events.filter((event) => event.kind === 'cancelled' && inRun.has(event.game_id)).map((event) => event.game_id))];
    clear('CHAIN_UNAVAILABLE');
    clear('CONFIRMED_CHAIN_REORG');
    await reconcile(snapshot);
    await persist();
    return snapshot;
  }

  function playerFor(snapshot, seat) { return snapshot.players.find((player) => player.wallet_address?.toLowerCase() === seat.wallet_address.toLowerCase()); }
  function actionObserved(snapshot, record) {
    if (snapshot.game_id !== record.game_id) return false;
    const seat = config.roster.find((candidate) => candidate.seat_id === record.seat_id);
    const player = seat && playerFor(snapshot, seat);
    if (!player) return false;
    if (record.action === 'join') return player.joined;
    if (record.action === 'commit') return snapshot.round === record.round && player.committed;
    if (record.action === 'reveal') return snapshot.round === record.round && player.revealed;
    if (record.action === 'claim') return !isPayable(snapshot, player);
    return false;
  }

  async function reconcile(snapshot) {
    for (const { key, value } of await store.entries('dispatch:')) {
      if (value.state !== 'chain-confirmed' && actionObserved(snapshot, value)) {
        await store.set(key, { ...value, state: 'chain-confirmed', confirmed_block: snapshot.block_number });
        clear('AGENT_ACTION_UNCERTAIN', { seat_id: value.seat_id, game_id: value.game_id });
        clear('AGENT_DISPATCH_EXPIRED', { seat_id: value.seat_id, game_id: value.game_id });
        clear('AGENT_REPORTED_ERROR', { seat_id: value.seat_id, game_id: value.game_id });
      } else if (snapshot.game_id === value.game_id && ['reserved', 'unknown', 'rejected-before-submit'].includes(value.state) && value.action !== 'claim' &&
          (snapshot.phase === 'terminal' || snapshot.round > value.round ||
           (value.action === 'join' && snapshot.phase !== 'join') ||
           (['commit', 'discussion'].includes(value.action) && snapshot.phase === 'reveal'))) {
        // A past action can no longer be retried. This is deliberately not called
        // confirmed: authoritative round events retain any timeout/default.
        await store.set(key, { ...value, state: 'phase-ended', observed_block: snapshot.block_number });
        clear('AGENT_ACTION_UNCERTAIN', { seat_id: value.seat_id, game_id: value.game_id });
        clear('AGENT_DISPATCH_EXPIRED', { seat_id: value.seat_id, game_id: value.game_id });
      }
    }
    for (const { key, value } of await store.entries('launch:')) {
      if (value.state !== 'chain-confirmed' && BigInt(snapshot.game_id) > BigInt(value.previous_game_id)) {
        await store.set(key, { ...value, state: 'chain-confirmed', game_id: snapshot.game_id });
        clear('LAUNCH_UNCERTAIN'); clear('LAUNCH_PENDING'); clear('LAUNCH_REJECTED');
      }
    }
    const phaseActions = await store.entries('action:');
    const unresolvedCurrent = phaseActions.some(({ value }) =>
      value.intent.game_id === snapshot.game_id && value.intent.round === snapshot.round && value.intent.phase === snapshot.phase &&
      ['reserved', 'submission-unknown'].includes(value.state));
    if (!unresolvedCurrent) {
      clear('PHASE_ADVANCE_UNCERTAIN', { game_id: snapshot.game_id });
      clear('PHASE_ADVANCE_REJECTED', { game_id: snapshot.game_id });
    }
  }

  async function initialize() {
    if (closed) throw new Error('RUNNER_CLOSED');
    if (initialized) return clone(state);
    if (initializing) return initializing;
    initializing = (async () => {
      await fs.mkdir(runtimeDir, { recursive: true, mode: 0o700 });
      const actualDir = await fs.realpath(runtimeDir);
      const repository = await fs.realpath(fileURLToPath(new URL('../../../../', import.meta.url)));
      const relative = path.relative(repository, actualDir);
      if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('RUNTIME_MUST_BE_OUTSIDE_REPOSITORY');
      release = await acquireRunnerLock(runtimeDir);
      try {
        // Configuration identity prevents accidental reuse of a pilot or another
        // network/run's counters and transaction intents.
        const identity = hash({ run_id: config.run_id, mode: config.mode, chain_id: config.chain_id,
          game_address: config.game_address.toLowerCase(), start_block: config.start_block,
          roster: config.roster.map(({ seat_id, team, agent_id, wallet_address }) => ({ seat_id, team, agent_id, wallet_address: wallet_address.toLowerCase() })) });
        const savedIdentity = await store.putIfAbsent('identity', { fingerprint: identity });
        if (savedIdentity.value.fingerprint !== identity) throw new Error('RUNTIME_IDENTITY_MISMATCH');
        const saved = await store.get('conference');
        if (saved) {
          if (saved.schema_version !== 1) throw new Error('INVALID_RUNNER_STATE');
          state = saved.state; metadata = saved.metadata;
          for (const issue of state.health) flag(issue.code, Object.fromEntries(Object.entries(issue).filter(([key]) => key !== 'code')));
        }
        await refresh();
        if (!['idle', 'terminal'].includes(state.snapshot.phase)) await core.resume();
        await refreshMessages();
        await updateScheduling();
        await persist();
        initialized = true;
        return clone(state);
      } catch (error) {
        await release(); release = undefined;
        throw error;
      }
    })();
    try { return await initializing; } finally { initializing = undefined; }
  }

  async function dispatch(seat, snapshot, action, phaseSignal) {
    const requestId = `conference:${hash([config.run_id, config.game_address.toLowerCase(), snapshot.game_id, snapshot.round, action, seat.seat_id]).slice(0, 32)}`;
    const key = `dispatch:${requestId}`;
    const existing = await store.get(key);
    if (existing && existing.state !== 'rejected-before-submit') {
      if (existing.state === 'reserved' || existing.state === 'unknown') flag('AGENT_ACTION_UNCERTAIN', { seat_id: seat.seat_id, game_id: snapshot.game_id });
      return existing.state;
    }
    const log = await gameLog(snapshot.game_id);
    const teamChat = await log.buildSnapshot(seat);
    const request = action === 'discussion' ? {
      schema_version: 1, type: 'discussion', request_id: requestId, game_id: snapshot.game_id, round: snapshot.round,
      phase: 'commit', seat_id: seat.seat_id, team: seat.team, chain_state: snapshot, team_chat: teamChat, max_message_chars: 200
    } : {
      request_id: requestId, game_id: snapshot.game_id, round: snapshot.round, phase: action, seat_id: seat.seat_id, team: seat.team,
      chain_state: snapshot, team_chat: teamChat, requested_action: action, response_schema_version: 1
    };
    if (!existing && action !== 'discussion') await core.recordRequest(request);
    const retryRecord = existing && clone(existing);
    if (retryRecord) {
      delete retryRecord.code;
      delete retryRecord.ambiguous;
      delete retryRecord.retryable;
      delete retryRecord.rejected_at;
    }
    const record = retryRecord ? { ...retryRecord, state: 'reserved', attempt_count: (existing.attempt_count ?? 1) + 1,
      last_attempted_at: stamp() } : { request_id: requestId, game_id: snapshot.game_id, round: snapshot.round, seat_id: seat.seat_id,
      action, state: 'reserved', requested_at: stamp(), attempt_count: 1 };
    if (existing) await store.set(key, record);
    else {
      const reservation = await store.putIfAbsent(key, record);
      if (!reservation.inserted) return reservation.value.state;
    }
    try {
      const deadlineAtMs = now() + limits.agent;
      const raw = await dispatchWithDeadline(({ deadline_at_ms, signal }) => agents.dispatch({
        seat: clone(seat), request: clone(request), deadline_at_ms, signal
      }), limits.agent, deadlineAtMs, phaseSignal);
      let response;
      if (action === 'discussion') {
        response = discussionToLogResponse(raw, request);
        if (response.status !== 'observed' || typeof response.team_message !== 'string' || !response.team_message.trim()) {
          throw new Error('DISCUSSION_MESSAGE_REQUIRED');
        }
      }
      else {
        response = parseAndValidateResponse(raw);
        assertResponseIdentity(request, response);
      }
      // Preserve agent words only through the validated TeamLogStore; arbitrary
      // provider error messages never become coordinator records.
      const safe = { ...response };
      if (safe.error) safe.error = { code: safePlayerErrorCode(safe.error.code), message: 'Agent reported an execution error.' };
      const accepted = await log.acceptResponse(safe, { ...request, phase: action === 'discussion' ? 'commit' : action });
      if (!accepted.accepted && accepted.reason !== 'DUPLICATE_REQUEST') throw new Error('AGENT_RESPONSE_REJECTED');
      // The reused append journal recovers torn lines; flush it and its derived
      // files before durably acknowledging receipt to survive a power loss.
      for (const file of [log.paths.journal, log.paths[seat.team], log.paths.ledger]) {
        const handle = await fs.open(file, 'r');
        try { await handle.sync(); } finally { await handle.close(); }
      }
      if (action !== 'discussion') {
        const acknowledgement = { ...safe };
        delete acknowledgement.team_message;
        await core.recordResponse(acknowledgement);
      }
      await store.set(key, { ...record, state: 'acknowledged', status: safe.status,
        ...(safe.error ? { error_code: safe.error.code } : {}),
        ...(safe.transaction_hash ? { transaction_hash: safe.transaction_hash } : {}) });
      clear('AGENT_DISPATCH_EXPIRED', { seat_id: seat.seat_id, game_id: snapshot.game_id });
      if (safe.status === 'error') flag('AGENT_REPORTED_ERROR', { seat_id: seat.seat_id, game_id: snapshot.game_id });
      return 'acknowledged';
    } catch (error) {
      if (isRejectedBeforeSubmit(error)) {
        const code = ['MARITIME_DISPATCH_EXPIRED', 'MARITIME_ONE_AWAKE_RECONCILIATION_REQUIRED'].includes(error.code)
          ? error.code : 'MARITIME_DISPATCH_EXPIRED';
        await store.set(key, { ...record, state: 'rejected-before-submit', code,
          ambiguous: false, retryable: true, rejected_at: stamp() });
        flag('AGENT_DISPATCH_EXPIRED', { seat_id: seat.seat_id, game_id: snapshot.game_id });
        return 'rejected-before-submit';
      }
      const diagnosticCode = error?.code === 'MARITIME_AGENT_RESPONSE_INVALID'
        ? safePlayerErrorCode(error.diagnostic_code, null) : null;
      const transportCode = safeMaritimeErrorCode(error?.transport_code, safeMaritimeErrorCode(error?.code));
      const transportDiagnostic = safeMaritimeDiagnosticCode(error?.diagnostic_code);
      await store.set(key, { ...record, state: 'unknown',
        ...(diagnosticCode ? { error_code: diagnosticCode } : {}),
        ...(transportCode ? { transport_code: transportCode } : {}),
        ...(transportDiagnostic ? { diagnostic_code: transportDiagnostic } : {}) });
      clear('AGENT_DISPATCH_EXPIRED', { seat_id: seat.seat_id, game_id: snapshot.game_id });
      flag('AGENT_ACTION_UNCERTAIN', { seat_id: seat.seat_id, game_id: snapshot.game_id });
      return 'unknown';
    }
  }

  async function updateScheduling() {
    const snapshot = state.snapshot;
    if (snapshot && !['idle', 'terminal'].includes(snapshot.phase)) {
      state.scheduling = { status: 'playing', next_game_at: null };
      return;
    }
    if (now() >= stopAt) {
      state.scheduling = { status: 'stopped', next_game_at: null };
      return;
    }
    if (!snapshot) { state.scheduling = { status: 'blocked', next_game_at: null }; return; }
    const previous = snapshot.game_id;
    const actionId = `launch:${hash([config.run_id, config.game_address.toLowerCase(), previous])}`;
    const launch = await store.get(`launch:${actionId}`);
    if (launch && !['rejected-before-submit', 'confirmed-revert', 'chain-confirmed'].includes(launch.state)) {
      flag(launch.state === 'accepted' ? 'LAUNCH_PENDING' : 'LAUNCH_UNCERTAIN');
      state.scheduling = { status: 'blocked', next_game_at: null };
      return;
    }
    if (!metadata.intermissions[previous]) {
      metadata.intermissions[previous] = new Date(Math.max(startAt, snapshot.phase === 'terminal' ? now() + (config.intermission_ms ?? 20_000) : now())).toISOString();
    }
    state.scheduling = { status: 'intermission', next_game_at: metadata.intermissions[previous] };
  }

  async function maybeLaunch() {
    await updateScheduling();
    if (state.scheduling.status !== 'intermission' || now() < Date.parse(state.scheduling.next_game_at) || now() >= stopAt) return;
    // Always refresh immediately before reserving a launcher request.
    const current = await refresh();
    if (!['idle', 'terminal'].includes(current.phase)) { await updateScheduling(); return; }
    const actionId = `launch:${hash([config.run_id, config.game_address.toLowerCase(), current.game_id])}`;
    const key = `launch:${actionId}`;
    const prior = await store.get(key);
    if (prior && !['rejected-before-submit', 'confirmed-revert'].includes(prior.state)) {
      flag(prior.state === 'accepted' ? 'LAUNCH_PENDING' : 'LAUNCH_UNCERTAIN');
      state.scheduling = { status: 'blocked', next_game_at: null };
      return;
    }
    if (prior && BigInt(prior.source_block_number) >= BigInt(current.block_number)) return;
    const intent = { action_id: actionId, source_block_number: current.block_number };
    const record = { ...intent, previous_game_id: current.game_id, state: 'reserved', requested_at: stamp() };
    await store.set(key, record);
    try {
      const outcome = await bounded(() => launcher.create(intent), limits.launcher, 'LAUNCH_TIMEOUT');
      if (!['accepted', 'confirmed-revert', 'race-or-revert', 'rejected-before-submit'].includes(outcome?.status) ||
        (outcome.reference && (outcome.reference.kind !== 'transaction-hash' || !txHash.test(outcome.reference.value)))) throw new Error('INVALID_LAUNCH_OUTCOME');
      await store.set(key, { ...record, state: outcome.status,
        ...(outcome.reference ? { reference: { kind: 'transaction-hash', value: outcome.reference.value } } : {}) });
      if (outcome.status !== 'accepted') flag(outcome.status === 'race-or-revert' ? 'LAUNCH_UNCERTAIN' : 'LAUNCH_REJECTED');
    } catch {
      await store.set(key, { ...record, state: 'unknown' });
      flag('LAUNCH_UNCERTAIN');
    }
    await refresh();
    await updateScheduling();
  }

  async function advance() {
    if (['idle', 'terminal'].includes(state.snapshot.phase)) return;
    const result = await core.advanceIfEligible();
    if (result.status === 'manual-reconciliation-required') flag('PHASE_ADVANCE_UNCERTAIN', { game_id: state.snapshot.game_id });
    else if (result.status === 'advance-rejected') flag('PHASE_ADVANCE_REJECTED', { game_id: state.snapshot.game_id });
    if (result.status === 'advance-requested') await refresh();
  }

  function watchDiscussionPhase(initial) {
    const controller = new AbortController();
    let stopped = false;
    let timer;
    let failure;
    const check = async () => {
      try {
        const current = await readSnapshot();
        if (stopped) return;
        // Use the authoritative block clock, not an estimated seconds-per-block
        // deadline. One watcher covers every active or queued discussion seat.
        if (current.game_id !== initial.game_id || current.round !== initial.round || current.phase !== initial.phase ||
            current.clock?.deadline !== initial.clock.deadline || evaluateChainSnapshot(coreSnapshot(current)).eligible) {
          controller.abort();
        }
      } catch (error) {
        if (!stopped) { failure = error; controller.abort(); }
      } finally {
        if (!stopped && !controller.signal.aborted) timer = setTimeout(check, 1000);
      }
    };
    timer = setTimeout(check, 1000);
    return {
      signal: controller.signal,
      get failure() { return failure; },
      stop() { stopped = true; clearTimeout(timer); }
    };
  }

  async function play() {
    let snapshot = state.snapshot;
    if (['idle', 'terminal'].includes(snapshot.phase)) return;
    if (evaluateChainSnapshot(coreSnapshot(snapshot)).eligible) { await advance(); return; }
    if (snapshot.phase === 'join') {
      await Promise.all(config.roster.filter((seat) => !playerFor(snapshot, seat)?.joined).map((seat) => dispatch(seat, snapshot, 'join')));
    } else if (snapshot.phase === 'commit') {
      const living = config.roster.filter((seat) => playerFor(snapshot, seat)?.alive);
      const phase = watchDiscussionPhase(snapshot);
      let discussionStates;
      try { discussionStates = await Promise.all(living.map((seat) => dispatch(seat, snapshot, 'discussion', phase.signal))); }
      finally { phase.stop(); }
      if (phase.failure) throw phase.failure;
      const afterDiscussion = await refresh();
      // Discussion consumes the live block deadline. Never send a stale commit.
      if (afterDiscussion.game_id !== snapshot.game_id || afterDiscussion.round !== snapshot.round || afterDiscussion.phase !== 'commit') return;
      snapshot = afterDiscussion;
      if (evaluateChainSnapshot(coreSnapshot(snapshot)).eligible) { await advance(); return; }
      // Every living player must have a durably accepted strategy message before
      // committing. Unknown or rejected discussions must not silently disappear.
      if (discussionStates.some(status => status !== 'acknowledged')) return;
      await Promise.all(config.roster.filter((seat) => {
        const player = playerFor(snapshot, seat); return player?.alive && !player.committed;
      }).map((seat) => dispatch(seat, snapshot, 'commit')));
    } else if (snapshot.phase === 'reveal') {
      await Promise.all(config.roster.filter((seat) => {
        const player = playerFor(snapshot, seat); return player?.alive && player.committed && !player.revealed;
      }).map((seat) => dispatch(seat, snapshot, 'reveal')));
    }
    await refresh();
    await advance();
  }

  function isPayable(snapshot, player) {
    if (!player.joined) return false;
    return snapshot.outcome === 'cancelled'
      ? BigInt(player.refunded_wei ?? '0') < BigInt(snapshot.config.entryFeeWei ?? '0')
      : BigInt(player.award_wei ?? '0') > BigInt(player.claimed_wei ?? '0');
  }

  async function settle() {
    if (!['idle', 'terminal'].includes(state.snapshot.phase)) return;
    const outstanding = Object.entries(metadata.terminal_games).filter(([, record]) => !record.settled);
    if (!outstanding.length) return;
    // One historical game per idle tick, round-robin. Finish this work before
    // launching so claims cannot consume the next game's join/commit/reveal time.
    const index = (metadata.settlement_index ?? 0) % outstanding.length;
    metadata.settlement_index = index + 1;
    for (const [gameId, record] of [outstanding[index]]) {
      let snapshot;
      try { snapshot = state.snapshot.game_id === gameId ? state.snapshot : await readSnapshot({ gameId }); }
      catch { flag('CLAIM_READ_UNAVAILABLE', { game_id: gameId }); continue; }
      if (snapshot.phase !== 'terminal') continue;
      clear('CLAIM_READ_UNAVAILABLE', { game_id: gameId });
      if (!metadata.seen_games.includes(gameId)) metadata.seen_games.push(gameId);
      await reconcile(snapshot);
      const payable = config.roster.filter((seat) => { const player = playerFor(snapshot, seat); return player && isPayable(snapshot, player); });
      record.settled = payable.length === 0;
      record.last_checked_block = snapshot.block_number;
      await Promise.all(payable.map((seat) => dispatch(seat, snapshot, 'claim')));
    }
  }

  async function publish() {
    if (!spectator?.publish) return;
    if (!publishInFlight) {
      const pending = Promise.resolve().then(() => spectator.publish(clone({ messages: state.messages, events: state.events, snapshot: state.snapshot })));
      publishInFlight = pending;
      pending.then(() => { if (publishInFlight === pending) publishInFlight = null; }, () => { if (publishInFlight === pending) publishInFlight = null; });
    }
    const currentPublish = publishInFlight;
    try { await bounded(() => currentPublish, limits.spectator, 'SPECTATOR_TIMEOUT'); clear('SPECTATOR_UNAVAILABLE'); }
    catch { flag('SPECTATOR_UNAVAILABLE'); }
    if (typeof spectator.health === 'function') {
      // The mirror's own health entries are not blindly copied into public state.
      try {
        const health = await bounded(() => spectator.health(), limits.spectator, 'SPECTATOR_TIMEOUT');
        if (health?.ok === false || (Array.isArray(health) && health.length)) flag('SPECTATOR_UNAVAILABLE');
      } catch { flag('SPECTATOR_UNAVAILABLE'); }
    }
  }

  function tick() {
    if (closed) return Promise.reject(new Error('RUNNER_CLOSED'));
    if (running) return running;
    running = (async () => {
      await initialize();
      try {
        await refresh();
        await play();
        await settle();
        await maybeLaunch();
        await refreshMessages();
        await updateScheduling();
      } catch (error) {
        flag('CHAIN_UNAVAILABLE');
        if (error?.message === 'CONFIRMED_CHAIN_REORG') flag('CONFIRMED_CHAIN_REORG');
        state.scheduling = { status: 'blocked', next_game_at: null };
      }
      await publish();
      await persist();
      return clone(state);
    })().finally(() => { running = undefined; });
    return running;
  }

  async function close() {
    if (closed) return;
    closed = true;
    await initializing?.catch(() => {});
    await running?.catch(() => {});
    if (release) { await release(); release = undefined; }
  }

  return Object.freeze({ initialize, tick, getState: () => clone(state), close });
}
