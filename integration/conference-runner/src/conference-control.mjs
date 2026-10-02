#!/usr/bin/env node
import { readFile, realpath, lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, assertCoordinatorEnvironment, REPOSITORY_ROOT } from './config.mjs';
import { buildInstallArtifact } from './maritime/install.mjs';
import { loadCoordinatorSecrets } from './live-secrets.mjs';

export const CONFERENCE_CONTROL_VERSION = 2;
const COMMANDS = new Set(['plan', 'status', 'diagnose', 'proof-plan', 'proof-status', 'proof-prepare', 'proof-run', 'proof-audit']);
const COMMON = ['config', 'runtime-dir', 'artifact-plan', 'operations-manifest'];
const DIAGNOSTIC = [...COMMON, 'deadline', 'cleanup-deadline', 'secrets-env'];
const PROOF = ['config', 'evidence', 'readiness-dir', 'proof-dir', 'operator-dir', 'runner-dirs',
  'stop-new-games-at', 'hard-stop-at', 'secrets-env', 'artifact-plan', 'operations-manifest', 'verification-root'];
const RUN = [...PROOF, 'operator-pid', 'operator-url', 'scoreboard-bindings'];
const AUDIT = ['proof-dir', 'game-id', 'scoreboard-bindings', 'secrets-env', 'output'];
const HELP = `Conference control v2 (Node >=22)
  plan|status --config FILE --runtime-dir NEW_DIR --artifact-plan FILE --operations-manifest FILE
  diagnose (same paths) --deadline UTC_ISO --cleanup-deadline UTC_ISO --secrets-env FILE
  proof-plan|proof-status|proof-prepare --config FILE --evidence FILE --readiness-dir DIR
    --proof-dir NEW_DIR --operator-dir DIR --runner-dirs JSON_ARRAY
    --stop-new-games-at UTC_ISO --hard-stop-at UTC_ISO --secrets-env FILE
    --artifact-plan FILE --operations-manifest FILE --verification-root EXISTING_PRIVATE_DIR
  proof-run (same proof paths/deadlines) --operator-pid PID --operator-url LOOPBACK_URL --scoreboard-bindings FILE
  proof-audit --proof-dir DIR --game-id ID --scoreboard-bindings FILE --secrets-env FILE --output NEW_FILE
All paths must be absolute. plan/status are local and read-only. proof-plan/proof-status
read chain/account metadata. diagnose wakes/configures/chats/sleeps agents but never signs.
proof-prepare wakes/inspects/sleeps all ten and writes a fresh preparation; it never signs.
proof-run revalidates all ten immediately before at most one game creation, then runs gameplay.
proof-audit reads chain/Telegram and writes a separate audit; it never overwrites the run report.
Live operations require an explicitly authorized window. This CLI does not load signing keys.
`;

function fail(code) { throw new Error(code); }
function absolute(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\0\r\n]/.test(value) ||
      path.normalize(value) !== value) fail('CONTROL_ABSOLUTE_PATH_REQUIRED');
  return value;
}
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) ||
      !Number.isSafeInteger(Date.parse(value))) fail('CONTROL_DEADLINE_INVALID');
  return Date.parse(value);
}
export function parseControlArguments(argv) {
  const [command, ...rest] = argv;
  if (['--help', '--version'].includes(command) && rest.length === 0) return { command, args: {} };
  if (!COMMANDS.has(command) || rest.length % 2 !== 0) fail('CONTROL_ARGUMENTS_INVALID');
  const permitted = new Set(command === 'proof-run' ? RUN : command === 'proof-audit' ? AUDIT :
    command.startsWith('proof-') ? PROOF : command === 'diagnose' ? DIAGNOSTIC : COMMON);
  const args = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index].replace(/^--/, '');
    if (!rest[index].startsWith('--') || !permitted.has(key) || Object.hasOwn(args, key) ||
        !rest[index + 1]) fail('CONTROL_ARGUMENTS_INVALID');
    args[key] = rest[index + 1];
  }
  for (const key of permitted) if (!Object.hasOwn(args, key)) fail('CONTROL_ARGUMENTS_REQUIRED');
  for (const [key, value] of Object.entries(args)) {
    if (['deadline', 'cleanup-deadline', 'stop-new-games-at', 'hard-stop-at'].includes(key)) timestamp(value);
    else if (key === 'runner-dirs') {
      let directories; try { directories = JSON.parse(value); } catch { fail('CONTROL_RUNNER_DIRS_INVALID'); }
      if (!Array.isArray(directories) || directories.length === 0 || directories.some(item => typeof item !== 'string') ||
          new Set(directories).size !== directories.length) fail('CONTROL_RUNNER_DIRS_INVALID');
      directories.forEach(absolute);
    } else if (['operator-pid', 'game-id'].includes(key)) {
      if (!/^[1-9][0-9]*$/.test(value) || key === 'operator-pid' && !Number.isSafeInteger(Number(value))) fail('CONTROL_ARGUMENTS_INVALID');
    } else if (key === 'operator-url') {
      let url; try { url = new URL(value); } catch { fail('CONTROL_OPERATOR_URL_INVALID'); }
      if (url.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(url.hostname) ||
          url.username || url.password || url.search || url.hash || url.pathname !== '/') fail('CONTROL_OPERATOR_URL_INVALID');
    } else absolute(value);
  }
  return { command, args };
}

export async function buildControlArtifacts({ config, artifactPlan, operationsManifest }) {
  if (!artifactPlan || Object.keys(artifactPlan).sort().join() !== 'schema_version,seats' ||
      artifactPlan.schema_version !== 1 || !Array.isArray(artifactPlan.seats) ||
      artifactPlan.seats.length !== config.roster.length) fail('CONTROL_ARTIFACT_PLAN_INVALID');
  const artifacts = [];
  for (const seat of config.roster) {
    const matches = artifactPlan.seats.filter(row => row?.seat_id === seat.seat_id);
    if (matches.length !== 1 || Object.keys(matches[0]).sort().join() !== 'persistent_root,seat_id') {
      fail('CONTROL_ARTIFACT_PLAN_INVALID');
    }
    absolute(matches[0].persistent_root);
    artifacts.push(await buildInstallArtifact({ config, seatId: seat.seat_id,
      persistentRoot: matches[0].persistent_root, operationsManifest }));
  }
  return artifacts;
}

const json = async filename => JSON.parse(await readFile(filename, 'utf8'));
async function verificationRoot(value) {
  const canonical = await realpath(value);
  const repository = await realpath(REPOSITORY_ROOT);
  const relative = path.relative(repository, canonical);
  const metadata = await lstat(value);
  if (canonical !== value || !metadata.isDirectory() || metadata.isSymbolicLink() ||
      (metadata.mode & 0o077) !== 0 || relative === '' ||
      (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    fail('CONTROL_VERIFICATION_ROOT_INVALID');
  }
  return canonical;
}
// Only owned codes may cross stdout/stderr. Regex-shaped provider text is still
// provider text, so arbitrary uppercase exception strings are not accepted.
export function controlErrorCode(error) {
  const code = error?.code ?? error?.message;
  return CONTROL_CODES.has(code) ? code : 'CONTROL_OPERATION_FAILED';
}
const CONTROL_CODES = new Set([
  'CONTINUITY_RESULT_INVALID',
  'CONTINUITY_TIMEOUT',
  'CONTROL_ABSOLUTE_PATH_REQUIRED',
  'CONTROL_ARGUMENTS_INVALID',
  'CONTROL_ARGUMENTS_REQUIRED',
  'CONTROL_ARTIFACT_PLAN_INVALID',
  'CONTROL_DEADLINE_INVALID',
  'CONTROL_LIVE_CONFIG_REQUIRED',
  'CONTROL_OPERATION_FAILED',
  'CONTROL_OPERATOR_URL_INVALID',
  'CONTROL_RUNNER_DIRS_INVALID',
  'CONTROL_TEN_SEATS_REQUIRED',
  'CONTROL_VERIFICATION_ROOT_INVALID',
  'COORDINATOR_ENV',
  'COORDINATOR_ENV_INVALID',
  'COORDINATOR_SIGNER_ENVIRONMENT_FORBIDDEN',
  'PLAYER_EXECUTION_PERMIT_INVALID',
  'PROOF_ABORTED',
  'PROOF_ABSOLUTE_PATH_REQUIRED',
  'PROOF_ACTIONS_UNVERIFIED',
  'PROOF_AGENT_OPERATION_FAILED',
  'PROOF_AGENT_OPERATION_UNCERTAIN',
  'PROOF_AUDIT_INPUT_INVALID',
  'PROOF_AUDIT_UNAVAILABLE',
  'PROOF_BINDINGS_CHANGED',
  'PROOF_CANONICAL_BLOCK_CHANGED',
  'PROOF_CANONICAL_BLOCK_UNAVAILABLE',
  'PROOF_CHAIN_LOG_INVALID',
  'PROOF_CHAIN_MISMATCH',
  'PROOF_CHAIN_NOT_READY',
  'PROOF_CHAIN_READ_FAILED',
  'PROOF_CHAIN_REORG',
  'PROOF_CHAIN_UNCONFIRMED',
  'PROOF_CLOCK_INVALID',
  'PROOF_CREATE_INTENT_INVALID',
  'PROOF_CREATE_SOURCE_BLOCK_INVALID',
  'PROOF_CREATION_UNCERTAIN',
  'PROOF_CREATION_UNVERIFIED',
  'PROOF_CURRENT_READINESS_REQUIRED',
  'PROOF_CURRENT_READINESS_UNVERIFIED',
  'PROOF_DEADLINE_EXCEEDED',
  'PROOF_DEADLINE_INVALID',
  'PROOF_DEFAULTED_ACTIONS',
  'PROOF_DIRECTORY_EXISTS',
  'PROOF_DISCUSSION_UNVERIFIED',
  'PROOF_DISPATCH_UNRESOLVED',
  'PROOF_DISPATCH_UNVERIFIED',
  'PROOF_DUPLICATE_RUNNER_DIRECTORY',
  'PROOF_EXCLUSIVE_WRITE_FAILED',
  'PROOF_FILE_INVALID',
  'PROOF_GAME_IDENTITY_CHANGED',
  'PROOF_GAME_IDENTITY_UNVERIFIED',
  'PROOF_HARD_DEADLINE',
  'PROOF_INPUT_CHANGED_DURING_VALIDATION',
  'PROOF_JOURNAL_INVALID',
  'PROOF_JOURNAL_RECEIPT_UNAVAILABLE',
  'PROOF_JOURNAL_REORGED',
  'PROOF_JOURNAL_UNRESOLVED',
  'PROOF_LAUNCHER_REQUIRED',
  'PROOF_LAUNCH_WINDOW_CLOSED',
  'PROOF_LOCK_AMBIGUOUS',
  'PROOF_LOCK_RECOVERY_UNRESOLVED',
  'PROOF_MULTIPLE_GAMES_OBSERVED',
  'PROOF_MUTATING_VERIFICATION_REQUIRED',
  'PROOF_NONCE_UNAVAILABLE',
  'PROOF_ONE_GAME_FUSE_USED',
  'PROOF_OPERATOR_LOCK_AMBIGUOUS',
  'PROOF_OPERATOR_LOCK_CHANGED',
  'PROOF_OPERATOR_LOCK_MISSING',
  'PROOF_OPERATOR_PID_INVALID',
  'PROOF_OPERATOR_PID_UNVERIFIED',
  'PROOF_OPERATOR_UNRESOLVED',
  'PROOF_OWNED_LOCK_CHANGED',
  'PROOF_OWNED_LOCK_MISSING',
  'PROOF_OWNED_PROCESSES_INVALID',
  'PROOF_OWNED_PROCESS_PATH_INVALID',
  'PROOF_PATH_OVERLAP',
  'PROOF_PATH_TYPE_INVALID',
  'PROOF_PATH_UNAVAILABLE',
  'PROOF_PATH_UNREADABLE',
  'PROOF_PAUSE_FAILED',
  'PROOF_PENDING_NONCE',
  'PROOF_PHASE_IDENTITY_UNVERIFIED',
  'PROOF_PHASE_UNCERTAIN',
  'PROOF_PLAYER_RECEIPT_UNVERIFIED',
  'PROOF_PREFLIGHT_FILE_INVALID',
  'PROOF_PREFLIGHT_PATH_INVALID',
  'PROOF_PREPARATION_REQUIRES_STOPPED_PROCESSES',
  'PROOF_PREPARED_CONFIG_INVALID',
  'PROOF_PROCESS_ACTIVE',
  'PROOF_PROCESS_RUNNING',
  'PROOF_READINESS_BINDINGS_REQUIRED',
  'PROOF_READINESS_NOT_CURRENT',
  'PROOF_READ_ADAPTER_REQUIRED',
  'PROOF_READ_FAILED',
  'PROOF_RECEIPT_UNVERIFIED',
  'PROOF_REPORT_WRITE_FAILED',
  'PROOF_RESULT_AWARDS_UNVERIFIED',
  'PROOF_RESULT_DELIVERY_UNVERIFIED',
  'PROOF_RESULT_EVENT_UNVERIFIED',
  'PROOF_RESULT_UNVERIFIED',
  'PROOF_ROSTER_UNVERIFIED',
  'PROOF_RUNNER_CLOSE_FAILED',
  'PROOF_RUNNER_DIRECTORIES_REQUIRED',
  'PROOF_RUNNER_HEALTH_BLOCKED',
  'PROOF_RUNNER_INITIALIZATION_FAILED',
  'PROOF_RUNNER_OWNERSHIP_UNVERIFIED',
  'PROOF_RUNNER_TICK_FAILED',
  'PROOF_RUN_ABORTED',
  'PROOF_RUN_ADAPTER_REQUIRED',
  'PROOF_RUN_ALREADY_STARTED',
  'PROOF_RUN_AUDIT_BINDINGS_INVALID',
  'PROOF_RUN_AUDIT_CHAIN_UNAVAILABLE',
  'PROOF_RUN_AUDIT_EVIDENCE_INVALID',
  'PROOF_RUN_AUDIT_FILE_INVALID',
  'PROOF_RUN_AUDIT_FUSE_MISMATCH',
  'PROOF_RUN_AUDIT_INCOMPLETE',
  'PROOF_RUN_AUDIT_INPUT_BINDING_MISMATCH',
  'PROOF_RUN_AUDIT_INPUT_CHANGED',
  'PROOF_RUN_AUDIT_INPUT_INVALID',
  'PROOF_RUN_AUDIT_OUTPUT_EXISTS',
  'PROOF_RUN_AUDIT_OUTSIDE_REPOSITORY_REQUIRED',
  'PROOF_RUN_AUDIT_PATH_INVALID',
  'PROOF_RUN_AUDIT_PREPARED_CONFIG_MISMATCH',
  'PROOF_RUN_AUDIT_READINESS_HISTORY_MISMATCH',
  'PROOF_RUN_AUDIT_REPORT_MISMATCH',
  'PROOF_RUN_AUDIT_RESULT_INVALID',
  'PROOF_RUN_AUDIT_SCOREBOARDS_UNAVAILABLE',
  'PROOF_RUN_AUDIT_SCOREBOARD_BINDINGS_INVALID',
  'PROOF_RUN_AUDIT_TEN_SEATS_REQUIRED',
  'PROOF_RUN_AUDIT_VERIFICATION_MISMATCH',
  'PROOF_RUN_AUDIT_WRITE_FAILED',
  'PROOF_RUN_CLOCK_INVALID',
  'PROOF_RUN_FAILED',
  'PROOF_RUN_PATH_UNAVAILABLE',
  'PROOF_RUN_SNAPSHOT_INVALID',
  'PROOF_RUN_STOPPED',
  'PROOF_RUN_UNEXPECTED_OWNERSHIP',
  'PROOF_SCOREBOARD_HEALTH_INVALID',
  'PROOF_SCOREBOARD_SCOPE_INVALID',
  'PROOF_SCOREBOARD_UNRESOLVED',
  'PROOF_SPECTATOR_CONFIG_INVALID',
  'PROOF_SPECTATOR_HEALTH_INVALID',
  'PROOF_SPECTATOR_HEALTH_UNAVAILABLE',
  'PROOF_SPECTATOR_OUTBOX_UNRESOLVED',
  'PROOF_SPECTATOR_STATE_CHANGED',
  'PROOF_SPECTATOR_UNCERTAIN',
  'PROOF_STATE_MUST_BE_OUTSIDE_REPOSITORY',
  'PROOF_TELEGRAM_IDENTITY_UNVERIFIED',
  'PROOF_TELEGRAM_PERMISSIONS_UNVERIFIED',
  'PROOF_TELEGRAM_PIN_UNVERIFIED',
  'PROOF_TELEGRAM_READ_FAILED',
  'PROOF_TELEGRAM_SCOPE_MISMATCH',
  'PROOF_TELEGRAM_UNDELIVERED',
  'PROOF_VERSIONED_CLI_REQUIRED',
  'PROOF_WINDOW_CLOSED',
  'READINESS_ARTIFACTS_INVALID',
  'READINESS_CAPACITY_UNAVAILABLE',
  'READINESS_CHAIN_CHANGED',
  'READINESS_CHAIN_DEFAULTS_INVALID',
  'READINESS_CHAIN_INVALID',
  'READINESS_CHAIN_REQUIRED',
  'READINESS_CLOCK_INVALID',
  'READINESS_CONTINUITY_INPUT_INVALID',
  'READINESS_CONTINUITY_POLICY_REQUIRED',
  'READINESS_CREDENTIAL_REQUIRED',
  'READINESS_DEADLINE_EXCEEDED',
  'READINESS_DEADLINE_EXPIRED',
  'READINESS_DEADLINE_INVALID',
  'READINESS_DIAGNOSTIC_RECEIPT_INVALID',
  'READINESS_DIRECTORY_ALREADY_EXISTS',
  'READINESS_DIRECTORY_INVALID',
  'READINESS_DIRECTORY_IN_REPOSITORY',
  'READINESS_EVIDENCE_INVALID',
  'READINESS_HARNESS_INVALID',
  'READINESS_INITIAL_LIFECYCLE_INVALID',
  'READINESS_INSPECTION_FAILED',
  'READINESS_INVENTORY_INVALID',
  'READINESS_LIFECYCLE_UNCONFIRMED',
  'READINESS_MIXED_GENERATION',
  'READINESS_MODEL_INVALID',
  'READINESS_MODEL_ROUTE_UNVERIFIED',
  'READINESS_OPERATION_FAILED',
  'READINESS_PERMIT_UNVERIFIED',
  'READINESS_REMOTE_GENERATION_UNATTESTED',
  'READINESS_RUN_ABANDONED',
  'READINESS_RUN_ALREADY_STARTED',
  'READINESS_RUN_EXISTS',
  'READINESS_RUN_FAILED',
  'READINESS_RUN_FAILED_SLEEP_UNCONFIRMED',
  'READINESS_SLEEP_REPLAY_FORBIDDEN',
  'READINESS_SLEEP_UNCONFIRMED',
  'READINESS_STATE_INVALID',
  'READINESS_TEN_SEATS_REQUIRED',
  'READINESS_TRANSPORT_SCOPE_INVALID',
  'READINESS_VERIFICATION_ABORTED',
  'READINESS_VERIFICATION_FAILED',
  'READINESS_VERIFICATION_FAILED_SLEEP_UNCONFIRMED',
  'READINESS_VOLUME_INVALID',
  'RUNTIME_ABSOLUTE_PATH_REQUIRED',
  'RUNTIME_CODE_HASH_REQUIRED',
  'RUNTIME_DIAGNOSTIC_CHOICE_FORBIDDEN',
  'RUNTIME_DIAGNOSTIC_CHOICE_INVALID',
  'RUNTIME_DIAGNOSTIC_IDENTITY_REUSED',
  'RUNTIME_DIAGNOSTIC_REQUEST_INVALID',
  'RUNTIME_DIAGNOSTIC_REQUIRED',
  'RUNTIME_DIAGNOSTIC_RESPONSE_IDENTITY_MISMATCH',
  'RUNTIME_DIAGNOSTIC_RESPONSE_INVALID',
  'RUNTIME_ENV_RELOAD_OUTCOME_UNKNOWN',
  'RUNTIME_EVIDENCE_BLOCK_REQUIRED',
  'RUNTIME_EVIDENCE_CLOCK_INVALID',
  'RUNTIME_EVIDENCE_EXPIRED',
  'RUNTIME_EVIDENCE_IDENTITY_MISMATCH',
  'RUNTIME_EVIDENCE_INPUT_INVALID',
  'RUNTIME_EVIDENCE_PRIVATE_FIELD',
  'RUNTIME_EVIDENCE_TIME_REQUIRED',
  'RUNTIME_EVIDENCE_UNEXPECTED_FIELD',
  'RUNTIME_IDENTITY_MISMATCH',
  'RUNTIME_INSTALL_IDENTITY_CHANGED',
  'RUNTIME_INSTALL_OUTCOME_UNKNOWN',
  'RUNTIME_LIFECYCLE_EVIDENCE_REQUIRED',
  'RUNTIME_MODEL_PROFILE_UNVERIFIED',
  'RUNTIME_MUST_BE_OUTSIDE_REPOSITORY',
  'RUNTIME_PRODUCER_BINDING_INVALID',
  'RUNTIME_PRODUCER_GENERATION_MISMATCH',
  'RUNTIME_PRODUCER_REQUIRED',
  'RUNTIME_SDK_UNVERIFIED',
  'RUNTIME_SEAT_IDENTITY_MISMATCH',
  'RUNTIME_VERIFICATION_INPUT_INVALID',
  'RUNTIME_VERIFICATION_INVALID',
  'RUNTIME_VERIFICATION_ROTATION_UNKNOWN',
  'RUNTIME_VERIFICATION_UNAVAILABLE',
]);

export async function runConferenceControl(argv, dependencies = {}) {
  const { command, args } = parseControlArguments(argv);
  if (command === '--help') return { text: HELP };
  if (command === '--version') return { schema_version: 1, cli_version: CONFERENCE_CONTROL_VERSION };
  assertCoordinatorEnvironment(dependencies.env ?? process.env);
  const config = await (dependencies.loadConfig ?? loadConfig)(command === 'proof-audit' ?
    path.join(args['proof-dir'], 'config.json') : args.config);
  if (config.mode !== 'live') fail('CONTROL_LIVE_CONFIG_REQUIRED');
  if (config.roster.length !== 10 || ['openclaw', 'hermes'].some(team =>
    config.roster.filter(seat => seat.team === team).length !== 5)) fail('CONTROL_TEN_SEATS_REQUIRED');
  if (command === 'proof-audit') {
    const secrets = await (dependencies.loadSecrets ?? loadCoordinatorSecrets)(args['secrets-env']);
    const { makeProvider } = dependencies.chainModule ?? await import('./chain/reader.mjs');
    const provider = makeProvider(config.rpc_url);
    try {
      const audit = dependencies.audit ?? await import('./proof-run-audit.mjs');
      return await audit.auditProofRun({ directory: args['proof-dir'], gameId: args['game-id'],
        scoreboardBindingsPath: args['scoreboard-bindings'], outputPath: args.output,
        provider, token: secrets.TELEGRAM_BOT_TOKEN });
    } finally { provider.destroy(); }
  }
  const readiness = dependencies.readiness ?? await import('./maritime/readiness-run.mjs');
  if (!command.startsWith('proof-')) {
    const artifacts = await buildControlArtifacts({ config,
      artifactPlan: await json(args['artifact-plan']), operationsManifest: await json(args['operations-manifest']) });
    const inputs = { config, runtimeDir: args['runtime-dir'], artifacts };
    // No credential loader, provider, SDK, or network client is constructed here.
    if (command !== 'diagnose') return readiness.createReadinessRun(inputs)[command]();
    const secrets = await (dependencies.loadSecrets ?? loadCoordinatorSecrets)(args['secrets-env']);
    const { makeProvider, createChainReader } = dependencies.chainModule ?? await import('./chain/reader.mjs');
    const provider = makeProvider(config.rpc_url);
    try {
      const result = await readiness.createReadinessRun({ ...inputs,
        deadlineAtMs: timestamp(args.deadline), cleanupDeadlineAtMs: timestamp(args['cleanup-deadline']),
        apiKey: secrets.MARITIME_API_KEY, chain: createChainReader({ config, provider }) }).run();
      return { schema_version: 1, cli_version: CONFERENCE_CONTROL_VERSION, diagnostics_complete: result.evidence.diagnostics_complete,
        ready_for_controlled_gameplay: result.evidence.ready_for_controlled_gameplay,
        evidence_sha256: result.evidenceDigest };
    } finally { provider.destroy(); }
  }
  const proof = dependencies.proof ?? await import('./proof-control.mjs');
  const artifacts = await buildControlArtifacts({ config,
    artifactPlan: await json(args['artifact-plan']), operationsManifest: await json(args['operations-manifest']) });
  const verificationDirectory = await verificationRoot(args['verification-root']);
  const secrets = await (dependencies.loadSecrets ?? loadCoordinatorSecrets)(args['secrets-env']);
  const { makeProvider, createChainReader } = dependencies.chainModule ?? await import('./chain/reader.mjs');
  const provider = makeProvider(config.rpc_url);
  try {
    const options = { configPath: args.config, evidencePath: args.evidence,
      readinessDirectory: args['readiness-dir'], directory: args['proof-dir'],
      operatorDirectory: args['operator-dir'], runnerDirectories: JSON.parse(args['runner-dirs']),
      verificationRoot: verificationDirectory, signal: dependencies.signal,
      stopNewGamesAtMs: timestamp(args['stop-new-games-at']), hardStopAtMs: timestamp(args['hard-stop-at']),
      provider, chain: createChainReader({ config, provider }),
      validateReadinessCurrent: parameters => readiness.verifyReadinessCurrent({ ...parameters,
        runtimeDir: args['readiness-dir'], artifacts,
        verificationDir: parameters.readOnly ? undefined : path.join(verificationDirectory, `verification-${randomUUID()}`),
        now: Date.now, apiKey: secrets.MARITIME_API_KEY }) };
    if (command === 'proof-run') {
      const preflight = dependencies.livePreflight ?? await import('./proof-live-preflight.mjs');
      const owner = await preflight.inspectProofOperator({ operatorDirectory: args['operator-dir'], expectedPid: Number(args['operator-pid']) });
      const scoreboard = await json(args['scoreboard-bindings']);
      options.ownedProcesses = [owner];
      const prepared = await proof.validatePreparedProof({ ...options, readOnly: true });
      await preflight.verifyProofSpectators({ config: prepared.preparedConfig, scoreboard, token: secrets.TELEGRAM_BOT_TOKEN });
      const { createRuntimeContinuity } = dependencies.continuity ?? await import('./maritime/continuity.mjs');
      const runtimeContinuity = createRuntimeContinuity({ config, evidence: await json(args.evidence), artifacts,
        hardStopAtMs: options.hardStopAtMs });
      const { createMaritimeAdapter } = dependencies.maritime ?? await import('./maritime/transport.mjs');
      const agents = createMaritimeAdapter({ config: prepared.preparedConfig, apiKey: secrets.MARITIME_API_KEY,
        runtimeEvidence: { schema_version: 2, run_id: config.run_id, seats: artifacts }, runtimeContinuity,
        maxAwake: 5, maxAgents: 10, timeoutMs: prepared.preparedConfig.agent_timeout_ms ?? 120_000 });
      const { createOperatorAdapters } = dependencies.operator ?? await import('./operator.mjs');
      const operator = createOperatorAdapters({ url: args['operator-url'], token: secrets.DILEMMA_LAUNCHER_TOKEN });
      const { createTelegramMirror } = dependencies.telegram ?? await import('./telegram/index.mjs');
      const spectator = createTelegramMirror({ config: prepared.preparedConfig,
        runtimeDir: path.join(args['proof-dir'], 'runtime'), token: secrets.TELEGRAM_BOT_TOKEN, scoreboard });
      const { runControlledProof } = dependencies.execution ?? await import('./proof-run.mjs');
      const result = await runControlledProof({ proofOptions: options, agents, ...operator, spectator, signal: dependencies.signal });
      return { schema_version: 1, cli_version: CONFERENCE_CONTROL_VERSION, status: result.status,
        game_id: result.game_id, launch_attempts: result.launch_attempts,
        candidate_proof_complete: result.candidate_proof_complete, proof_complete: false,
        awaiting_independent_audit: result.awaiting_independent_audit, failure: result.failure };
    }
    options.readOnly = command !== 'proof-prepare';
    const method = { 'proof-plan': 'planControlledProof', 'proof-status': 'validatePreparedProof',
      'proof-prepare': 'prepareControlledProof' }[command];
    const result = await proof[method](options);
    return { schema_version: 1, cli_version: CONFERENCE_CONTROL_VERSION, status: result.status,
      read_only: command !== 'proof-prepare', ready_for_creation: false,
      verification_required: command !== 'proof-prepare' };
  } finally { provider.destroy(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (['proof-run', 'proof-prepare'].includes(process.argv[2])) {
    process.once('SIGINT', abort);
    process.once('SIGTERM', abort);
  }
  runConferenceControl(process.argv.slice(2), { signal: controller.signal }).then(result => {
    process.stdout.write(result.text ?? `${JSON.stringify(result)}\n`);
    if (process.argv[2] === 'proof-audit' && result.proof_complete !== true) process.exitCode = 2;
  }).catch(error => {
    process.stderr.write(`${JSON.stringify({ schema_version: 1, cli_version: CONFERENCE_CONTROL_VERSION, error_code: controlErrorCode(error) })}\n`);
    process.exitCode = 1;
  }).finally(() => {
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
  });
}
