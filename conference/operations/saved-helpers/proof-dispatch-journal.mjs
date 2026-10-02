import { open, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { safePlayerErrorCode } from '../../../integration/conference-runner/src/maritime/diagnostics.mjs';
import { safeMaritimeErrorCode, safeMaritimeDiagnosticCode } from '../../../integration/conference-runner/src/maritime/transport.mjs';

const TERMINAL_STATUSES = new Set([
  'submitted',
  'observed',
  'skipped',
  'agent-error',
  'rejected-before-submit',
  'ambiguous',
  'cancelled-after-submit',
]);
const REQUEST_ID = /^conference:[0-9a-f]{32}$/;
const SEAT_ID = /^(?:oc|hs)-(?:[1-9]|10)$/;
const TRANSACTION_HASH = /^0x[0-9a-fA-F]{64}$/;

function timestamp(now) {
  const value = new Date(now());
  if (!Number.isFinite(value.getTime())) throw new TypeError('PROOF_DISPATCH_CLOCK_INVALID');
  return value.toISOString();
}

function operationFor(request) {
  if (request?.type === 'discussion') return 'discussion';
  return ['join', 'commit', 'reveal', 'claim'].includes(request?.requested_action)
    ? request.requested_action
    : 'unknown';
}

function startedRecord(args, now) {
  const round = Number.isSafeInteger(args?.request?.round) && args.request.round >= 0
    ? args.request.round
    : null;
  const gameId = /^(0|[1-9][0-9]*)$/.test(String(args?.request?.game_id ?? ''))
    ? String(args.request.game_id)
    : null;
  return {
    started_at: timestamp(now),
    request_id: typeof args?.request?.request_id === 'string' && REQUEST_ID.test(args.request.request_id)
      ? args.request.request_id
      : null,
    seat_id: typeof args?.seat?.seat_id === 'string' && SEAT_ID.test(args.seat.seat_id)
      ? args.seat.seat_id
      : null,
    operation: operationFor(args?.request),
    game_id: gameId,
    round,
    status: 'started',
  };
}

function responseOutcome(response) {
  if (response?.status === 'error') return 'agent-error';
  if (['submitted', 'observed', 'skipped'].includes(response?.status)) return response.status;
  return 'ambiguous';
}

function rejectedBeforeSubmit(error) {
  // The adapter owns the remote-mutation boundary. Only its explicit
  // non-ambiguous classification can prove that submission did not begin.
  return error?.ambiguous === false;
}

function safeTransportCode(error) {
  const fixed = new Set([
    'MARITIME_TIMEOUT',
    'MARITIME_AGENT_RESPONSE_INVALID',
    'MARITIME_PUBLIC_REQUEST_STAGE_FAILED',
    'MARITIME_DISPATCH_EXPIRED',
    'MARITIME_ONE_AWAKE_RECONCILIATION_REQUIRED',
    'MARITIME_HTTP_500',
  ]);
  return fixed.has(error?.code) ? error.code : 'MARITIME_OPERATION_FAILED';
}

function sanitizedFailure(record) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

/**
 * Atomically replaces the proof report and fsyncs both the file and its parent.
 * Temporary filenames contain no proof data or request identity.
 */
export async function writeProofReport(filename, report) {
  const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, filename);
    const directory = await open(dirname(filename), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } catch (error) {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

/**
 * Wrap an agent adapter with proof-only evidence. The report receives only
 * allowlisted public identity, fixed status/error codes and a transaction hash.
 */
export function createProofDispatchJournal({ adapter, report, persist, stopController, now = Date.now } = {}) {
  if (typeof adapter?.dispatch !== 'function' || !report || !Array.isArray(report.dispatches) ||
      typeof persist !== 'function' || !(stopController instanceof AbortController) || typeof now !== 'function') {
    throw new TypeError('PROOF_DISPATCH_JOURNAL_INVALID');
  }

  let failure = null;
  let writes = Promise.resolve();
  const mutateAndPersist = mutation => {
    const pending = writes.then(async () => {
      mutation();
      await persist();
    });
    writes = pending;
    return pending;
  };

  async function finish(record, outcome) {
    if (!TERMINAL_STATUSES.has(outcome.status)) throw new TypeError('PROOF_DISPATCH_STATUS_INVALID');
    await mutateAndPersist(() => {
      Object.assign(record, { finished_at: timestamp(now), ...outcome });
    });
  }

  function stopFor(record) {
    if (failure || record.operation === 'claim' || record.status === 'rejected-before-submit') return;
    failure = sanitizedFailure(record);
    stopController.abort();
  }

  async function dispatch(args) {
    if (failure) throw Object.assign(new Error('CONTROLLED_PROOF_STOPPED'), {
      code: 'CONTROLLED_PROOF_STOPPED', ambiguous: false, retryable: false,
    });

    const record = startedRecord(args, now);
    await mutateAndPersist(() => { report.dispatches.push(record); });

    let response;
    try { response = await adapter.dispatch(args); }
    catch (error) {
      const status = rejectedBeforeSubmit(error)
        ? 'rejected-before-submit'
        : stopController.signal.aborted && error?.ambiguous === true && failure !== null
          ? 'cancelled-after-submit'
          : 'ambiguous';
      const transportCode = safeMaritimeErrorCode(error?.transport_code, safeMaritimeErrorCode(error?.code));
      await finish(record, {
        status,
        transaction_hash: null,
        error_code: safeTransportCode(error),
        ...(transportCode ? { transport_code: transportCode } : {}),
        diagnostic_code: safeMaritimeDiagnosticCode(error?.diagnostic_code),
        has_team_message: false,
      });
      stopFor(record);
      throw error;
    }

    const status = responseOutcome(response);
    await finish(record, {
      status,
      transaction_hash: TRANSACTION_HASH.test(response?.transaction_hash ?? '')
        ? response.transaction_hash.toLowerCase()
        : null,
      error_code: status === 'agent-error'
        ? safePlayerErrorCode(response?.error?.code)
        : status === 'ambiguous' ? 'MARITIME_OPERATION_FAILED' : null,
      has_team_message: typeof response?.team_message === 'string' && response.team_message.length > 0,
    });
    if (status === 'agent-error' || status === 'ambiguous') stopFor(record);
    return response;
  }

  return {
    dispatch,
    getFailure: () => failure === null ? null : structuredClone(failure),
    flush: () => writes,
  };
}
