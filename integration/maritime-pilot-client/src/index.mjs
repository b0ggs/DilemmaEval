import { createHash } from "node:crypto";

import {
  buildTwoSeatPilotPlan
} from "../../pilot-preflight/src/index.mjs";
import {
  deriveEthereumAddress
} from "../../game-bridge/src/index.js";

export const LIVE_PILOT_AUTHORIZATION =
  "AUTHORIZE_DILEMMAEVAL_TWO_SEAT_MARITIME_PILOT";
export const WALLET_ENVIRONMENT_KEY = "GAMEPLAY_WALLET_PRIVATE_KEY";
export const VERIFIED_SDK_POLICY = Object.freeze({
  package: "maritime-sdk",
  version: "0.6.0",
  maxRetries: 0
});

const PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/;
const UUID =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
const MASK_MARKER = /(?:[•*]{3,}|\[MASKED\]|<redacted>)/i;
const RAW_32_BYTE_TEXT = /(?:0[xX])?[0-9a-fA-F]{64}/;
const SEAT_RUNTIME = Object.freeze({
  "oc-1": Object.freeze({
    template: "openclaw",
    externalId: "dilemmaeval-pilot-openclaw"
  }),
  "hs-1": Object.freeze({
    template: "hermes",
    externalId: "dilemmaeval-pilot-hermes"
  })
});

export class PilotExecutionError extends Error {
  constructor(code, message, publicState) {
    super(`${code}: ${message}`);
    this.name = "PilotExecutionError";
    this.code = code;
    this.publicState = deepFreeze(structuredClone(publicState));
  }
}

export function createMaritimePilotExecutor({
  maritime,
  secretProvider,
  sdkPolicy
} = {}) {
  assertMaritimeClient(maritime);
  assertSdkPolicy(sdkPolicy);
  if (typeof secretProvider !== "function") {
    throw new TypeError("secretProvider must be a function");
  }

  return Object.freeze({
    async execute({ manifest, authorization } = {}) {
      const plan = buildTwoSeatPilotPlan(manifest);
      if (authorization !== LIVE_PILOT_AUTHORIZATION) {
        throw new PilotExecutionError(
          "LIVE_AUTHORIZATION_REQUIRED",
          "the exact two-seat live authorization is required",
          emptyState(plan)
        );
      }

      const secretBySeat = await loadDistinctSecrets(
        plan.seats,
        secretProvider,
        plan
      );
      const state = emptyState(plan);
      const agentBySeat = new Map();

      for (const seat of plan.seats) {
        const runtime = SEAT_RUNTIME[seat.seat_id];
        let agent;
        try {
          agent = await maritime.agents.provision({
            externalId: runtime.externalId,
            name: runtime.externalId,
            template: runtime.template
          });
        } catch {
          throw externalFailure(
            "MARITIME_PROVISION_FAILED",
            `provision:${seat.seat_id}`,
            state,
            true
          );
        }
        const publicAgent = normalizeAgent(agent, seat, runtime);
        agentBySeat.set(seat.seat_id, publicAgent);
        state.agents.push(publicAgent);
        state.completed_steps.push(`provision:${seat.seat_id}`);
      }

      for (const seat of plan.seats) {
        const agent = agentBySeat.get(seat.seat_id);
        const privateKey = secretBySeat.get(seat.seat_id);
        try {
          await maritime.agents.setEnv(
            agent.agent_id,
            WALLET_ENVIRONMENT_KEY,
            privateKey,
            { secret: true }
          );
        } catch {
          throw externalFailure(
            "MARITIME_SECRET_WRITE_UNKNOWN",
            `set-secret:${seat.seat_id}`,
            state,
            true
          );
        } finally {
          secretBySeat.delete(seat.seat_id);
        }
        state.completed_steps.push(`set-secret:${seat.seat_id}`);

        try {
          await maritime.agents.reloadEnv(agent.agent_id);
        } catch {
          throw externalFailure(
            "MARITIME_ENV_RELOAD_UNKNOWN",
            `reload-env:${seat.seat_id}`,
            state,
            true
          );
        }
        state.completed_steps.push(`reload-env:${seat.seat_id}`);

        let environment;
        try {
          environment = await maritime.agents.listEnv(agent.agent_id);
        } catch {
          throw externalFailure(
            "MARITIME_ENV_VERIFICATION_FAILED",
            `verify-secret:${seat.seat_id}`,
            state
          );
        }
        assertMaskedWalletEnvironment(environment, seat.seat_id, state);
        state.wallet_environment.push(
          Object.freeze({
            seat_id: seat.seat_id,
            agent_id: agent.agent_id,
            key: WALLET_ENVIRONMENT_KEY,
            secret: true,
            value_exposed: false,
            reload_completed: true
          })
        );
        state.completed_steps.push(`verify-secret:${seat.seat_id}`);
      }

      return deepFreeze({
        schema_version: 1,
        status: "two-seat-pilot-configured",
        network: plan.network,
        game_id: plan.game_id,
        agents: state.agents,
        wallet_environment: state.wallet_environment,
        completed_steps: state.completed_steps
      });
    }
  });
}

async function loadDistinctSecrets(seats, secretProvider, plan) {
  const result = new Map();
  const fingerprints = new Set();
  for (const seat of seats) {
    let value;
    try {
      value = await secretProvider(seat.seat_id);
    } catch {
      throw new PilotExecutionError(
        "PLAYER_SECRET_UNAVAILABLE",
        `wallet secret was not available for ${seat.seat_id}`,
        emptyState(plan)
      );
    }
    if (typeof value !== "string" || !PRIVATE_KEY.test(value)) {
      throw new PilotExecutionError(
        "PLAYER_SECRET_INVALID",
        `wallet secret format was invalid for ${seat.seat_id}`,
        emptyState(plan)
      );
    }
    const fingerprint = createHash("sha256").update(value).digest("hex");
    if (fingerprints.has(fingerprint)) {
      throw new PilotExecutionError(
        "DUPLICATE_PLAYER_SECRET",
        "the two pilot seats must not share a wallet secret",
        emptyState(plan)
      );
    }
    const derivedAddress = deriveEthereumAddress(value).toLowerCase();
    if (derivedAddress !== seat.wallet_address.toLowerCase()) {
      throw new PilotExecutionError(
        "PLAYER_WALLET_ADDRESS_MISMATCH",
        `wallet secret does not match the public manifest for ${seat.seat_id}`,
        emptyState(plan)
      );
    }
    fingerprints.add(fingerprint);
    result.set(seat.seat_id, value);
  }
  return result;
}

function normalizeAgent(value, seat, runtime) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PilotExecutionError(
      "MARITIME_AGENT_RESPONSE_INVALID",
      `provision returned no public agent object for ${seat.seat_id}`,
      { agents: [], wallet_environment: [], completed_steps: [] }
    );
  }
  const agentId = value.id;
  if (typeof agentId !== "string" || !UUID.test(agentId)) {
    throw new PilotExecutionError(
      "MARITIME_AGENT_RESPONSE_INVALID",
      `provision returned an invalid public agent ID for ${seat.seat_id}`,
      { agents: [], wallet_environment: [], completed_steps: [] }
    );
  }
  for (const [field, expected] of [
    ["externalId", runtime.externalId],
    ["name", runtime.externalId],
    ["framework", runtime.template]
  ]) {
    if (value[field] !== expected) {
      throw new PilotExecutionError(
        "MARITIME_AGENT_IDENTITY_MISMATCH",
        `provision returned a mismatched ${field} for ${seat.seat_id}`,
        { agents: [], wallet_environment: [], completed_steps: [] }
      );
    }
  }
  if (
    typeof value.status !== "string" ||
    !["sleeping", "active", "deploying", "error", "stopped"].includes(
      value.status
    )
  ) {
    throw new PilotExecutionError(
      "MARITIME_AGENT_RESPONSE_INVALID",
      `provision returned an invalid public status for ${seat.seat_id}`,
      { agents: [], wallet_environment: [], completed_steps: [] }
    );
  }
  return Object.freeze({
    seat_id: seat.seat_id,
    harness: runtime.template,
    external_id: runtime.externalId,
    agent_id: agentId,
    status: value.status
  });
}

function assertMaskedWalletEnvironment(value, seatId, state) {
  if (!Array.isArray(value)) {
    throw externalFailure(
      "MARITIME_ENV_RESPONSE_INVALID",
      `verify-secret:${seatId}`,
      state
    );
  }
  const entry = value.find(
    (candidate) =>
      candidate &&
      typeof candidate === "object" &&
      candidate.key === WALLET_ENVIRONMENT_KEY
  );
  if (!entry) {
    throw externalFailure(
      "MARITIME_SECRET_NOT_CONFIRMED",
      `verify-secret:${seatId}`,
      state
    );
  }
  const secretFlag =
    entry.secret === true ||
    entry.isSecret === true ||
    entry.is_secret === true;
  const maskedValue =
    typeof entry.value === "string" &&
    MASK_MARKER.test(entry.value) &&
    !RAW_32_BYTE_TEXT.test(entry.value);
  if (!secretFlag || !maskedValue) {
    throw externalFailure(
      "MARITIME_SECRET_NOT_MASKED",
      `verify-secret:${seatId}`,
      state
    );
  }
}

function assertMaritimeClient(maritime) {
  if (!maritime || typeof maritime !== "object" || !maritime.agents) {
    throw new TypeError("maritime.agents is required");
  }
  for (const method of [
    "provision",
    "setEnv",
    "reloadEnv",
    "listEnv"
  ]) {
    if (typeof maritime.agents[method] !== "function") {
      throw new TypeError(`maritime.agents.${method} must be a function`);
    }
  }
}

function assertSdkPolicy(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.package !== VERIFIED_SDK_POLICY.package ||
    value.version !== VERIFIED_SDK_POLICY.version ||
    value.maxRetries !== VERIFIED_SDK_POLICY.maxRetries ||
    Object.keys(value).length !== 3
  ) {
    throw new TypeError(
      "sdkPolicy must attest maritime-sdk@0.6.0 with maxRetries: 0"
    );
  }
}

function emptyState(plan) {
  return {
    network: plan.network,
    game_id: plan.game_id,
    agents: [],
    wallet_environment: [],
    completed_steps: []
  };
}

function externalFailure(code, action, state, ambiguous = false) {
  return new PilotExecutionError(
    code,
    ambiguous
      ? "external write outcome is unknown; stop for manual reconciliation"
      : "external action failed; stop without automatic deletion or retry",
    {
      ...state,
      failed_action: action,
      ambiguous_external_write: ambiguous
    }
  );
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}
