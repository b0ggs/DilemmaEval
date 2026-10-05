import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { posix } from 'node:path';
import { PINNED_GAME_REVISION } from '../../../game-bridge/src/index.js';
import { maritimeRequest, MaritimeAdapterError } from './transport.mjs';
import { validateMaritimeRoster } from './roster.mjs';
import { validatePlayerSettings } from './player-runtime.mjs';
import { recipeForHarness, recipeDigest, TEAM_PAYOUT_OBJECTIVE } from './recipes.mjs';
import { HERMES_RUNTIME_IDENTITY } from './runtime-identity.mjs';

const SOURCE_FILES = [
  'game-bridge/src/index.js', 'shared/runtime-source.json', 'maritime-transport/src/validation.mjs',
  ...['protocol.mjs', 'roster.mjs', 'runtime-identity.mjs', 'diagnostics.mjs', 'diagnostic-receipt.mjs', 'execution-permit.mjs', 'player-runtime.mjs', 'player-cli.mjs', 'install-runtime.mjs', 'openclaw-oauth.mjs', 'hermes-oauth.mjs']
    .map(file => `conference-runner/src/maritime/${file}`)
];
const MAX_ARTIFACT_HASH_OUTPUT_BYTES = 131_072;
export const INSTALL_PUBLIC_ARTIFACT_INTEGRITY_MISMATCH = 'INSTALL_PUBLIC_ARTIFACT_INTEGRITY_MISMATCH';
export const INSTALL_PUBLIC_ARTIFACT_FLUSH_FAILED = 'INSTALL_PUBLIC_ARTIFACT_FLUSH_FAILED';

const FLUSH_PUBLIC_ARTIFACT_SOURCE = `
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
try {
  const { files, directories } = JSON.parse(process.argv[1]);
  const targets = [...files.map(path => ({ path, directory: false })),
    ...directories.map(path => ({ path, directory: true }))];
  // Validate every target before any flush; never follow a link into private state.
  for (const target of targets) {
    const metadata = await lstat(target.path);
    if (metadata.isSymbolicLink() || await realpath(target.path) !== target.path ||
        !(target.directory ? metadata.isDirectory() : metadata.isFile())) throw new Error();
  }
  for (const target of targets) {
    const handle = await open(target.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const metadata = await handle.stat();
      if (!(target.directory ? metadata.isDirectory() : metadata.isFile())) throw new Error();
      await handle.sync();
    } finally { await handle.close(); }
  }
  process.stdout.write(JSON.stringify({ schema_version: 1, flushed_file_count: files.length }) + '\\n');
} catch { process.exitCode = 1; }
`;

function persistentPath(root) {
  if (typeof root !== 'string' || !root.startsWith('/') || root === '/' ||
      posix.normalize(root) !== root || /[\0\r\n]/.test(root)) throw new TypeError('PERSISTENT_ROOT_INVALID');
  return root;
}

function validatedPublicArtifactFiles(artifact) {
  if (!artifact || !Array.isArray(artifact.files) || artifact.files.length === 0 ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(artifact.agent_id ?? '') ||
      !/^[a-z0-9][a-z0-9-]{0,31}$/.test(artifact.seat_id ?? '')) throw new TypeError('INSTALL_ARTIFACT_INVALID');
  const base = posix.join(persistentPath(artifact.persistent_root), 'dilemma-conference', artifact.seat_id);
  const code = posix.join(base, 'code');
  const exactPublic = new Set(['seat.json', 'PLAYER-INSTRUCTIONS.md', 'HARNESS-RECIPE.json'].map(name => posix.join(base, name)));
  const seen = new Set();
  for (const file of artifact.files) {
    const publicPath = typeof file?.path === 'string' &&
      (file.path.startsWith(`${code}/`) || exactPublic.has(file.path));
    if (!publicPath || posix.normalize(file.path) !== file.path || /[\0\r\n]/.test(file.path) ||
        typeof file.content !== 'string' || !/^[0-9a-f]{64}$/.test(file.sha256 ?? '') ||
        createHash('sha256').update(file.content).digest('hex') !== file.sha256 || seen.has(file.path)) {
      throw new TypeError('INSTALL_ARTIFACT_INVALID');
    }
    seen.add(file.path);
  }
  return artifact.files;
}

/** Hashes only the declared public artifact files, preserving their exact order. */
export async function verifyPublicArtifactIntegrity(artifact, execute) {
  if (typeof execute !== 'function') throw new TypeError('INSTALL_INTEGRITY_EXECUTOR_INVALID');
  const files = validatedPublicArtifactFiles(artifact);
  const command = ['sha256sum', '--', ...files.map(file => file.path)];
  let result;
  try { result = await execute(command); }
  catch (error) {
    if (error instanceof MaritimeAdapterError) throw error;
    throw new MaritimeAdapterError(INSTALL_PUBLIC_ARTIFACT_INTEGRITY_MISMATCH);
  }
  const stdout = result?.stdout;
  if (result?.exitCode !== 0 || typeof stdout !== 'string' ||
      Buffer.byteLength(stdout) > MAX_ARTIFACT_HASH_OUTPUT_BYTES) {
    throw new MaritimeAdapterError(INSTALL_PUBLIC_ARTIFACT_INTEGRITY_MISMATCH);
  }
  const expected = files.map(file => `${file.sha256}  ${file.path}`).join('\n');
  const actual = stdout.endsWith('\n') ? stdout.slice(0, -1) : stdout;
  if (actual !== expected) throw new MaritimeAdapterError(INSTALL_PUBLIC_ARTIFACT_INTEGRITY_MISMATCH);
  return { schema_version: 1, verified_file_count: files.length };
}

/** Flushes declared public files and their directory entries before a volume snapshot. */
export async function flushPublicArtifacts(artifact, execute) {
  if (typeof execute !== 'function') throw new TypeError('INSTALL_FLUSH_EXECUTOR_INVALID');
  const files = validatedPublicArtifactFiles(artifact);
  const directories = new Set();
  for (const file of files) {
    let directory = posix.dirname(file.path);
    while (true) {
      directories.add(directory);
      if (directory === artifact.persistent_root) break;
      directory = posix.dirname(directory);
    }
  }
  // Deepest entries first, then their parents, stopping at the persistent root.
  const orderedDirectories = [...directories].sort((a, b) => b.split('/').length - a.split('/').length);
  const command = ['node', '--input-type=module', '-e', FLUSH_PUBLIC_ARTIFACT_SOURCE,
    JSON.stringify({ files: files.map(file => file.path), directories: orderedDirectories })];
  let result;
  try { result = await execute(command); }
  catch (error) {
    throw new MaritimeAdapterError(INSTALL_PUBLIC_ARTIFACT_FLUSH_FAILED,
      { ambiguous: error instanceof MaritimeAdapterError && error.ambiguous });
  }
  const evidence = { schema_version: 1, flushed_file_count: files.length };
  if (result?.exitCode !== 0 || result.stdout !== `${JSON.stringify(evidence)}\n` ||
      (result.stderr !== undefined && result.stderr !== '')) {
    throw new MaritimeAdapterError(INSTALL_PUBLIC_ARTIFACT_FLUSH_FAILED);
  }
  return evidence;
}

/** Produces reviewable public code/config artifacts. Contains no secret values. */
export async function buildInstallArtifact({ config, seatId, persistentRoot, operationsManifest, recipe, readFileImpl = readFile }) {
  validateMaritimeRoster(config?.roster);
  const seat = config.roster.find(row => row.seat_id === seatId);
  if (!seat) throw new TypeError('INSTALL_SEAT_INVALID');
  recipe ??= recipeForHarness(seat.harness);
  if (recipe !== recipeForHarness(seat.harness)) throw new TypeError('INSTALL_RECIPE_INVALID');
  const base = posix.join(persistentPath(persistentRoot), 'dilemma-conference', seatId);
  const code = posix.join(base, 'code');
  const settings = {
    schema_version: 1, seat_id: seatId, harness: seat.harness, chain_id: config.chain_id, rpc_url: config.rpc_url,
    game_address: config.game_address, game_repo: posix.join(base, 'game'), persistent_root: persistentRoot,
    execution_permit_required: config.mode === 'live',
    ...(seat.harness === 'openclaw' ? { openclaw_config_path: posix.join(persistentPath(persistentRoot), '.openclaw', 'openclaw.json') } : {}),
    ...(seat.harness === 'hermes' ? { hermes_config_path: posix.join(persistentRoot, 'config.yaml'),
      runtime_identity: { ...HERMES_RUNTIME_IDENTITY } } : {}),
    state_directory: posix.join(base, 'private'), bin_directory: posix.join(base, 'bin'),
    roster: config.roster.map(({ seat_id, team, harness, agent_id, maritime_agent, wallet_address, cause_id }) =>
      ({ seat_id, team, harness, agent_id, maritime_agent, wallet_address, cause_id })),
    operations_manifest: structuredClone(operationsManifest), command_timeout_ms: 90_000
  };
  validatePlayerSettings(settings);
  const files = [];
  for (const path of SOURCE_FILES) {
    files.push({ path: posix.join(code, 'integration', path), content: await readFileImpl(new URL(`../../../${path}`, import.meta.url), 'utf8') });
  }
  files.push({ path: posix.join(code, 'package.json'), content: '{"name":"dilemma-conference-player","private":true,"type":"module"}\n' });
  const settingsPath = posix.join(base, 'seat.json');
  files.push({ path: settingsPath, content: `${JSON.stringify(settings, null, 2)}\n` });
  const cli = posix.join(code, 'integration/conference-runner/src/maritime/player-cli.mjs');
  const installer = posix.join(code, 'integration/conference-runner/src/maritime/install-runtime.mjs');
  const instruction = [
    `You are the actual ${seat.harness} player ${seatId}, team ${seat.team}; wallet ${seat.wallet_address}.`,
    TEAM_PAYOUT_OBJECTIVE,
    'Play Share, Steal, or Catch under the pinned game rules. Use the supplied same-team discussion to make your own choice; the coordinator never chooses for you.',
    `Your only gameplay tool is argv ${JSON.stringify(['node', cli, settingsPath])}. Supply the exact request envelope and your commit choice using JSON stdin.`,
    'Use the shell/terminal execution tool without printing environment or reading secrets. Keep every prepared bundle in the tool-managed persistent directory.',
    'Return the gameplay tool response as exact JSON. Discussion envelopes authorize only your own message, never a transaction. Contribute a concrete strategic consideration for the team payout in at most 200 characters, within the phase deadline.',
    'Never disclose signing keys, commit salts, private bundle contents, or unrevealed choices in your response or team_message.',
    'An error or interrupted execution may already have submitted a transaction. Never repeat another signing command or use another player wallet.',
    'Use only the supplied same-team messages; spectator feeds and opposing-team messages are not authorized game inputs.',
    'Keys are injected separately as GAMEPLAY_WALLET_PRIVATE_KEY; no owner/phase signer belongs in this agent.',
    `Pinned source: ${PINNED_GAME_REVISION}. Base Sepolia only, chain ID 84532.`
  ].join('\n');
  files.push({ path: posix.join(base, 'PLAYER-INSTRUCTIONS.md'), content: `${instruction}\n` });
  files.push({ path: posix.join(base, 'HARNESS-RECIPE.json'), content: `${JSON.stringify(recipe, null, 2)}\n` });
  for (const file of files) file.sha256 = createHash('sha256').update(file.content).digest('hex');
  return {
    schema_version: 1, seat_id: seatId, harness: seat.harness, agent_id: seat.agent_id, persistent_root: persistentRoot,
    recipe_id: recipe.recipe_id, recipe_version: recipe.recipe_version, recipe_sha256: recipeDigest(recipe),
    source_revision: PINNED_GAME_REVISION,
    artifact_sha256: createHash('sha256').update(JSON.stringify(files.map(({ path, sha256 }) => ({ path, sha256 })))).digest('hex'),
    files, instructions: instruction,
    install_command: ['node', installer, settingsPath],
    inspect_command: ['node', cli, settingsPath, '--inspect'],
    ...(seat.harness === 'hermes' ? {
      hermes_configure_command: ['node', installer, '--configure-hermes-config', settingsPath],
      hermes_config_check_command: ['node', installer, '--check-hermes-config', settingsPath]
    } : {}),
    model_configure_command: ['node', installer, '--configure-model', settingsPath],
    model_config_check_command: ['node', installer, '--check-model', settingsPath],
    model_route_check_command: ['node', installer, '--check-model-route', settingsPath],
    gameplay_command: ['node', cli, settingsPath],
    live_evidence: { installed: false, wallet_verified: false, gameplay_execution_proven: false,
      model_route_verified: false, spectator_access_blocked: false, restart_bundle_recovery_proven: false }
  };
}

/** Operator-only helper. Constructing it is inert; install() mutates one selected agent. */
export function createMaritimeInstaller({ apiKey, fetchImpl = globalThis.fetch, timeoutMs = 120_000 } = {}) {
  const request = args => maritimeRequest({ apiKey, fetchImpl, timeoutMs, ...args });
  const validateHermesArtifact = artifact => {
    if (!artifact || artifact.harness !== 'hermes' || !Array.isArray(artifact.hermes_configure_command) ||
        !Array.isArray(artifact.hermes_config_check_command) ||
        !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(artifact.agent_id)) throw new TypeError('INSTALL_ARTIFACT_INVALID');
    return artifact;
  };
  const verifyRemoteArtifact = (artifact, prefix) => verifyPublicArtifactIntegrity(artifact, command =>
    request({ path: `${prefix}/exec`, method: 'POST', body: { command, timeout: 30 } }));
  const runModelConfigurationCommand = async (artifact, command, code) => {
    if (!artifact || !Array.isArray(command)) throw new TypeError('INSTALL_ARTIFACT_INVALID');
    const prefix = `/api/agents/${encodeURIComponent(artifact.agent_id)}`;
    const liveVolume = await request({ path: `${prefix}/files/list` });
    if (persistentPath(liveVolume?.root) !== artifact.persistent_root) throw new TypeError('PERSISTENT_ROOT_CHANGED');
    await verifyRemoteArtifact(artifact, prefix);
    const result = await request({ path: `${prefix}/exec`, method: 'POST', body: { command, timeout: 30 } });
    let evidence; try { evidence = JSON.parse(result?.stdout); } catch { throw new MaritimeAdapterError(code); }
    if (result?.exitCode !== 0 || evidence?.configured !== true || evidence.model !== 'gpt-6.1-sol' ||
        evidence.reasoning_effort !== 'low' || evidence.max_output_tokens !== 2048 ||
        evidence.automatic_fallback !== false || evidence.fallback_model !== null ||
        evidence.response_metadata_required !== true) throw new MaritimeAdapterError(code);
    return evidence;
  };
  const parseHarnessConfiguration = (artifact, checked, { code, ambiguous = false }) => {
    let configEvidence;
    try { configEvidence = JSON.parse(checked?.stdout); }
    catch { throw new MaritimeAdapterError(code, { ambiguous }); }
    if (checked?.exitCode !== 0 || configEvidence?.schema_version !== 1 ||
        configEvidence.seat_id !== artifact.seat_id || configEvidence.configured !== true ||
        configEvidence.variable !== 'GAMEPLAY_WALLET_PRIVATE_KEY' ||
        configEvidence.config_owner_configured !== true ||
        configEvidence.private_state_owner_configured !== true ||
        configEvidence.runtime_identity?.uid !== HERMES_RUNTIME_IDENTITY.uid ||
        configEvidence.runtime_identity?.gid !== HERMES_RUNTIME_IDENTITY.gid) {
      throw new MaritimeAdapterError(code, { ambiguous });
    }
    return { schema_version: 1, seat_id: artifact.seat_id, agent_id: artifact.agent_id,
      hermes_terminal_env_passthrough_configured: true, hermes_config_owner_configured: true,
      hermes_private_state_owner_configured: true,
      runtime_identity: { ...HERMES_RUNTIME_IDENTITY } };
  };
  const runHarnessConfigurationCommand = async (artifact, command, options) => {
    validateHermesArtifact(artifact);
    const prefix = `/api/agents/${encodeURIComponent(artifact.agent_id)}`;
    const liveVolume = await request({ path: `${prefix}/files/list` });
    if (persistentPath(liveVolume?.root) !== artifact.persistent_root) throw new TypeError('PERSISTENT_ROOT_CHANGED');
    await verifyRemoteArtifact(artifact, prefix);
    const checked = await request({ path: `${prefix}/exec`, method: 'POST',
      body: { command, timeout: 30 } });
    return parseHarnessConfiguration(artifact, checked, options);
  };
  const inspectHarnessConfiguration = artifact => runHarnessConfigurationCommand(artifact,
    artifact?.hermes_config_check_command, { code: 'HERMES_CONFIG_INSPECTION_INVALID' });
  return Object.freeze({
    async inspectVolumeRoot(agentId) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(agentId)) throw new TypeError('INSTALL_AGENT_ID_INVALID');
      const data = await request({ path: `/api/agents/${encodeURIComponent(agentId)}/files/list` });
      return persistentPath(data?.root);
    },
    async install(artifact) {
      const files = validatedPublicArtifactFiles(artifact);
      const prefix = `/api/agents/${encodeURIComponent(artifact.agent_id)}`;
      const liveVolume = await request({ path: `${prefix}/files/list` });
      if (persistentPath(liveVolume?.root) !== artifact.persistent_root) throw new TypeError('PERSISTENT_ROOT_CHANGED');
      // Parent creation uses argv, never untrusted shell interpolation.
      const directories = [...new Set(files.map(file => posix.dirname(file.path)))];
      const made = await request({ path: `${prefix}/exec`, method: 'POST', body: { command: ['mkdir', '-p', '--', ...directories], timeout: 30 } });
      if (made.exitCode !== 0) throw new MaritimeAdapterError('INSTALL_DIRECTORY_FAILED', { ambiguous: true });
      const upload = async () => {
        for (const file of files) await request({ path: `${prefix}/files/write`, method: 'PUT', body: { path: file.path, content: file.content } });
        await flushPublicArtifacts(artifact, command =>
          request({ path: `${prefix}/exec`, method: 'POST', body: { command, timeout: 30 } }));
      };
      const verify = () => verifyPublicArtifactIntegrity(artifact, command =>
        request({ path: `${prefix}/exec`, method: 'POST', body: { command, timeout: 30 } }));
      await upload();
      try { await verify(); }
      catch (error) {
        if (error?.code !== INSTALL_PUBLIC_ARTIFACT_INTEGRITY_MISMATCH) throw error;
        // One bounded, exact rewrite is safe before the installer has executed.
        await upload();
        await verify();
      }
      const result = await request({ path: `${prefix}/exec`, method: 'POST', body: { command: artifact.install_command, timeout: 120 } });
      await verify();
      if (result.exitCode !== 0) throw new MaritimeAdapterError('INSTALL_RUNTIME_FAILED', { ambiguous: true });
      let evidence;
      try { evidence = JSON.parse(result.stdout); } catch { throw new MaritimeAdapterError('INSTALL_EVIDENCE_INVALID'); }
      if (evidence.seat_id !== artifact.seat_id || evidence.runtime_installed !== true ||
          (artifact.harness === 'hermes' && (evidence.hermes_private_state_owner_configured !== true ||
            evidence.hermes_gameplay_command_owner_configured !== true))) {
        throw new MaritimeAdapterError('INSTALL_EVIDENCE_INVALID');
      }
      return { schema_version: 1, seat_id: artifact.seat_id, agent_id: artifact.agent_id,
        artifact_sha256: artifact.artifact_sha256, ...artifact.live_evidence, installed: true };
    },
    async configureHarnessConfiguration(artifact) {
      return runHarnessConfigurationCommand(artifact, artifact?.hermes_configure_command,
        { code: 'HERMES_CONFIG_UPDATE_OUTCOME_UNKNOWN', ambiguous: true });
    },
    async configureModel(artifact) { return runModelConfigurationCommand(artifact, artifact?.model_configure_command, 'MODEL_CONFIG_UPDATE_INVALID'); },
    async inspectModel(artifact) { return runModelConfigurationCommand(artifact, artifact?.model_config_check_command, 'MODEL_CONFIG_INSPECTION_INVALID'); },
    inspectHarnessConfiguration,
    async inspectInstallation(artifact) {
      return inspectRuntimeArtifact(artifact, false);
    },
    async inspectRuntime(artifact) {
      return inspectRuntimeArtifact(artifact, true);
    }
  });

  async function inspectRuntimeArtifact(artifact, includeHarnessConfiguration) {
      if (!artifact || !Array.isArray(artifact.inspect_command) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(artifact.agent_id)) {
        throw new TypeError('INSTALL_ARTIFACT_INVALID');
      }
      const prefix = `/api/agents/${encodeURIComponent(artifact.agent_id)}`;
      const liveVolume = await request({ path: `${prefix}/files/list` });
      if (persistentPath(liveVolume?.root) !== artifact.persistent_root) throw new TypeError('PERSISTENT_ROOT_CHANGED');
      await verifyPublicArtifactIntegrity(artifact, command =>
        request({ path: `${prefix}/exec`, method: 'POST', body: { command, timeout: 30 } }));
      const result = await request({ path: `${prefix}/exec`, method: 'POST', body: { command: artifact.inspect_command, timeout: 30 } });
      if (result.exitCode !== 0) throw new MaritimeAdapterError('INSTALL_INSPECTION_FAILED', { ambiguous: false });
      let evidence;
      try { evidence = JSON.parse(result.stdout); } catch { throw new MaritimeAdapterError('INSTALL_INSPECTION_INVALID'); }
      const wallet = artifact.files.find(file => file.path.endsWith('/seat.json'));
      let settings;
      try { settings = JSON.parse(wallet.content); } catch { throw new TypeError('INSTALL_ARTIFACT_INVALID'); }
      const seat = settings.roster.find(row => row.seat_id === artifact.seat_id);
      if (evidence?.schema_version !== 1 || evidence.seat_id !== artifact.seat_id || evidence.chain_id !== 84532 ||
          evidence.wallet_address?.toLowerCase() !== seat?.wallet_address?.toLowerCase() ||
          evidence.persistent_storage_writable !== true || evidence.gameplay_execution_proven !== false) {
        throw new MaritimeAdapterError('INSTALL_INSPECTION_INVALID');
      }
      let hermesConfigured = false;
      let hermesPrivateStateOwnerConfigured = false;
      if (artifact.harness === 'hermes') {
        if (includeHarnessConfiguration) {
          await inspectHarnessConfiguration(artifact);
          hermesConfigured = true;
        }
        hermesPrivateStateOwnerConfigured = true;
      }
      return { schema_version: 1, seat_id: artifact.seat_id, agent_id: artifact.agent_id,
        wallet_address: seat.wallet_address.toLowerCase(), wallet_identity_verified: true,
        persistent_storage_verified: true, direct_runtime_inspection_verified: true,
        inspect_output: { schema_version: 1, seat_id: evidence.seat_id, wallet_address: evidence.wallet_address,
          chain_id: evidence.chain_id, persistent_storage_writable: true, gameplay_execution_proven: false },
        hermes_terminal_env_passthrough_configured: hermesConfigured,
        hermes_private_state_owner_configured: hermesPrivateStateOwnerConfigured };
  }
}
