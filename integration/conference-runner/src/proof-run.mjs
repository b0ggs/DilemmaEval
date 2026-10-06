import { lstat, open, readFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createConferenceRunner } from './runner/index.mjs';
import { safeMaritimeErrorCode, safeMaritimeDiagnosticCode } from './maritime/transport.mjs';
import { validateGameplayResponse } from './maritime/protocol.mjs';
import { createGuardedLauncher, validatePreparedProof } from './proof-control.mjs';
import { createProofDispatchJournal, writeProofReport } from '../../../conference/operations/saved-helpers/proof-dispatch-journal.mjs';

const HASH = /^0x[0-9a-fA-F]{64}$/;
const UINT = /^(0|[1-9][0-9]*)$/;
const BAD_DISPATCH = new Set(['agent-error', 'ambiguous', 'cancelled-after-submit', 'rejected-before-submit']);
const fixedError = (code, ambiguous = false) => Object.assign(new Error(code), { code, ambiguous, retryable: false });

async function mustNotExist(filename) {
  try { await lstat(filename); }
  catch (error) { if (error.code === 'ENOENT') return; throw fixedError('PROOF_RUN_PATH_UNAVAILABLE'); }
  throw fixedError('PROOF_RUN_ALREADY_STARTED');
}

function snapshotSummary(snapshot) {
  if (!snapshot || !UINT.test(snapshot.game_id ?? '') || !UINT.test(snapshot.active_game_id ?? '') ||
      !UINT.test(snapshot.block_number ?? '') || !HASH.test(snapshot.block_hash ?? '') ||
      !['idle', 'join', 'commit', 'reveal', 'terminal'].includes(snapshot.phase)) throw fixedError('PROOF_RUN_SNAPSHOT_INVALID');
  return { game_id: snapshot.game_id, active_game_id: snapshot.active_game_id,
    phase: snapshot.phase, outcome: ['completed', 'cancelled'].includes(snapshot.outcome) ? snapshot.outcome : null,
    block_number: snapshot.block_number, block_hash: snapshot.block_hash,
    players: Array.isArray(snapshot.players) ? snapshot.players.filter(player => player.joined === true).length : 0 };
}

function publicSpectatorHealth(value, config) {
  const pending = value?.pending ?? 0, inflight = value?.inflight ?? 0;
  if (!Number.isSafeInteger(pending) || pending < 0 || !Number.isSafeInteger(inflight) || inflight < 0) throw fixedError('PROOF_SPECTATOR_HEALTH_INVALID');
  const pins = value?.scoreboard?.pins;
  const scoreboardReady = value?.scoreboard === undefined || value.scoreboard.ok === true &&
    pins && Object.keys(pins).length === 2 && Object.values(pins).every(pin => pin?.status === 'sent');
  let scoreboard;
  if (value?.scoreboard !== undefined) {
    const score = value.scoreboard;
    const teams = ['openclaw', 'hermes'];
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(score?.series_id ?? '') || typeof score.first_game_id !== 'string' || !/^[1-9][0-9]*$/.test(score.first_game_id) ||
        ![score.completed, score.ties, ...teams.map(team => score.wins?.[team])].every(count => Number.isSafeInteger(count) && count >= 0) ||
        !teams.every(team => typeof score.awards_wei?.[team] === 'string' && UINT.test(score.awards_wei[team]) &&
          typeof score.pins?.[team]?.chat_id === 'string' && /^-\d+$/.test(score.pins[team].chat_id) &&
          score.pins[team].chat_id === config.telegram?.[team]?.chat_id &&
          Number.isSafeInteger(score.pins[team].message_id) && score.pins[team].message_id > 0 &&
          ['sent', 'pending', 'inflight', 'rejected'].includes(score.pins[team].status)) ||
        score.pins.openclaw.chat_id === score.pins.hermes.chat_id) throw fixedError('PROOF_SCOREBOARD_HEALTH_INVALID');
    scoreboard = { ok: score.ok === true, series_id: score.series_id, first_game_id: score.first_game_id,
      completed: score.completed, ties: score.ties,
      wins: Object.fromEntries(teams.map(team => [team, score.wins[team]])),
      awards_wei: Object.fromEntries(teams.map(team => [team, score.awards_wei[team]])),
      pins: Object.fromEntries(teams.map(team => [team, { chat_id: score.pins[team].chat_id,
        message_id: score.pins[team].message_id, status: score.pins[team].status }])) };
    for (const key of ['cancelled', 'defaulted_games']) if (Number.isSafeInteger(score[key]) && score[key] >= 0) scoreboard[key] = score[key];
  }
  return { ok: value?.ok === true, pending, inflight, scoreboard_ready: Boolean(scoreboardReady), ...(scoreboard ? { scoreboard } : {}) };
}

function terminalResult(state, gameId, config) {
  const selected = state.events.filter(event => event.game_id === gameId && ['completed', 'cancelled'].includes(event.kind));
  if (selected.length !== 1 || selected[0].kind !== state.snapshot.outcome) throw fixedError('PROOF_RESULT_EVENT_UNVERIFIED');
  const event = selected[0];
  if (!UINT.test(event.block_number ?? '') || !HASH.test(event.transaction_hash ?? '') ||
      !Number.isSafeInteger(event.log_index) || event.log_index < 0 || !Number.isSafeInteger(event.round) || event.round < 0) throw fixedError('PROOF_RESULT_EVENT_UNVERIFIED');
  const data = {};
  if (event.kind === 'completed') {
    const awards = event.data?.awards;
    const roster = new Set(config.roster.map(seat => seat.wallet_address.toLowerCase()));
    if (!Array.isArray(awards) || awards.length !== roster.size || new Set(awards.map(award => award.wallet_address?.toLowerCase())).size !== roster.size ||
        !awards.every(award => roster.has(award.wallet_address?.toLowerCase()) && typeof award.award_wei === 'string' && UINT.test(award.award_wei))) throw fixedError('PROOF_RESULT_AWARDS_UNVERIFIED');
    data.awards = awards.map(award => ({ wallet_address: award.wallet_address.toLowerCase(), award_wei: award.award_wei }));
  }
  return { game_id: gameId, outcome: state.snapshot.outcome, events: [{ kind: event.kind, game_id: gameId,
    round: event.round, block_number: event.block_number, transaction_hash: event.transaction_hash.toLowerCase(),
    log_index: event.log_index, data }] };
}

/** Execute one already prepared proof. This function never prepares or repairs a run. */
export async function runControlledProof({ proofOptions, agents, launcher, phaseExecutor, spectator,
  signal, now, pause = ms => delay(ms), createRunner = createConferenceRunner } = {}) {
  const clock = now ?? (typeof proofOptions?.now === 'function' ? proofOptions.now : Date.now);
  if (typeof clock !== 'function' || typeof pause !== 'function' || typeof createRunner !== 'function' ||
      typeof agents?.dispatch !== 'function' || typeof launcher?.create !== 'function' ||
      typeof phaseExecutor?.advance !== 'function' || typeof spectator?.publish !== 'function' ||
      typeof spectator?.health !== 'function') throw fixedError('PROOF_RUN_ADAPTER_REQUIRED');
  if (signal?.aborted) throw fixedError('PROOF_RUN_ABORTED');
  if ((proofOptions?.ownedProcesses ?? []).some(owner => owner.role !== 'operator')) throw fixedError('PROOF_RUN_UNEXPECTED_OWNERSHIP');
  const options = { ...proofOptions, now: clock };
  // No adapter capable of an external effect is called before this gate passes.
  const prepared = await validatePreparedProof({ ...options, readOnly: true });
  const debug = options.debug === true;
  const directory = prepared.bindings.directory;
  const runtimeDir = path.join(directory, 'runtime');
  const reportPath = path.join(directory, 'proof-run.json');
  await mustNotExist(runtimeDir);
  await mustNotExist(reportPath);
  const stamp = () => new Date(clock()).toISOString();
  const report = { schema_version: 1, type: debug ? 'controlled-debug-run' : 'controlled-proof-run', ...(debug ? { purpose: 'debug' } : {}), run_id: prepared.preparedConfig.run_id,
    started_at: stamp(), finished_at: null, status: 'starting', maximum_fresh_games: 1,
    launch_attempts: 0, creation: null, game_id: null, dispatches: [], phase_actions: [],
    runtime_evidence_sha256: prepared.bindings.runtime_evidence_sha256,
    candidate_proof_complete: false, proof_complete: false, awaiting_independent_audit: false,
    failure: null, final_chain: null, result: null, telegram: null, runner_stopped: false, pending_dispatches: 0,
    hard_stop_reached: false };
  // This exclusive initial file prevents a crash before creation from becoming
  // an accidental second execution or from replacing an existing report.
  const initial = await open(reportPath, 'wx', 0o600);
  try { await initial.writeFile(`${JSON.stringify(report, null, 2)}\n`); await initial.sync(); }
  finally { await initial.close(); }
  const directoryHandle = await open(directory, 'r');
  try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }

  let writes = Promise.resolve(), runner, guardedLauncher, creationStarted = false;
  const stopController = new AbortController();
  const deadlineController = new AbortController();
  const pendingDispatches = new Set();
  const pendingEffects = new Set();
  const trackedEffect = callback => {
    const task = Promise.resolve().then(callback);
    pendingEffects.add(task);
    task.then(() => pendingEffects.delete(task), () => pendingEffects.delete(task));
    return task;
  };
  const persist = () => {
    const pending = writes.then(() => writeProofReport(reportPath, report));
    writes = pending;
    return pending;
  };
  const stop = code => {
    report.failure ??= { code };
    report.status = 'stopped';
    stopController.abort();
  };
  const externalAbort = () => { stop('PROOF_RUN_ABORTED'); deadlineController.abort(); };
  signal?.addEventListener('abort', externalAbort, { once: true });
  const hardTimer = setTimeout(() => { report.hard_stop_reached = true; stop('PROOF_HARD_DEADLINE'); deadlineController.abort(); },
    Math.max(1, Math.min(options.hardStopAtMs - clock(), 2 ** 31 - 1)));

  function assertOpen() {
    const current = clock();
    if (!Number.isSafeInteger(current)) throw fixedError('PROOF_RUN_CLOCK_INVALID');
    if (current >= options.hardStopAtMs) { report.hard_stop_reached = true; stop('PROOF_HARD_DEADLINE'); deadlineController.abort(); }
    if (signal?.aborted || deadlineController.signal.aborted || stopController.signal.aborted) throw fixedError(report.failure?.code ?? 'PROOF_RUN_STOPPED');
  }

  function observeConfirmedGame(state) {
    const created = state.events.filter(event => event.kind === 'created' && UINT.test(event.game_id ?? ''));
    const createdIds = [...new Set(created.map(event => event.game_id))];
    if (created.length > 1 || report.game_id && createdIds.some(gameId => gameId !== report.game_id)) {
      stop('PROOF_MULTIPLE_GAMES_OBSERVED');
    } else if (!report.game_id && creationStarted && report.creation?.status === 'accepted' && createdIds.length === 1) {
      const reference = report.creation.reference;
      if (reference && created.some(event => event.transaction_hash?.toLowerCase() !== reference.value?.toLowerCase())) {
        stop('PROOF_GAME_IDENTITY_UNVERIFIED');
      } else report.game_id = createdIds[0];
    }
    if (report.game_id && state.snapshot.game_id !== report.game_id) stop('PROOF_GAME_IDENTITY_CHANGED');
  }

  // In-flight operations may return after a sibling fails. Keep their actual
  // outcomes until the absolute deadline, when unresolved outcomes are ambiguous.
  async function boundedCall(callback, code, { mutation = false, allowStopped = false, agentRequest } = {}) {
    if (!allowStopped) assertOpen();
    if (deadlineController.signal.aborted) throw fixedError(report.failure?.code ?? 'PROOF_HARD_DEADLINE', mutation);
    let onAbort;
    const aborted = new Promise((_, reject) => {
      onAbort = () => reject(fixedError(report.failure?.code ?? 'PROOF_HARD_DEADLINE', mutation));
      deadlineController.signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      return await Promise.race([Promise.resolve().then(callback).catch(error => {
        const known = error?.message === 'READINESS_REMOTE_GENERATION_UNATTESTED' ? error.message : code;
        const wrapped = fixedError(known, mutation && error?.ambiguous !== false);
        const transportCode = safeMaritimeErrorCode(error?.transport_code, safeMaritimeErrorCode(error?.code));
        const diagnosticCode = safeMaritimeDiagnosticCode(error?.diagnostic_code);
        if (transportCode) wrapped.transport_code = transportCode;
        if (diagnosticCode) wrapped.diagnostic_code = diagnosticCode;
        if (agentRequest && error?.cleanup_confirmed === true && error.completed_request_id === agentRequest.request_id) {
          wrapped.completed_request_id = agentRequest.request_id;
          wrapped.cleanup_confirmed = true;
        }
        if (agentRequest && error?.recovered_response) {
          try { wrapped.recovered_response = validateGameplayResponse(error.recovered_response, agentRequest); }
          catch { /* Never forward a malformed or mismatched recovery response. */ }
        }
        throw wrapped;
      }), aborted]);
    } finally { deadlineController.signal.removeEventListener('abort', onAbort); }
  }

  const journal = createProofDispatchJournal({ report, persist, stopController, now: clock, debug,
    adapter: { capacityManaged: agents.capacityManaged === true, dispatch: async args => {
      // Confirmation can first arrive inside tick's refresh, before play sends
      // its first request and before the outer loop receives that tick's state.
      observeConfirmedGame(runner.getState());
      assertOpen();
      if (!creationStarted || !report.game_id || args.request?.game_id !== report.game_id) throw fixedError('PROOF_GAME_IDENTITY_UNVERIFIED');
      const deadlineAt = Number.isSafeInteger(args.deadline_at_ms)
        ? Math.min(args.deadline_at_ms, options.hardStopAtMs) : options.hardStopAtMs;
      if (clock() >= deadlineAt) throw fixedError('MARITIME_DISPATCH_EXPIRED');
      return boundedCall(() => { assertOpen(); return agents.dispatch({ ...args, deadline_at_ms: deadlineAt,
        ...(args.on_admitted ? { on_admitted: async () => Math.min(await args.on_admitted(), options.hardStopAtMs) } : {}),
        signal: AbortSignal.any([stopController.signal, deadlineController.signal, ...(signal ? [signal] : []), ...(args.signal ? [args.signal] : [])])
      }); }, 'PROOF_AGENT_OPERATION_FAILED', { mutation: true, agentRequest: args.request });
    } } });
  const trackedAgents = { capacityManaged: journal.capacityManaged, dispatch: args => {
    const task = journal.dispatch(args);
    pendingDispatches.add(task);
    task.then(() => pendingDispatches.delete(task), () => pendingDispatches.delete(task));
    return task;
  } };
  const safeChain = Object.fromEntries(['readSnapshot', 'readEvents', 'readBlockHash'].filter(method => typeof options.chain?.[method] === 'function')
    .map(method => [method, (...args) => boundedCall(() => options.chain[method](...args), 'PROOF_CHAIN_READ_FAILED')]));
  const phaseRequests = new Set();
  const guardedPhase = { advance: intent => trackedEffect(async () => {
    observeConfirmedGame(runner.getState());
    assertOpen();
    if (!report.game_id || intent?.game_id !== report.game_id || phaseRequests.has(intent.action_id)) throw fixedError('PROOF_PHASE_IDENTITY_UNVERIFIED');
    phaseRequests.add(intent.action_id);
    const row = { game_id: report.game_id, round: Number.isSafeInteger(intent.round) ? intent.round : null,
      phase: ['join', 'commit', 'reveal'].includes(intent.phase) ? intent.phase : null,
      status: 'started', transaction_hash: null };
    report.phase_actions.push(row); await persist();
    try {
      const result = await boundedCall(() => { assertOpen(); return phaseExecutor.advance({ ...intent,
        not_after_ms: Math.min(options.hardStopAtMs, clock() + 20_000) }, {
        signal: AbortSignal.any([stopController.signal, deadlineController.signal, ...(signal ? [signal] : [])])
      }); }, 'PROOF_PHASE_UNCERTAIN', { mutation: true });
      row.status = result?.status === 'accepted' ? 'accepted' : result?.status === 'rejected-before-submit' ? 'rejected-before-submit' : 'ambiguous';
      if (result?.reference?.kind === 'transaction-hash' && HASH.test(result.reference.value ?? '')) row.transaction_hash = result.reference.value.toLowerCase();
      if (row.status !== 'accepted') stop('PROOF_PHASE_UNCERTAIN');
      await persist();
      return { status: row.status === 'ambiguous' ? 'race-or-revert' : row.status,
        ...(row.transaction_hash ? { reference: { kind: 'transaction-hash', value: row.transaction_hash } } : {}) };
    } catch { row.status = 'ambiguous'; stop('PROOF_PHASE_UNCERTAIN'); await persist(); throw fixedError('PROOF_PHASE_UNCERTAIN', true); }
  }) };
  const guardedSpectator = {
    publish: value => trackedEffect(() => boundedCall(() => spectator.publish(value), 'PROOF_SPECTATOR_UNCERTAIN', { mutation: true })),
    health: () => boundedCall(() => spectator.health(), 'PROOF_SPECTATOR_HEALTH_UNAVAILABLE')
  };
  const oneGameLauncher = { create: intent => trackedEffect(async () => {
    assertOpen();
    // Terminal settlement may tick the continuous runner again. Suppress its
    // subsequent launch request locally; never make a second operator call.
    if (creationStarted) return { status: 'rejected-before-submit' };
    if (!guardedLauncher || clock() >= options.stopNewGamesAtMs) throw fixedError('PROOF_LAUNCH_WINDOW_CLOSED');
    creationStarted = true;
    report.launch_attempts = 1;
    await persist();
    try {
      const result = await boundedCall(() => guardedLauncher.create(intent), 'PROOF_CREATION_UNCERTAIN', { mutation: true });
      report.creation = result;
      if (result.status !== 'accepted') stop('PROOF_CREATION_UNCERTAIN');
      await persist();
      return result;
    } catch (error) {
      const code = error?.message === 'READINESS_REMOTE_GENERATION_UNATTESTED' ? error.message : 'PROOF_CREATION_UNCERTAIN';
      stop(code); await persist(); throw fixedError(code, true);
    }
  }) };

  try {
    assertOpen();
    runner = createRunner({ config: prepared.preparedConfig, runtimeDir, now: clock,
      launcherTimeoutMs: Math.max(1, Math.min(2 ** 31 - 1, options.stopNewGamesAtMs - clock(), options.hardStopAtMs - clock())),
      chain: safeChain, agents: trackedAgents, launcher: oneGameLauncher, phaseExecutor: guardedPhase, spectator: guardedSpectator });
    await boundedCall(() => runner.initialize(), 'PROOF_RUNNER_INITIALIZATION_FAILED');
    const owner = JSON.parse(await readFile(path.join(runtimeDir, 'runner.lock'), 'utf8'));
    if (owner.pid !== process.pid || owner.hostname !== hostname() || typeof owner.token !== 'string') throw fixedError('PROOF_RUNNER_OWNERSHIP_UNVERIFIED');
    guardedLauncher = await createGuardedLauncher({ ...options,
      signal: AbortSignal.any([stopController.signal, deadlineController.signal, ...(signal ? [signal] : [])]),
      launcher: { create: (intent, context) => { assertOpen(); return launcher.create(intent, context); } },
      ownedProcesses: [...(options.ownedProcesses ?? []), { role: 'runner', directory: runtimeDir, ...owner }] });
    report.status = 'running'; await persist();
    while (!stopController.signal.aborted) {
      assertOpen();
      const state = await boundedCall(() => runner.tick(), 'PROOF_RUNNER_TICK_FAILED');
      await journal.flush();
      report.final_chain = snapshotSummary(state.snapshot);
      observeConfirmedGame(state);
      if (!debug && (journal.getFailure() || report.dispatches.some(row => BAD_DISPATCH.has(row.status)))) stop('PROOF_AGENT_OPERATION_UNCERTAIN');
      const issues = (state.health ?? []).filter(issue => !debug || !issue?.seat_id && issue?.code !== 'SPECTATOR_UNAVAILABLE').map(issue => issue?.code);
      if (issues.some(code => code !== 'LAUNCH_REJECTED' &&
          !(code === 'LAUNCH_PENDING' && creationStarted && report.creation?.status === 'accepted' && !report.game_id))) {
        stop('PROOF_RUNNER_HEALTH_BLOCKED');
      }
      if (stopController.signal.aborted) break;
      if (report.game_id && state.snapshot.phase === 'terminal') {
        report.result = terminalResult(state, report.game_id, prepared.preparedConfig);
        const payable = state.snapshot.players.some(player => player.joined &&
          (state.snapshot.outcome === 'cancelled' ? BigInt(player.refunded_wei ?? '0') < BigInt(state.snapshot.config.entryFeeWei ?? '0')
            : BigInt(player.claimed_wei ?? '0') < BigInt(player.award_wei ?? '0')));
        if ((debug || !payable) && !pendingDispatches.size) {
          if (typeof spectator.flush === 'function') await boundedCall(() => spectator.flush(), 'PROOF_SPECTATOR_UNCERTAIN', { mutation: true });
          report.telegram = publicSpectatorHealth(await guardedSpectator.health(), prepared.preparedConfig);
          if (report.telegram.ok && report.telegram.pending === 0 && report.telegram.inflight === 0 && report.telegram.scoreboard_ready) {
            const completeSeats = prepared.preparedConfig.roster.every(seat => ['join', 'commit', 'reveal'].every(operation =>
              report.dispatches.some(row => row.seat_id === seat.seat_id && row.game_id === report.game_id && row.operation === operation && row.status === 'submitted')) &&
              report.dispatches.some(row => row.seat_id === seat.seat_id && row.game_id === report.game_id && row.operation === 'discussion' && row.has_team_message));
            report.candidate_proof_complete = !debug && state.snapshot.outcome === 'completed' && completeSeats &&
              report.final_chain.players === prepared.preparedConfig.roster.length && state.snapshot.active_game_id === '0';
            report.awaiting_independent_audit = report.candidate_proof_complete;
            report.status = debug ? 'debug-complete' : report.candidate_proof_complete ? 'candidate-complete' : 'terminal-incomplete';
            if (debug) {
              report.all_seats_acted = completeSeats;
              report.defaults = state.events.filter(event => event.game_id === report.game_id && event.kind === 'round-resolved')
                .reduce((count, event) => count + (event.data?.choices ?? []).filter(choice => choice.defaulted).length, 0);
            }
            break;
          }
        }
      }
      if (!creationStarted && clock() >= options.stopNewGamesAtMs) { stop('PROOF_LAUNCH_WINDOW_CLOSED'); break; }
      await persist();
      await boundedCall(() => pause(Math.min(prepared.preparedConfig.poll_interval_ms, Math.max(1, options.hardStopAtMs - clock()))), 'PROOF_PAUSE_FAILED');
    }
  } catch (error) {
    stop(error?.message === 'READINESS_REMOTE_GENERATION_UNATTESTED' ? error.message :
      ['PROOF_HARD_DEADLINE', 'PROOF_RUN_ABORTED'].includes(error?.code) ? error.code : 'PROOF_RUN_FAILED');
  } finally {
    stopController.abort();
    // The journal observes outcomes after a sibling aborts. The raw adapter is
    // bounded by the same absolute deadline, so this drain cannot hang forever.
    await Promise.allSettled([...pendingDispatches, ...pendingEffects]);
    try { await runner?.close(); report.runner_stopped = true; }
    catch { stop('PROOF_RUNNER_CLOSE_FAILED'); }
    await Promise.allSettled([...pendingDispatches, ...pendingEffects]);
    let persistenceFailed = false;
    try { await journal.flush(); }
    catch { persistenceFailed = true; stop('PROOF_REPORT_WRITE_FAILED'); }
    if (!debug && report.dispatches.some(row => BAD_DISPATCH.has(row.status))) stop('PROOF_AGENT_OPERATION_UNCERTAIN');
    report.pending_dispatches = report.dispatches.filter(row => row.status === 'started').length;
    if (report.pending_dispatches) stop('PROOF_DISPATCH_UNRESOLVED');
    if (report.failure) { report.candidate_proof_complete = false; report.awaiting_independent_audit = false; }
    clearTimeout(hardTimer);
    signal?.removeEventListener('abort', externalAbort);
    report.finished_at = stamp();
    try { await persist(); }
    catch { persistenceFailed = true; }
    if (persistenceFailed) throw fixedError('PROOF_REPORT_WRITE_FAILED');
  }
  return structuredClone(report);
}
