const PHASES = new Set(["join", "commit", "reveal", "claim"]);
const TEAMS = new Set(["openclaw", "hermes"]);
const STATUSES = new Set(["submitted", "observed", "skipped", "error"]);
const SEAT_PATTERN = /^(oc|hs)-[1-5]$/;
const TRANSACTION_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const PHASE_ORDER = new Map([
  ["join", 0],
  ["commit", 1],
  ["reveal", 2],
  ["claim", 3]
]);

const POKE_KEYS = new Set([
  "request_id",
  "game_id",
  "round",
  "phase",
  "seat_id",
  "team",
  "chain_state",
  "team_chat",
  "requested_action",
  "response_schema_version"
]);
const RESPONSE_KEYS = new Set([
  "schema_version",
  "request_id",
  "game_id",
  "round",
  "phase",
  "seat_id",
  "status",
  "transaction_hash",
  "team_message",
  "error"
]);
const MESSAGE_KEYS = new Set([
  "schema_version",
  "game_id",
  "round",
  "phase",
  "team",
  "seat_id",
  "sequence",
  "received_at",
  "request_id",
  "message"
]);

export function validatePoke(poke) {
  assertPlainObject(poke, "poke");
  assertNoSensitiveMaterial(poke);
  assertExactKeys(poke, POKE_KEYS, POKE_KEYS, "poke");

  nonEmptyString(poke.request_id, "poke.request_id");
  nonEmptyString(poke.game_id, "poke.game_id");
  nonNegativeInteger(poke.round, "poke.round");
  enumValue(poke.phase, PHASES, "poke.phase");
  seatId(poke.seat_id, "poke.seat_id");
  enumValue(poke.team, TEAMS, "poke.team");
  assertSeatMatchesTeam(poke.seat_id, poke.team, "poke");
  assertPlainObject(poke.chain_state, "poke.chain_state");
  enumValue(poke.requested_action, PHASES, "poke.requested_action");
  if (poke.requested_action !== poke.phase) {
    fail("poke.requested_action", "must equal poke.phase");
  }
  if (poke.response_schema_version !== 1) {
    fail("poke.response_schema_version", "must equal 1");
  }

  assertPlainObject(poke.team_chat, "poke.team_chat");
  assertExactKeys(
    poke.team_chat,
    new Set(["through_sequence", "messages"]),
    new Set(["through_sequence", "messages"]),
    "poke.team_chat"
  );
  nonNegativeInteger(poke.team_chat.through_sequence, "poke.team_chat.through_sequence");
  if (!Array.isArray(poke.team_chat.messages) || poke.team_chat.messages.length > 20) {
    fail("poke.team_chat.messages", "must be an array with at most 20 items");
  }
  let previousSequence = 0;
  poke.team_chat.messages.forEach((message, index) => {
    const path = `poke.team_chat.messages[${index}]`;
    validateTeamMessage(message, path);
    assertSeatMatchesTeam(message.seat_id, message.team, path);
    if (message.team !== poke.team) {
      fail(`${path}.team`, "must equal poke.team");
    }
    if (message.game_id !== poke.game_id) {
      fail(`${path}.game_id`, "must equal poke.game_id");
    }
    if (message.round > poke.round) {
      fail(`${path}.round`, "must not be later than poke.round");
    }
    if (
      message.round === poke.round &&
      PHASE_ORDER.get(message.phase) > PHASE_ORDER.get(poke.phase)
    ) {
      fail(`${path}.phase`, "must not be later than poke.phase in the same round");
    }
    if (message.sequence <= previousSequence) {
      fail(`${path}.sequence`, "must be strictly ascending and unique");
    }
    if (message.sequence > poke.team_chat.through_sequence) {
      fail(`${path}.sequence`, "must not exceed team_chat.through_sequence");
    }
    previousSequence = message.sequence;
  });
  if (poke.team_chat.messages.length === 0) {
    if (poke.team_chat.through_sequence !== 0) {
      fail("poke.team_chat.through_sequence", "must equal 0 when messages is empty");
    }
  } else if (poke.team_chat.through_sequence !== previousSequence) {
    fail(
      "poke.team_chat.through_sequence",
      "must equal the highest included message sequence"
    );
  }

  return poke;
}

export function serializePoke(poke) {
  validatePoke(poke);
  return JSON.stringify(poke);
}

export function validateAgentResponse(response) {
  assertPlainObject(response, "response");
  assertNoSensitiveMaterial(response);

  const required = new Set([
    "schema_version",
    "request_id",
    "game_id",
    "round",
    "phase",
    "seat_id",
    "status"
  ]);
  assertExactKeys(response, RESPONSE_KEYS, required, "response");

  if (response.schema_version !== 1) {
    fail("response.schema_version", "must equal 1");
  }
  nonEmptyString(response.request_id, "response.request_id");
  nonEmptyString(response.game_id, "response.game_id");
  nonNegativeInteger(response.round, "response.round");
  enumValue(response.phase, PHASES, "response.phase");
  seatId(response.seat_id, "response.seat_id");
  enumValue(response.status, STATUSES, "response.status");

  if (
    Object.hasOwn(response, "transaction_hash") &&
    response.transaction_hash !== null &&
    (typeof response.transaction_hash !== "string" ||
      !TRANSACTION_PATTERN.test(response.transaction_hash))
  ) {
    fail("response.transaction_hash", "must be null or a 32-byte hexadecimal hash");
  }
  if (Object.hasOwn(response, "team_message") && typeof response.team_message !== "string") {
    fail("response.team_message", "must be a string");
  }
  if (Object.hasOwn(response, "error") && response.error !== null) {
    assertPlainObject(response.error, "response.error");
    assertExactKeys(
      response.error,
      new Set(["code", "message"]),
      new Set(["code", "message"]),
      "response.error"
    );
    nonEmptyString(response.error.code, "response.error.code");
    nonEmptyString(response.error.message, "response.error.message");
  }

  return response;
}

export function parseAndValidateResponse(raw) {
  let candidate = raw;
  if (typeof candidate === "string") {
    candidate = parseJson(candidate, "agent response");
  } else if (
    candidate &&
    typeof candidate === "object" &&
    !Array.isArray(candidate) &&
    Object.keys(candidate).length === 1 &&
    Object.hasOwn(candidate, "response")
  ) {
    candidate =
      typeof candidate.response === "string"
        ? parseJson(candidate.response, "Maritime response")
        : candidate.response;
  }

  return validateAgentResponse(candidate);
}

export function assertResponseIdentity(poke, response) {
  validatePoke(poke);
  validateAgentResponse(response);
  for (const field of ["request_id", "game_id", "round", "phase", "seat_id"]) {
    if (response[field] !== poke[field]) {
      throw new Error(
        `RESPONSE_IDENTITY_MISMATCH: ${field} expected ${String(poke[field])}, received ${String(response[field])}`
      );
    }
  }
  return true;
}

export function assertNoSensitiveMaterial(value, path = "input") {
  if (typeof value === "string") {
    const leaf = path.split(".").at(-1).toLowerCase().replaceAll(/[^a-z0-9]/g, "");
    const publicHashField =
      leaf.includes("hash") ||
      leaf.includes("commitment") ||
      leaf === "message" ||
      leaf === "teammessage" ||
      leaf === "errormessage";
    if (
      /(?:^|\s)Bearer\s+\S+/i.test(value) ||
      /\bmk_[A-Za-z0-9_-]{6,}/.test(value) ||
      /\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{8,}/i.test(value) ||
      (!publicHashField && /^0x[0-9a-fA-F]{64}$/.test(value))
    ) {
      throw new Error(`SENSITIVE_MATERIAL_REJECTED: ${path}`);
    }
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, child] of Object.entries(value)) {
    if (isSensitiveKey(key, path)) {
      throw new Error(`SENSITIVE_MATERIAL_REJECTED: ${path}.${key}`);
    }
    assertNoSensitiveMaterial(child, `${path}.${key}`);
  }
}

export const assertNoGameplayPrivateKey = assertNoSensitiveMaterial;

function isSensitiveKey(key, path) {
  const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
  return (
    normalized.includes("privatekey") ||
    normalized.includes("walletkey") ||
    normalized.includes("secret") ||
    normalized.includes("mnemonic") ||
    normalized.startsWith("seed") ||
    normalized.includes("seedphrase") ||
    normalized.includes("recoveryphrase") ||
    normalized === "salt" ||
    normalized.endsWith("salt") ||
    normalized.includes("token") ||
    normalized.includes("apikey") ||
    normalized.includes("password") ||
    normalized.includes("passphrase") ||
    normalized.includes("credential") ||
    normalized.includes("authorization") ||
    normalized === "authentication" ||
    (normalized === "auth" && path.startsWith("metadata")) ||
    normalized.includes("authheader") ||
    normalized === "headers" ||
    normalized.includes("cookie") ||
    normalized === "env" ||
    normalized === "environ" ||
    normalized === "environment" ||
    normalized.includes("processenv") ||
    normalized.includes("environmentvariables")
  );
}

function assertSeatMatchesTeam(seat, team, path) {
  const expectedPrefix = team === "openclaw" ? "oc-" : "hs-";
  if (!seat.startsWith(expectedPrefix)) {
    fail(`${path}.seat_id`, `must use the ${expectedPrefix} prefix for team ${team}`);
  }
}

function validateTeamMessage(message, path) {
  assertPlainObject(message, path);
  assertExactKeys(message, MESSAGE_KEYS, MESSAGE_KEYS, path);
  if (message.schema_version !== 1) fail(`${path}.schema_version`, "must equal 1");
  nonEmptyString(message.game_id, `${path}.game_id`);
  nonNegativeInteger(message.round, `${path}.round`);
  enumValue(message.phase, PHASES, `${path}.phase`);
  enumValue(message.team, TEAMS, `${path}.team`);
  seatId(message.seat_id, `${path}.seat_id`);
  if (!Number.isInteger(message.sequence) || message.sequence < 1) {
    fail(`${path}.sequence`, "must be an integer >= 1");
  }
  nonEmptyString(message.received_at, `${path}.received_at`);
  if (Number.isNaN(Date.parse(message.received_at))) {
    fail(`${path}.received_at`, "must be an RFC 3339 date-time");
  }
  nonEmptyString(message.request_id, `${path}.request_id`);
  if (typeof message.message !== "string") fail(`${path}.message`, "must be a string");
}

function assertExactKeys(value, allowed, required, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${path}.${key}`, "is not allowed");
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, "is required");
  }
}

function assertPlainObject(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "must be an object");
  }
}

function nonEmptyString(value, path) {
  if (typeof value !== "string" || value.length === 0) fail(path, "must be a non-empty string");
}

function nonNegativeInteger(value, path) {
  if (!Number.isInteger(value) || value < 0) fail(path, "must be an integer >= 0");
}

function seatId(value, path) {
  if (typeof value !== "string" || !SEAT_PATTERN.test(value)) {
    fail(path, "must match ^(oc|hs)-[1-5]$");
  }
}

function enumValue(value, allowed, path) {
  if (!allowed.has(value)) fail(path, `must be one of ${[...allowed].join(", ")}`);
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`INVALID_JSON: ${label}: ${error.message}`, { cause: error });
  }
}

function fail(path, message) {
  throw new TypeError(`${path} ${message}`);
}
