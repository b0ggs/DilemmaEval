import { posix } from 'node:path';
import { validateConfig } from './config.mjs';
import { configFingerprint } from './readiness.mjs';
import { verifyPublicArtifactIntegrity } from './maritime/install.mjs';
import { buildExecutionPermit, buildExecutionPermitStageCommand, executionPermitFingerprint } from './maritime/execution-permit.mjs';
import { fixedCliDiagnostic, withFailureMetadata } from './maritime/transport.mjs';

const HEX = /^[0-9a-f]{64}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const UINT = /^[1-9][0-9]*$/;
const MODEL = { model_endpoint: 'https://chatgpt.com/backend-api/codex', model: 'gpt-6.1-sol',
  reasoning_effort: 'low', max_output_tokens: 2048, automatic_fallback: false };
const fail = code => { throw Object.assign(new Error(code), { code }); };
const same = (a, b) => configFingerprint(a) === configFingerprint(b);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join() === [...keys].sort().join();

/** Purpose is coordinator data. The normal validator continues to reject it. */
export function validateDebugConfig(input) {
  if (input?.purpose !== 'debug') fail('DEBUG_CONFIG_PURPOSE_REQUIRED');
  const { purpose, ...rest } = input;
  const config = validateConfig(rest);
  if (config.roster.length !== 10 || ['openclaw', 'hermes'].some(team =>
    config.roster.filter(seat => seat.team === team).length !== 5)) fail('DEBUG_TEN_SEATS_REQUIRED');
  return { ...config, purpose };
}

/** A chain binding, explicitly without certification or diagnostic claims. */
export function buildDebugEvidence({ config, preflight }) {
  validateDebugConfig(config);
  return validateDebugEvidence(config, { schema_version: 1, purpose: 'debug', run_id: config.run_id,
    config_fingerprint: configFingerprint(config), chain_id: 84532,
    game_address: config.game_address.toLowerCase(), game_code_hash: preflight.code_hash,
    chain_defaults_fingerprint: configFingerprint(preflight.config),
    confirmed_block_number: preflight.block_number, confirmed_block_hash: preflight.block_hash });
}

export function validateDebugEvidence(config, value) {
  if (!exact(value, ['schema_version', 'purpose', 'run_id', 'config_fingerprint', 'chain_id', 'game_address',
    'game_code_hash', 'chain_defaults_fingerprint', 'confirmed_block_number', 'confirmed_block_hash']) ||
      value.schema_version !== 1 || value.purpose !== 'debug' || value.chain_id !== 84532 ||
      value.run_id !== config.run_id || value.config_fingerprint !== configFingerprint(config) ||
      value.game_address !== config.game_address.toLowerCase() || !HASH.test(value.game_code_hash ?? '') ||
      !HEX.test(value.chain_defaults_fingerprint ?? '') || !UINT.test(value.confirmed_block_number ?? '') ||
      !HASH.test(value.confirmed_block_hash ?? '')) fail('DEBUG_EVIDENCE_INVALID');
  return structuredClone(value);
}

function result(value, code) {
  if (value?.exitCode !== 0 || typeof value.stdout !== 'string' || Buffer.byteLength(value.stdout) > 16384 ||
      value.stderr && value.stderr !== '') {
    throw withFailureMetadata(Object.assign(new Error(code), { code }),
      { diagnostic_code: fixedCliDiagnostic(value?.stdout) });
  }
  try { return JSON.parse(value.stdout); } catch { fail(code); }
}

/** Reuse player permits, binding each action to the observed live incarnation.
 * The purpose marker ensures these contexts can never be admitted as proof. */
export function createDebugContinuity({ config, artifacts, hardStopAtMs, now = Date.now }) {
  validateDebugConfig(config);
  if (!Number.isSafeInteger(hardStopAtMs) || !Array.isArray(artifacts) || artifacts.length !== 10) fail('DEBUG_CONTINUITY_INVALID');
  const pinned = structuredClone(config);
  const bindings = new Map(pinned.roster.map(seat => {
    const rows = artifacts.filter(artifact => artifact.seat_id === seat.seat_id);
    const artifact = rows[0];
    if (rows.length !== 1 || artifact.agent_id !== seat.agent_id || artifact.harness !== seat.harness ||
        !HEX.test(artifact.artifact_sha256 ?? '') ||
        ['gameplay_command', 'inspect_command', 'model_config_check_command', 'model_route_check_command']
          .some(key => !Array.isArray(artifact[key]))) fail('DEBUG_CONTINUITY_INVALID');
    return [seat.seat_id, { seat, artifact: structuredClone(artifact) }];
  }));
  const time = deadline => {
    const at = now();
    if (!Number.isSafeInteger(at) || at >= Math.min(deadline, hardStopAtMs)) fail('READINESS_DEADLINE_EXPIRED');
    return at;
  };
  async function inspect({ seat, execute, getAgent }, deadline = hardStopAtMs) {
    time(deadline);
    const binding = bindings.get(seat?.seat_id);
    if (!binding || !same(binding.seat, seat) || typeof execute !== 'function' || typeof getAgent !== 'function') fail('DEBUG_CONTINUITY_INVALID');
    const { artifact } = binding;
    const run = async (command, code) => { time(deadline); const value = result(await execute(structuredClone(command)), code); time(deadline); return value; };
    const agent = async () => {
      const live = await getAgent();
      if (live?.id !== seat.agent_id || live.framework !== seat.harness || live.status !== 'active') fail('READINESS_LIFECYCLE_UNCONFIRMED');
    };
    await agent();
    await verifyPublicArtifactIntegrity(artifact, execute);
    const modulePath = posix.join(posix.dirname(artifact.gameplay_command[1]), 'execution-permit.mjs');
    const fingerprintCommand = ['node', '--input-type=module', '-e',
      "import {pathToFileURL} from 'node:url';const m=await import(pathToFileURL(process.argv[1]));process.stdout.write(JSON.stringify({fingerprint:await m.readRuntimeInstanceFingerprint()}));", modulePath];
    const fingerprint = async () => {
      const live = await run(fingerprintCommand, 'READINESS_MIXED_GENERATION');
      if (!exact(live, ['fingerprint']) || !HEX.test(live.fingerprint ?? '')) fail('READINESS_MIXED_GENERATION');
      return live.fingerprint;
    };
    const observed = await fingerprint();
    const direct = await run(artifact.inspect_command, 'READINESS_INSPECTION_FAILED');
    if (direct.schema_version !== 1 || direct.seat_id !== seat.seat_id || direct.chain_id !== 84532 ||
        direct.wallet_address?.toLowerCase() !== seat.wallet_address.toLowerCase() ||
        direct.persistent_storage_writable !== true || direct.gameplay_execution_proven !== false) fail('READINESS_INSPECTION_FAILED');
    const model = await run(artifact.model_config_check_command, 'READINESS_MODEL_INVALID');
    if (model.schema_version !== 1 || model.seat_id !== seat.seat_id || model.harness !== seat.harness || model.configured !== true ||
        model.model !== MODEL.model || model.reasoning_effort !== MODEL.reasoning_effort || model.max_output_tokens !== MODEL.max_output_tokens ||
        model.automatic_fallback !== false || model.fallback_model !== null || model.response_metadata_required !== true) fail('READINESS_MODEL_INVALID');
    const route = await run(artifact.model_route_check_command, 'READINESS_MODEL_ROUTE_UNVERIFIED');
    if (!exact(route, ['schema_version', 'seat_id', 'model_route_verified']) || route.schema_version !== 1 ||
        route.seat_id !== seat.seat_id || route.model_route_verified !== true) fail('READINESS_MODEL_ROUTE_UNVERIFIED');
    if (await fingerprint() !== observed) fail('READINESS_MIXED_GENERATION');
    await agent(); time(deadline);
    return { artifact, fingerprint: observed };
  }
  return Object.freeze({
    async verify(args) { await inspect(args); return { schema_version: 1, verified: true }; },
    async prepareAction({ seat, request, execute, getAgent, deadlineAtMs }) {
      if (!Number.isSafeInteger(deadlineAtMs)) fail('READINESS_DEADLINE_EXPIRED');
      const deadline = Math.min(deadlineAtMs, hardStopAtMs);
      const { artifact, fingerprint } = await inspect({ seat, execute, getAgent }, deadline);
      const at = time(deadline);
      const context = { schema_version: 2, producer_version: 2, purpose: 'debug', run_id: pinned.run_id,
        config_fingerprint: configFingerprint(pinned), continuity_policy: 'observed-runtime-continuity-v1',
        ready_for_controlled_gameplay: true, remote_generation_attested: false, diagnostics_complete: true,
        verified_at: new Date(at).toISOString(), expires_at: new Date(deadline).toISOString(),
        chain_id: 84532, game_address: pinned.game_address.toLowerCase(),
        verification_method: 'live-configuration-debug',
        seats: [{ ...seat, artifact_sha256: artifact.artifact_sha256, runtime_instance_fingerprint: fingerprint,
          model_profile: MODEL, tool_execution_verified: true, lifecycle_ambiguous: false }] };
      const envelope = buildExecutionPermit({ config: pinned, evidence: context, artifact, request,
        expiresAtMs: Math.min(deadline, at + 300000), hardStopAtMs, nowMs: at });
      const staged = await runStage(execute, buildExecutionPermitStageCommand({ artifact, permit: envelope }));
      if (staged.schema_version !== 1 || staged.staged !== true || staged.request_id !== request.request_id ||
          staged.permit_sha256 !== executionPermitFingerprint(envelope.permit)) fail('READINESS_PERMIT_UNVERIFIED');
      time(deadline);
      return { schema_version: 1, verified: true };
    }
  });
}

async function runStage(execute, command) { return result(await execute(command), 'READINESS_PERMIT_UNVERIFIED'); }
