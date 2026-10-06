// Compact coordinator-only evidence. No prompts, commands, responses or extra I/O.
const stages = new Set(['capacity_wait', 'wake', 'wake_confirm', 'runtime_verify', 'request_stage',
  'chat', 'reply_validation', 'final_verify', 'sleep', 'sleep_confirm', 'recovery']);
const checks = new Set(['identity', 'artifact_integrity', 'fingerprint', 'storage', 'model', 'model_route', 'diagnostic_receipt', 'permit']);
const sources = new Set(['http_request', 'runtime_verification', 'action_allowance', 'cleanup_allowance',
  'phase_abort', 'hard_stop', 'deadline_signal']);
const workStates = new Set(['not_started', 'unknown', 'completed']);
const duration = value => Number.isSafeInteger(value) && value >= 0;

export function safeDispatchDiagnostics(value, safeCode = () => null) {
  if (!value || !stages.has(value.stage)) return undefined;
  const cleanFailure = failure => {
    if (!failure || !stages.has(failure.stage)) return undefined;
    const code = safeCode(failure.code);
    return { stage: failure.stage,
      ...(checks.has(failure.check) ? { check: failure.check } : {}),
      ...(code ? { code } : {}),
      ...(sources.has(failure.timeout_source) ? { timeout_source: failure.timeout_source } : {}),
      ...(duration(failure.timeout_ms) ? { timeout_ms: failure.timeout_ms } : {}),
      ...(duration(failure.elapsed_ms) ? { elapsed_ms: failure.elapsed_ms } : {}) };
  };
  const failure = cleanFailure(value.failure), cleanupFailure = cleanFailure(value.cleanup_failure);
  return { stage: value.stage,
    ...(checks.has(value.check) ? { check: value.check } : {}),
    ...Object.fromEntries(['queue_ms', 'action_ms', 'cleanup_ms'].filter(key => duration(value[key])).map(key => [key, value[key]])),
    ...(failure ? { failure } : {}), ...(cleanupFailure ? { cleanup_failure: cleanupFailure } : {}),
    ...(typeof value.cleanup_confirmed === 'boolean' ? { cleanup_confirmed: value.cleanup_confirmed } : {}),
    ...(workStates.has(value.remote_work) ? { remote_work: value.remote_work } : {}) };
}

export function createDispatchDiagnostics({ now = Date.now, safeCode = () => null } = {}) {
  const started = now();
  let stage = 'capacity_wait', check, stageStarted = started, admitted, cleanup, finished;
  let failure, cleanupFailure, onFailure, remoteWork = 'not_started', cleanupConfirmed = false;
  const elapsed = (start, end = finished ?? now()) => Math.max(0, Math.round(end - start));
  return {
    stage(next, nextCheck) {
      if (!stages.has(next)) return;
      const selectedCheck = checks.has(nextCheck) ? nextCheck : undefined;
      if (stage !== next || check !== selectedCheck) stageStarted = now();
      stage = next; check = selectedCheck;
    },
    admitted() { admitted ??= now(); },
    cleanup() { cleanup ??= now(); },
    remoteWork(next) { if (workStates.has(next)) remoteWork = next; },
    sleepConfirmed() { cleanupConfirmed = true; },
    onFailure(callback) { if (typeof callback === 'function') onFailure = callback; },
    failure(error, { source = error?.timeout_source, timeoutMs = error?.timeout_ms, secondary = false } = {}) {
      if (secondary ? cleanupFailure : failure) return;
      const code = safeCode(error?.diagnostic_code ?? error?.transport_code ?? error?.code);
      const entry = { stage, ...(check ? { check } : {}), ...(code ? { code } : {}),
        ...(sources.has(source) ? { timeout_source: source } : {}),
        ...(duration(timeoutMs) ? { timeout_ms: timeoutMs } : {}), elapsed_ms: elapsed(stageStarted) };
      if (secondary) cleanupFailure = entry;
      else failure = entry;
      onFailure?.();
    },
    finish() { finished ??= now(); },
    snapshot() {
      return { stage, ...(check ? { check } : {}), queue_ms: elapsed(started, admitted ?? finished ?? now()),
        action_ms: admitted === undefined ? 0 : elapsed(admitted, cleanup ?? finished ?? now()),
        cleanup_ms: cleanup === undefined ? 0 : elapsed(cleanup),
        ...(failure ? { failure: { ...failure } } : {}),
        ...(cleanupFailure ? { cleanup_failure: { ...cleanupFailure } } : {}),
        remote_work: remoteWork, cleanup_confirmed: cleanupConfirmed };
    }
  };
}
