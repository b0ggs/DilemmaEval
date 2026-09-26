import { createHash } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { FROZEN_NETWORK, deriveEthereumAddress } from '../../../game-bridge/src/index.js';
import { prepareRuntimeDirectory } from '../config.mjs';
import { acquireRunnerLock } from '../runner/lock.mjs';
import { atomicWrite, createDurableStore } from '../runner/store.mjs';
import { buildInstallArtifact, createMaritimeInstaller } from './install.mjs';
import { validateMaritimeRoster } from './roster.mjs';
import { recipeDigest, recipeForHarness } from './recipes.mjs';
import { createMaritimeRuntimeVerifier } from './verify.mjs';

export const VERIFIED_MARITIME_SDK = Object.freeze({ package: 'maritime-sdk', version: '0.6.0', maxRetries: 0 });
const PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/;
const RAW_PRIVATE_KEY = /(?:0[xX])?[0-9a-fA-F]{64}/;
const AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const READY = new Set(['active', 'sleeping']);
const TERMINAL = new Set(['error', 'stopped']);
const WALLET_ENV = 'GAMEPLAY_WALLET_PRIVATE_KEY';
const HERMES_MODEL_ENV = Object.freeze({ HERMES_INFERENCE_MODEL: 'gpt-5.4-mini', HERMES_MAX_TOKENS: '2048' });

export class ConferenceLaunchError extends Error {
  constructor(code, { seatId = null, ambiguous = false } = {}) {
    super(code);
    this.name = 'ConferenceLaunchError';
    this.code = code;
    this.seat_id = seatId;
    this.ambiguous = ambiguous;
    this.retryable = false;
  }
}

function publicSeat(seat) {
  return { seat_id: seat.seat_id, team: seat.team, harness: seat.harness,
    maritime_agent: seat.maritime_agent, wallet_address: seat.wallet_address.toLowerCase(), cause_id: seat.cause_id };
}

function normalizeInventory(value) {
  const agents = Array.isArray(value) ? value : Array.isArray(value?.agents) ? value.agents :
    Array.isArray(value?.items) ? value.items : Array.isArray(value?.data) ? value.data : null;
  if (!agents) throw new ConferenceLaunchError('MARITIME_INVENTORY_INVALID');
  const ids = new Set();
  for (const agent of agents) {
    if (!agent || typeof agent !== 'object' || !AGENT_ID.test(agent.id ?? '') || ids.has(agent.id)) {
      throw new ConferenceLaunchError('MARITIME_INVENTORY_INVALID');
    }
    ids.add(agent.id);
  }
  return agents;
}

function framework(agent) {
  return agent.framework ?? agent.template ?? agent.templateId ?? agent.template_id;
}

function validateAgent(agent, seat) {
  if (!agent || !AGENT_ID.test(agent.id ?? '') || agent.externalId !== seat.maritime_agent ||
      agent.name !== seat.maritime_agent || framework(agent) !== seat.harness) {
    throw new ConferenceLaunchError('MARITIME_AGENT_IDENTITY_MISMATCH', { seatId: seat.seat_id });
  }
  return agent;
}

function planInventory({ roster, agents, maxAgents }) {
  const stableIds = new Set(roster.map(row => row.maritime_agent));
  const safeStaleMigration = agents.every(agent => stableIds.has(agent.externalId));
  const used = new Set();
  const seats = roster.map(seat => {
    const stable = agents.filter(agent => agent.externalId === seat.maritime_agent);
    const configured = seat.agent_id ? agents.find(agent => agent.id === seat.agent_id) : null;
    const base = { ...publicSeat(seat), configured_agent_id: seat.agent_id ?? null };
    if (stable.length > 1) return { ...base, agent_id: null, action: 'blocked', blocker: 'AMBIGUOUS_STABLE_IDENTITY' };
    if (configured && (stable.length !== 1 || stable[0].id !== configured.id)) {
      return { ...base, agent_id: configured.id, action: 'blocked', blocker: 'CONFIGURED_AGENT_IDENTITY_CONFLICT' };
    }
    if (stable.length === 1) {
      const agent = stable[0];
      if (used.has(agent.id) || agent.name !== seat.maritime_agent || framework(agent) !== seat.harness) {
        return { ...base, agent_id: agent.id, action: 'blocked', blocker: 'STABLE_AGENT_IDENTITY_CONFLICT' };
      }
      used.add(agent.id);
      return { ...base, agent_id: agent.id, action: 'reuse', agent_status: agent.status ?? 'unknown' };
    }
    const collidingName = agents.some(agent => agent.name === seat.maritime_agent);
    if (collidingName) return { ...base, agent_id: null, action: 'blocked', blocker: 'AGENT_NAME_CONFLICT' };
    if (seat.agent_id && !safeStaleMigration) {
      return { ...base, agent_id: null, action: 'blocked', blocker: 'STALE_CONFIGURED_ID_WITH_NONEMPTY_INVENTORY' };
    }
    return { ...base, agent_id: null, action: 'create', stale_configured_id: seat.agent_id ?? null };
  });
  const createCount = seats.filter(row => row.action === 'create').length;
  const blockers = seats.filter(row => row.blocker).map(row => `${row.seat_id}:${row.blocker}`);
  if (roster.length > maxAgents || agents.length + createCount > maxAgents) blockers.push('EXPLICIT_AGENT_LIMIT_EXCEEDED');
  return { seats, blockers, createCount, safeStaleMigration };
}

function recipeAction(seat, kind, extra = {}) {
  const recipe = recipeForHarness(seat.harness);
  return { seat_id: seat.seat_id, kind, harness: seat.harness, external_id: seat.maritime_agent,
    recipe_id: recipe.recipe_id, recipe_version: recipe.recipe_version, ...extra };
}

function planResult(config, agents, maxAgents, oneAwake) {
  const planned = planInventory({ roster: config.roster, agents, maxAgents });
  const reuse = planned.seats.filter(row => row.action === 'reuse').map(row => recipeAction(row, 'reuse', { agent_id: row.agent_id }));
  const creates = planned.seats.filter(row => row.action === 'create').map(row => recipeAction(row, 'create', {
    agent_id: null,
    provision: { externalId: row.maritime_agent, name: row.maritime_agent, template: row.harness,
      ...(oneAwake ? { idleTtlSeconds: 60 } : {}) }
  }));
  const installs = planned.seats.map(row => recipeAction(row, 'install', { agent_id: row.agent_id }));
  const verifies = planned.seats.map(row => recipeAction(row, 'verify', {
    agent_id: row.agent_id,
    checks: ['wallet-identity', 'private-storage', 'model-route', 'tool-execution', 'spectator-access']
  }));
  return Object.freeze({
    schema_version: 1,
    workflow_version: 1,
    run_id: config.run_id,
    read_only: true,
    one_awake: oneAwake,
    explicit_max_agents: maxAgents,
    account_agent_count: agents.length,
    requested_agent_count: config.roster.length,
    available_slots: Math.max(0, maxAgents - agents.length),
    within_explicit_limit: planned.blockers.length === 0,
    stale_binding_migration: planned.safeStaleMigration && planned.seats.some(row => row.stale_configured_id),
    seats: planned.seats,
    reuse,
    creates,
    installs,
    verifies,
    actions: [...reuse, ...creates, ...installs, ...verifies],
    blockers: planned.blockers,
    live_gameplay_proven: false
  });
}

function assertSdk(maritime, sdkPolicy, oneAwake) {
  if (!maritime?.agents) throw new TypeError('MARITIME_SDK_REQUIRED');
  for (const method of ['provision', 'get', 'list', 'listEnv', 'setEnv', 'reloadEnv', 'restart', 'chat']) {
    if (typeof maritime.agents[method] !== 'function') throw new TypeError(`MARITIME_SDK_${method.toUpperCase()}_REQUIRED`);
  }
  if (oneAwake && typeof maritime.agents.sleep !== 'function') throw new TypeError('MARITIME_SDK_SLEEP_REQUIRED');
  if (sdkPolicy !== undefined && (sdkPolicy?.package !== VERIFIED_MARITIME_SDK.package ||
      sdkPolicy.version !== VERIFIED_MARITIME_SDK.version || sdkPolicy.maxRetries !== 0)) {
    throw new TypeError('MARITIME_SDK_POLICY_INVALID');
  }
}

function maskedWallet(environment) {
  if (!Array.isArray(environment)) return false;
  const matches = environment.filter(row => row?.key === WALLET_ENV);
  if (matches.length !== 1) return false;
  const row = matches[0];
  const secret = row.isSecret === true || row.secret === true || row.is_secret === true;
  return secret && typeof row.value === 'string' && /(?:[•*]{3,}|\[MASKED\]|<redacted>)/i.test(row.value) &&
    !RAW_PRIVATE_KEY.test(row.value);
}

function hermesModelEnvironment(environment) {
  if (!Array.isArray(environment)) return false;
  return Object.entries(HERMES_MODEL_ENV).every(([key, expected]) => plainEnvironmentValue(environment, key, expected));
}

function plainEnvironmentValue(environment, key, expected) {
  if (!Array.isArray(environment)) return false;
    const matches = environment.filter(row => row?.key === key);
    return matches.length === 1 && matches[0].value === expected &&
      matches[0].isSecret !== true && matches[0].secret !== true && matches[0].is_secret !== true;
}

function defaultOperationsManifest(config) {
  const wallet = config.expected_owner ?? FROZEN_NETWORK.owner;
  return { schema_version: 1, network: 'base-sepolia', chain_id: 84532,
    phase_advancer: { role: 'phase-advancer', wallet_address: wallet, is_player_seat: false, erc8004_registered: false },
    gas_ceiling_wei: '1000000000000000' };
}

function identityDigest(config, maxAgents, oneAwake) {
  const value = { schema_version: 1, run_id: config.run_id, max_agents: maxAgents, one_awake: oneAwake,
    seats: config.roster.map(row => ({ ...publicSeat(row), recipe_sha256: recipeDigest(recipeForHarness(row.harness)) })) };
  return { ...value, digest: createHash('sha256').update(JSON.stringify(value)).digest('hex') };
}

function initialState(seat) {
  return { schema_version: 1, ...publicSeat(seat), agent_id: null, provision: 'unstarted',
    environment: 'unstarted', install: 'unstarted',
    activation_generation: 0,
    model_environment: seat.harness === 'hermes' ? 'unstarted' : 'not-required',
    model_configuration: 'unstarted', model_configuration_repair: 'unstarted',
    harness_restart: seat.harness === 'hermes' ? 'unstarted' : 'not-required',
    post_restart_configuration: seat.harness === 'hermes' ? 'unstarted' : 'not-required',
    post_restart_configuration_repair: seat.harness === 'hermes' ? 'unstarted' : 'not-required',
    post_restart_environment: seat.harness === 'hermes' ? 'unstarted' : 'not-required',
    verification: 'unstarted' };
}

function publicBoundConfig(config, bindings) {
  const allowed = ['schema_version', 'run_id', 'mode', 'chain_id', 'rpc_url', 'game_address', 'auth_adapter_address',
    'identity_registry_address', 'expected_owner', 'start_block', 'start_time', 'stop_time', 'intermission_ms',
    'poll_interval_ms', 'confirmations', 'telegram', 'agent_timeout_ms', 'adapter_timeout_ms', 'spectator_timeout_ms'];
  const result = {};
  for (const key of allowed) if (Object.hasOwn(config, key)) result[key] = structuredClone(config[key]);
  result.roster = config.roster.map(seat => ({ ...publicSeat(seat),
    agent_id: bindings.get(seat.seat_id).agent_id }));
  return result;
}

function rosterFingerprint(config) {
  return createHash('sha256').update(JSON.stringify(config.roster.map(row =>
    [row.seat_id, row.agent_id, row.wallet_address.toLowerCase(), row.team]).sort())).digest('hex');
}

function publicEvidence(value, direct, seat, agentId, artifact) {
  if (!direct || direct.seat_id !== seat.seat_id || direct.agent_id !== agentId ||
      direct.wallet_address?.toLowerCase() !== seat.wallet_address.toLowerCase() ||
      direct.wallet_identity_verified !== true || direct.persistent_storage_verified !== true ||
      direct.direct_runtime_inspection_verified !== true || RAW_PRIVATE_KEY.test(JSON.stringify(direct))) {
    throw new ConferenceLaunchError('DIRECT_RUNTIME_INSPECTION_INVALID', { seatId: seat.seat_id });
  }
  if (!value || value.seat_id !== seat.seat_id || value.agent_id !== agentId ||
      value.wallet_address?.toLowerCase() !== seat.wallet_address.toLowerCase() ||
      typeof value.tool_execution_verified !== 'boolean' || typeof value.model_profile_verified !== 'boolean' ||
      typeof value.spectator_access_blocked !== 'boolean' || RAW_PRIVATE_KEY.test(JSON.stringify(value))) {
    throw new ConferenceLaunchError('RUNTIME_VERIFICATION_INVALID', { seatId: seat.seat_id });
  }
  const recipe = recipeForHarness(seat.harness);
  const modelVerified = value.model_profile_verified === true &&
    ['operator-effective-config', 'sdk-response-metadata'].includes(value.model_verification_source) &&
    value.model_endpoint === recipe.model_profile.endpoint && value.model === recipe.model_profile.primary_model;
  if (value.model_profile_verified === true && !modelVerified) {
    throw new ConferenceLaunchError('MODEL_PROFILE_EVIDENCE_INVALID', { seatId: seat.seat_id });
  }
  const accessBlocked = value.spectator_access_blocked === true &&
    value.access_verification_source === 'operator-denial-probe';
  if (value.spectator_access_blocked === true && !accessBlocked) {
    throw new ConferenceLaunchError('SPECTATOR_ACCESS_EVIDENCE_INVALID', { seatId: seat.seat_id });
  }
  return { seat_id: seat.seat_id, agent_id: agentId, harness: seat.harness,
    wallet_address: seat.wallet_address.toLowerCase(), framework_status_verified: true,
    wallet_identity_verified: true, direct_runtime_inspection_verified: true,
    tool_execution_verified: value.tool_execution_verified,
    persistent_storage_verified: true, persistent_bundles_verified: false,
    model_profile_verified: modelVerified, model_endpoint: modelVerified ? value.model_endpoint : null,
    model: modelVerified ? value.model : null,
    model_verification_source: modelVerified ? value.model_verification_source : null,
    spectator_access_blocked: accessBlocked,
    access_verification_source: accessBlocked ? value.access_verification_source : null,
    gameplay_command: [...artifact.gameplay_command] };
}

function unverifiedEvidence(seat, agentId, artifact) {
  return { seat_id: seat.seat_id, agent_id: agentId, harness: seat.harness,
    wallet_address: seat.wallet_address.toLowerCase(), framework_status_verified: true,
    wallet_identity_verified: false, direct_runtime_inspection_verified: false,
    tool_execution_verified: false, persistent_storage_verified: false,
    persistent_bundles_verified: false, model_profile_verified: false,
    model_endpoint: null, model: null, model_verification_source: null,
    spectator_access_blocked: false, access_verification_source: null,
    gameplay_command: [...artifact.gameplay_command] };
}

function evidenceBlockers(evidence) {
  const blockers = [];
  for (const row of evidence) {
    if (!row.wallet_identity_verified) blockers.push(`${row.seat_id}:WALLET_IDENTITY_UNVERIFIED`);
    if (!row.persistent_storage_verified) blockers.push(`${row.seat_id}:PERSISTENT_STORAGE_UNVERIFIED`);
    if (!row.tool_execution_verified) blockers.push(`${row.seat_id}:TOOL_EXECUTION_UNVERIFIED`);
    if (!row.model_profile_verified) blockers.push(`${row.seat_id}:MODEL_PROFILE_UNVERIFIED`);
    if (!row.spectator_access_blocked) blockers.push(`${row.seat_id}:SPECTATOR_ACCESS_POLICY_UNVERIFIED`);
    if (!row.persistent_bundles_verified) blockers.push(`${row.seat_id}:RESTART_BUNDLE_RECOVERY_UNPROVEN`);
  }
  return blockers;
}

function wait(delay, sleep) {
  return sleep ? sleep(delay) : new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Resumable conference bootstrap. Construction and plan() are mutation-free.
 * The caller must construct the official SDK client with maxRetries: 0.
 */
export function createConferenceLaunchWorkflow({ config, runtimeDir, maritime, apiKey, secretProvider, maxAgents = 3,
  sdkPolicy, operationsManifest = defaultOperationsManifest(config ?? {}), installer, verifier,
  fetchImpl = globalThis.fetch, timeoutMs = 120_000, deploymentTimeoutMs = 180_000,
  pollIntervalMs = 2_000, sleep, now = () => new Date(), reverifyIncomplete = false, oneAwake = false } = {}) {
  if (config?.schema_version !== 1 || config.chain_id !== 84532 || typeof config.run_id !== 'string' ||
      !isAbsolute(runtimeDir ?? '') || typeof secretProvider !== 'function' || !Number.isInteger(maxAgents) ||
      maxAgents < 1 || maxAgents > 20 || !Number.isInteger(deploymentTimeoutMs) || deploymentTimeoutMs < 1 ||
      !Number.isInteger(pollIntervalMs) || pollIntervalMs < 0 || typeof reverifyIncomplete !== 'boolean' ||
      typeof oneAwake !== 'boolean') {
    throw new TypeError('CONFERENCE_LAUNCH_CONFIGURATION_INVALID');
  }
  validateMaritimeRoster(config.roster, { requireAgentIds: false });
  assertSdk(maritime, sdkPolicy, oneAwake);
  const roster = structuredClone(config.roster);
  const directory = join(runtimeDir, 'maritime-launch');
  const store = createDurableStore({ directory });
  const runtimeInstaller = installer ?? createMaritimeInstaller({ apiKey, fetchImpl, timeoutMs });
  if (typeof runtimeInstaller?.inspectVolumeRoot !== 'function' || typeof runtimeInstaller?.install !== 'function') {
    throw new TypeError('MARITIME_INSTALLER_INVALID');
  }
  if (typeof runtimeInstaller.inspectModel !== 'function' || typeof runtimeInstaller.configureModel !== 'function') {
    throw new TypeError('MARITIME_INSTALLER_MODEL_CONFIGURATION_REQUIRED');
  }
  if (roster.some(seat => seat.harness === 'hermes') &&
      (typeof runtimeInstaller.inspectHarnessConfiguration !== 'function' ||
       typeof runtimeInstaller.configureHarnessConfiguration !== 'function')) {
    throw new TypeError('MARITIME_INSTALLER_HARNESS_INSPECTION_REQUIRED');
  }
  const runtimeVerifier = typeof verifier === 'function' ? { verify: verifier } : verifier ?? createMaritimeRuntimeVerifier({ maritime });
  if (typeof runtimeVerifier?.verify !== 'function') throw new TypeError('MARITIME_VERIFIER_INVALID');
  const identity = identityDigest(config, maxAgents, oneAwake);
  let active = false;

  async function listAgents() {
    try { return normalizeInventory(await maritime.agents.list()); }
    catch (error) {
      if (error instanceof ConferenceLaunchError) throw error;
      throw new ConferenceLaunchError('MARITIME_INVENTORY_UNAVAILABLE');
    }
  }

  async function waitUntilReady(seat, agentId) {
    const deadline = Date.now() + deploymentTimeoutMs;
    do {
      let agent;
      try { agent = validateAgent(await maritime.agents.get(agentId), seat); }
      catch (error) {
        if (error instanceof ConferenceLaunchError) throw error;
        throw new ConferenceLaunchError('MARITIME_AGENT_READ_UNAVAILABLE', { seatId: seat.seat_id });
      }
      if (READY.has(agent.status)) return agent;
      if (TERMINAL.has(agent.status)) throw new ConferenceLaunchError('MARITIME_AGENT_NOT_READY', { seatId: seat.seat_id });
      if (Date.now() >= deadline) break;
      await wait(pollIntervalMs, sleep);
    } while (true);
    throw new ConferenceLaunchError('MARITIME_AGENT_READY_TIMEOUT', { seatId: seat.seat_id });
  }

  async function ensureActive(seat, state, label) {
    if (!oneAwake) return state;
    let agent;
    try { agent = validateAgent(await maritime.agents.get(state.agent_id), seat); }
    catch { throw new ConferenceLaunchError('MARITIME_AGENT_READ_UNAVAILABLE', { seatId: seat.seat_id }); }
    const steps = { ...(state.activation_steps ?? {}) };
    if (agent.status === 'active') {
      // Maritime can report the VM active before its file/exec services are
      // reachable. Match the dispatch adapter's bounded wake-settle delay.
      await wait(10_000, sleep);
      const generation = (state.activation_generation ?? 0) + (steps[label] === 'done' ? 0 : 1);
      steps[label] = 'done';
      state = { ...state, activation_steps: steps, activation_generation: generation };
      await store.set(`seat:${seat.seat_id}`, state);
      return state;
    }
    if (steps[label] === 'intent' || steps[label] === 'reconcile-intent') {
      throw new ConferenceLaunchError('AGENT_ACTIVATION_OUTCOME_UNKNOWN', { seatId: seat.seat_id, ambiguous: true });
    }
    steps[label] = steps[label] === 'done' ? 'reconcile-intent' : 'intent';
    state = { ...state, activation_steps: steps };
    await store.set(`seat:${seat.seat_id}`, state);
    let activated;
    try { activated = validateAgent(await maritime.agents.reloadEnv(state.agent_id), seat); }
    catch { throw new ConferenceLaunchError('AGENT_ACTIVATION_OUTCOME_UNKNOWN', { seatId: seat.seat_id, ambiguous: true }); }
    if (activated.status !== 'active') {
      const deadline = Date.now() + deploymentTimeoutMs;
      do {
        if (Date.now() >= deadline) throw new ConferenceLaunchError('MARITIME_AGENT_READY_TIMEOUT', { seatId: seat.seat_id });
        await wait(pollIntervalMs, sleep);
        activated = validateAgent(await maritime.agents.get(state.agent_id), seat);
      } while (activated.status !== 'active');
    }
    await wait(10_000, sleep);
    steps[label] = 'done';
    state = { ...state, activation_steps: steps, activation_generation: (state.activation_generation ?? 0) + 1 };
    await store.set(`seat:${seat.seat_id}`, state);
    return state;
  }

  async function ensureSleeping(seat, state, label) {
    if (!oneAwake) return state;
    let agent;
    try { agent = validateAgent(await maritime.agents.get(state.agent_id), seat); }
    catch { throw new ConferenceLaunchError('MARITIME_AGENT_READ_UNAVAILABLE', { seatId: seat.seat_id }); }
    const sleepSteps = { ...(state.sleep_steps ?? {}) };
    if (agent.status === 'sleeping') {
      sleepSteps[label] = 'done';
      state = { ...state, sleep_steps: sleepSteps };
      await store.set(`seat:${seat.seat_id}`, state);
      return state;
    }
    if (sleepSteps[label] === 'intent' || sleepSteps[label] === 'reconcile-intent') {
      throw new ConferenceLaunchError('AGENT_SLEEP_OUTCOME_UNKNOWN', { seatId: seat.seat_id, ambiguous: true });
    }
    if (agent.status !== 'active') agent = await waitUntilReady(seat, state.agent_id);
    if (agent.status === 'sleeping') return ensureSleeping(seat, state, label);
    // A previously confirmed sleep may be followed by a later inspection that
    // wakes the VM. Observing it active proves the old transition completed and
    // authorizes a new, separately journaled idempotent sleep.
    sleepSteps[label] = sleepSteps[label] === 'done' ? 'reconcile-intent' : 'intent';
    state = { ...state, sleep_steps: sleepSteps };
    await store.set(`seat:${seat.seat_id}`, state);
    try {
      const slept = validateAgent(await maritime.agents.sleep(state.agent_id), seat);
      if (slept.status !== 'sleeping') throw new Error('sleep not confirmed');
    } catch { throw new ConferenceLaunchError('AGENT_SLEEP_OUTCOME_UNKNOWN', { seatId: seat.seat_id, ambiguous: true }); }
    sleepSteps[label] = 'done';
    state = { ...state, sleep_steps: sleepSteps };
    await store.set(`seat:${seat.seat_id}`, state);
    return state;
  }

  async function inspectWithEnvironment(seat, state, artifact) {
    if (!oneAwake) return { state, inspected: await runtimeInstaller.inspectRuntime(artifact) };
    // A restored snapshot can retain the configured secret in Maritime while
    // omitting it from the live process. Prefer a direct inspection first; if
    // that fails, reload the already-stored environment before verification.
    try { return { state, inspected: await runtimeInstaller.inspectRuntime(artifact) }; } catch {}
    const label = 'pre-verification';
    const steps = { ...(state.environment_refresh_steps ?? {}) };
    if (steps[label] === 'intent' || steps[label] === 'reconcile-intent') {
      throw new ConferenceLaunchError('RUNTIME_ENV_RELOAD_OUTCOME_UNKNOWN', { seatId: seat.seat_id, ambiguous: true });
    }
    steps[label] = steps[label] === 'done' ? 'reconcile-intent' : 'intent';
    state = { ...state, environment_refresh_steps: steps };
    await store.set(`seat:${seat.seat_id}`, state);
    try { await maritime.agents.reloadEnv(state.agent_id); }
    catch { throw new ConferenceLaunchError('RUNTIME_ENV_RELOAD_OUTCOME_UNKNOWN', { seatId: seat.seat_id, ambiguous: true }); }
    steps[label] = 'done';
    state = { ...state, environment_refresh_steps: steps,
      activation_generation: (state.activation_generation ?? 0) + 1 };
    await store.set(`seat:${seat.seat_id}`, state);
    await wait(10_000, sleep);
    state = await configureHermesBeforeVerification(seat, state, artifact);
    state = await configureModelBeforeVerification(seat, state, artifact);
    return { state, inspected: await runtimeInstaller.inspectRuntime(artifact) };
  }

  function validHermesConfiguration(value, seat, state) {
    return value?.seat_id === seat.seat_id && value.agent_id === state.agent_id &&
      value.hermes_terminal_env_passthrough_configured === true &&
      value.hermes_private_state_owner_configured === true;
  }

  async function restartHermesAfterInstall(seat, state) {
    if (seat.harness !== 'hermes') return ensureSleeping(seat, state, 'post-install');
    let restartStage = state.harness_restart ?? 'unstarted';
    if (restartStage === 'intent') {
      throw new ConferenceLaunchError('HERMES_RESTART_OUTCOME_UNKNOWN', { seatId: seat.seat_id, ambiguous: true });
    }
    // configuration-verified was written by recipe .5 before its restart. It
    // is not durable evidence, but it is safe to continue with the one restart.
    if (restartStage === 'configuration-verified') restartStage = 'unstarted';
    if (!['unstarted', 'done'].includes(restartStage)) {
      throw new ConferenceLaunchError('HERMES_RESTART_STATE_INVALID', { seatId: seat.seat_id });
    }
    if (restartStage === 'unstarted') {
      state = { ...state, harness_restart: 'intent' };
      await store.set(`seat:${seat.seat_id}`, state);
      try { validateAgent(await maritime.agents.restart(state.agent_id), seat); }
      catch { throw new ConferenceLaunchError('HERMES_RESTART_OUTCOME_UNKNOWN', { seatId: seat.seat_id, ambiguous: true }); }
      state = { ...state, harness_restart: 'done' };
      await store.set(`seat:${seat.seat_id}`, state);
    }
    await waitUntilReady(seat, state.agent_id);
    return ensureSleeping(seat, state, 'post-hermes-restart');
  }

  async function configureHermesBeforeVerification(seat, state, artifact) {
    if (seat.harness !== 'hermes') return state;
    // Lifecycle reloads can rematerialize the template-owned config.yaml. Apply
    // the stored environment first, then make the allowlist the final mutation
    // before direct inspection and the model/tool invocation.
    const environmentStage = state.post_restart_environment ?? 'unstarted';
    if (environmentStage === 'intent') {
      throw new ConferenceLaunchError('HERMES_POST_RESTART_ENV_RELOAD_OUTCOME_UNKNOWN',
        { seatId: seat.seat_id, ambiguous: true });
    }
    if (!['unstarted', 'done'].includes(environmentStage)) {
      throw new ConferenceLaunchError('HERMES_POST_RESTART_ENV_RELOAD_STATE_INVALID', { seatId: seat.seat_id });
    }
    if (!maskedWallet(await maritime.agents.listEnv(state.agent_id))) {
      throw new ConferenceLaunchError('WALLET_SECRET_NOT_MASKED', { seatId: seat.seat_id });
    }
    if (environmentStage === 'unstarted') {
      state = { ...state, post_restart_environment: 'intent' };
      await store.set(`seat:${seat.seat_id}`, state);
      try { await maritime.agents.reloadEnv(state.agent_id); }
      catch { throw new ConferenceLaunchError('HERMES_POST_RESTART_ENV_RELOAD_OUTCOME_UNKNOWN',
        { seatId: seat.seat_id, ambiguous: true }); }
      state = { ...state, post_restart_environment: 'done',
        activation_generation: (state.activation_generation ?? 0) + 1 };
      await store.set(`seat:${seat.seat_id}`, state);
      if (!maskedWallet(await maritime.agents.listEnv(state.agent_id))) {
        throw new ConferenceLaunchError('WALLET_SECRET_NOT_MASKED', { seatId: seat.seat_id });
      }
    }
    await waitUntilReady(seat, state.agent_id);

    const generation = state.activation_generation ?? 0;
    let configurationStage = state.post_restart_configuration ?? 'unstarted';
    const priorRepairStage = state.post_restart_configuration_repair ?? 'unstarted';
    if (state.post_restart_configuration_generation !== generation &&
        configurationStage !== 'intent' && priorRepairStage !== 'intent') {
      configurationStage = 'unstarted';
      state = { ...state, post_restart_configuration: 'unstarted',
        post_restart_configuration_repair: 'unstarted', post_restart_configuration_generation: generation };
      await store.set(`seat:${seat.seat_id}`, state);
    }
    if (!['unstarted', 'intent', 'done'].includes(configurationStage)) {
      throw new ConferenceLaunchError('HERMES_POST_RESTART_CONFIGURATION_STATE_INVALID', { seatId: seat.seat_id });
    }
    if (configurationStage === 'intent') {
      let inspected, inspectionError;
      try { inspected = await runtimeInstaller.inspectHarnessConfiguration(artifact); }
      catch (error) { inspectionError = error; }
      if (validHermesConfiguration(inspected, seat, state)) {
        state = { ...state, post_restart_configuration: 'done', post_restart_configuration_generation: generation,
          ...(state.post_restart_configuration_repair === 'intent' ? { post_restart_configuration_repair: 'done' } : {}) };
        await store.set(`seat:${seat.seat_id}`, state);
      } else if (inspectionError?.code === 'HERMES_CONFIG_INSPECTION_INVALID') {
        const repairStage = state.post_restart_configuration_repair ?? 'unstarted';
        if (repairStage === 'intent' || repairStage === 'done') {
          throw new ConferenceLaunchError('HERMES_POST_RESTART_CONFIGURATION_REPAIR_OUTCOME_UNKNOWN',
            { seatId: seat.seat_id, ambiguous: true });
        }
        if (repairStage !== 'unstarted') {
          throw new ConferenceLaunchError('HERMES_POST_RESTART_CONFIGURATION_STATE_INVALID', { seatId: seat.seat_id });
        }
        state = { ...state, post_restart_configuration_repair: 'intent' };
        await store.set(`seat:${seat.seat_id}`, state);
        let repaired;
        try { repaired = await runtimeInstaller.configureHarnessConfiguration(artifact); } catch {}
        if (!validHermesConfiguration(repaired, seat, state)) {
          throw new ConferenceLaunchError('HERMES_POST_RESTART_CONFIGURATION_REPAIR_OUTCOME_UNKNOWN',
            { seatId: seat.seat_id, ambiguous: true });
        }
        state = { ...state, post_restart_configuration: 'done', post_restart_configuration_repair: 'done',
          post_restart_configuration_generation: generation };
        await store.set(`seat:${seat.seat_id}`, state);
      } else {
        throw new ConferenceLaunchError('HERMES_POST_RESTART_CONFIGURATION_OUTCOME_UNKNOWN',
          { seatId: seat.seat_id, ambiguous: true });
      }
    } else if (configurationStage === 'unstarted') {
      state = { ...state, post_restart_configuration: 'intent' };
      await store.set(`seat:${seat.seat_id}`, state);
      let configured;
      try { configured = await runtimeInstaller.configureHarnessConfiguration(artifact); } catch {}
      if (!validHermesConfiguration(configured, seat, state)) {
        throw new ConferenceLaunchError('HERMES_POST_RESTART_CONFIGURATION_OUTCOME_UNKNOWN',
          { seatId: seat.seat_id, ambiguous: true });
      }
      state = { ...state, post_restart_configuration: 'done', post_restart_configuration_generation: generation };
      await store.set(`seat:${seat.seat_id}`, state);
    } else {
      const repairStage = state.post_restart_configuration_repair ?? 'unstarted';
      if (!['unstarted', 'intent', 'done'].includes(repairStage)) {
        throw new ConferenceLaunchError('HERMES_POST_RESTART_CONFIGURATION_STATE_INVALID', { seatId: seat.seat_id });
      }
      let inspected, inspectionError;
      try { inspected = await runtimeInstaller.inspectHarnessConfiguration(artifact); }
      catch (error) { inspectionError = error; }
      if (validHermesConfiguration(inspected, seat, state)) {
        if (repairStage === 'intent') {
            state = { ...state, post_restart_configuration_repair: 'done',
              post_restart_configuration_generation: generation };
          await store.set(`seat:${seat.seat_id}`, state);
        }
      } else if (inspectionError?.code === 'HERMES_CONFIG_INSPECTION_INVALID') {
        if (repairStage === 'intent') {
          throw new ConferenceLaunchError('HERMES_POST_RESTART_CONFIGURATION_REPAIR_OUTCOME_UNKNOWN',
            { seatId: seat.seat_id, ambiguous: true });
        }
        if (repairStage === 'done') {
          throw new ConferenceLaunchError('HERMES_POST_RESTART_CONFIGURATION_INVALID', { seatId: seat.seat_id });
        }
        if (repairStage !== 'unstarted') {
          throw new ConferenceLaunchError('HERMES_POST_RESTART_CONFIGURATION_STATE_INVALID', { seatId: seat.seat_id });
        }
        state = { ...state, post_restart_configuration_repair: 'intent' };
        await store.set(`seat:${seat.seat_id}`, state);
        let repaired;
        try { repaired = await runtimeInstaller.configureHarnessConfiguration(artifact); } catch {}
        if (!validHermesConfiguration(repaired, seat, state)) {
          throw new ConferenceLaunchError('HERMES_POST_RESTART_CONFIGURATION_REPAIR_OUTCOME_UNKNOWN',
            { seatId: seat.seat_id, ambiguous: true });
        }
        state = { ...state, post_restart_configuration_repair: 'done',
          post_restart_configuration_generation: generation };
        await store.set(`seat:${seat.seat_id}`, state);
      } else {
        throw new ConferenceLaunchError('HERMES_POST_RESTART_CONFIGURATION_INSPECTION_UNKNOWN',
          { seatId: seat.seat_id, ambiguous: true });
      }
    }
    return state;
  }

  async function configureModelBeforeVerification(seat, state, artifact) {
    const valid = value => value?.seat_id === seat.seat_id && value.harness === seat.harness &&
      value.configured === true && value.model === 'gpt-5.4-mini' && value.reasoning_effort === 'low' &&
      value.max_output_tokens === 2048 && value.automatic_fallback === false && value.fallback_model === null &&
      value.response_metadata_required === true;
    const stage = state.model_configuration ?? 'unstarted';
    if (!['unstarted', 'intent', 'done'].includes(stage)) {
      throw new ConferenceLaunchError('MODEL_CONFIGURATION_STATE_INVALID', { seatId: seat.seat_id });
    }
    if (stage === 'intent') {
      let inspected, inspectionError;
      try { inspected = await runtimeInstaller.inspectModel(artifact); } catch (error) { inspectionError = error; }
      if (valid(inspected)) {
        state = { ...state, model_configuration: 'done' };
        await store.set(`seat:${seat.seat_id}`, state);
        return state;
      }
      if (inspectionError?.code !== 'MODEL_CONFIG_INSPECTION_INVALID') {
        throw new ConferenceLaunchError('MODEL_CONFIGURATION_OUTCOME_UNKNOWN',
          { seatId: seat.seat_id, ambiguous: true });
      }
      const repair = state.model_configuration_repair ?? 'unstarted';
      if (repair !== 'unstarted') {
        throw new ConferenceLaunchError('MODEL_CONFIGURATION_REPAIR_OUTCOME_UNKNOWN',
          { seatId: seat.seat_id, ambiguous: true });
      }
      state = { ...state, model_configuration_repair: 'intent' };
      await store.set(`seat:${seat.seat_id}`, state);
      let repaired;
      try { repaired = await runtimeInstaller.configureModel(artifact); } catch {}
      if (!valid(repaired)) {
        throw new ConferenceLaunchError('MODEL_CONFIGURATION_REPAIR_OUTCOME_UNKNOWN',
          { seatId: seat.seat_id, ambiguous: true });
      }
      state = { ...state, model_configuration: 'done', model_configuration_repair: 'done' };
      await store.set(`seat:${seat.seat_id}`, state);
      return state;
    }
    if (stage === 'unstarted') {
      state = { ...state, model_configuration: 'intent' };
      await store.set(`seat:${seat.seat_id}`, state);
      let configured;
      try { configured = await runtimeInstaller.configureModel(artifact); } catch {}
      if (!valid(configured)) {
        throw new ConferenceLaunchError('MODEL_CONFIGURATION_OUTCOME_UNKNOWN',
          { seatId: seat.seat_id, ambiguous: true });
      }
      state = { ...state, model_configuration: 'done' };
      await store.set(`seat:${seat.seat_id}`, state);
      return state;
    }
    let inspected;
    try { inspected = await runtimeInstaller.inspectModel(artifact); } catch {}
    if (valid(inspected)) return state;
    const repair = state.model_configuration_repair ?? 'unstarted';
    if (repair !== 'unstarted') {
      throw new ConferenceLaunchError('MODEL_CONFIGURATION_REPAIR_OUTCOME_UNKNOWN',
        { seatId: seat.seat_id, ambiguous: true });
    }
    state = { ...state, model_configuration_repair: 'intent' };
    await store.set(`seat:${seat.seat_id}`, state);
    let configured;
    try { configured = await runtimeInstaller.configureModel(artifact); } catch {}
    if (!valid(configured)) {
      throw new ConferenceLaunchError('MODEL_CONFIGURATION_REPAIR_OUTCOME_UNKNOWN',
        { seatId: seat.seat_id, ambiguous: true });
    }
    state = { ...state, model_configuration_repair: 'done' };
    await store.set(`seat:${seat.seat_id}`, state);
    return state;
  }

  return Object.freeze({
    async plan() {
      return planResult(config, await listAgents(), maxAgents, oneAwake);
    },

    async launch() {
      if (active) throw new ConferenceLaunchError('CONFERENCE_LAUNCH_BUSY');
      active = true;
      const keys = new Map();
      let release;
      try {
        await prepareRuntimeDirectory(runtimeDir);
        release = await acquireRunnerLock(directory);
        const savedIdentity = await store.get('identity');
        if (savedIdentity && savedIdentity.digest !== identity.digest) throw new ConferenceLaunchError('CONFERENCE_LAUNCH_IDENTITY_CHANGED');
        const initialPlan = planResult(config, await listAgents(), maxAgents, oneAwake);
        if (initialPlan.blockers.length) throw new ConferenceLaunchError(initialPlan.blockers.includes('EXPLICIT_AGENT_LIMIT_EXCEEDED') ?
          'EXPLICIT_AGENT_LIMIT_EXCEEDED' : 'MARITIME_IDENTITY_CONFLICT');
        if (!savedIdentity) await store.putIfAbsent('identity', identity);

        const states = new Map();
        for (const seat of roster) states.set(seat.seat_id, await store.get(`seat:${seat.seat_id}`) ?? initialState(seat));

        // Validate every key still needing injection before the first external mutation.
        const fingerprints = new Set();
        for (const seat of roster) {
          const state = states.get(seat.seat_id);
          if (['set', 'reload-intent', 'reloaded', 'verified'].includes(state.environment)) continue;
          let key;
          try { key = await secretProvider(seat.seat_id); } catch { throw new ConferenceLaunchError('PLAYER_SECRET_UNAVAILABLE', { seatId: seat.seat_id }); }
          let wallet = null;
          try { if (PRIVATE_KEY.test(key ?? '')) wallet = deriveEthereumAddress(key).toLowerCase(); } catch {}
          const fingerprint = typeof key === 'string' ? createHash('sha256').update(key).digest('hex') : null;
          if (!fingerprint || fingerprints.has(fingerprint) || wallet !== seat.wallet_address.toLowerCase()) {
            throw new ConferenceLaunchError(wallet && fingerprints.has(fingerprint) ? 'DUPLICATE_PLAYER_SECRET' : 'PLAYER_WALLET_MISMATCH', { seatId: seat.seat_id });
          }
          fingerprints.add(fingerprint);
          keys.set(seat.seat_id, key);
        }

        // A rotating fleet starts with every existing conference agent asleep.
        // Unrelated awake inventory is never mutated implicitly.
        if (oneAwake) {
          const agents = await listAgents();
          const names = new Set(roster.map(seat => seat.maritime_agent));
          if (agents.some(agent => !names.has(agent.externalId) && agent.status === 'active')) {
            throw new ConferenceLaunchError('UNRELATED_AWAKE_AGENT_BLOCKS_ROTATION');
          }
          for (const agent of agents.filter(candidate => names.has(candidate.externalId))) {
            const seat = roster.find(candidate => candidate.maritime_agent === agent.externalId);
            validateAgent(agent, seat);
            let state = states.get(seat.seat_id);
            if (state.agent_id && state.agent_id !== agent.id) throw new ConferenceLaunchError('BOUND_AGENT_CHANGED', { seatId: seat.seat_id });
            state = { ...state, agent_id: agent.id, provision: 'done' };
            await store.set(`seat:${seat.seat_id}`, state);
            state = await ensureSleeping(seat, state, 'initial-capacity');
            states.set(seat.seat_id, state);
          }
        }

        // Phase 1: bind every stable identity through the official SDK.
        for (const seat of roster) {
          let state = states.get(seat.seat_id);
          const agents = await listAgents();
          const planned = planInventory({ roster, agents, maxAgents });
          const row = planned.seats.find(candidate => candidate.seat_id === seat.seat_id);
          if (planned.blockers.length) throw new ConferenceLaunchError(planned.blockers.includes('EXPLICIT_AGENT_LIMIT_EXCEEDED') ?
            'EXPLICIT_AGENT_LIMIT_EXCEEDED' : 'MARITIME_IDENTITY_CONFLICT', { seatId: seat.seat_id });
          if (row.action === 'reuse') {
            validateAgent(agents.find(agent => agent.id === row.agent_id), seat);
            if (state.agent_id && state.agent_id !== row.agent_id) throw new ConferenceLaunchError('BOUND_AGENT_CHANGED', { seatId: seat.seat_id });
            state = { ...state, agent_id: row.agent_id, provision: 'done' };
            await store.set(`seat:${seat.seat_id}`, state);
          } else {
            if (state.provision !== 'unstarted') throw new ConferenceLaunchError('AGENT_PROVISION_OUTCOME_UNKNOWN', { seatId: seat.seat_id, ambiguous: true });
            state = { ...state, provision: 'intent' };
            await store.set(`seat:${seat.seat_id}`, state);
            let agent;
            try {
              const recipe = recipeForHarness(seat.harness);
              agent = await maritime.agents.provision({ externalId: seat.maritime_agent, name: seat.maritime_agent,
                template: seat.harness, instructions: recipe.instructions,
                ...(oneAwake ? { idleTtlSeconds: recipe.runtime.one_awake_idle_ttl_seconds } : {}) });
              validateAgent(agent, seat);
            } catch {
              throw new ConferenceLaunchError('AGENT_PROVISION_OUTCOME_UNKNOWN', { seatId: seat.seat_id, ambiguous: true });
            }
            state = { ...state, agent_id: agent.id, provision: 'done' };
            await store.set(`seat:${seat.seat_id}`, state);
            if (oneAwake) {
              await waitUntilReady(seat, agent.id);
              state = await ensureSleeping(seat, state, 'post-provision');
            }
          }
          states.set(seat.seat_id, state);
        }

        // Persist the Hermes model route independently from the encrypted
        // wallet. Each control-plane write has its own durable intent so an
        // uncertain response is inspected, never blindly replayed.
        for (const seat of roster.filter(row => row.harness === 'hermes')) {
          let state = states.get(seat.seat_id);
          let stage = state.model_environment ?? 'unstarted';
          const environment = () => maritime.agents.listEnv(state.agent_id);
          if (stage === 'model-intent') {
            if (!plainEnvironmentValue(await environment(), 'HERMES_INFERENCE_MODEL', HERMES_MODEL_ENV.HERMES_INFERENCE_MODEL)) {
              throw new ConferenceLaunchError('HERMES_MODEL_ENV_OUTCOME_UNKNOWN',
                { seatId: seat.seat_id, ambiguous: true });
            }
            stage = 'model-set'; state = { ...state, model_environment: stage };
            await store.set(`seat:${seat.seat_id}`, state);
          }
          if (stage === 'unstarted') {
            state = { ...state, model_environment: 'model-intent' };
            await store.set(`seat:${seat.seat_id}`, state);
            try { await maritime.agents.setEnv(state.agent_id, 'HERMES_INFERENCE_MODEL',
              HERMES_MODEL_ENV.HERMES_INFERENCE_MODEL, { secret: false }); }
            catch { throw new ConferenceLaunchError('HERMES_MODEL_ENV_OUTCOME_UNKNOWN',
              { seatId: seat.seat_id, ambiguous: true }); }
            stage = 'model-set'; state = { ...state, model_environment: stage };
            await store.set(`seat:${seat.seat_id}`, state);
          }
          if (stage === 'limit-intent') {
            if (!plainEnvironmentValue(await environment(), 'HERMES_MAX_TOKENS', HERMES_MODEL_ENV.HERMES_MAX_TOKENS)) {
              throw new ConferenceLaunchError('HERMES_MODEL_LIMIT_ENV_OUTCOME_UNKNOWN',
                { seatId: seat.seat_id, ambiguous: true });
            }
            stage = 'set'; state = { ...state, model_environment: stage };
            await store.set(`seat:${seat.seat_id}`, state);
          }
          if (stage === 'model-set') {
            state = { ...state, model_environment: 'limit-intent' };
            await store.set(`seat:${seat.seat_id}`, state);
            try { await maritime.agents.setEnv(state.agent_id, 'HERMES_MAX_TOKENS',
              HERMES_MODEL_ENV.HERMES_MAX_TOKENS, { secret: false }); }
            catch { throw new ConferenceLaunchError('HERMES_MODEL_LIMIT_ENV_OUTCOME_UNKNOWN',
              { seatId: seat.seat_id, ambiguous: true }); }
            stage = 'set'; state = { ...state, model_environment: stage };
            await store.set(`seat:${seat.seat_id}`, state);
          }
          if (stage === 'reload-intent') {
            throw new ConferenceLaunchError('HERMES_MODEL_ENV_RELOAD_OUTCOME_UNKNOWN',
              { seatId: seat.seat_id, ambiguous: true });
          }
          if (stage === 'set') {
            if (!hermesModelEnvironment(await environment())) {
              throw new ConferenceLaunchError('HERMES_MODEL_ENV_UNVERIFIED', { seatId: seat.seat_id });
            }
            state = { ...state, model_environment: 'reload-intent' };
            await store.set(`seat:${seat.seat_id}`, state);
            try { await maritime.agents.reloadEnv(state.agent_id); }
            catch { throw new ConferenceLaunchError('HERMES_MODEL_ENV_RELOAD_OUTCOME_UNKNOWN',
              { seatId: seat.seat_id, ambiguous: true }); }
            stage = 'verified'; state = { ...state, model_environment: stage };
            await store.set(`seat:${seat.seat_id}`, state);
          }
          if (stage !== 'verified' || !hermesModelEnvironment(await environment())) {
            throw new ConferenceLaunchError('HERMES_MODEL_ENV_UNVERIFIED', { seatId: seat.seat_id });
          }
          state = await ensureSleeping(seat, state, 'post-model-environment');
          states.set(seat.seat_id, state);
        }

        // Phase 2: inject exactly one encrypted player wallet and activate it.
        for (const seat of roster) {
          let state = states.get(seat.seat_id);
          const agentId = state.agent_id;
          if (state.environment === 'set-intent') throw new ConferenceLaunchError('WALLET_ENV_OUTCOME_UNKNOWN', { seatId: seat.seat_id, ambiguous: true });
          if (state.environment === 'reload-intent') throw new ConferenceLaunchError('WALLET_ENV_RELOAD_OUTCOME_UNKNOWN', { seatId: seat.seat_id, ambiguous: true });
          if (state.environment === 'verified') {
            if (!maskedWallet(await maritime.agents.listEnv(agentId))) throw new ConferenceLaunchError('WALLET_SECRET_NOT_MASKED', { seatId: seat.seat_id });
            keys.delete(seat.seat_id);
            continue;
          }
          if (state.environment === 'unstarted') {
            state = { ...state, environment: 'set-intent' }; await store.set(`seat:${seat.seat_id}`, state);
            try { await maritime.agents.setEnv(agentId, WALLET_ENV, keys.get(seat.seat_id), { secret: true }); }
            catch { throw new ConferenceLaunchError('WALLET_ENV_OUTCOME_UNKNOWN', { seatId: seat.seat_id, ambiguous: true }); }
            finally { keys.delete(seat.seat_id); }
            state = { ...state, environment: 'set' }; await store.set(`seat:${seat.seat_id}`, state);
          }
          if (!maskedWallet(await maritime.agents.listEnv(agentId))) throw new ConferenceLaunchError('WALLET_SECRET_NOT_MASKED', { seatId: seat.seat_id });
          state = { ...state, environment: 'reload-intent' }; await store.set(`seat:${seat.seat_id}`, state);
          try { await maritime.agents.reloadEnv(agentId); }
          catch { throw new ConferenceLaunchError('WALLET_ENV_RELOAD_OUTCOME_UNKNOWN', { seatId: seat.seat_id, ambiguous: true }); }
          state = { ...state, environment: 'reloaded' }; await store.set(`seat:${seat.seat_id}`, state);
          if (!maskedWallet(await maritime.agents.listEnv(agentId))) throw new ConferenceLaunchError('WALLET_SECRET_NOT_MASKED', { seatId: seat.seat_id });
          state = { ...state, environment: 'verified' }; await store.set(`seat:${seat.seat_id}`, state);
          state = await ensureSleeping(seat, state, 'post-environment');
          states.set(seat.seat_id, state);
        }

        const bindings = new Map(roster.map(seat => [seat.seat_id, states.get(seat.seat_id)]));
        const boundConfig = publicBoundConfig(config, bindings);
        validateMaritimeRoster(boundConfig.roster);
        const artifacts = new Map();

        // Phase 3: install the same player runtime plus the harness-specific recipe.
        for (const seat of boundConfig.roster) {
          let state = states.get(seat.seat_id);
          let root = state.persistent_root;
          if (state.install !== 'done') {
            state = await ensureActive(seat, state, 'install');
            states.set(seat.seat_id, state);
            await waitUntilReady(seat, seat.agent_id);
            root = await runtimeInstaller.inspectVolumeRoot(seat.agent_id);
          }
          if (typeof root !== 'string') throw new ConferenceLaunchError('RUNTIME_INSTALL_IDENTITY_CHANGED', { seatId: seat.seat_id });
          const artifact = await buildInstallArtifact({ config: boundConfig, seatId: seat.seat_id, persistentRoot: root,
            operationsManifest, recipe: recipeForHarness(seat.harness) });
          artifacts.set(seat.seat_id, artifact);
          if (state.install === 'intent') {
            // A timed-out installer is reconciled only by the exact installed
            // artifact successfully inspecting its assigned wallet/storage.
            // Failure remains blocked and is never treated as permission to
            // upload or execute the installer again.
            try {
              const inspectInstallation = runtimeInstaller.inspectInstallation?.bind(runtimeInstaller) ??
                runtimeInstaller.inspectRuntime.bind(runtimeInstaller);
              const inspected = await inspectInstallation(artifact);
              if (inspected?.wallet_identity_verified !== true || inspected.persistent_storage_verified !== true ||
                  inspected.wallet_address?.toLowerCase() !== seat.wallet_address.toLowerCase()) throw new Error('inspection failed');
              state = { ...state, install: 'done' };
              await store.set(`seat:${seat.seat_id}`, state);
            } catch {
              throw new ConferenceLaunchError('RUNTIME_INSTALL_OUTCOME_UNKNOWN', { seatId: seat.seat_id, ambiguous: true });
            }
          }
          if (state.install === 'done') {
            if (state.artifact_sha256 !== artifact.artifact_sha256 || state.persistent_root !== root) {
              throw new ConferenceLaunchError('RUNTIME_INSTALL_IDENTITY_CHANGED', { seatId: seat.seat_id });
            }
            state = await restartHermesAfterInstall(seat, state, artifact);
            states.set(seat.seat_id, state);
            continue;
          }
          state = { ...state, install: 'intent', artifact_sha256: artifact.artifact_sha256,
            recipe_sha256: artifact.recipe_sha256, persistent_root: root };
          await store.set(`seat:${seat.seat_id}`, state);
          let installed;
          try { installed = await runtimeInstaller.install(artifact); }
          catch { throw new ConferenceLaunchError('RUNTIME_INSTALL_OUTCOME_UNKNOWN', { seatId: seat.seat_id, ambiguous: true }); }
          if (installed?.installed !== true || installed.seat_id !== seat.seat_id || installed.agent_id !== seat.agent_id ||
              installed.artifact_sha256 !== artifact.artifact_sha256) {
            throw new ConferenceLaunchError('RUNTIME_INSTALL_OUTCOME_UNKNOWN', { seatId: seat.seat_id, ambiguous: true });
          }
          state = { ...state, install: 'done' }; await store.set(`seat:${seat.seat_id}`, state);
          state = await restartHermesAfterInstall(seat, state, artifact);
          states.set(seat.seat_id, state);
        }

        // Phase 4: direct exec is authoritative for wallet/storage. Chat can prove
        // tool invocation only by returning the exact direct inspect output. Model
        // and access claims require separately sourced operator evidence.
        const evidenceSeats = [];
        for (const seat of boundConfig.roster) {
          let state = states.get(seat.seat_id);
          const artifact = artifacts.get(seat.seat_id);
          const previousIncomplete = state.runtime_evidence && !(state.runtime_evidence.wallet_identity_verified &&
            state.runtime_evidence.persistent_storage_verified && state.runtime_evidence.tool_execution_verified);
          if (state.verification === 'checked' && !(reverifyIncomplete && previousIncomplete)) {
            evidenceSeats.push(state.runtime_evidence);
            continue;
          }
          state = await ensureActive(seat, state, 'verification');
          state = await configureHermesBeforeVerification(seat, state, artifact);
          state = await configureModelBeforeVerification(seat, state, artifact);
          states.set(seat.seat_id, state);
          state = { ...state, verification: 'attempt' }; await store.set(`seat:${seat.seat_id}`, state);
          let publicResult = unverifiedEvidence(seat, seat.agent_id, artifact);
          try {
            const activated = await inspectWithEnvironment(seat, state, artifact);
            state = activated.state;
            const inspected = activated.inspected;
            let checked;
            try { checked = await runtimeVerifier.verify({ seat, agentId: seat.agent_id, artifact,
              recipe: recipeForHarness(seat.harness), maritime, directInspection: inspected }); }
            catch {
              checked = { seat_id: seat.seat_id, agent_id: seat.agent_id, harness: seat.harness,
                wallet_address: seat.wallet_address.toLowerCase(), tool_execution_verified: false,
                model_profile_verified: false, model_endpoint: null, model: null, model_verification_source: null,
                spectator_access_blocked: false, access_verification_source: null };
            }
            publicResult = publicEvidence(checked, inspected, seat, seat.agent_id, artifact);
          } catch (error) {
            if (oneAwake) throw new ConferenceLaunchError('RUNTIME_VERIFICATION_ROTATION_UNKNOWN', { seatId: seat.seat_id, ambiguous: true });
          }
          state = { ...state, verification: 'checked', runtime_evidence: publicResult };
          await store.set(`seat:${seat.seat_id}`, state);
          state = await ensureSleeping(seat, state, 'post-verification');
          states.set(seat.seat_id, state);
          evidenceSeats.push(publicResult);
        }

        let completion = await store.get('completion');
        if (!completion) {
          const date = now();
          const verifiedAt = date instanceof Date ? date.toISOString() : new Date(date).toISOString();
          completion = { schema_version: 1, verified_at: verifiedAt };
          await store.putIfAbsent('completion', completion);
        }
        const blockers = evidenceBlockers(evidenceSeats);
        const verificationBlockers = blockers.filter(code => !code.endsWith(':RESTART_BUNDLE_RECOVERY_UNPROVEN'));
        const readyForControlledGameplay = evidenceSeats.every(row => row.wallet_identity_verified &&
          row.persistent_storage_verified && row.tool_execution_verified);
        const runtimeEvidence = {
          schema_version: 1, workflow_version: 1, run_id: config.run_id,
          roster_fingerprint: rosterFingerprint(boundConfig), verified_at: completion.verified_at,
          sdk: VERIFIED_MARITIME_SDK,
          recipes: { openclaw: { id: recipeForHarness('openclaw').recipe_id, version: recipeForHarness('openclaw').recipe_version,
            sha256: recipeDigest(recipeForHarness('openclaw')) },
          hermes: { id: recipeForHarness('hermes').recipe_id, version: recipeForHarness('hermes').recipe_version,
            sha256: recipeDigest(recipeForHarness('hermes')) } },
          seats: evidenceSeats, blockers,
          installed: true, runtime_checks_verified: verificationBlockers.length === 0, live_gameplay_proven: false,
          ready_for_controlled_gameplay: readyForControlledGameplay,
          restart_bundle_recovery_proven: evidenceSeats.every(row => row.persistent_bundles_verified)
        };
        const boundPath = join(directory, 'conference.bound.json');
        const evidencePath = join(directory, 'runtime-evidence.json');
        await atomicWrite(boundPath, boundConfig);
        await atomicWrite(evidencePath, runtimeEvidence);
        return Object.freeze({ schema_version: 1,
          status: verificationBlockers.length === 0 ? 'installed-and-runtime-verified' : 'installed-awaiting-runtime-verification',
          ready: verificationBlockers.length === 0, ready_for_controlled_gameplay: readyForControlledGameplay,
          blockers,
          bound_config: boundConfig, runtime_evidence: runtimeEvidence,
          artifacts: { bound_config: boundPath, runtime_evidence: evidencePath },
          live_gameplay_proven: false });
      } finally {
        keys.clear();
        active = false;
        if (release) await release();
      }
    }
  });
}
