export const PUBLIC_SEAT_MANIFEST_SCHEMA =
  "https://dilemmaeval.local/schemas/seat-manifest.schema.json";
export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const PILOT_SEAT_IDS = Object.freeze(["oc-1", "hs-1"]);
export const PILOT_AGENT_REFERENCES = Object.freeze({
  "oc-1": "dilemmaeval-pilot-openclaw",
  "hs-1": "dilemmaeval-pilot-hermes"
});

const ROOT_KEYS = new Set(["schema_version", "network", "game_id", "seats"]);
const SEAT_KEYS = new Set([
  "seat_id",
  "team",
  "harness",
  "maritime_agent",
  "wallet_address"
]);
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const GAME_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const RAW_32_BYTE_VALUE =
  /(?<![0-9a-fA-F])(?:0[xX])?[0-9a-fA-F]{64}(?![0-9a-fA-F])/;
const SECRET_ASSIGNMENT =
  /\b(?:api[_-]?key|private[_-]?key|token|secret|password|mnemonic|seed)\s*[:=]\s*\S+/i;
const SECRET_BEARING_URL =
  /https?:\/\/(?:[^/\s]*\.)?(?:alchemy\.com|infura\.io)\/(?:v2|v3)\/[A-Za-z0-9_-]{8,}/i;
const API_TOKEN_SHAPE = /\bsk-[A-Za-z0-9_-]{16,}\b/;
const MARITIME_API_TOKEN_SHAPE = /\bmk_[A-Za-z0-9_-]{8,}\b/;
const JWT_SHAPE =
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/;

const EXPECTED_SEATS = Object.freeze({
  "oc-1": Object.freeze({ team: "openclaw", harness: "openclaw" }),
  "hs-1": Object.freeze({ team: "hermes", harness: "hermes" })
});

export class PreflightValidationError extends TypeError {
  constructor(code, path, message) {
    super(`${code} at ${path}: ${message}`);
    this.name = "PreflightValidationError";
    this.code = code;
    this.path = path;
  }
}

export function validateTwoSeatManifest(input) {
  assertNoSecretInput(input);
  assertPlainObject(input, "$");
  assertExactKeys(input, ROOT_KEYS, "$");

  if (input.schema_version !== 1) {
    fail("MANIFEST_SCHEMA_MISMATCH", "$.schema_version", "must equal 1");
  }
  if (input.network !== "base-sepolia") {
    fail(
      "UNSUPPORTED_NETWORK",
      "$.network",
      'must equal "base-sepolia" (chain 84532)'
    );
  }
  if (
    typeof input.game_id !== "string" ||
    !GAME_ID_PATTERN.test(input.game_id)
  ) {
    fail(
      "INVALID_GAME_ID",
      "$.game_id",
      "must be a bounded public identifier, not a URL"
    );
  }
  assertSafeString(input.game_id, "$.game_id");

  if (!Array.isArray(input.seats) || input.seats.length !== 2) {
    fail(
      "INVALID_PILOT_SEAT_COUNT",
      "$.seats",
      "must contain exactly two seats"
    );
  }

  const normalizedSeats = input.seats.map((seat, index) =>
    validateSeat(seat, `$.seats[${index}]`)
  );
  const byId = new Map(normalizedSeats.map((seat) => [seat.seat_id, seat]));
  if (
    byId.size !== PILOT_SEAT_IDS.length ||
    PILOT_SEAT_IDS.some((seatId) => !byId.has(seatId))
  ) {
    fail(
      "INVALID_PILOT_SEAT_SET",
      "$.seats",
      "must contain oc-1 and hs-1 exactly once"
    );
  }

  const addresses = normalizedSeats.map((seat) => seat.wallet_address);
  if (new Set(addresses).size !== addresses.length) {
    fail(
      "DUPLICATE_WALLET_ADDRESS",
      "$.seats",
      "wallet addresses must be unique (case-insensitive)"
    );
  }

  const agentReferences = normalizedSeats.map((seat) => seat.maritime_agent);
  if (new Set(agentReferences).size !== agentReferences.length) {
    fail(
      "DUPLICATE_AGENT_REFERENCE",
      "$.seats",
      "Maritime agent references must be unique"
    );
  }

  return deepFreeze({
    schema_version: 1,
    network: "base-sepolia",
    game_id: input.game_id,
    seats: PILOT_SEAT_IDS.map((seatId) => byId.get(seatId))
  });
}

export function buildTwoSeatPilotPlan(input) {
  const manifest = validateTwoSeatManifest(input);
  const steps = [];

  for (const seat of manifest.seats) {
    steps.push(
      pendingStep({
        id: `create-agent:${seat.seat_id}`,
        type: "create_agent",
        seat,
        authorizationScope: "live_maritime_agent_creation",
        prerequisite: "verified_current_maritime_sdk_create_surface"
      }),
      pendingStep({
        id: `configure-wallet-environment:${seat.seat_id}`,
        type: "configure_wallet_environment",
        seat,
        authorizationScope: "live_maritime_secret_injection",
        prerequisite:
          "created_agent_and_operator_selected_wallet_secret_out_of_band",
        fixedConfigurationName: "GAMEPLAY_WALLET_PRIVATE_KEY"
      }),
      pendingStep({
        id: `verify-masked-wallet-environment:${seat.seat_id}`,
        type: "verify_masked_wallet_environment",
        seat,
        authorizationScope: "live_maritime_agent_execution",
        prerequisite:
          "configured_agent_and_verified_current_maritime_masked_environment_inspection_surface"
      })
    );
  }

  return deepFreeze({
    schema_version: 1,
    plan_kind: "dilemmaeval.two-seat-maritime-pilot",
    mode: "dry-run",
    source_schema: PUBLIC_SEAT_MANIFEST_SCHEMA,
    network: {
      name: manifest.network,
      chain_id: BASE_SEPOLIA_CHAIN_ID
    },
    game_id: manifest.game_id,
    seats: manifest.seats.map((seat) => ({ ...seat })),
    live_execution: {
      preflight_executes_live: false,
      sdk_surface_status: "verified-maritime-sdk-0.6.0",
      executor_module: "../maritime-pilot-client"
    },
    steps
  });
}

export function assertNoSecretInput(value, path = "$", seen = new Set()) {
  if (typeof value === "string") {
    assertSafeString(value, path);
    return true;
  }
  if (value === null || typeof value !== "object") {
    return true;
  }
  if (seen.has(value)) {
    fail("CYCLIC_INPUT", path, "input must be JSON-compatible and acyclic");
  }
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      assertNoSecretInput(child, `${path}[${index}]`, seen)
    );
  } else {
    for (const [key, child] of Object.entries(value)) {
      // Validate unknown key text before it can be reflected in an exact-key
      // validation path. Use a generic path so secret-shaped key names are
      // never copied into an error.
      assertSafeString(key, `${path}.[field-name]`);
      if (isSensitiveFieldName(key)) {
        fail(
          "SECRET_FIELD_REJECTED",
          `${path}.[sensitive-field]`,
          "secret, environment, token, and RPC fields are not accepted"
        );
      }
      assertNoSecretInput(child, `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
  return true;
}

export function isDeeplyFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) {
    return true;
  }
  if (!Object.isFrozen(value)) {
    return false;
  }
  seen.add(value);
  return Object.values(value).every((child) => isDeeplyFrozen(child, seen));
}

function validateSeat(input, path) {
  assertPlainObject(input, path);
  assertExactKeys(input, SEAT_KEYS, path);

  if (!Object.hasOwn(EXPECTED_SEATS, input.seat_id)) {
    fail(
      "INVALID_PILOT_SEAT_ID",
      `${path}.seat_id`,
      "must equal oc-1 or hs-1"
    );
  }
  const expected = EXPECTED_SEATS[input.seat_id];
  if (input.team !== expected.team) {
    fail(
      "SEAT_TEAM_MISMATCH",
      `${path}.team`,
      `must equal ${expected.team} for ${input.seat_id}`
    );
  }
  if (input.harness !== expected.harness) {
    fail(
      "SEAT_HARNESS_MISMATCH",
      `${path}.harness`,
      `must equal ${expected.harness} for ${input.seat_id}`
    );
  }
  if (input.maritime_agent !== PILOT_AGENT_REFERENCES[input.seat_id]) {
    fail(
      "INVALID_AGENT_REFERENCE",
      `${path}.maritime_agent`,
      `must equal the stable pilot idempotency reference ${PILOT_AGENT_REFERENCES[input.seat_id]}`
    );
  }
  if (
    typeof input.wallet_address !== "string" ||
    !ADDRESS_PATTERN.test(input.wallet_address)
  ) {
    fail(
      "INVALID_WALLET_ADDRESS",
      `${path}.wallet_address`,
      "must be a 0x-prefixed 20-byte Ethereum address"
    );
  }

  return deepFreeze({
    seat_id: input.seat_id,
    team: input.team,
    harness: input.harness,
    maritime_agent: input.maritime_agent,
    wallet_address: input.wallet_address.toLowerCase()
  });
}

function pendingStep({
  id,
  type,
  seat,
  authorizationScope,
  prerequisite,
  fixedConfigurationName
}) {
  return {
    id,
    type,
    status: "pending",
    target: {
      seat_id: seat.seat_id,
      harness: seat.harness,
      maritime_agent: seat.maritime_agent,
      expected_wallet_address: seat.wallet_address
    },
    ...(fixedConfigurationName
      ? { fixed_configuration_name: fixedConfigurationName }
      : {}),
    prerequisite,
    authorization: {
      required: true,
      grant: "explicit_operator_approval",
      scope: authorizationScope
    }
  };
}

function assertSafeString(value, path) {
  if (
    RAW_32_BYTE_VALUE.test(value) ||
    SECRET_ASSIGNMENT.test(value) ||
    SECRET_BEARING_URL.test(value) ||
    API_TOKEN_SHAPE.test(value) ||
    MARITIME_API_TOKEN_SHAPE.test(value) ||
    JWT_SHAPE.test(value)
  ) {
    fail(
      "SECRET_VALUE_REJECTED",
      path,
      "private-key-, token-, or RPC-secret-shaped values are not accepted"
    );
  }
}

function isSensitiveFieldName(key) {
  const compact = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return (
    compact === "env" ||
    compact === "environment" ||
    compact === "environmentvariables" ||
    compact === "processenv" ||
    compact === "headers" ||
    compact === "header" ||
    compact === "cookie" ||
    compact.includes("privatekey") ||
    compact.includes("walletkey") ||
    compact.includes("apikey") ||
    compact.includes("rpckey") ||
    compact.includes("rpcurl") ||
    compact.includes("authorization") ||
    compact.includes("credential") ||
    compact.includes("password") ||
    compact.includes("passphrase") ||
    compact.includes("mnemonic") ||
    compact.includes("seedphrase") ||
    compact.includes("recoveryphrase") ||
    compact.includes("secret") ||
    compact.includes("token")
  );
}

function assertPlainObject(value, path) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail("INVALID_OBJECT", path, "must be a plain object");
  }
}

function assertExactKeys(value, allowed, path) {
  const keys = Object.keys(value);
  for (const key of keys) {
    if (!allowed.has(key)) {
      fail("UNKNOWN_FIELD", `${path}.${key}`, "field is not in the public schema");
    }
  }
  for (const key of allowed) {
    if (!Object.hasOwn(value, key)) {
      fail("MISSING_FIELD", `${path}.${key}`, "field is required");
    }
  }
}

function fail(code, path, message) {
  throw new PreflightValidationError(code, path, message);
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value)) {
    deepFreeze(child, seen);
  }
  return Object.freeze(value);
}
