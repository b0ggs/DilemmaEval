import { mkdir } from 'node:fs/promises';
import { posix, join } from 'node:path';
import { createMaritimeInstaller } from './install.mjs';
import { maritimeRequest, safeMaritimeDiagnosticCode } from './transport.mjs';
import { buildObserverTransitionCommand, buildObserverInspectionCommand } from './observer-transition.mjs';
import { buildOpenClawOAuthInspectionCommand } from './openclaw-oauth.mjs';
import { nativeCommandResult } from './seat-diagnostic.mjs';
import { writeProofReport } from '../../../../conference/operations/saved-helpers/proof-dispatch-journal.mjs';

/** Deploy the batched public sources and perform the one-time observer disable.
 * Reuses installation and model/route checks, with one account-checked wake per
 * seat. It never creates a game or signs, claims, or sends Telegram messages. */
export async function prepareDebugAgents({ config, artifacts, apiKey, runtimeDir,
  seatIds = config.roster.map(seat => seat.seat_id),
  installSources = true,
  fetchImpl = globalThis.fetch, installer = createMaritimeInstaller({ apiKey, fetchImpl }),
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)), onWake = async () => {} }) {
  if (config.chain_id !== 84532 || config.roster.length !== 10 || artifacts.length !== 10 || typeof installSources !== 'boolean') throw new Error('DEBUG_TEN_SEATS_REQUIRED');
  if (!Array.isArray(seatIds) || !seatIds.length || new Set(seatIds).size !== seatIds.length ||
      seatIds.some(id => !config.roster.some(seat => seat.seat_id === id))) throw new Error('DEBUG_TEN_SEATS_REQUIRED');
  await mkdir(runtimeDir, { mode: 0o700 });
  const report = { schema_version: 1, purpose: 'debug', status: 'started', seats: [], account_awake: null };
  const persist = () => writeProofReport(join(runtimeDir, 'debug-agents.json'), report);
  const fail = code => { throw Object.assign(new Error(code), { code }); };
  const request = (url, method = 'GET', body) => maritimeRequest({ apiKey, fetchImpl, path: url, method, body });
  await persist();
  for (const seat of config.roster.filter(seat => seatIds.includes(seat.seat_id))) {
    const artifact = artifacts.find(row => row.seat_id === seat.seat_id);
    const row = { seat_id: seat.seat_id, wake_started: false, installed: false, observer_disabled: false,
      route_verified: false, native_credentials_oauth_only: false, sleep_confirmed: false, failure: null };
    report.seats.push(row); await persist();
    const prefix = `/api/agents/${encodeURIComponent(seat.agent_id)}`;
    const execute = command => request(`${prefix}/exec`, 'POST', { command, timeout: 60 });
    try {
      const inventory = await request('/api/agents');
      if (!Array.isArray(inventory) || inventory.filter(agent => !['sleeping', 'stopped'].includes(agent.status)).length >= 5 ||
          !inventory.some(agent => agent.id === seat.agent_id && agent.framework === seat.harness && ['sleeping', 'stopped'].includes(agent.status))) fail('MARITIME_INVENTORY_INVALID');
      await onWake(seat); row.wake_started = true; await persist();
      await request(`${prefix}/start`, 'POST'); await pause(10000);
      if (installSources) await (installer.refreshPublicArtifact ?? installer.install)(artifact);
      else await installer.inspectInstallation(artifact);
      row.installed = true;
      const transition = nativeCommandResult(await execute(buildObserverTransitionCommand({ artifact })));
      if (transition.observer_enabled !== false || transition.seat_id !== seat.seat_id) fail('OBSERVER_TRANSITION_FAILED');
      row.observer_disabled = true;
      await request(`${prefix}/reload-env`, 'POST'); await pause(10000);
      const observed = nativeCommandResult(await execute(buildObserverInspectionCommand({ artifact })));
      if (observed.observer_enabled !== false || observed.seat_id !== seat.seat_id) fail('OBSERVER_TRANSITION_FAILED');
      nativeCommandResult(await execute(artifact.model_config_check_command));
      const route = nativeCommandResult(await execute(artifact.model_route_check_command));
      if (route.model_route_verified !== true) fail('READINESS_MODEL_ROUTE_UNVERIFIED');
      row.route_verified = true;
      const settings = JSON.parse(artifact.files.find(file => file.path === artifact.gameplay_command[2]).content);
      if (seat.harness === 'openclaw') {
        const auth = nativeCommandResult(await execute(buildOpenClawOAuthInspectionCommand({ settings,
          modulePath: posix.join(posix.dirname(artifact.gameplay_command[1]), 'openclaw-oauth.mjs') })));
        row.native_credentials_oauth_only = auth.oauth_profile_exclusive === true && auth.inspection_cli_api_fallback_absent === true;
      } else {
        const auth = nativeCommandResult(await execute(['python3', '-c', `
import os,sys,json,pathlib
try:
 data=json.loads(pathlib.Path('/opt/data/auth.json').read_text());provider=data.get('providers',{}).get('openai-codex',{})
 rows=list(data.get('credential_pool',{}).get('openai-codex',[]));tokens=provider.get('tokens',{})
 if tokens.get('access_token'): rows.append({'auth_type':'oauth','access_token':tokens.get('access_token'),'refresh_token':tokens.get('refresh_token')})
 if not rows or len(rows)>100: raise ValueError()
 for r in rows:
  if r.get('auth_type')!='oauth' or not r.get('access_token') or not r.get('refresh_token') or r.get('base_url') not in (None,'','https://chatgpt.com/backend-api/codex','https://chatgpt.com/backend-api/codex/'): raise ValueError()
 print('{"schema_version":1,"oauth_only":true}')
except Exception:
 print('{"ok":false,"error":{"code":"HERMES_OAUTH_POOL_UNVERIFIED"}}');sys.exit(1)
`]));
        row.native_credentials_oauth_only = auth.oauth_only === true;
      }
      if (!row.native_credentials_oauth_only) fail('READINESS_MODEL_ROUTE_UNVERIFIED');
    } catch (error) {
      row.failure = { code: safeMaritimeDiagnosticCode(error.diagnostic_code,
        safeMaritimeDiagnosticCode(error.code, safeMaritimeDiagnosticCode(error.message, 'DEBUG_AGENT_PREPARATION_FAILED'))) };
    } finally {
      if (row.wake_started) {
        try {
          await request(`${prefix}/sleep`, 'POST');
          const agent = await request(prefix);
          row.sleep_confirmed = agent.id === seat.agent_id && agent.status === 'sleeping';
        } catch { row.sleep_confirmed = false; }
      }
      await persist();
    }
    if (row.failure || !row.sleep_confirmed) break;
  }
  const inventory = await request('/api/agents');
  report.account_awake = inventory.filter(agent => !['sleeping', 'stopped'].includes(agent.status)).length;
  report.status = report.seats.length === seatIds.length && report.seats.every(row => !row.failure && row.sleep_confirmed && row.native_credentials_oauth_only) ? 'complete' : 'failed';
  await persist();
  return report;
}
