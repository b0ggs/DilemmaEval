import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createMaritimeAdapter, maritimeRequest, fixedCliDiagnostic, safeMaritimeDiagnosticCode, safeMaritimeErrorCode } from './transport.mjs';
import { buildOpenClawProductionObserverCommand, buildOpenClawProductionActivationReadCommand,
  buildOpenClawProductionReceiptReadCommand } from './openclaw-oauth.mjs';
import { buildHermesProductionObserverCommand, buildHermesProductionReceiptReadCommand } from './hermes-oauth.mjs';
import { buildObserverTransitionCommand } from './observer-transition.mjs';
import { writeProofReport } from '../../../../conference/operations/saved-helpers/proof-dispatch-journal.mjs';

const fail = code => { throw Object.assign(new Error(code), { code, diagnostic_code: code }); };
const settingsFor = artifact => JSON.parse(artifact.files.find(file => file.path === artifact.gameplay_command[2]).content);
export function nativeCommandResult(value, fallback = 'MARITIME_DIAGNOSTIC_RESPONSE_INVALID') {
  const code = fixedCliDiagnostic(value?.stdout);
  if (code) fail(code);
  if (value?.exitCode !== 0 || typeof value.stdout !== 'string' || value.stdout.length > 16384 || value.stderr) fail(fallback);
  try { return JSON.parse(value.stdout); } catch { fail(fallback); }
}

/** One real seat, full ten-seat config. Native receipts are read for this exact
 * /chat call even if the chat response fails validation. Never replays a call. */
export async function runSeatDiagnostic({ config, artifacts, seatId, runtimeDir, apiKey, chain,
  deadlineAtMs, cleanupDeadlineAtMs, fetchImpl = globalThis.fetch, adapterFactory = createMaritimeAdapter,
  now = Date.now, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const seat = config.roster.find(row => row.seat_id === seatId);
  const artifact = artifacts.find(row => row.seat_id === seatId);
  if (!seat || !artifact || !Number.isSafeInteger(deadlineAtMs) || !Number.isSafeInteger(cleanupDeadlineAtMs) ||
      cleanupDeadlineAtMs <= deadlineAtMs || now() >= deadlineAtMs || !path.isAbsolute(runtimeDir)) fail('CONTROL_ARGUMENTS_INVALID');
  await mkdir(runtimeDir, { mode: 0o700 });
  const filename = path.join(runtimeDir, 'seat-diagnostic.json');
  const operationId = `${seat.harness}-production-${seatId}-${randomUUID()}`;
  const report = { schema_version: 1, seat_id: seatId, operation_id: operationId, status: 'started',
    failure: null, activation_verified: false, native_call_verified: false, response_verified: false,
    sleep_confirmed: false, account_awake: null };
  const persist = () => writeProofReport(filename, report);
  await persist();
  const prefix = `/api/agents/${encodeURIComponent(seat.agent_id)}`;
  const request = async (url, method = 'GET', body, cleanup = false) => {
    const end = cleanup ? cleanupDeadlineAtMs : deadlineAtMs;
    if (now() >= end) fail('MARITIME_DISPATCH_EXPIRED');
    return maritimeRequest({ apiKey, fetchImpl, path: url, method, body, timeoutMs: Math.min(120000, end - now()) });
  };
  const execute = async command => request(`${prefix}/exec`, 'POST', { command, timeout: 30 });
  let wakeStarted = false;
  let diagnostic, chatError;
  const settings = settingsFor(artifact);
  try {
    const inventory = await request('/api/agents');
    if (!Array.isArray(inventory) || inventory.filter(row => !['sleeping', 'stopped'].includes(row.status)).length >= 5 ||
        !inventory.some(row => row.id === seat.agent_id && row.framework === seat.harness && row.status === 'sleeping')) fail('MARITIME_INVENTORY_INVALID');
    const preflight = await chain.preflight();
    diagnostic = { schema_version: 1, type: 'runtime-diagnostic', request_id: `diagnostic:${randomUUID()}`,
      seat_id: seatId, team: seat.team, mode: 'gameplay-input', chain_state: { chain_id: 84532,
        game_address: config.game_address.toLowerCase(), confirmed_block_number: preflight.block_number,
        confirmed_block_hash: preflight.block_hash } };
    report.request_id = diagnostic.request_id; await persist();
    wakeStarted = true;
    await request(`${prefix}/start`, 'POST');
    await pause(10000);
    nativeCommandResult(await execute(buildObserverTransitionCommand({ artifact })));
    if (seat.harness === 'hermes') {
      const names = ['hermes_cli/auth.py', 'hermes_cli/config.py', 'hermes_cli/runtime_provider.py',
        'agent/credential_pool.py', 'hermes_cli/plugins.py', 'run_agent.py'];
      const pins = nativeCommandResult(await execute(['python3', '-c',
        "import hashlib,json,pathlib,sys;print(json.dumps({n:hashlib.sha256((pathlib.Path('/opt/hermes')/n).read_bytes()).hexdigest() for n in json.loads(sys.argv[1])}))", JSON.stringify(names)]));
      settings.native_source_pins = pins;
      // Restore selection first, then install a fresh observer deadline/scope.
      nativeCommandResult(await execute(buildObserverTransitionCommand({ artifact, enabled: true })));
    }
    const scope = { settings, operationId, deadlineAtMs };
    nativeCommandResult(await execute(seat.harness === 'openclaw' ? buildOpenClawProductionObserverCommand(scope) : buildHermesProductionObserverCommand(scope)));
    await request(`${prefix}/reload-env`, 'POST');
    await pause(10000);
    if (seat.harness === 'openclaw') {
      const active = nativeCommandResult(await execute(buildOpenClawProductionActivationReadCommand(scope)));
      if (active.observer_active !== true) fail('MARITIME_DIAGNOSTIC_RESPONSE_INVALID');
    }
    report.activation_verified = true; await persist();
    const adapter = adapterFactory({ config, apiKey, fetchImpl, maxAgents: 10, diagnosticStageRetries: 0,
      runtimeEvidence: { schema_version: 2, run_id: config.run_id, seats: artifacts } });
    try {
      await adapter.diagnose({ seat, request: diagnostic, deadline_at_ms: deadlineAtMs });
      report.response_verified = true;
    } catch (error) { chatError = error; }
    const receipt = nativeCommandResult(await execute(seat.harness === 'openclaw' ?
      buildOpenClawProductionReceiptReadCommand({ ...scope, publicRequestId: diagnostic.request_id }) :
      buildHermesProductionReceiptReadCommand({ ...scope, publicRequestId: diagnostic.request_id })));
    report.native_call_verified = receipt.actual_model_call_verified === true || receipt.native_call_verified === true;
    if (!report.native_call_verified) fail('MARITIME_DIAGNOSTIC_RESPONSE_INVALID');
    if (chatError) throw chatError;
    report.status = 'complete';
  } catch (error) {
    report.status = 'failed';
    report.failure = { code: safeMaritimeDiagnosticCode(error.diagnostic_code,
      safeMaritimeDiagnosticCode(error.code, safeMaritimeErrorCode(error.code, 'MARITIME_DIAGNOSTIC_RESPONSE_INVALID'))),
      ambiguous: error.ambiguous === true };
  } finally {
    if (wakeStarted) {
      try {
        await request(`${prefix}/sleep`, 'POST', undefined, true);
        const observed = await request(prefix, 'GET', undefined, true);
        report.sleep_confirmed = observed.id === seat.agent_id && observed.status === 'sleeping';
      } catch { report.sleep_confirmed = false; }
    }
    try {
      const inventory = await request('/api/agents', 'GET', undefined, true);
      report.account_awake = inventory.filter(row => !['sleeping', 'stopped'].includes(row.status)).length;
    } catch { report.account_awake = null; }
    await persist();
  }
  return structuredClone(report);
}
