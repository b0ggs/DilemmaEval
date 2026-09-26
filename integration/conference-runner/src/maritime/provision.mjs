import { createHash } from 'node:crypto';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveEthereumAddress } from '../../../game-bridge/src/index.js';
import { createDurableStore } from '../runner/store.mjs';
import { acquireRunnerLock } from '../runner/lock.mjs';
import { maritimeRequest } from './transport.mjs';
import { reconcileRoster, validateMaritimeRoster } from './roster.mjs';
import { prepareRuntimeDirectory } from '../config.mjs';

export const PLAYER_WALLET_ENV = 'GAMEPLAY_WALLET_PRIVATE_KEY';
const PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/;
const PRIVATE_KEY_TEXT = /(?:0[xX])?[0-9a-fA-F]{64}/;
const MASK = /(?:[•*]{3,}|\[MASKED\]|<redacted>)/i;
const PRIVILEGED_KEYS = ['PHASE_ADVANCER_PRIVATE_KEY', 'CONFERENCE_OWNER_PRIVATE_KEY', 'DILEMMA_LAUNCHER_PRIVATE_KEY', 'DILEMMA_PHASE_PRIVATE_KEY'];

export class MaritimeProvisionError extends Error {
  constructor(code, { seatId = null, ambiguous = false } = {}) {
    super(code); this.name = 'MaritimeProvisionError'; this.code = code;
    this.seat_id = seatId; this.ambiguous = ambiguous; this.retryable = false;
  }
}

function maskedWallet(environment) {
  if (!Array.isArray(environment)) throw new MaritimeProvisionError('MARITIME_ENV_INVALID');
  if (environment.some(row => PRIVILEGED_KEYS.includes(row?.key))) throw new MaritimeProvisionError('PLAYER_ROLE_COLLISION');
  const matches = environment.filter(row => row?.key === PLAYER_WALLET_ENV);
  return matches.length === 1 && matches[0].isSecret === true && typeof matches[0].value === 'string' &&
    MASK.test(matches[0].value) && !PRIVATE_KEY_TEXT.test(matches[0].value);
}

function publicIdentity(seat) {
  return { seat_id: seat.seat_id, harness: seat.harness, team: seat.team,
    maritime_agent: seat.maritime_agent, wallet_address: seat.wallet_address.toLowerCase() };
}

/** Operator-only provisioning. No call, key access, or mutation occurs at construction. */
export function createConferenceProvisioner({ config, runtimeDir, apiKey, secretProvider,
  fetchImpl = globalThis.fetch, timeoutMs = 120_000, maxAgents = 3 } = {}) {
  if (config?.chain_id !== 84532 || !isAbsolute(runtimeDir ?? '') || typeof config.run_id !== 'string' ||
      typeof secretProvider !== 'function' || !Number.isInteger(maxAgents) || maxAgents < 1 || maxAgents > 20) {
    throw new TypeError('PROVISIONER_CONFIGURATION_INVALID');
  }
  validateMaritimeRoster(config.roster, { requireAgentIds: false });
  const repository = fileURLToPath(new URL('../../../../', import.meta.url));
  const runtimeRelative = relative(repository, resolve(runtimeDir));
  if (!runtimeRelative || (runtimeRelative !== '..' && !runtimeRelative.startsWith(`..${sep}`) && !isAbsolute(runtimeRelative))) throw new TypeError('PROVISION_RUNTIME_MUST_BE_OUTSIDE_REPOSITORY');
  const roster = structuredClone(config.roster);
  const directory = join(runtimeDir, 'maritime-provisioning');
  const store = createDurableStore({ directory });
  const request = args => maritimeRequest({ apiKey, fetchImpl, timeoutMs, ...args });
  const list = () => request({ path: '/api/agents' });
  const identity = { run_id: config.run_id, seats: roster.map(publicIdentity) };
  const digest = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  let active = false;

  async function getPlan() {
    const agents = await list();
    return { agents, plan: reconcileRoster({ roster, agents, maxAgents }) };
  }

  function validatePlan(plan) {
    if (plan.seats.some(row => ['identity-mismatch', 'ambiguous-identity', 'unknown'].includes(row.status))) {
      throw new MaritimeProvisionError('PROVISION_IDENTITY_UNRESOLVED');
    }
    if (!plan.provisioning_within_budget) throw new MaritimeProvisionError('FREE_SLOT_BUDGET_EXCEEDED');
    // A configured ID that disappeared must never be silently replaced.
    if (plan.seats.some(row => row.status === 'missing' && row.agent_id)) throw new MaritimeProvisionError('CONFIGURED_AGENT_MISSING');
  }

  return Object.freeze({
    async plan() {
      const { plan } = await getPlan();
      return { ...plan, creates: plan.seats.filter(row => row.status === 'missing').map(row => ({
        seat_id: row.seat_id, body: { name: row.maritime_agent, templateId: row.harness, externalId: row.maritime_agent }
      })), live_gameplay_proven: false };
    },
    async provision() {
      if (active) throw new MaritimeProvisionError('PROVISIONER_BUSY');
      active = true;
      const keys = new Map(); let release;
      try {
        await prepareRuntimeDirectory(runtimeDir);
        release = await acquireRunnerLock(directory);
        const savedIdentity = await store.get('identity');
        if (savedIdentity && savedIdentity.digest !== digest) throw new MaritimeProvisionError('PROVISION_IDENTITY_CHANGED');
        let { agents, plan } = await getPlan();
        validatePlan(plan);
        if (!savedIdentity) await store.putIfAbsent('identity', { digest, ...identity });

        // Validate every assigned signer locally BEFORE creating or injecting anything.
        for (const seat of roster) {
          let key;
          try { key = await secretProvider(seat.seat_id); }
          catch { throw new MaritimeProvisionError('PLAYER_SECRET_UNAVAILABLE', { seatId: seat.seat_id }); }
          let wallet;
          try { wallet = typeof key === 'string' && PRIVATE_KEY.test(key) ? deriveEthereumAddress(key).toLowerCase() : null; }
          catch { wallet = null; }
          if (wallet !== seat.wallet_address.toLowerCase()) {
            throw new MaritimeProvisionError('PLAYER_WALLET_MISMATCH', { seatId: seat.seat_id });
          }
          keys.set(seat.seat_id, key);
        }

        const bindings = [];
        for (const seat of roster) {
          const stateKey = `seat:${seat.seat_id}`;
          let state = await store.get(stateKey) ?? { ...publicIdentity(seat), agent_id: null, creation: 'unstarted', environment: 'unstarted' };
          // Fresh complete account inventory before every potential create, not a filtered seat list.
          agents = await list();
          plan = reconcileRoster({ roster, agents, maxAgents }); validatePlan(plan);
          let observed = plan.seats.find(row => row.seat_id === seat.seat_id);
          if (observed.status !== 'missing') {
            if (state.agent_id && state.agent_id !== observed.agent_id) throw new MaritimeProvisionError('PROVISION_BOUND_AGENT_CHANGED', { seatId: seat.seat_id });
            state = { ...state, agent_id: observed.agent_id, creation: 'confirmed' };
            await store.set(stateKey, state);
          } else {
            if (state.creation !== 'unstarted') throw new MaritimeProvisionError('AGENT_CREATE_OUTCOME_UNKNOWN', { seatId: seat.seat_id, ambiguous: true });
            if (agents.length >= maxAgents) throw new MaritimeProvisionError('FREE_SLOT_BUDGET_EXCEEDED');
            state = { ...state, creation: 'intent' };
            await store.set(stateKey, state);
            try {
              const created = await request({ path: '/api/agents', method: 'POST', body: {
                name: seat.maritime_agent, templateId: seat.harness, externalId: seat.maritime_agent
              } });
              // Match against the public plan; never trust an ID returned for another identity.
              const reconciled = reconcileRoster({ roster, agents: [...agents, created], maxAgents });
              observed = reconciled.seats.find(row => row.seat_id === seat.seat_id);
              if (observed.status === 'missing' || observed.status === 'identity-mismatch' || observed.status === 'ambiguous-identity' || !observed.agent_id) {
                throw new MaritimeProvisionError('AGENT_CREATE_IDENTITY_UNVERIFIED');
              }
              state = { ...state, agent_id: observed.agent_id, creation: 'confirmed' };
              await store.set(stateKey, state);
            } catch {
              // Intent stays durable. Next invocation ONLY reconciles list by stable identity.
              throw new MaritimeProvisionError('AGENT_CREATE_OUTCOME_UNKNOWN', { seatId: seat.seat_id, ambiguous: true });
            }
          }

          const prefix = `/api/agents/${encodeURIComponent(state.agent_id)}`;
          const environment = await request({ path: `${prefix}/env` });
          const alreadyMasked = maskedWallet(environment);
          if (state.environment === 'intent' || state.environment === 'reload-intent') {
            // A mask cannot prove which wallet an uncertain update installed.
            throw new MaritimeProvisionError('WALLET_ENV_OUTCOME_UNKNOWN', { seatId: seat.seat_id, ambiguous: true });
          }
          if (state.environment === 'verified') {
            if (!alreadyMasked) throw new MaritimeProvisionError('WALLET_SECRET_NOT_MASKED', { seatId: seat.seat_id });
          } else {
            if (state.environment === 'unstarted') {
              state = { ...state, environment: 'intent' }; await store.set(stateKey, state);
              try {
                // Official SDK's setEnv({secret:true}) encodes the flag as isSecret.
                await request({ path: `${prefix}/env`, method: 'POST', body: {
                  key: PLAYER_WALLET_ENV, value: keys.get(seat.seat_id), isSecret: true
                } });
              } catch { throw new MaritimeProvisionError('WALLET_ENV_OUTCOME_UNKNOWN', { seatId: seat.seat_id, ambiguous: true }); }
              finally { keys.delete(seat.seat_id); }
              state = { ...state, environment: 'set' }; await store.set(stateKey, state);
            }
            if (!maskedWallet(await request({ path: `${prefix}/env` }))) throw new MaritimeProvisionError('WALLET_SECRET_NOT_MASKED', { seatId: seat.seat_id });
            state = { ...state, environment: 'reload-intent' }; await store.set(stateKey, state);
            try { await request({ path: `${prefix}/reload-env`, method: 'POST' }); }
            catch { throw new MaritimeProvisionError('WALLET_ENV_RELOAD_UNKNOWN', { seatId: seat.seat_id, ambiguous: true }); }
            if (!maskedWallet(await request({ path: `${prefix}/env` }))) throw new MaritimeProvisionError('WALLET_SECRET_NOT_MASKED', { seatId: seat.seat_id });
            state = { ...state, environment: 'verified' }; await store.set(stateKey, state);
          }
          keys.delete(seat.seat_id);
          bindings.push({ ...publicIdentity(seat), agent_id: state.agent_id,
            wallet_environment_masked: true, wallet_environment_reloaded: true, runtime_wallet_verified: false });
        }
        const finalPlan = reconcileRoster({ roster: roster.map(row => ({ ...row, agent_id: bindings.find(binding => binding.seat_id === row.seat_id).agent_id })),
          agents: await list(), maxAgents });
        return { schema_version: 1, status: finalPlan.ready ? 'configured' : 'agents-not-ready',
          ready: finalPlan.ready, seats: bindings, account_agent_count: finalPlan.account_agent_count,
          budget_agent_count: maxAgents, blockers: finalPlan.blockers, live_gameplay_proven: false };
      } finally {
        keys.clear(); active = false;
        if (release) await release();
      }
    }
  });
}
