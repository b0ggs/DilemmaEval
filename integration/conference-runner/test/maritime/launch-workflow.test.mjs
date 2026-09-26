import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deriveEthereumAddress } from '../../../game-bridge/src/index.js';
import { createConferenceLaunchWorkflow, HERMES_RECIPE, OPENCLAW_RECIPE } from '../../src/maritime/index.mjs';
import { config as fixtureConfig, roster as fixtureRoster } from './fixtures.mjs';

function keysAndConfig(counts = { openclaw: 2, hermes: 1 }) {
  const rows = [];
  const keys = new Map();
  let index = 1;
  for (const [team, prefix] of [['openclaw', 'oc'], ['hermes', 'hs']]) {
    for (let n = 1; n <= counts[team]; n++, index++) {
      const key = `0x${index.toString(16).padStart(64, '0')}`;
      const seatId = `${prefix}-${n}`;
      keys.set(seatId, key);
      rows.push({ seat_id: seatId, team, harness: team,
        agent_id: counts.openclaw + counts.hermes === 3 ? `stale-${seatId}` : null,
        maritime_agent: `conference-${seatId}`, wallet_address: deriveEthereumAddress(key), cause_id: team === 'openclaw' ? 1 : 2 });
    }
  }
  return { keys, config: { ...fixtureConfig, run_id: `launch-${rows.length}`, roster: rows } };
}

async function fixture(t, options = {}) {
  const runtimeDir = await realpath(await mkdtemp(join(tmpdir(), 'conference-sdk-launch-')));
  t.after(() => rm(runtimeDir, { recursive: true, force: true }));
  const { keys, config } = keysAndConfig();
  const agents = [];
  const environments = new Map();
  const environmentLive = new Map();
  const installed = new Map();
  const hermesConfigured = new Set();
  const modelsConfigured = new Set();
  const environmentReloads = new Map();
  const calls = [];
  let completedInstallFailures = 0;
  let completedConfigurationFailures = 0;
  let invalidatedConfigurations = 0;
  let configurationCalls = 0;
  const maritime = { agents: {
    async list() { calls.push({ method: 'list' }); return structuredClone(agents); },
    async provision(input) {
      calls.push({ method: 'provision', input: { ...input } });
      if (options.provisionFailure) throw new Error('provider secret');
      if (options.enforceOneAwake && agents.some(agent => agent.status === 'active')) throw new Error('one awake capacity exceeded');
      const agent = { id: `fresh-${input.externalId}`, externalId: input.externalId, name: input.name,
        framework: input.template, status: 'active' };
      agents.push(agent); return structuredClone(agent);
    },
    async get(id) { calls.push({ method: 'get', id }); return structuredClone(agents.find(agent => agent.id === id)); },
    async setEnv(id, key, value, opts) {
      calls.push({ method: 'setEnv', id, key, secret: opts.secret });
      const current = (environments.get(id) ?? []).filter(row => row.key !== key);
      if (key === 'GAMEPLAY_WALLET_PRIVATE_KEY') {
        assert.equal(opts.secret, true);
        assert.equal(deriveEthereumAddress(value).toLowerCase(), config.roster.find(row => `fresh-${row.maritime_agent}` === id).wallet_address.toLowerCase());
        current.push({ key, value: '********', isSecret: true });
      } else {
        assert.equal(opts.secret, false);
        assert.equal({ HERMES_INFERENCE_MODEL: 'gpt-5.4-mini', HERMES_MAX_TOKENS: '2048' }[key], value);
        current.push({ key, value, isSecret: false });
      }
      environments.set(id, current);
      return structuredClone(current.at(-1));
    },
    async listEnv(id) { calls.push({ method: 'listEnv', id }); return structuredClone(environments.get(id) ?? []); },
    async reloadEnv(id) {
      calls.push({ method: 'reloadEnv', id }); const agent = agents.find(candidate => candidate.id === id);
      const reloadCount = (environmentReloads.get(id) ?? 0) + 1;
      environmentReloads.set(id, reloadCount);
      if (options.postRestartReloadFailure && agent.framework === 'hermes' && reloadCount === 3) {
        throw new Error('reload response lost');
      }
      environmentLive.set(id, true);
      if (agent.framework === 'hermes') hermesConfigured.delete(id);
      agent.status = 'active'; return structuredClone(agent);
    },
    async restart(id) {
      calls.push({ method: 'restart', id });
      if (options.restartFailure) throw new Error('restart response lost');
      const agent = agents.find(candidate => candidate.id === id);
      if (agent.framework === 'hermes') {
        hermesConfigured.delete(id);
        environmentLive.set(id, false);
      }
      agent.status = 'active'; return structuredClone(agent);
    },
    async sleep(id) {
      calls.push({ method: 'sleep', id }); const agent = agents.find(candidate => candidate.id === id);
      if (options.environmentMissingAfterSleep) environmentLive.set(id, false);
      if (agent.framework === 'hermes') hermesConfigured.delete(id);
      agent.status = 'sleeping'; return structuredClone(agent);
    },
    async chat(id) {
      calls.push({ method: 'chat', id });
      const agent = agents.find(agent => agent.id === id);
      agent.status = 'active';
      if (agent.framework === 'hermes') {
        assert.equal(hermesConfigured.has(id), true);
        assert.equal(environmentLive.get(id), true);
      }
      const artifact = installed.get(id);
      const seat = config.roster.find(row => `fresh-${row.maritime_agent}` === id);
      return { response: JSON.stringify({ schema_version: 1, type: 'conference-tool-verification', inspect: {
        schema_version: 1, seat_id: seat.seat_id, wallet_address: seat.wallet_address.toLowerCase(), chain_id: 84532,
        persistent_storage_writable: true, gameplay_execution_proven: false
      } }) };
    }
  } };
  const installer = {
    async inspectVolumeRoot(id) { calls.push({ method: 'inspectVolumeRoot', id }); return `/volume/${id}`; },
    async install(artifact) {
      calls.push({ method: 'install', id: artifact.agent_id });
      if (options.installFailureAfterCompletion && completedInstallFailures++ === 0) {
        installed.set(artifact.agent_id, artifact);
        throw new Error('response lost after completion');
      }
      if (options.installFailure) throw new Error('upload outcome unknown');
      agents.find(agent => agent.id === artifact.agent_id).status = 'active';
      installed.set(artifact.agent_id, artifact);
      return { schema_version: 1, seat_id: artifact.seat_id, agent_id: artifact.agent_id,
        artifact_sha256: artifact.artifact_sha256, installed: true };
    },
    async configureHarnessConfiguration(artifact) {
      calls.push({ method: 'configureHarnessConfiguration', id: artifact.agent_id });
      configurationCalls++;
      if (options.configurationFailure && configurationCalls === 1) throw new Error('config update unavailable');
      hermesConfigured.add(artifact.agent_id);
      agents.find(agent => agent.id === artifact.agent_id).status = 'active';
      if (options.configurationFailureAfterCompletion && completedConfigurationFailures++ === 0) {
        throw new Error('config update response lost');
      }
      if (options.repairFailureAfterCompletion && configurationCalls === 2) throw new Error('repair response lost');
      return { schema_version: 1, seat_id: artifact.seat_id, agent_id: artifact.agent_id,
        hermes_terminal_env_passthrough_configured: true, hermes_config_owner_configured: true,
        hermes_private_state_owner_configured: true,
        runtime_identity: { uid: 10_000, gid: 10_000 } };
    },
    async inspectHarnessConfiguration(artifact) {
      calls.push({ method: 'inspectHarnessConfiguration', id: artifact.agent_id });
      agents.find(agent => agent.id === artifact.agent_id).status = 'active';
      if (!hermesConfigured.has(artifact.agent_id)) {
        const error = new Error(options.configurationInspectionFailure ? 'inspection transport unavailable' : 'Hermes config missing');
        error.code = options.configurationInspectionFailure ? 'MARITIME_TIMEOUT' : 'HERMES_CONFIG_INSPECTION_INVALID';
        throw error;
      }
      return { schema_version: 1, seat_id: artifact.seat_id, agent_id: artifact.agent_id,
        hermes_terminal_env_passthrough_configured: true, hermes_config_owner_configured: true,
        hermes_private_state_owner_configured: true,
        runtime_identity: { uid: 10_000, gid: 10_000 } };
    },
    async configureModel(artifact) {
      calls.push({ method: 'configureModel', id: artifact.agent_id });
      modelsConfigured.add(artifact.agent_id);
      agents.find(agent => agent.id === artifact.agent_id).status = 'active';
      return { schema_version: 1, seat_id: artifact.seat_id, harness: artifact.harness, configured: true,
        model: 'gpt-5.4-mini', reasoning_effort: 'low', max_output_tokens: 2048,
        automatic_fallback: false, fallback_model: null, response_metadata_required: true };
    },
    async inspectModel(artifact) {
      calls.push({ method: 'inspectModel', id: artifact.agent_id });
      if (!modelsConfigured.has(artifact.agent_id)) throw new Error('model config missing');
      return { schema_version: 1, seat_id: artifact.seat_id, harness: artifact.harness, configured: true,
        model: 'gpt-5.4-mini', reasoning_effort: 'low', max_output_tokens: 2048,
        automatic_fallback: false, fallback_model: null, response_metadata_required: true };
    },
    async inspectRuntime(artifact) {
      calls.push({ method: 'inspectRuntime', id: artifact.agent_id });
      if (options.environmentMissingAfterSleep && !environmentLive.get(artifact.agent_id)) throw new Error('environment absent after wake');
      agents.find(agent => agent.id === artifact.agent_id).status = 'active';
      assert.equal(installed.get(artifact.agent_id)?.artifact_sha256, artifact.artifact_sha256);
      const seat = config.roster.find(row => row.seat_id === artifact.seat_id);
      if (seat.harness === 'hermes' && options.invalidateConfigurationBeforeVerification && invalidatedConfigurations++ === 0) {
        hermesConfigured.delete(artifact.agent_id);
        throw new Error('config rematerialized before verification');
      }
      if (seat.harness === 'hermes') assert.equal(hermesConfigured.has(artifact.agent_id), true);
      return { schema_version: 1, seat_id: seat.seat_id, agent_id: artifact.agent_id,
        wallet_address: seat.wallet_address.toLowerCase(), wallet_identity_verified: true,
        persistent_storage_verified: true, direct_runtime_inspection_verified: true,
        hermes_terminal_env_passthrough_configured: seat.harness === 'hermes',
        hermes_private_state_owner_configured: seat.harness === 'hermes',
        inspect_output: { schema_version: 1, seat_id: seat.seat_id, wallet_address: seat.wallet_address.toLowerCase(),
          chain_id: 84532, persistent_storage_writable: true, gameplay_execution_proven: false } };
    }
  };
  const make = (overrides = {}) => createConferenceLaunchWorkflow({ config, runtimeDir, maritime, installer,
    apiKey: 'fixture-maritime-api-key', secretProvider: seatId => keys.get(seatId),
    now: () => new Date('2026-09-24T20:00:00Z'), sleep: async () => {}, ...overrides });
  return { runtimeDir, config, keys, calls, agents, make };
}

test('empty inventory launches three SDK agents, replaces stale bindings, and writes sanitized artifacts', async t => {
  const f = await fixture(t);
  const plan = await f.make().plan();
  assert.equal(plan.creates.length, 3); assert.equal(plan.reuse.length, 0); assert.equal(plan.stale_binding_migration, true);
  assert.ok(f.calls.every(call => call.method === 'list'));
  const result = await f.make().launch();
  assert.equal(result.status, 'installed-awaiting-runtime-verification');
  assert.equal(result.ready_for_controlled_gameplay, true);
  assert.ok(result.blockers.some(code => code.endsWith(':MODEL_PROFILE_UNVERIFIED')));
  assert.ok(result.blockers.some(code => code.endsWith(':SPECTATOR_ACCESS_POLICY_UNVERIFIED')));
  assert.ok(result.runtime_evidence.seats.every(row => row.tool_execution_verified && !row.persistent_bundles_verified));
  assert.ok(result.runtime_evidence.seats.every(row => row.gameplay_command[0] === 'node'));
  assert.deepEqual(result.bound_config.roster.map(row => row.agent_id), f.agents.map(row => row.id));
  const restarts = f.calls.filter(call => call.method === 'restart');
  assert.deepEqual(restarts.map(call => call.id), ['fresh-conference-hs-1']);
  const restartIndex = f.calls.indexOf(restarts[0]);
  assert.ok(f.calls.slice(0, restartIndex).some(call => call.method === 'install' && call.id === restarts[0].id));
  const postRestartReloadIndex = f.calls.findIndex((call, index) => index > restartIndex && call.method === 'reloadEnv' && call.id === restarts[0].id);
  const configureIndex = f.calls.findIndex(call => call.method === 'configureHarnessConfiguration' && call.id === restarts[0].id);
  const chatIndex = f.calls.findIndex((call, index) => index > configureIndex && call.method === 'chat' && call.id === restarts[0].id);
  assert.ok(restartIndex < postRestartReloadIndex && postRestartReloadIndex < configureIndex && configureIndex < chatIndex);
  assert.equal(f.calls.slice(0, restartIndex).some(call => call.method === 'inspectHarnessConfiguration' && call.id === restarts[0].id), false);
  const persisted = `${await readFile(result.artifacts.bound_config, 'utf8')}\n${await readFile(result.artifacts.runtime_evidence, 'utf8')}\n${await readFile(join(f.runtimeDir, 'maritime-launch/records.json'), 'utf8')}`;
  assert.equal(persisted.includes('fixture-maritime-api-key'), false);
  for (const key of f.keys.values()) assert.equal(persisted.includes(key), false);
});

test('completed launch rerun is externally idempotent', async t => {
  const f = await fixture(t); const first = await f.make().launch();
  const writes = () => f.calls.filter(call =>
    ['provision', 'setEnv', 'reloadEnv', 'install', 'restart', 'configureHarnessConfiguration', 'chat'].includes(call.method)).length;
  const before = writes();
  const second = await f.make().launch();
  assert.equal(writes(), before);
  assert.deepEqual(second.bound_config, first.bound_config);
  assert.deepEqual(second.runtime_evidence, first.runtime_evidence);
});

test('oneAwake uses short idle TTL and releases every completed remote stage', async t => {
  const f = await fixture(t, { enforceOneAwake: true });
  const workflow = f.make({ oneAwake: true });
  const plan = await workflow.plan();
  assert.equal(plan.one_awake, true);
  assert.ok(plan.creates.every(row => row.provision.idleTtlSeconds === 60));
  const result = await workflow.launch();
  assert.equal(result.ready_for_controlled_gameplay, true);
  const provisions = f.calls.filter(call => call.method === 'provision');
  assert.equal(provisions.length, 3);
  assert.ok(provisions.every(call => call.input.idleTtlSeconds === 60));
  assert.ok(f.agents.every(agent => agent.status === 'sleeping'));
  assert.equal(f.calls.filter(call => call.method === 'restart').length, 1);
  assert.ok(f.calls.filter(call => call.method === 'sleep').length >= 12);
  const hermesId = 'fresh-conference-hs-1';
  const installIndex = f.calls.findIndex(call => call.method === 'install' && call.id === hermesId);
  const ordered = f.calls.slice(installIndex).filter(call => call.id === hermesId &&
    ['install', 'restart', 'configureHarnessConfiguration', 'reloadEnv', 'chat'].includes(call.method));
  assert.deepEqual(ordered.map(call => call.method),
    ['install', 'restart', 'reloadEnv', 'reloadEnv', 'configureHarnessConfiguration', 'chat']);
  const chatIndex = f.calls.indexOf(ordered.at(-1));
  assert.ok(f.calls.slice(chatIndex + 1).some(call => call.method === 'sleep' && call.id === hermesId));
  for (let index = 1; index < provisions.length; index++) {
    const position = f.calls.indexOf(provisions[index]);
    assert.ok(f.calls.slice(0, position).some(call => call.method === 'sleep'));
  }
});

test('oneAwake re-sleeps a seat that was observed awake after a confirmed sleep', async t => {
  const f = await fixture(t, { enforceOneAwake: true });
  await f.make({ oneAwake: true }).launch();
  const before = f.calls.filter(call => call.method === 'sleep').length;
  f.agents[0].status = 'active';
  const resumed = await f.make({ oneAwake: true }).launch();
  assert.equal(resumed.ready_for_controlled_gameplay, true);
  assert.equal(f.agents[0].status, 'sleeping');
  assert.ok(f.calls.filter(call => call.method === 'sleep').length > before);
});

test('oneAwake reloads the stored wallet environment before verification after snapshot wake', async t => {
  const f = await fixture(t, { enforceOneAwake: true, environmentMissingAfterSleep: true });
  const result = await f.make({ oneAwake: true }).launch();
  assert.equal(result.ready_for_controlled_gameplay, true);
  assert.equal(f.calls.filter(call => call.method === 'reloadEnv').length, 11);
  assert.ok(f.agents.every(agent => agent.status === 'sleeping'));
});

test('ambiguous provision and install mutations remain blocked without replay', async t => {
  const provision = await fixture(t, { provisionFailure: true });
  await assert.rejects(provision.make().launch(), error => error.code === 'AGENT_PROVISION_OUTCOME_UNKNOWN' && error.ambiguous);
  await assert.rejects(provision.make().launch(), error => error.code === 'AGENT_PROVISION_OUTCOME_UNKNOWN' && error.ambiguous);
  assert.equal(provision.calls.filter(call => call.method === 'provision').length, 1);

  const install = await fixture(t, { installFailure: true });
  await assert.rejects(install.make().launch(), error => error.code === 'RUNTIME_INSTALL_OUTCOME_UNKNOWN' && error.ambiguous);
  await assert.rejects(install.make().launch(), error => error.code === 'RUNTIME_INSTALL_OUTCOME_UNKNOWN' && error.ambiguous);
  assert.equal(install.calls.filter(call => call.method === 'install').length, 1);
});

test('ambiguous Hermes restart is journaled and never blindly replayed', async t => {
  const f = await fixture(t, { restartFailure: true });
  await assert.rejects(f.make().launch(), error => error.code === 'HERMES_RESTART_OUTCOME_UNKNOWN' && error.ambiguous);
  await assert.rejects(f.make().launch(), error => error.code === 'HERMES_RESTART_OUTCOME_UNKNOWN' && error.ambiguous);
  assert.equal(f.calls.filter(call => call.method === 'restart').length, 1);
});

test('ambiguous post-restart Hermes configuration resumes only after direct inspection proves it completed', async t => {
  const f = await fixture(t, { configurationFailureAfterCompletion: true });
  const make = () => f.make();
  await assert.rejects(make().launch(), error =>
    error.code === 'HERMES_POST_RESTART_CONFIGURATION_OUTCOME_UNKNOWN' && error.ambiguous);
  const recovered = await make().launch();
  assert.equal(recovered.ready_for_controlled_gameplay, true);
  assert.equal(f.calls.filter(call => call.method === 'restart').length, 1);
  assert.equal(f.calls.filter(call => call.method === 'configureHarnessConfiguration').length, 1);
  assert.equal(f.calls.filter(call => call.method === 'chat' && call.id === 'fresh-conference-hs-1').length, 1);
});

test('definitively absent post-restart Hermes config authorizes exactly one journaled repair', async t => {
  const f = await fixture(t, { configurationFailure: true });
  await assert.rejects(f.make().launch(), error =>
    error.code === 'HERMES_POST_RESTART_CONFIGURATION_OUTCOME_UNKNOWN' && error.ambiguous);
  const recovered = await f.make().launch();
  assert.equal(recovered.ready_for_controlled_gameplay, true);
  await f.make().launch();
  assert.equal(f.calls.filter(call => call.method === 'restart').length, 1);
  assert.equal(f.calls.filter(call => call.method === 'configureHarnessConfiguration').length, 2);
  assert.equal(f.calls.filter(call => call.method === 'chat' && call.id === 'fresh-conference-hs-1').length, 1);
});

test('uncertain post-restart Hermes config inspection remains blocked without repair', async t => {
  const f = await fixture(t, { configurationFailure: true, configurationInspectionFailure: true });
  await assert.rejects(f.make().launch(), error =>
    error.code === 'HERMES_POST_RESTART_CONFIGURATION_OUTCOME_UNKNOWN' && error.ambiguous);
  await assert.rejects(f.make().launch(), error =>
    error.code === 'HERMES_POST_RESTART_CONFIGURATION_OUTCOME_UNKNOWN' && error.ambiguous);
  await assert.rejects(f.make().launch(), error =>
    error.code === 'HERMES_POST_RESTART_CONFIGURATION_OUTCOME_UNKNOWN' && error.ambiguous);
  assert.equal(f.calls.filter(call => call.method === 'restart').length, 1);
  assert.equal(f.calls.filter(call => call.method === 'configureHarnessConfiguration').length, 1);
  assert.equal(f.calls.filter(call => call.method === 'chat' && call.id === 'fresh-conference-hs-1').length, 0);
});

test('ambiguous post-restart environment reload remains blocked without reload or configure replay', async t => {
  const f = await fixture(t, { postRestartReloadFailure: true });
  await assert.rejects(f.make().launch(), error =>
    error.code === 'HERMES_POST_RESTART_ENV_RELOAD_OUTCOME_UNKNOWN' && error.ambiguous);
  await assert.rejects(f.make().launch(), error =>
    error.code === 'HERMES_POST_RESTART_ENV_RELOAD_OUTCOME_UNKNOWN' && error.ambiguous);
  assert.equal(f.calls.filter(call => call.method === 'reloadEnv' && call.id === 'fresh-conference-hs-1').length, 3);
  assert.equal(f.calls.filter(call => call.method === 'configureHarnessConfiguration').length, 0);
  assert.equal(f.calls.filter(call => call.method === 'chat' && call.id === 'fresh-conference-hs-1').length, 0);
});

test('observed invalid Hermes config is refreshed in the same confirmed activation generation', async t => {
  const f = await fixture(t, { enforceOneAwake: true, invalidateConfigurationBeforeVerification: true });
  const make = () => f.make({ oneAwake: true });
  const recovered = await make().launch();
  assert.equal(recovered.ready_for_controlled_gameplay, true);
  assert.equal(f.calls.filter(call => call.method === 'restart').length, 1);
  assert.equal(f.calls.filter(call => call.method === 'configureHarnessConfiguration').length, 2);
  assert.equal(f.calls.filter(call => call.method === 'chat' && call.id === 'fresh-conference-hs-1').length, 1);
});

test('ambiguous completed Hermes repair resumes only when inspection proves the allowlist', async t => {
  const f = await fixture(t, { invalidateConfigurationBeforeVerification: true, repairFailureAfterCompletion: true });
  const first = await f.make().launch();
  assert.equal(first.ready_for_controlled_gameplay, false);
  await assert.rejects(f.make({ reverifyIncomplete: true }).launch(), error =>
    error.code === 'HERMES_POST_RESTART_CONFIGURATION_REPAIR_OUTCOME_UNKNOWN' && error.ambiguous);
  const recovered = await f.make({ reverifyIncomplete: true }).launch();
  assert.equal(recovered.ready_for_controlled_gameplay, true);
  assert.equal(f.calls.filter(call => call.method === 'restart').length, 1);
  assert.equal(f.calls.filter(call => call.method === 'configureHarnessConfiguration').length, 2);
  assert.equal(f.calls.filter(call => call.method === 'chat' && call.id === 'fresh-conference-hs-1').length, 1);
});

test('ambiguous lifecycle refresh is inspected and never blindly replayed', async t => {
  const f = await fixture(t, { enforceOneAwake: true, invalidateConfigurationBeforeVerification: true,
    repairFailureAfterCompletion: true });
  const make = () => f.make({ oneAwake: true });
  await assert.rejects(make().launch(), error => error.code === 'RUNTIME_VERIFICATION_ROTATION_UNKNOWN');
  const recovered = await make().launch();
  assert.equal(recovered.ready_for_controlled_gameplay, true);
  await make().launch();
  assert.equal(f.calls.filter(call => call.method === 'restart').length, 1);
  assert.equal(f.calls.filter(call => call.method === 'configureHarnessConfiguration').length, 2);
  assert.equal(f.calls.filter(call => call.method === 'chat' && call.id === 'fresh-conference-hs-1').length, 1);
});

test('an uncertain install reconciles only after the exact artifact passes direct inspection', async t => {
  const f = await fixture(t, { installFailureAfterCompletion: true });
  await assert.rejects(f.make().launch(), error => error.code === 'RUNTIME_INSTALL_OUTCOME_UNKNOWN' && error.ambiguous);
  const recovered = await f.make().launch();
  assert.equal(recovered.ready_for_controlled_gameplay, true);
  assert.equal(f.calls.filter(call => call.method === 'install').length, 3);
  assert.ok(f.calls.some(call => call.method === 'inspectRuntime'));
});

test('recipes are versioned, distinct, immutable, and contain no seat or secret values', () => {
  assert.notDeepEqual(OPENCLAW_RECIPE, HERMES_RECIPE);
  for (const recipe of [OPENCLAW_RECIPE, HERMES_RECIPE]) {
    const text = JSON.stringify(recipe);
    assert.equal(recipe.recipe_version, '2026-09-25.9');
    assert.equal(Object.isFrozen(recipe), true);
    assert.equal(/GAMEPLAY_WALLET_PRIVATE_KEY|mk_[A-Za-z0-9]+|0x[0-9a-fA-F]{64}|agent_id|oc-1|hs-1/.test(text), false);
  }
});

test('ten plus ten roster plans without silently raising the default three-agent limit', async t => {
  const runtimeDir = await realpath(await mkdtemp(join(tmpdir(), 'conference-sdk-plan-')));
  t.after(() => rm(runtimeDir, { recursive: true, force: true }));
  const { config, keys } = keysAndConfig({ openclaw: 10, hermes: 10 });
  let secretReads = 0;
  const maritime = { agents: {
    async list() { return []; }, async provision() {}, async get() {}, async listEnv() {}, async setEnv() {},
    async reloadEnv() {}, async restart() {}, async chat() {}
  } };
  const workflow = createConferenceLaunchWorkflow({ config, runtimeDir, maritime, apiKey: 'fixture',
    secretProvider: seatId => { secretReads++; return keys.get(seatId); },
    installer: { inspectVolumeRoot() {}, install() {}, inspectHarnessConfiguration() {}, configureHarnessConfiguration() {},
      inspectModel() {}, configureModel() {} } });
  const plan = await workflow.plan();
  assert.equal(plan.requested_agent_count, 20); assert.equal(plan.creates.length, 20);
  assert.equal(plan.explicit_max_agents, 3); assert.equal(plan.within_explicit_limit, false);
  assert.ok(plan.blockers.includes('EXPLICIT_AGENT_LIMIT_EXCEEDED')); assert.equal(secretReads, 0);
  await assert.rejects(workflow.launch(), error => error.code === 'EXPLICIT_AGENT_LIMIT_EXCEEDED');
  assert.equal(secretReads, 0);
});
