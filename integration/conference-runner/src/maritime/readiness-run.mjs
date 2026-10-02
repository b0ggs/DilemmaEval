import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { REPOSITORY_ROOT } from '../config.mjs';
import { atomicWrite } from '../runner/store.mjs';
import { configFingerprint, rosterFingerprint, runtimeEvidenceFingerprint, TRANSPORT_FINGERPRINT,
  RUNTIME_EVIDENCE_MAX_AGE_MS, buildControlledRuntimeEvidence, validateControlledRuntimeEvidence } from '../readiness.mjs';
import { createMaritimeAdapter, maritimeRequest } from './transport.mjs';
import { verifyPublicArtifactIntegrity } from './install.mjs';
import { reconcileRoster, validateMaritimeRoster } from './roster.mjs';
import { buildDiagnosticReceiptReadCommand, validateDiagnosticReceipt } from './diagnostic-receipt.mjs';

export const READINESS_PRODUCER_VERSION = 1;
export const READINESS_FILES = Object.freeze({ evidence: 'readiness-v2.json', state: 'readiness-state.json', journal: 'readiness-journal.json' });
const HASH = /^[0-9a-f]{64}$/;
const BLOCK_HASH = /^0x[0-9a-f]{64}$/;
const MODEL = Object.freeze({ model_endpoint: 'https://api.maritime.sh/api/llm/v1', model: 'gpt-5.4-mini',
  reasoning_effort: 'low', max_output_tokens: 2048, automatic_fallback: false });
const fail = code => { throw Object.assign(new Error(code), { code }); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');

// Observational continuity, NOT a provider-issued activation generation. A VM
// snapshot can preserve these values. Current-generation revalidation therefore
// stays closed until Maritime exposes a documented attestation mechanism.
export const RUNTIME_INSTANCE_COMMAND = Object.freeze(['node', '--input-type=module', '-e', `
import { readFile, readlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
try {
  const boot = (await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim();
  const stat = await readFile('/proc/1/stat','utf8');
  const start = stat.slice(stat.lastIndexOf(')')+2).split(' ')[19];
  const ns = await readlink('/proc/1/ns/pid');
  if (!/^[0-9a-f-]{36}$/.test(boot) || !/^[0-9]+$/.test(start) || !/^pid:\\[[0-9]+\\]$/.test(ns)) throw new Error();
  process.stdout.write(JSON.stringify({schema_version:1,runtime_instance_fingerprint:createHash('sha256').update(JSON.stringify([boot,start,ns])).digest('hex')}));
} catch { process.exitCode=1; }
`]);

function contains(parent, child) {
  const part = relative(parent, child);
  return part === '' || (part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part));
}

async function checkedDirectory(directory, { existing = false } = {}) {
  if (!isAbsolute(directory ?? '') || resolve(directory) !== directory) fail('READINESS_DIRECTORY_INVALID');
  const repository = await realpath(REPOSITORY_ROOT);
  if (contains(repository, directory) || contains(directory, repository)) fail('READINESS_DIRECTORY_IN_REPOSITORY');
  // Require an existing canonical parent; no recursive mkdir, symlink traversal,
  // or touching an inherited private runtime directory.
  const parent = await realpath(dirname(directory));
  if (parent !== dirname(directory) || contains(repository, parent)) fail('READINESS_DIRECTORY_INVALID');
  try {
    const metadata = await lstat(directory);
    if (!existing) fail('READINESS_DIRECTORY_ALREADY_EXISTS');
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(directory) !== directory ||
        (metadata.mode & 0o077) !== 0) fail('READINESS_DIRECTORY_INVALID');
  } catch (error) {
    if (error.code !== 'ENOENT' || existing) throw error;
  }
  return directory;
}

async function readSafeJson(file) {
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.nlink !== 1 || metadata.size > 2_000_000 || (metadata.mode & 0o077) !== 0) {
      fail('READINESS_STATE_INVALID');
    }
    return JSON.parse(await handle.readFile('utf8'));
  } finally { await handle?.close(); }
}

function checkedArtifacts(config, artifacts) {
  if (!Array.isArray(artifacts) || artifacts.length !== config.roster.length) fail('READINESS_ARTIFACTS_INVALID');
  return config.roster.map(seat => {
    const matches = artifacts.filter(row => row?.seat_id === seat.seat_id && row.agent_id === seat.agent_id && row.harness === seat.harness);
    const artifact = matches[0];
    if (matches.length !== 1 || !HASH.test(artifact.artifact_sha256 ?? '') || !Array.isArray(artifact.files) ||
        !Array.isArray(artifact.gameplay_command) || !Array.isArray(artifact.inspect_command) ||
        !Array.isArray(artifact.model_config_check_command)) fail('READINESS_ARTIFACTS_INVALID');
    const digest = createHash('sha256').update(JSON.stringify(artifact.files.map(({ path, sha256 }) => ({ path, sha256 })))).digest('hex');
    if (digest !== artifact.artifact_sha256) fail('READINESS_ARTIFACTS_INVALID');
    const base = join(artifact.persistent_root,'dilemma-conference',seat.seat_id);
    const cli = join(base,'code/integration/conference-runner/src/maritime/player-cli.mjs');
    const installer = join(base,'code/integration/conference-runner/src/maritime/install-runtime.mjs');
    for (const [key,expected] of Object.entries({gameplay_command:['node',cli,join(base,'seat.json')],
      inspect_command:['node',cli,join(base,'seat.json'),'--inspect'],
      model_config_check_command:['node',installer,'--check-model',join(base,'seat.json')],
      model_configure_command:['node',installer,'--configure-model',join(base,'seat.json')],
      model_route_check_command:['node',installer,'--check-model-route',join(base,'seat.json')],
      ...(seat.harness === 'hermes' ? {hermes_configure_command:['node',installer,'--configure-hermes-config',join(base,'seat.json')]} : {})})) {
      if (JSON.stringify(artifact[key]) !== JSON.stringify(expected)) fail('READINESS_ARTIFACTS_INVALID');
    }
    for (const file of artifact.files) {
      if (typeof file.content !== 'string' || createHash('sha256').update(file.content).digest('hex') !== file.sha256) fail('READINESS_ARTIFACTS_INVALID');
    }
    let settings;
    try { settings = JSON.parse(artifact.files.find(row => row.path === artifact.gameplay_command[2])?.content); }
    catch { fail('READINESS_ARTIFACTS_INVALID'); }
    if (settings?.chain_id !== config.chain_id || settings.game_address?.toLowerCase() !== config.game_address.toLowerCase() ||
        settings.rpc_url !== config.rpc_url || settings.seat_id !== seat.seat_id || settings.harness !== seat.harness ||
        runtimeEvidenceFingerprint(settings.roster) !== runtimeEvidenceFingerprint(config.roster)) fail('READINESS_ARTIFACTS_INVALID');
    return structuredClone(artifact);
  });
}

function inventory(value, config) {
  const agents = Array.isArray(value) ? value : value?.agents;
  if (!Array.isArray(agents) || (value?.nextCursor ?? value?.next_cursor ?? value?.has_more)) fail('READINESS_INVENTORY_INVALID');
  let report;
  try { report = reconcileRoster({ roster: config.roster, agents, maxAgents: Math.max(10, agents.length) }); }
  catch { fail('READINESS_INVENTORY_INVALID'); }
  if (!report.ready || agents.some(agent => !['active','sleeping','deploying','stopped','error'].includes(agent.status))) {
    fail('READINESS_INVENTORY_INVALID');
  }
  return { seats: report.seats, awake: agents.filter(row => !['sleeping','stopped'].includes(row.status)).length };
}

function agentStatus(value, seat, expected) {
  if (!value || value.error != null || value.id !== seat.agent_id || value.name !== seat.maritime_agent ||
      (value.externalId ?? value.external_id ?? seat.maritime_agent) !== seat.maritime_agent ||
      (value.framework ?? value.templateId ?? value.template_id) !== seat.harness || value.status !== expected) {
    fail('READINESS_LIFECYCLE_UNCONFIRMED');
  }
}

function execJson(value) {
  if (value?.exitCode !== 0 || typeof value.stdout !== 'string' || Buffer.byteLength(value.stdout) > 16_384 ||
      (value.stderr !== undefined && value.stderr !== '')) fail('READINESS_INSPECTION_FAILED');
  try { return JSON.parse(value.stdout); } catch { fail('READINESS_INSPECTION_FAILED'); }
}

function verifyModel(value, seat) {
  if (!exact(value, ['schema_version','seat_id','harness','configured','model','reasoning_effort','max_output_tokens',
    'automatic_fallback','fallback_model','response_metadata_required']) || value.schema_version !== 1 ||
      value.seat_id !== seat.seat_id || value.harness !== seat.harness || value.configured !== true ||
      value.model !== MODEL.model || value.reasoning_effort !== MODEL.reasoning_effort ||
      value.max_output_tokens !== MODEL.max_output_tokens || value.automatic_fallback !== false ||
      value.fallback_model !== null || value.response_metadata_required !== true) fail('READINESS_MODEL_INVALID');
}

function chainFacts(value, config) {
  if (value?.chain_id !== 84532 || value.game_address?.toLowerCase() !== config.game_address.toLowerCase() ||
      value.active_game_id !== '0' || !/^[1-9][0-9]*$/.test(value.block_number ?? '') ||
      !BLOCK_HASH.test(value.block_hash ?? '') || !BLOCK_HASH.test(value.code_hash ?? '') ||
      !value.config || typeof value.config !== 'object' || Array.isArray(value.config)) fail('READINESS_CHAIN_INVALID');
  const keys = ['entryFeeWei','creatorFeeBps','causeFeeBps','joinDurationSeconds','commitDurationBlocks',
    'revealDurationBlocks','minPlayers','maxPlayers','maxCauses'];
  if (!exact(value.config, keys) || keys.some(key => !/^\d+$/.test(value.config[key])) ||
      Number(value.config.minPlayers) !== 10 || Number(value.config.maxPlayers) !== 10) fail('READINESS_CHAIN_DEFAULTS_INVALID');
  return { block_number: value.block_number, block_hash: value.block_hash, game_code_hash: value.code_hash,
    chain_defaults_fingerprint: runtimeEvidenceFingerprint(value.config) };
}

async function bounded(operation, deadline, now) {
  if (!Number.isSafeInteger(deadline) || now() >= deadline) fail('READINESS_DEADLINE_EXPIRED');
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('READINESS_DEADLINE_EXPIRED'), { code: 'READINESS_DEADLINE_EXPIRED' })),
        Math.max(1, deadline - now()));
    })]);
  } finally { clearTimeout(timer); }
}

/** Construction, plan and status never read credentials or contact Maritime. */
export function createReadinessRun({ config, runtimeDir, artifacts, deadlineAtMs, cleanupDeadlineAtMs,
  apiKey, chain, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  validateMaritimeRoster(config?.roster);
  if (config.chain_id !== 84532 || config.roster.length !== 10 ||
      ['openclaw','hermes'].some(team => config.roster.filter(seat => seat.team === team).length !== 5)) fail('READINESS_TEN_SEATS_REQUIRED');
  if (typeof now !== 'function') fail('READINESS_CLOCK_INVALID');
  config = structuredClone(config);
  artifacts = checkedArtifacts(config, artifacts);
  const rows = config.roster;
  let started = false;
  const plan = () => ({ schema_version: 1, producer_version: 1, read_only: true,
    run_id: config.run_id, roster_fingerprint: rosterFingerprint(config), config_fingerprint: configFingerprint(config),
    transport_fingerprint: TRANSPORT_FINGERPRINT, requested_seats: 10, max_account_awake: 5,
    schedule: 'serial-account-capacity-checked', modes: ['gameplay-input','commit-input'],
    generation_scope: 'diagnostic-run-intent-v1', remote_generation_attested: false,
    creation_blocker: 'READINESS_REMOTE_GENERATION_UNATTESTED',
    seats: artifacts.map(row => ({ seat_id: row.seat_id, agent_id: row.agent_id, artifact_sha256: row.artifact_sha256 })) });
  return Object.freeze({
    plan,
    async status() {
      try { await checkedDirectory(runtimeDir, { existing: true }); }
      catch (error) {
        if (error.code === 'ENOENT') return { schema_version: 1, status: 'absent', read_only: true };
        fail('READINESS_STATE_INVALID');
      }
      try {
        const journal = await readSafeJson(join(runtimeDir, READINESS_FILES.journal));
        if (journal.config_fingerprint !== configFingerprint(config) || journal.roster_fingerprint !== rosterFingerprint(config) ||
            !['running','failed','complete'].includes(journal.status) || !Array.isArray(journal.operations)) fail('READINESS_STATE_INVALID');
        let complete = false;
        if (journal.status === 'complete') {
          try {
            const evidence = await readSafeJson(join(runtimeDir,READINESS_FILES.evidence));
            await validateReadinessRunState({config,evidence,runtimeDir,now});
            complete = true;
          } catch { /* An interrupted publication never reports completion. */ }
        }
        return { schema_version: 1, read_only: true, status: journal.status === 'running' ? 'incomplete-no-replay' : journal.status,
          completed_operations: journal.operations.filter(row => row.status === 'complete').length,
          pending_operations: journal.operations.filter(row => row.status === 'intent').length,
          all_seats_sleeping: journal.all_seats_sleeping === true, replay_allowed: false,
          ready_for_controlled_gameplay: false,
          creation_blocker: 'READINESS_REMOTE_GENERATION_UNATTESTED',
          ...(journal.status === 'complete' && !complete ? {status:'incomplete-no-replay'} : {}) };
      } catch { fail('READINESS_STATE_INVALID'); }
    },
    async run() {
      if (started) fail('READINESS_RUN_ALREADY_STARTED');
      if (typeof apiKey !== 'string' || !apiKey || /[\r\n]/.test(apiKey) || typeof fetchImpl !== 'function') fail('READINESS_CREDENTIAL_REQUIRED');
      if (['preflight','readSnapshot','readBlockHash'].some(key => typeof chain?.[key] !== 'function')) fail('READINESS_CHAIN_REQUIRED');
      const startedAt = now();
      if (!Number.isSafeInteger(startedAt) || !Number.isSafeInteger(deadlineAtMs) || deadlineAtMs <= startedAt ||
          deadlineAtMs - startedAt > RUNTIME_EVIDENCE_MAX_AGE_MS || !Number.isSafeInteger(cleanupDeadlineAtMs) ||
          cleanupDeadlineAtMs <= deadlineAtMs || cleanupDeadlineAtMs - deadlineAtMs > 300_000) fail('READINESS_DEADLINE_INVALID');
      await checkedDirectory(runtimeDir);
      await mkdir(runtimeDir, { mode: 0o700 });
      const parent = await open(dirname(runtimeDir), 'r');
      try { await parent.sync(); } finally { await parent.close(); }
      started = true;
      const runId = randomUUID();
      const journal = { schema_version: 1, producer_version: 1, diagnostic_run_id: runId,
        config_fingerprint: configFingerprint(config), roster_fingerprint: rosterFingerprint(config),
        transport_fingerprint: TRANSPORT_FINGERPRINT, status: 'running', started_at_ms: startedAt,
        deadline_at_ms: deadlineAtMs, cleanup_deadline_at_ms: cleanupDeadlineAtMs,
        all_seats_sleeping: false, operations: [] };
      let persistence = Promise.resolve();
      const persist = () => {
        const snapshot = structuredClone(journal);
        persistence = persistence.then(() => atomicWrite(join(runtimeDir, READINESS_FILES.journal), snapshot));
        return persistence;
      };
      await persist();
      const activated = new Set(), sleepAttempted = new Set(), completed = [];
      let cleanup = false, abandoned = false, lifecycleAmbiguous = false, sequence = 0;
      const deadline = () => cleanup ? cleanupDeadlineAtMs : deadlineAtMs;
      const operation = async (kind, seat, task) => {
        const cleanupOperation = cleanup;
        if (abandoned && !cleanupOperation) fail('READINESS_RUN_ABANDONED');
        if (now() >= deadline()) fail('READINESS_DEADLINE_EXPIRED');
        const entry = { sequence: ++sequence, kind, seat_id: seat?.seat_id ?? null, status: 'intent', started_at_ms: now() };
        journal.operations.push(entry);
        await persist();
        try {
          const result = await bounded(task, deadline(), now);
          if (abandoned && !cleanupOperation) fail('READINESS_RUN_ABANDONED');
          if (now() >= deadline()) fail('READINESS_DEADLINE_EXPIRED');
          entry.status = 'complete'; entry.completed_at_ms = now(); await persist();
          return result;
        } catch {
          entry.status = 'unknown'; entry.completed_at_ms = now();
          if (abandoned && !cleanupOperation) fail('READINESS_OPERATION_FAILED');
          await persist(); fail('READINESS_OPERATION_FAILED');
        }
      };
      const request = (kind, seat, path, method = 'GET', body) => operation(kind, seat, () => maritimeRequest({
        apiKey, fetchImpl, path, method, body, timeoutMs: Math.max(1, Math.min(120_000, deadline() - now())) }));
      const prefix = seat => `/api/agents/${encodeURIComponent(seat.agent_id)}`;
      const getInventory = async () => inventory(await request('inventory', null, '/api/agents'), config);
      const getStatus = async (seat, expected) => agentStatus(await request('lifecycle-read', seat, prefix(seat)), seat, expected);
      const execute = (seat, command) => request('runtime-read', seat, `${prefix(seat)}/exec`, 'POST', { command, timeout: 30 });
      const inspect = async (seat, artifact, previous) => {
        await getStatus(seat, 'active');
        const volume = await request('volume-read', seat, `${prefix(seat)}/files/list`);
        if (!exact(volume, ['root','files']) && (typeof volume?.root !== 'string' || !Array.isArray(volume?.files))) fail('READINESS_VOLUME_INVALID');
        if (volume.root !== artifact.persistent_root) fail('READINESS_VOLUME_INVALID');
        await verifyPublicArtifactIntegrity(artifact, command => execute(seat, command));
        const direct = execJson(await execute(seat, artifact.inspect_command));
        if (!exact(direct, ['schema_version','seat_id','wallet_address','chain_id','persistent_storage_writable','gameplay_execution_proven']) ||
            direct.schema_version !== 1 || direct.seat_id !== seat.seat_id || direct.wallet_address?.toLowerCase() !== seat.wallet_address.toLowerCase() ||
            direct.chain_id !== 84532 || direct.persistent_storage_writable !== true || direct.gameplay_execution_proven !== false) fail('READINESS_INSPECTION_FAILED');
        verifyModel(execJson(await execute(seat, artifact.model_config_check_command)), seat);
        const route = execJson(await execute(seat,artifact.model_route_check_command));
        if (!exact(route,['schema_version','seat_id','model_route_verified']) || route.schema_version !== 1 ||
            route.seat_id !== seat.seat_id || route.model_route_verified !== true) fail('READINESS_MODEL_ROUTE_UNVERIFIED');
        const instance = execJson(await execute(seat, RUNTIME_INSTANCE_COMMAND));
        if (!exact(instance, ['schema_version','runtime_instance_fingerprint']) || instance.schema_version !== 1 ||
            !HASH.test(instance.runtime_instance_fingerprint ?? '') || previous && instance.runtime_instance_fingerprint !== previous) fail('READINESS_MIXED_GENERATION');
        await getStatus(seat, 'active');
        return instance.runtime_instance_fingerprint;
      };
      const sleep = async seat => {
        if (sleepAttempted.has(seat.seat_id)) fail('READINESS_SLEEP_REPLAY_FORBIDDEN');
        sleepAttempted.add(seat.seat_id);
        try {
          const response = await request('sleep', seat, `${prefix(seat)}/sleep`, 'POST');
          agentStatus(response, seat, 'sleeping');
          await getStatus(seat, 'sleeping');
        } catch { lifecycleAmbiguous = true; fail('READINESS_SLEEP_UNCONFIRMED'); }
      };
      try {
        const first = await getInventory();
        if (first.seats.some(seat => seat.status !== 'sleeping') || first.awake > 5) fail('READINESS_INITIAL_LIFECYCLE_INVALID');
        const initial = chainFacts(await operation('chain-preflight', null, () => chain.preflight()), config);
        const snapshot = await operation('chain-snapshot', null, () => chain.readSnapshot({ gameId: '0' }));
        if (snapshot?.chain_id !== 84532 || snapshot.game_address?.toLowerCase() !== config.game_address.toLowerCase() ||
            snapshot.active_game_id !== '0' || snapshot.phase !== 'idle') fail('READINESS_CHAIN_INVALID');
        if (await operation('chain-canonical', null, () => chain.readBlockHash({ blockNumber: initial.block_number })) !== initial.block_hash) fail('READINESS_CHAIN_CHANGED');
        for (let index = 0; index < rows.length; index++) {
          const seat = rows[index], artifact = artifacts[index];
          const capacity = await getInventory();
          if (capacity.awake >= 5 || capacity.seats.some(row => row.status !== 'sleeping')) fail('READINESS_CAPACITY_UNAVAILABLE');
          // This number is the durable intent's sequence in THIS diagnostic run,
          // not a copied launch-journal counter or a fabricated remote epoch.
          const generation = sequence + 1;
          activated.add(seat.seat_id);
          try {
            const activatedAgent = await request('activation-intent', seat, `${prefix(seat)}/reload-env`, 'POST');
            agentStatus(activatedAgent, seat, 'active');
            await getStatus(seat, 'active');
          } catch { lifecycleAmbiguous = true; fail('READINESS_LIFECYCLE_UNCONFIRMED'); }
          // Restore can rematerialize harness config. Only exact source-bound
          // configure commands run, after public artifact integrity succeeds.
          await verifyPublicArtifactIntegrity(artifact, command => execute(seat, command));
          if (seat.harness === 'hermes') {
            const configured = execJson(await execute(seat, artifact.hermes_configure_command));
            if (!exact(configured, ['schema_version','seat_id','configured','variable','config_owner_configured',
              'private_state_owner_configured','runtime_identity']) || configured.schema_version !== 1 ||
                configured.seat_id !== seat.seat_id || configured.configured !== true || configured.variable !== 'GAMEPLAY_WALLET_PRIVATE_KEY' ||
                configured.config_owner_configured !== true || configured.private_state_owner_configured !== true ||
                !exact(configured.runtime_identity,['uid','gid']) || configured.runtime_identity.uid !== 10000 ||
                configured.runtime_identity.gid !== 10000) fail('READINESS_HARNESS_INVALID');
          }
          verifyModel(execJson(await execute(seat, artifact.model_configure_command)), seat);
          let instance = await inspect(seat, artifact);
          const diagnostics = {}, diagnosticGenerations = {};
          const adapter = createMaritimeAdapter({ config, apiKey, timeoutMs: 120_000, diagnosticStageRetries: 0,
            runtimeEvidence: { schema_version: 2, run_id: config.run_id, seats: artifacts },
            fetchImpl: async (url, options) => {
              const endpoint = new URL(url).pathname;
              if (options.method !== 'POST' || ![`${prefix(seat)}/exec`,`${prefix(seat)}/chat`].includes(endpoint)) fail('READINESS_TRANSPORT_SCOPE_INVALID');
              return operation(endpoint.endsWith('/chat') ? 'diagnostic-chat' : 'diagnostic-stage', seat,
                () => fetchImpl(url, options));
            } });
          for (const [mode, key] of [['gameplay-input','gameplay_input'],['commit-input','commit_input']]) {
            const requestId = `${runId}:${seat.seat_id}:${generation}:${key}`;
            const diagnostic = { schema_version: 1, type: 'runtime-diagnostic', request_id: requestId,
              seat_id: seat.seat_id, team: seat.team, mode,
              chain_state: { chain_id: 84532, game_address: config.game_address.toLowerCase(),
                confirmed_block_number: initial.block_number, confirmed_block_hash: initial.block_hash } };
            diagnostics[key] = await operation('diagnostic-validation', seat,
              () => adapter.diagnose({ seat, request: diagnostic, deadline_at_ms: deadlineAtMs }));
            const receipt = execJson(await execute(seat, buildDiagnosticReceiptReadCommand(artifact,diagnostic)));
            validateDiagnosticReceipt(receipt,diagnostic,diagnostics[key]);
            diagnosticGenerations[key] = generation;
            instance = await inspect(seat, artifact, instance);
          }
          await sleep(seat);
          completed.push({ seat_id: seat.seat_id, agent_id: seat.agent_id, harness: seat.harness,
            wallet_address: seat.wallet_address.toLowerCase(), framework_status_verified: true,
            direct_runtime_inspection_verified: true, wallet_identity_verified: true, persistent_storage_verified: true,
            tool_execution_verified: true, gameplay_command: artifact.gameplay_command,
            artifact_sha256: artifact.artifact_sha256, activation_generation: generation,
            final_agent_status: 'sleeping', sleep_confirmed: true, lifecycle_ambiguous: false,
            model_profile: { ...MODEL }, diagnostics, runtime_instance_fingerprint: instance,
            diagnostic_generations: diagnosticGenerations });
        }
        const end = await getInventory();
        if (end.seats.some(row => row.status !== 'sleeping')) fail('READINESS_SLEEP_UNCONFIRMED');
        const final = chainFacts(await operation('chain-preflight', null, () => chain.preflight()), config);
        if (final.chain_defaults_fingerprint !== initial.chain_defaults_fingerprint || final.game_code_hash !== initial.game_code_hash ||
            await operation('chain-canonical', null, () => chain.readBlockHash({ blockNumber: initial.block_number })) !== initial.block_hash) fail('READINESS_CHAIN_CHANGED');
        if (now() >= deadlineAtMs || now() - startedAt >= RUNTIME_EVIDENCE_MAX_AGE_MS) fail('READINESS_DEADLINE_EXPIRED');
        journal.all_seats_sleeping = true;
        journal.status = 'complete';
        await persist();
        const state = { schema_version: 1, diagnostic_run_id: runId, config_fingerprint: configFingerprint(config),
          roster_fingerprint: rosterFingerprint(config), transport_fingerprint: TRANSPORT_FINGERPRINT,
          generation_scope: 'diagnostic-run-intent-v1', journal_sha256: runtimeEvidenceFingerprint(journal),
          seats: completed.map(row => ({ seat_id: row.seat_id, agent_id: row.agent_id,
            activation_generation: row.activation_generation, artifact_sha256: row.artifact_sha256,
            runtime_instance_fingerprint: row.runtime_instance_fingerprint, final_agent_status: 'sleeping' })) };
        const evidence = buildControlledRuntimeEvidence(config, { confirmedBlockNumber: initial.block_number,
          confirmedBlockHash: initial.block_hash, seats: completed, now: startedAt,
          producer: { producer_version: 1, diagnostic_run_id: runId, chain_id: 84532,
            game_address: config.game_address.toLowerCase(), game_code_hash: initial.game_code_hash,
            chain_defaults_fingerprint: initial.chain_defaults_fingerprint, generation_scope: 'diagnostic-run-intent-v1',
            remote_generation_attested: false, diagnostics_complete: true, lifecycle_state_digest: runtimeEvidenceFingerprint(state) } });
        await atomicWrite(join(runtimeDir, READINESS_FILES.state), state);
        const evidencePath = join(runtimeDir, READINESS_FILES.evidence);
        if (now() >= deadlineAtMs) fail('READINESS_DEADLINE_EXPIRED');
        await atomicWrite(evidencePath, evidence);
        return { evidence, evidencePath, evidenceDigest: runtimeEvidenceFingerprint(evidence) };
      } catch {
        abandoned = true;
        cleanup = true;
        // Each activated seat gets at most one sleep request. An ambiguous sleep
        // is never replayed merely because a later read still says active.
        for (const seat of rows.filter(row => activated.has(row.seat_id) && !sleepAttempted.has(row.seat_id))) {
          try { await sleep(seat); } catch { /* fixed failure below; never emit raw provider exceptions */ }
        }
        try { journal.all_seats_sleeping = (await getInventory()).seats.every(row => row.status === 'sleeping') && !lifecycleAmbiguous &&
          !journal.operations.some(row => ['activation-intent','sleep','diagnostic-chat','diagnostic-validation'].includes(row.kind) && row.status === 'unknown'); }
        catch { journal.all_seats_sleeping = false; }
        journal.status = 'failed'; await persist();
        fail(journal.all_seats_sleeping ? 'READINESS_RUN_FAILED' : 'READINESS_RUN_FAILED_SLEEP_UNCONFIRMED');
      }
    }
  });
}

/** Read-only local verification used at both proof preparation and creation. */
export async function validateReadinessRunState({ config, evidence, runtimeDir, now = Date.now } = {}) {
  try {
    validateControlledRuntimeEvidence(config, evidence, { now, allowDiagnosticsOnly: true });
    await checkedDirectory(runtimeDir, { existing: true });
    const stored = await readSafeJson(join(runtimeDir, READINESS_FILES.evidence));
    const state = await readSafeJson(join(runtimeDir, READINESS_FILES.state));
    const journal = await readSafeJson(join(runtimeDir, READINESS_FILES.journal));
    if (runtimeEvidenceFingerprint(stored) !== runtimeEvidenceFingerprint(evidence) ||
        runtimeEvidenceFingerprint(state) !== evidence.lifecycle_state_digest ||
        runtimeEvidenceFingerprint(journal) !== state.journal_sha256 || journal.status !== 'complete' ||
        journal.all_seats_sleeping !== true || journal.diagnostic_run_id !== evidence.diagnostic_run_id ||
        state.diagnostic_run_id !== evidence.diagnostic_run_id || state.config_fingerprint !== configFingerprint(config) ||
        state.roster_fingerprint !== rosterFingerprint(config) || state.transport_fingerprint !== TRANSPORT_FINGERPRINT ||
        !Array.isArray(state.seats) || state.seats.length !== config.roster.length ||
        journal.operations.some(row => row.status !== 'complete')) fail('READINESS_STATE_INVALID');
    for (const seat of evidence.seats) {
      const current = state.seats.find(row => row.seat_id === seat.seat_id);
      if (!current || ['agent_id','activation_generation','artifact_sha256','runtime_instance_fingerprint','final_agent_status']
        .some(key => current[key] !== seat[key])) fail('READINESS_STATE_INVALID');
      const activation = journal.operations.find(row => row.sequence === seat.activation_generation);
      if (activation?.kind !== 'activation-intent' || activation.seat_id !== seat.seat_id) fail('READINESS_STATE_INVALID');
    }
    return { ready: true, evidence_sha256: runtimeEvidenceFingerprint(evidence), lifecycle_state_digest: evidence.lifecycle_state_digest };
  } catch { fail('READINESS_STATE_INVALID'); }
}

/** Current provider schema cannot attest no intervening restore/reload. */
export async function verifyReadinessCurrent({ config, evidence, runtimeDir, apiKey, fetchImpl = globalThis.fetch,
  chain, deadlineAtMs, now = Date.now } = {}) {
  await validateReadinessRunState({ config, evidence, runtimeDir, now });
  const result = inventory(await bounded(() => maritimeRequest({ apiKey, fetchImpl, path: '/api/agents',
    timeoutMs: Math.max(1, deadlineAtMs - now()) }), deadlineAtMs, now), config);
  if (result.seats.some(row => row.status !== 'sleeping')) fail('READINESS_SLEEP_UNCONFIRMED');
  const current = chainFacts(await bounded(() => chain.preflight(), deadlineAtMs, now), config);
  if (current.chain_defaults_fingerprint !== evidence.chain_defaults_fingerprint || current.game_code_hash !== evidence.game_code_hash ||
      await bounded(() => chain.readBlockHash({ blockNumber: evidence.confirmed_block_number }), deadlineAtMs, now) !== evidence.confirmed_block_hash) {
    fail('READINESS_CHAIN_CHANGED');
  }
  fail('READINESS_REMOTE_GENERATION_UNATTESTED');
}
