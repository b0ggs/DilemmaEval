#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, assertCoordinatorEnvironment } from './config.mjs';
import { buildInstallArtifact } from './maritime/install.mjs';
import { loadCoordinatorSecrets } from './live-secrets.mjs';

export const CONFERENCE_CONTROL_VERSION = 1;
const COMMANDS = new Set(['plan', 'status', 'diagnose', 'proof-plan', 'proof-status', 'proof-prepare']);
const COMMON = ['config', 'runtime-dir', 'artifact-plan', 'operations-manifest'];
const DIAGNOSTIC = [...COMMON, 'deadline', 'cleanup-deadline', 'secrets-env'];
const PROOF = ['config', 'evidence', 'readiness-dir', 'proof-dir', 'operator-dir', 'runner-dirs',
  'stop-new-games-at', 'hard-stop-at', 'secrets-env'];
const HELP = `Conference control v1 (Node >=22)
  plan|status --config FILE --runtime-dir NEW_DIR --artifact-plan FILE --operations-manifest FILE
  diagnose (same paths) --deadline UTC_ISO --cleanup-deadline UTC_ISO --secrets-env FILE
  proof-plan|proof-status|proof-prepare --config FILE --evidence FILE --readiness-dir DIR
    --proof-dir NEW_DIR --operator-dir DIR --runner-dirs JSON_ARRAY
    --stop-new-games-at UTC_ISO --hard-stop-at UTC_ISO --secrets-env FILE
All paths must be absolute. plan/status are local and read-only. proof-plan/proof-status
read chain/account metadata. diagnose wakes/configures/chats/sleeps agents but never signs.
proof-prepare writes a new local preparation only. There is no game creation command.
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
  const permitted = new Set(command.startsWith('proof-') ? PROOF : command === 'diagnose' ? DIAGNOSTIC : COMMON);
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
// Only owned codes may cross stdout/stderr. Regex-shaped provider text is still
// provider text, so arbitrary uppercase exception strings are not accepted.
export function controlErrorCode(error) {
  const code = error?.code ?? error?.message;
  return CONTROL_CODES.has(code) ? code : 'CONTROL_OPERATION_FAILED';
}
const CONTROL_CODES = new Set([
  'PROOF_OWNED_LOCK_CHANGED',
  'PROOF_OWNED_LOCK_MISSING',
  'PROOF_OWNED_PROCESSES_INVALID',
  'PROOF_OWNED_PROCESS_PATH_INVALID',
  'PROOF_PREPARATION_REQUIRES_STOPPED_PROCESSES',
  'READINESS_HARNESS_INVALID',
  'READINESS_MODEL_ROUTE_UNVERIFIED',
  'READINESS_RUN_ABANDONED',
  'PROOF_ABSOLUTE_PATH_REQUIRED',
  'PROOF_CANONICAL_BLOCK_CHANGED',
  'PROOF_CANONICAL_BLOCK_UNAVAILABLE',
  'PROOF_CHAIN_NOT_READY',
  'PROOF_CHAIN_READ_FAILED',
  'PROOF_CLOCK_INVALID',
  'PROOF_CREATE_INTENT_INVALID',
  'PROOF_CREATE_SOURCE_BLOCK_INVALID',
  'PROOF_CURRENT_READINESS_REQUIRED',
  'PROOF_CURRENT_READINESS_UNVERIFIED',
  'PROOF_DEADLINE_EXCEEDED',
  'PROOF_DEADLINE_INVALID',
  'PROOF_DUPLICATE_RUNNER_DIRECTORY',
  'PROOF_EXCLUSIVE_WRITE_FAILED',
  'PROOF_FILE_INVALID',
  'PROOF_INPUT_CHANGED_DURING_VALIDATION',
  'PROOF_JOURNAL_INVALID',
  'PROOF_JOURNAL_RECEIPT_UNAVAILABLE',
  'PROOF_JOURNAL_REORGED',
  'PROOF_JOURNAL_UNRESOLVED',
  'PROOF_LAUNCHER_REQUIRED',
  'PROOF_LOCK_AMBIGUOUS',
  'PROOF_LOCK_RECOVERY_UNRESOLVED',
  'PROOF_NONCE_UNAVAILABLE',
  'PROOF_ONE_GAME_FUSE_USED',
  'PROOF_PATH_OVERLAP',
  'PROOF_PATH_TYPE_INVALID',
  'PROOF_PATH_UNAVAILABLE',
  'PROOF_PATH_UNREADABLE',
  'PROOF_PREPARED_CONFIG_INVALID',
  'PROOF_PROCESS_RUNNING',
  'PROOF_READINESS_BINDINGS_REQUIRED',
  'PROOF_READ_ADAPTER_REQUIRED',
  'PROOF_READ_FAILED',
  'PROOF_RUNNER_DIRECTORIES_REQUIRED',
  'PROOF_STATE_MUST_BE_OUTSIDE_REPOSITORY',
  'READINESS_ARTIFACTS_INVALID',
  'READINESS_CAPACITY_UNAVAILABLE',
  'READINESS_CHAIN_CHANGED',
  'READINESS_CHAIN_DEFAULTS_INVALID',
  'READINESS_CHAIN_INVALID',
  'READINESS_CLOCK_INVALID',
  'READINESS_INITIAL_LIFECYCLE_INVALID',
  'READINESS_INSPECTION_FAILED',
  'READINESS_INVENTORY_INVALID',
  'READINESS_LIFECYCLE_UNCONFIRMED',
  'READINESS_MIXED_GENERATION',
  'READINESS_MODEL_INVALID',
  'READINESS_OPERATION_FAILED',
  'READINESS_SLEEP_REPLAY_FORBIDDEN',
  'READINESS_TEN_SEATS_REQUIRED',
  'READINESS_TRANSPORT_SCOPE_INVALID',
  'READINESS_VOLUME_INVALID',
  'CONTROL_ARGUMENTS_INVALID', 'CONTROL_ARGUMENTS_REQUIRED', 'CONTROL_ABSOLUTE_PATH_REQUIRED',
  'CONTROL_DEADLINE_INVALID', 'CONTROL_RUNNER_DIRS_INVALID', 'CONTROL_ARTIFACT_PLAN_INVALID',
  'CONTROL_TEN_SEATS_REQUIRED', 'CONTROL_LIVE_CONFIG_REQUIRED', 'COORDINATOR_SIGNER_ENVIRONMENT_FORBIDDEN',
  'READINESS_REMOTE_GENERATION_UNATTESTED', 'CONTROLLED_RUNTIME_NOT_READY',
  'RUNTIME_EVIDENCE_EXPIRED', 'RUNTIME_EVIDENCE_IDENTITY_MISMATCH', 'RUNTIME_EVIDENCE_PRIVATE_FIELD',
  'PROOF_READINESS_NOT_CURRENT', 'PROOF_WINDOW_CLOSED', 'PROOF_DIRECTORY_EXISTS',
  'PROOF_BINDINGS_CHANGED', 'PROOF_PENDING_NONCE', 'PROOF_OPERATOR_UNRESOLVED',
  'PROOF_PROCESS_ACTIVE', 'PROOF_CREATION_UNCERTAIN', 'READINESS_RUN_EXISTS',
  'READINESS_DEADLINE_EXCEEDED', 'READINESS_SLEEP_UNCONFIRMED', 'READINESS_RUN_FAILED',
  'READINESS_DIRECTORY_ALREADY_EXISTS', 'READINESS_DIRECTORY_INVALID', 'READINESS_STATE_INVALID',
  'READINESS_DIRECTORY_IN_REPOSITORY', 'READINESS_RUN_ALREADY_STARTED', 'READINESS_CREDENTIAL_REQUIRED',
  'READINESS_CHAIN_REQUIRED', 'READINESS_DEADLINE_INVALID', 'READINESS_DEADLINE_EXPIRED',
  'READINESS_RUN_FAILED_SLEEP_UNCONFIRMED',
  'RUNTIME_PRODUCER_REQUIRED', 'RUNTIME_PRODUCER_BINDING_INVALID', 'RUNTIME_PRODUCER_GENERATION_MISMATCH',
]);

export async function runConferenceControl(argv, dependencies = {}) {
  const { command, args } = parseControlArguments(argv);
  if (command === '--help') return { text: HELP };
  if (command === '--version') return { schema_version: 1, cli_version: CONFERENCE_CONTROL_VERSION };
  assertCoordinatorEnvironment(dependencies.env ?? process.env);
  const config = await (dependencies.loadConfig ?? loadConfig)(args.config);
  if (config.mode !== 'live') fail('CONTROL_LIVE_CONFIG_REQUIRED');
  if (config.roster.length !== 10 || ['openclaw', 'hermes'].some(team =>
    config.roster.filter(seat => seat.team === team).length !== 5)) fail('CONTROL_TEN_SEATS_REQUIRED');
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
      return { schema_version: 1, cli_version: 1, diagnostics_complete: result.evidence.diagnostics_complete,
        ready_for_controlled_gameplay: result.evidence.ready_for_controlled_gameplay,
        evidence_sha256: result.evidenceDigest };
    } finally { provider.destroy(); }
  }
  const proof = dependencies.proof ?? await import('./proof-control.mjs');
  const secrets = await (dependencies.loadSecrets ?? loadCoordinatorSecrets)(args['secrets-env']);
  const { makeProvider, createChainReader } = dependencies.chainModule ?? await import('./chain/reader.mjs');
  const provider = makeProvider(config.rpc_url);
  try {
    const options = { configPath: args.config, evidencePath: args.evidence,
      readinessDirectory: args['readiness-dir'], directory: args['proof-dir'],
      operatorDirectory: args['operator-dir'], runnerDirectories: JSON.parse(args['runner-dirs']),
      stopNewGamesAtMs: timestamp(args['stop-new-games-at']), hardStopAtMs: timestamp(args['hard-stop-at']),
      provider, chain: createChainReader({ config, provider }),
      validateReadinessCurrent: parameters => readiness.verifyReadinessCurrent({ ...parameters,
        runtimeDir: args['readiness-dir'], now: Date.now, apiKey: secrets.MARITIME_API_KEY }) };
    const method = { 'proof-plan': 'planControlledProof', 'proof-status': 'validatePreparedProof',
      'proof-prepare': 'prepareControlledProof' }[command];
    const result = await proof[method](options);
    return { schema_version: 1, cli_version: 1, status: result.status,
      read_only: command !== 'proof-prepare', ready_for_creation: false };
  } finally { provider.destroy(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runConferenceControl(process.argv.slice(2)).then(result => {
    process.stdout.write(result.text ?? `${JSON.stringify(result)}\n`);
  }).catch(error => {
    process.stderr.write(`${JSON.stringify({ schema_version: 1, cli_version: 1, error_code: controlErrorCode(error) })}\n`);
    process.exitCode = 1;
  });
}
