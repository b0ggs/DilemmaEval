import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { PINNED_GAME_REVISION } from '../../../game-bridge/src/index.js';
import { validateControlledRuntimeEvidence, runtimeEvidenceFingerprint } from '../readiness.mjs';
import { verifyPublicArtifactIntegrity } from './install.mjs';
import { safeMaritimeErrorCode, safeMaritimeDiagnosticCode } from './transport.mjs';
import { buildDiagnosticReceiptReadCommand, validateDiagnosticReceipt } from './diagnostic-receipt.mjs';
import { buildExecutionPermit, buildExecutionPermitStageCommand, executionPermitFingerprint } from './execution-permit.mjs';

const HASH = /^[0-9a-f]{64}$/;
const VERIFIED = Object.freeze({ schema_version: 1, verified: true });
const digest = value => createHash('sha256').update(value).digest('hex');
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
const equal = (left, right) => runtimeEvidenceFingerprint(left) === runtimeEvidenceFingerprint(right);
function failureMetadata(error) {
  const transport = safeMaritimeErrorCode(error?.transport_code, safeMaritimeErrorCode(error?.code));
  const diagnostic = safeMaritimeDiagnosticCode(error?.diagnostic_code, safeMaritimeDiagnosticCode(error?.code));
  return { ...(transport !== null ? { transport_code: transport } : {}),
    ...(diagnostic !== null ? { diagnostic_code: diagnostic } : {}) };
}
function fail(code, error) { throw Object.assign(new Error(code), { code }, failureMetadata(error)); }

function checkedArtifact(config, seat, evidence, artifacts) {
  const matches = artifacts.filter(artifact => artifact?.seat_id === seat.seat_id);
  const artifact = matches[0];
  if (matches.length !== 1 || artifact.schema_version !== 1 || artifact.agent_id !== seat.agent_id ||
      artifact.harness !== seat.harness || artifact.source_revision !== PINNED_GAME_REVISION ||
      !HASH.test(artifact.artifact_sha256 ?? '') || artifact.artifact_sha256 !== evidence.artifact_sha256 ||
      !Array.isArray(artifact.files) || artifact.files.length === 0 || typeof artifact.persistent_root !== 'string' ||
      !posix.isAbsolute(artifact.persistent_root) || posix.normalize(artifact.persistent_root) !== artifact.persistent_root ||
      artifact.persistent_root === '/' || /[\0\r\n]/.test(artifact.persistent_root)) fail('READINESS_ARTIFACTS_INVALID');
  const base = posix.join(artifact.persistent_root, 'dilemma-conference', seat.seat_id);
  const code = posix.join(base, 'code');
  const moduleRoot = posix.join(code, 'integration/conference-runner/src/maritime');
  const cli = posix.join(moduleRoot, 'player-cli.mjs');
  const installer = posix.join(moduleRoot, 'install-runtime.mjs');
  const settingsPath = posix.join(base, 'seat.json');
  const commands = { gameplay_command: ['node', cli, settingsPath], inspect_command: ['node', cli, settingsPath, '--inspect'],
    model_config_check_command: ['node', installer, '--check-model', settingsPath],
    model_route_check_command: ['node', installer, '--check-model-route', settingsPath] };
  if (Object.entries(commands).some(([key, command]) => !equal(artifact[key], command)) ||
      !equal(artifact.gameplay_command, evidence.gameplay_command)) fail('READINESS_ARTIFACTS_INVALID');
  const publicPaths = new Set(['seat.json', 'PLAYER-INSTRUCTIONS.md', 'HARNESS-RECIPE.json'].map(name => posix.join(base, name)));
  const seen = new Set();
  for (const file of artifact.files) {
    if (typeof file?.path !== 'string' || (!file.path.startsWith(`${code}/`) && !publicPaths.has(file.path)) ||
        posix.normalize(file.path) !== file.path || /[\0\r\n]/.test(file.path) || seen.has(file.path) ||
        typeof file.content !== 'string' || !HASH.test(file.sha256 ?? '') || digest(file.content) !== file.sha256) {
      fail('READINESS_ARTIFACTS_INVALID');
    }
    seen.add(file.path);
  }
  if ([cli, installer, settingsPath, posix.join(moduleRoot, 'execution-permit.mjs'), posix.join(moduleRoot, 'diagnostic-receipt.mjs')]
    .some(path => !seen.has(path)) || digest(JSON.stringify(artifact.files.map(({ path, sha256 }) => ({ path, sha256 })))) !== artifact.artifact_sha256) {
    fail('READINESS_ARTIFACTS_INVALID');
  }
  let settings;
  try { settings = JSON.parse(artifact.files.find(file => file.path === settingsPath).content); }
  catch { fail('READINESS_ARTIFACTS_INVALID'); }
  const expectedRoster = config.roster.map(({ seat_id, team, harness, agent_id, maritime_agent, wallet_address, cause_id }) =>
    ({ seat_id, team, harness, agent_id, maritime_agent, wallet_address, cause_id }));
  if (settings.schema_version !== 1 || (config.mode === 'live' && settings.execution_permit_required !== true) ||
      settings.seat_id !== seat.seat_id || settings.harness !== seat.harness ||
      settings.chain_id !== config.chain_id || settings.game_address?.toLowerCase() !== config.game_address.toLowerCase() ||
      settings.rpc_url !== config.rpc_url || settings.state_directory !== posix.join(base, 'private') ||
      settings.persistent_root !== artifact.persistent_root || !equal(settings.roster, expectedRoster)) fail('READINESS_ARTIFACTS_INVALID');
  return artifact;
}

function jsonResult(value, code) {
  if (value?.exitCode !== 0 || typeof value.stdout !== 'string' || Buffer.byteLength(value.stdout) > 16_384 ||
      (value.stderr !== undefined && value.stderr !== '')) fail(code);
  try { return JSON.parse(value.stdout); } catch { fail(code); }
}

/** This certificate checks observed incarnation and original content. It never
 * reloads environment, repairs configuration, or claims a provider epoch. */
export function createRuntimeContinuity({ config, evidence, artifacts, hardStopAtMs, now = Date.now } = {}) {
  if (typeof now !== 'function') fail('READINESS_CONTINUITY_INPUT_INVALID');
  let pinnedConfig, pinnedEvidence, pinnedArtifacts, constructedAt;
  try {
    constructedAt = now();
    if (!Number.isSafeInteger(constructedAt) || hardStopAtMs !== undefined &&
        (!Number.isSafeInteger(hardStopAtMs) || hardStopAtMs <= constructedAt)) fail('READINESS_CONTINUITY_INPUT_INVALID');
    pinnedConfig = structuredClone(config); pinnedEvidence = structuredClone(evidence); pinnedArtifacts = structuredClone(artifacts);
  } catch { fail('READINESS_CONTINUITY_INPUT_INVALID'); }
  try { validateControlledRuntimeEvidence(pinnedConfig, pinnedEvidence, { now: constructedAt, allowDiagnosticsOnly: true }); }
  catch { fail('READINESS_EVIDENCE_INVALID'); }
  if (pinnedEvidence.producer_version !== 2 || pinnedEvidence.continuity_policy !== 'observed-runtime-continuity-v1') fail('READINESS_EVIDENCE_INVALID');
  if (!Array.isArray(pinnedArtifacts) || pinnedArtifacts.length !== pinnedConfig.roster.length) fail('READINESS_ARTIFACTS_INVALID');
  const bindings = new Map(pinnedConfig.roster.map(seat => {
    const row = pinnedEvidence.seats.find(row => row.seat_id === seat.seat_id);
    let artifact;
    try { artifact = checkedArtifact(pinnedConfig, seat, row, pinnedArtifacts); }
    catch { fail('READINESS_ARTIFACTS_INVALID'); }
    return [seat.seat_id, { seat, row, artifact }];
  }));
  const endAtMs = hardStopAtMs ?? Date.parse(pinnedEvidence.expires_at);

  function time(deadline = endAtMs) {
    const value = now();
    if (!Number.isSafeInteger(value) || value < constructedAt || value >= Math.min(deadline, endAtMs)) fail('READINESS_DEADLINE_EXPIRED');
    return value;
  }
  function bindingFor(seat) {
    const binding = bindings.get(seat?.seat_id);
    if (!binding || !equal(binding.seat, seat)) fail('READINESS_CONTINUITY_INPUT_INVALID');
    return binding;
  }
  async function bounded(operation, deadline, code) {
    const remaining = Math.min(deadline, endAtMs) - time(deadline);
    let timer;
    try {
      const result = await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('READINESS_DEADLINE_EXPIRED'), { code: 'READINESS_DEADLINE_EXPIRED' })), remaining);
      })]);
      time(deadline); return result;
    } catch (error) {
      if (error?.code === 'READINESS_DEADLINE_EXPIRED') fail('READINESS_DEADLINE_EXPIRED', error);
      fail(code, error);
    } finally { clearTimeout(timer); }
  }

  async function inspect({ seat, execute, getAgent }, deadline) {
    const { seat: expected, row, artifact } = bindingFor(seat);
    if (typeof execute !== 'function' || typeof getAgent !== 'function') fail('READINESS_CONTINUITY_INPUT_INVALID');
    const run = (command, code) => bounded(() => execute(structuredClone(command)), deadline, code);
    const agent = async () => {
      const current = await bounded(getAgent, deadline, 'READINESS_LIFECYCLE_UNCONFIRMED');
      if (!exact(current, ['id', 'framework', 'status']) || current.id !== expected.agent_id ||
          current.framework !== expected.harness || current.status !== 'active') fail('READINESS_LIFECYCLE_UNCONFIRMED');
    };
    const instanceCommand = ['node', '--input-type=module', '-e', `
import { pathToFileURL } from 'node:url';
try {
 const { readRuntimeInstanceFingerprint } = await import(pathToFileURL(process.argv[1]).href);
 process.stdout.write(JSON.stringify({schema_version:1,runtime_instance_fingerprint:await readRuntimeInstanceFingerprint()}));
} catch { process.exitCode=1; }
`, posix.join(posix.dirname(artifact.gameplay_command[1]), 'execution-permit.mjs')];
    const instance = async () => {
      const result = jsonResult(await run(instanceCommand, 'READINESS_MIXED_GENERATION'), 'READINESS_MIXED_GENERATION');
      if (!exact(result, ['schema_version', 'runtime_instance_fingerprint']) || result.schema_version !== 1 ||
          result.runtime_instance_fingerprint !== row.runtime_instance_fingerprint) fail('READINESS_MIXED_GENERATION');
    };
    await agent();
    // The module performing the incarnation check must itself be the pinned bytes.
    let artifactFailure;
    try { await verifyPublicArtifactIntegrity(artifact, async command => {
      try { return await run(command, 'READINESS_ARTIFACTS_INVALID'); }
      catch (error) { artifactFailure = failureMetadata(error); throw error; }
    }); }
    catch (error) { fail(error?.code === 'READINESS_DEADLINE_EXPIRED' ? error.code : 'READINESS_ARTIFACTS_INVALID', artifactFailure ?? error); }
    await instance();
    const direct = jsonResult(await run(artifact.inspect_command, 'READINESS_INSPECTION_FAILED'), 'READINESS_INSPECTION_FAILED');
    if (!exact(direct, ['schema_version', 'seat_id', 'wallet_address', 'chain_id', 'persistent_storage_writable', 'gameplay_execution_proven']) ||
        direct.schema_version !== 1 || direct.seat_id !== expected.seat_id || direct.wallet_address?.toLowerCase() !== expected.wallet_address.toLowerCase() ||
        direct.chain_id !== 84532 || direct.persistent_storage_writable !== true || direct.gameplay_execution_proven !== false) fail('READINESS_INSPECTION_FAILED');
    const model = jsonResult(await run(artifact.model_config_check_command, 'READINESS_MODEL_INVALID'), 'READINESS_MODEL_INVALID');
    if (!exact(model, ['schema_version', 'seat_id', 'harness', 'configured', 'model', 'reasoning_effort', 'max_output_tokens',
      'automatic_fallback', 'fallback_model', 'response_metadata_required']) || model.schema_version !== 1 ||
        model.seat_id !== expected.seat_id || model.harness !== expected.harness || model.configured !== true ||
        model.model !== row.model_profile.model || model.reasoning_effort !== row.model_profile.reasoning_effort ||
        model.max_output_tokens !== row.model_profile.max_output_tokens || model.automatic_fallback !== false ||
        model.fallback_model !== null || model.response_metadata_required !== true) fail('READINESS_MODEL_INVALID');
    const route = jsonResult(await run(artifact.model_route_check_command, 'READINESS_MODEL_ROUTE_UNVERIFIED'), 'READINESS_MODEL_ROUTE_UNVERIFIED');
    if (!exact(route, ['schema_version', 'seat_id', 'model_route_verified']) || route.schema_version !== 1 ||
        route.seat_id !== expected.seat_id || route.model_route_verified !== true) fail('READINESS_MODEL_ROUTE_UNVERIFIED');
    for (const [mode, key] of [['gameplay-input', 'gameplay_input'], ['commit-input', 'commit_input']]) {
      const original = { schema_version: 1, type: 'runtime-diagnostic', request_id: row.diagnostics[key].request_id,
        seat_id: expected.seat_id, team: expected.team, mode, chain_state: { chain_id: 84532,
          game_address: pinnedConfig.game_address.toLowerCase(), confirmed_block_number: pinnedEvidence.confirmed_block_number,
          confirmed_block_hash: pinnedEvidence.confirmed_block_hash } };
      const receipt = jsonResult(await run(buildDiagnosticReceiptReadCommand(artifact, original), 'READINESS_DIAGNOSTIC_RECEIPT_INVALID'),
        'READINESS_DIAGNOSTIC_RECEIPT_INVALID');
      try { validateDiagnosticReceipt(receipt, original, row.diagnostics[key]); }
      catch { fail('READINESS_DIAGNOSTIC_RECEIPT_INVALID'); }
    }
    // Detect replacement or lifecycle changes while the checks ran. Player CLI
    // rechecks the incarnation inside its lock before any signing operation.
    artifactFailure = undefined;
    try { await verifyPublicArtifactIntegrity(artifact, async command => {
      try { return await run(command, 'READINESS_ARTIFACTS_INVALID'); }
      catch (error) { artifactFailure = failureMetadata(error); throw error; }
    }); }
    catch (error) { fail(error?.code === 'READINESS_DEADLINE_EXPIRED' ? error.code : 'READINESS_ARTIFACTS_INVALID', artifactFailure ?? error); }
    await instance(); await agent();
    return VERIFIED;
  }

  return Object.freeze({
    async verify(args) { return inspect(args, Math.min(endAtMs, time() + 120_000)); },
    async prepareAction({ seat, request, execute, getAgent, deadlineAtMs } = {}) {
      if (!Number.isSafeInteger(deadlineAtMs)) fail('READINESS_DEADLINE_EXPIRED');
      const deadline = Math.min(deadlineAtMs, endAtMs);
      time(deadline);
      let pinnedRequest;
      try { pinnedRequest = structuredClone(request); }
      catch { fail('READINESS_PERMIT_UNVERIFIED'); }
      await inspect({ seat, execute, getAgent }, deadline);
      const { artifact } = bindingFor(seat);
      let envelope, command;
      try {
        const current = time(deadline);
        envelope = buildExecutionPermit({ config: pinnedConfig, evidence: pinnedEvidence, artifact,
          request: pinnedRequest, expiresAtMs: Math.min(deadline, current + 300_000), nowMs: current, hardStopAtMs: endAtMs });
        command = buildExecutionPermitStageCommand({ artifact, permit: envelope });
      } catch (error) { fail(error?.code === 'READINESS_DEADLINE_EXPIRED' ? error.code : 'READINESS_PERMIT_UNVERIFIED', error); }
      const staged = jsonResult(await bounded(() => execute(structuredClone(command)), deadline, 'READINESS_PERMIT_UNVERIFIED'), 'READINESS_PERMIT_UNVERIFIED');
      if (!exact(staged, ['schema_version', 'staged', 'request_id', 'permit_sha256']) || staged.schema_version !== 1 ||
          staged.staged !== true || staged.request_id !== pinnedRequest.request_id ||
          staged.permit_sha256 !== executionPermitFingerprint(envelope.permit)) fail('READINESS_PERMIT_UNVERIFIED');
      return VERIFIED;
    },
  });
}
