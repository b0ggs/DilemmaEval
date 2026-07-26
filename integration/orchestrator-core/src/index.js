import { createHash } from "node:crypto";

const ACTIVE_PHASES = Object.freeze(new Set(["join", "commit", "reveal"]));
const SNAPSHOT_PHASES = Object.freeze(new Set([...ACTIVE_PHASES, "terminal"]));
const REQUEST_PHASES = Object.freeze(
  new Set(["join", "commit", "reveal", "claim"])
);
const REQUEST_STATUSES = Object.freeze(
  new Set(["submitted", "observed", "skipped", "error"])
);
const TEAMS = Object.freeze(new Set(["openclaw", "hermes"]));
const DECIMAL_UINT = /^(0|[1-9][0-9]*)$/;
const BLOCK_HASH = /^0x[0-9a-fA-F]{64}$/;
const SEAT_ID = /^(oc|hs)-[1-5]$/;
const TRANSACTION_HASH = /^0x[0-9a-fA-F]{64}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const SAFE_REQUEST_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
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
const TEAM_MESSAGE_KEYS = new Set([
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

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])])
    );
  }
  return value;
}

function fingerprint(value) {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
}

function requireExactKeys(value, required, optional, label) {
  const permitted = new Set([...required, ...optional]);
  const missing = required.filter((key) => !(key in value));
  const extra = Object.keys(value).filter((key) => !permitted.has(key));
  if (missing.length > 0 || extra.length > 0) {
    throw new TypeError(
      `${label} has invalid fields (missing: ${missing.join(",") || "none"}; ` +
        `extra: ${extra.join(",") || "none"}).`
    );
  }
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
}

function requireInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${label} must be a safe integer >= ${minimum}.`);
  }
}

function requireDecimal(value, label) {
  if (typeof value !== "string" || !DECIMAL_UINT.test(value)) {
    throw new TypeError(`${label} must be a canonical unsigned decimal string.`);
  }
}

function normalizeClock(clock, phase) {
  if (phase === "terminal") {
    if (clock !== null) throw new TypeError("Terminal snapshot clock must be null.");
    return null;
  }

  requireRecord(clock, "snapshot.clock");
  requireExactKeys(
    clock,
    ["unit", "current", "deadline"],
    [],
    "snapshot.clock"
  );
  const expectedUnit = phase === "join" ? "timestamp" : "block";
  if (clock.unit !== expectedUnit) {
    throw new TypeError(
      `${phase} snapshot clock unit must be ${expectedUnit}.`
    );
  }
  requireDecimal(clock.current, "snapshot.clock.current");
  requireDecimal(clock.deadline, "snapshot.clock.deadline");
  return {
    unit: clock.unit,
    current: clock.current,
    deadline: clock.deadline
  };
}

export function normalizeChainSnapshot(snapshot) {
  requireRecord(snapshot, "snapshot");
  requireExactKeys(
    snapshot,
    [
      "schema_version",
      "game_id",
      "round",
      "phase",
      "block_number",
      "block_hash",
      "alive_count",
      "committed_count",
      "revealed_count",
      "clock"
    ],
    [],
    "snapshot"
  );

  if (snapshot.schema_version !== 1) {
    throw new TypeError("snapshot.schema_version must be 1.");
  }
  requireNonEmptyString(snapshot.game_id, "snapshot.game_id");
  requireInteger(snapshot.round, "snapshot.round");
  if (!SNAPSHOT_PHASES.has(snapshot.phase)) {
    throw new TypeError("snapshot.phase is unsupported.");
  }
  requireDecimal(snapshot.block_number, "snapshot.block_number");
  if (typeof snapshot.block_hash !== "string" || !BLOCK_HASH.test(snapshot.block_hash)) {
    throw new TypeError("snapshot.block_hash must be a 32-byte hex value.");
  }
  requireInteger(snapshot.alive_count, "snapshot.alive_count");
  requireInteger(snapshot.committed_count, "snapshot.committed_count");
  requireInteger(snapshot.revealed_count, "snapshot.revealed_count");

  if (ACTIVE_PHASES.has(snapshot.phase) && snapshot.alive_count === 0) {
    throw new TypeError("An active-phase snapshot must have an alive player.");
  }
  if (
    snapshot.committed_count > snapshot.alive_count ||
    snapshot.revealed_count > snapshot.alive_count ||
    snapshot.revealed_count > snapshot.committed_count
  ) {
    throw new TypeError(
      "Acted counts cannot exceed alive_count, and revealed_count cannot exceed committed_count."
    );
  }
  const clock = normalizeClock(snapshot.clock, snapshot.phase);
  if (
    (snapshot.phase === "commit" || snapshot.phase === "reveal") &&
    clock.current !== snapshot.block_number
  ) {
    throw new TypeError(
      "Commit/reveal clock.current must equal snapshot.block_number."
    );
  }

  return deepFreeze({
    schema_version: 1,
    game_id: snapshot.game_id,
    round: snapshot.round,
    phase: snapshot.phase,
    block_number: snapshot.block_number,
    block_hash: snapshot.block_hash.toLowerCase(),
    alive_count: snapshot.alive_count,
    committed_count: snapshot.committed_count,
    revealed_count: snapshot.revealed_count,
    clock
  });
}

export function evaluateChainSnapshot(input) {
  const snapshot = normalizeChainSnapshot(input);
  if (snapshot.phase === "terminal") {
    return deepFreeze({
      status: "terminal",
      phase: "terminal",
      eligible: false,
      reason: "game-terminal",
      predicate_token: fingerprint({
        game_id: snapshot.game_id,
        round: snapshot.round,
        phase: snapshot.phase
      })
    });
  }

  const deadlineReached =
    BigInt(snapshot.clock.current) > BigInt(snapshot.clock.deadline);
  const allRequiredActed =
    snapshot.phase === "commit"
      ? snapshot.committed_count === snapshot.alive_count
      : snapshot.phase === "reveal"
        ? snapshot.revealed_count === snapshot.committed_count
        : false;
  const eligible =
    snapshot.phase === "join"
      ? deadlineReached
      : allRequiredActed || deadlineReached;
  const relevantCount =
    snapshot.phase === "commit"
      ? snapshot.committed_count
      : snapshot.phase === "reveal"
        ? {
            committed_count: snapshot.committed_count,
            revealed_count: snapshot.revealed_count
          }
        : null;

  const predicateToken = fingerprint({
    game_id: snapshot.game_id,
    round: snapshot.round,
    phase: snapshot.phase,
    alive_count: snapshot.alive_count,
    relevant_count: relevantCount,
    deadline_unit: snapshot.clock.unit,
    deadline: snapshot.clock.deadline,
    deadline_reached: deadlineReached
  });

  let reason = "predicate-not-met";
  if (eligible) {
    if (snapshot.phase === "join") reason = "join-deadline-reached";
    else if (allRequiredActed) {
      reason =
        snapshot.phase === "commit"
          ? "all-alive-committed"
          : "all-committed-revealed";
    }
    else reason = `${snapshot.phase}-deadline-reached`;
  }

  return deepFreeze({
    status: eligible ? "advance-eligible" : "wait",
    phase: snapshot.phase,
    eligible,
    reason,
    predicate_token: predicateToken
  });
}

function requireSeatTeam(seat, team, label) {
  if (typeof seat !== "string" || !SEAT_ID.test(seat)) {
    throw new TypeError(`${label}.seat_id is unsupported.`);
  }
  if (!TEAMS.has(team)) {
    throw new TypeError(`${label}.team is unsupported.`);
  }
  const expectedPrefix = team === "openclaw" ? "oc-" : "hs-";
  if (!seat.startsWith(expectedPrefix)) {
    throw new TypeError(`${label}.seat_id does not match ${label}.team.`);
  }
}

function validateTeamMessage(message, request, index) {
  const label = `request.team_chat.messages[${index}]`;
  requireRecord(message, label);
  requireExactKeys(message, [...TEAM_MESSAGE_KEYS], [], label);
  if (message.schema_version !== 1) {
    throw new TypeError(`${label}.schema_version must be 1.`);
  }
  requireNonEmptyString(message.game_id, `${label}.game_id`);
  requireInteger(message.round, `${label}.round`);
  if (!REQUEST_PHASES.has(message.phase)) {
    throw new TypeError(`${label}.phase is unsupported.`);
  }
  requireSeatTeam(message.seat_id, message.team, label);
  requireInteger(message.sequence, `${label}.sequence`, 1);
  requireNonEmptyString(message.received_at, `${label}.received_at`);
  if (Number.isNaN(Date.parse(message.received_at))) {
    throw new TypeError(`${label}.received_at must be a date-time.`);
  }
  requireNonEmptyString(message.request_id, `${label}.request_id`);
  if (typeof message.message !== "string") {
    throw new TypeError(`${label}.message must be a string.`);
  }
  if (message.game_id !== request.game_id || message.team !== request.team) {
    throw new TypeError(`${label} must match the poke game and team.`);
  }
}

function validateRequestRecord(request) {
  requireRecord(request, "request");
  requireExactKeys(
    request,
    [...POKE_KEYS],
    [],
    "request"
  );
  requireNonEmptyString(request.request_id, "request.request_id");
  requireNonEmptyString(request.game_id, "request.game_id");
  requireInteger(request.round, "request.round");
  if (!REQUEST_PHASES.has(request.phase)) {
    throw new TypeError("request.phase is unsupported.");
  }
  requireSeatTeam(request.seat_id, request.team, "request");
  if (request.requested_action !== request.phase) {
    throw new TypeError("request.requested_action must equal request.phase.");
  }
  requireRecord(request.chain_state, "request.chain_state");
  requireRecord(request.team_chat, "request.team_chat");
  requireExactKeys(
    request.team_chat,
    ["through_sequence", "messages"],
    [],
    "request.team_chat"
  );
  requireInteger(
    request.team_chat.through_sequence,
    "request.team_chat.through_sequence"
  );
  if (
    !Array.isArray(request.team_chat.messages) ||
    request.team_chat.messages.length > 20
  ) {
    throw new TypeError(
      "request.team_chat.messages must be an array with at most 20 entries."
    );
  }
  for (const [index, message] of request.team_chat.messages.entries()) {
    validateTeamMessage(message, request, index);
  }
  if (request.response_schema_version !== 1) {
    throw new TypeError("request.response_schema_version must be 1.");
  }

  // Persist only immutable, non-secret identity/action metadata. The chain
  // snapshot and chat payload have separate authorities and storage modules.
  return deepFreeze({
    schema_version: 1,
    request_id: request.request_id,
    game_id: request.game_id,
    round: request.round,
    phase: request.phase,
    seat_id: request.seat_id,
    team: request.team,
    requested_action: request.requested_action
  });
}

function validateResponseRecord(response) {
  requireRecord(response, "response");
  requireExactKeys(
    response,
    [
      "schema_version",
      "request_id",
      "game_id",
      "round",
      "phase",
      "seat_id",
      "status"
    ],
    ["transaction_hash", "team_message", "error"],
    "response"
  );
  if (response.schema_version !== 1) {
    throw new TypeError("response.schema_version must be 1.");
  }
  requireNonEmptyString(response.request_id, "response.request_id");
  requireNonEmptyString(response.game_id, "response.game_id");
  requireInteger(response.round, "response.round");
  if (!REQUEST_PHASES.has(response.phase)) {
    throw new TypeError("response.phase is unsupported.");
  }
  if (typeof response.seat_id !== "string" || !SEAT_ID.test(response.seat_id)) {
    throw new TypeError("response.seat_id is unsupported.");
  }
  if (!REQUEST_STATUSES.has(response.status)) {
    throw new TypeError("response.status is unsupported.");
  }
  if (
    response.transaction_hash !== undefined &&
    response.transaction_hash !== null &&
    !TRANSACTION_HASH.test(response.transaction_hash)
  ) {
    throw new TypeError("response.transaction_hash is invalid.");
  }
  if (
    response.team_message !== undefined &&
    typeof response.team_message !== "string"
  ) {
    throw new TypeError("response.team_message must be a string.");
  }
  if (response.error !== undefined && response.error !== null) {
    requireRecord(response.error, "response.error");
    requireExactKeys(response.error, ["code", "message"], [], "response.error");
    requireNonEmptyString(response.error.code, "response.error.code");
    requireNonEmptyString(response.error.message, "response.error.message");
  }
  return deepFreeze(clone(response));
}

export function createMemoryStore(seed = []) {
  const records = new Map();
  for (const entry of seed) {
    requireRecord(entry, "seed entry");
    requireNonEmptyString(entry.key, "seed entry.key");
    if (records.has(entry.key)) throw new TypeError("Seed keys must be unique.");
    records.set(entry.key, clone(entry.value));
  }

  return Object.freeze({
    async get(key) {
      return clone(records.get(key));
    },
    async putIfAbsent(key, value) {
      if (records.has(key)) {
        return { inserted: false, value: clone(records.get(key)) };
      }
      records.set(key, clone(value));
      return { inserted: true, value: clone(value) };
    },
    async set(key, value) {
      records.set(key, clone(value));
      return clone(value);
    },
    async compareAndSet(key, expectedRevision, value) {
      const current = records.get(key);
      if (
        !current ||
        !Number.isSafeInteger(current.revision) ||
        current.revision !== expectedRevision
      ) {
        return { updated: false, value: clone(current) };
      }
      records.set(key, clone(value));
      return { updated: true, value: clone(value) };
    },
    async entries(prefix = "") {
      return [...records.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => ({ key, value: clone(value) }));
    }
  });
}

function validateStore(store) {
  requireRecord(store, "store");
  for (const method of [
    "get",
    "putIfAbsent",
    "set",
    "compareAndSet",
    "entries"
  ]) {
    if (typeof store[method] !== "function") {
      throw new TypeError(`store.${method} must be a function.`);
    }
  }
}

function samePredicate(initial, current) {
  return (
    BigInt(current.block_number) >= BigInt(initial.block_number) &&
    BigInt(current.clock.current) >= BigInt(initial.clock.current) &&
    initial.game_id === current.game_id &&
    initial.round === current.round &&
    initial.phase === current.phase &&
    evaluateChainSnapshot(initial).predicate_token ===
      evaluateChainSnapshot(current).predicate_token
  );
}

function createAdvanceIntent(snapshot, evaluation) {
  const identity = {
    game_id: snapshot.game_id,
    round: snapshot.round,
    phase: snapshot.phase
  };
  const actionId = `advance:${fingerprint(identity)}`;
  return deepFreeze({
    schema_version: 1,
    type: "advance-request",
    action_id: actionId,
    attempt_id: `${actionId}:${fingerprint({
      block_number: snapshot.block_number,
      block_hash: snapshot.block_hash
    })}`,
    game_id: snapshot.game_id,
    round: snapshot.round,
    phase: snapshot.phase,
    source_block_number: snapshot.block_number,
    source_block_hash: snapshot.block_hash,
    source_predicate_token: evaluation.predicate_token,
    reason: evaluation.reason
  });
}

function validateNonSecretReference(reference) {
  if (reference === undefined) return undefined;
  requireRecord(reference, "advance requester outcome.reference");
  requireExactKeys(
    reference,
    ["kind", "value"],
    [],
    "advance requester outcome.reference"
  );
  if (reference.kind === "transaction-hash") {
    if (
      typeof reference.value !== "string" ||
      !TRANSACTION_HASH.test(reference.value)
    ) {
      throw new TypeError(
        "transaction-hash reference must be a 32-byte hexadecimal hash."
      );
    }
  } else if (reference.kind === "request-id") {
    if (
      typeof reference.value !== "string" ||
      !SAFE_REQUEST_REFERENCE.test(reference.value) ||
      /(?:private|secret|token|password|credential|authorization|bearer|github_pat|ghp_|sk-|mk_)/i.test(
        reference.value
      )
    ) {
      throw new TypeError("request-id reference is not a safe identifier.");
    }
  } else {
    throw new TypeError("advance requester reference kind is unsupported.");
  }
  return deepFreeze(clone(reference));
}

function validateAdvanceIntent(intent) {
  requireRecord(intent, "persisted action.intent");
  requireExactKeys(
    intent,
    [
      "schema_version",
      "type",
      "action_id",
      "attempt_id",
      "game_id",
      "round",
      "phase",
      "source_block_number",
      "source_block_hash",
      "source_predicate_token",
      "reason"
    ],
    [],
    "persisted action.intent"
  );
  if (intent.schema_version !== 1 || intent.type !== "advance-request") {
    throw new TypeError("Persisted advance intent version/type is invalid.");
  }
  for (const field of [
    "action_id",
    "attempt_id",
    "game_id",
    "source_predicate_token",
    "reason"
  ]) {
    requireNonEmptyString(intent[field], `persisted action.intent.${field}`);
  }
  requireInteger(intent.round, "persisted action.intent.round");
  if (!ACTIVE_PHASES.has(intent.phase)) {
    throw new TypeError("Persisted advance intent phase is invalid.");
  }
  requireDecimal(
    intent.source_block_number,
    "persisted action.intent.source_block_number"
  );
  if (!BLOCK_HASH.test(intent.source_block_hash)) {
    throw new TypeError("Persisted advance intent block hash is invalid.");
  }
  if (!SHA256_HEX.test(intent.source_predicate_token)) {
    throw new TypeError("Persisted advance predicate token is invalid.");
  }
  const expectedActionId = `advance:${fingerprint({
    game_id: intent.game_id,
    round: intent.round,
    phase: intent.phase
  })}`;
  const expectedAttemptId = `${expectedActionId}:${fingerprint({
    block_number: intent.source_block_number,
    block_hash: intent.source_block_hash
  })}`;
  if (
    intent.action_id !== expectedActionId ||
    intent.attempt_id !== expectedAttemptId
  ) {
    throw new TypeError("Persisted advance action/attempt identity is invalid.");
  }
  return intent;
}

function validatePersistedRequest(record) {
  requireRecord(record, "persisted request");
  requireExactKeys(
    record,
    ["kind", "fingerprint", "request"],
    [],
    "persisted request"
  );
  if (record.kind !== "request") {
    throw new TypeError("Persisted request kind is invalid.");
  }
  requireNonEmptyString(record.fingerprint, "persisted request.fingerprint");
  requireRecord(record.request, "persisted request.request");
  requireExactKeys(
    record.request,
    [
      "schema_version",
      "request_id",
      "game_id",
      "round",
      "phase",
      "seat_id",
      "team",
      "requested_action"
    ],
    [],
    "persisted request.request"
  );
  if (
    record.request.schema_version !== 1 ||
    fingerprint(record.request) !== record.fingerprint
  ) {
    throw new TypeError("Persisted request fingerprint/version is invalid.");
  }
  requireNonEmptyString(record.request.request_id, "persisted request.request_id");
  requireNonEmptyString(record.request.game_id, "persisted request.game_id");
  requireInteger(record.request.round, "persisted request.round");
  if (
    !REQUEST_PHASES.has(record.request.phase) ||
    record.request.requested_action !== record.request.phase
  ) {
    throw new TypeError("Persisted request phase/action is invalid.");
  }
  requireSeatTeam(
    record.request.seat_id,
    record.request.team,
    "persisted request"
  );
  return record;
}

function validatePersistedResponse(record) {
  requireRecord(record, "persisted response");
  requireExactKeys(
    record,
    ["kind", "fingerprint", "team", "response"],
    [],
    "persisted response"
  );
  if (record.kind !== "response-acknowledgement" || !TEAMS.has(record.team)) {
    throw new TypeError("Persisted response kind/team is invalid.");
  }
  const response = validateResponseRecord(record.response);
  if (
    fingerprint({ team: record.team, response }) !== record.fingerprint
  ) {
    throw new TypeError("Persisted response fingerprint is invalid.");
  }
  return record;
}

function assertPersistedResponseIdentity(responseRecord, requestRecord) {
  validatePersistedResponse(responseRecord);
  validatePersistedRequest(requestRecord);
  for (const field of ["request_id", "game_id", "round", "phase", "seat_id"]) {
    if (responseRecord.response[field] !== requestRecord.request[field]) {
      throw new Error(
        `RESPONSE_IDENTITY_MISMATCH: persisted ${field} does not match request.`
      );
    }
  }
  if (responseRecord.team !== requestRecord.request.team) {
    throw new Error("RESPONSE_IDENTITY_MISMATCH: persisted team does not match request.");
  }
}

function validatePersistedAction(record) {
  requireRecord(record, "persisted action");
  requireExactKeys(
    record,
    [
      "kind",
      "revision",
      "state",
      "active_attempt",
      "intent",
      "attempts"
    ],
    ["outcome"],
    "persisted action"
  );
  if (record.kind !== "advance-action") {
    throw new TypeError("Persisted action kind is invalid.");
  }
  requireInteger(record.revision, "persisted action.revision");
  if (
    ![
      "reserved",
      "submission-accepted",
      "confirmed-revert",
      "submission-unknown",
      "rejected-before-submit"
    ].includes(record.state)
  ) {
    throw new TypeError("Persisted action state is invalid.");
  }
  validateAdvanceIntent(record.intent);
  requireRecord(record.active_attempt, "persisted action.active_attempt");
  if (!Array.isArray(record.attempts) || record.attempts.length === 0) {
    throw new TypeError("Persisted action attempts must be non-empty.");
  }
  const active = record.active_attempt;
  const allowedAttemptStates = new Set([
    "reserved",
    "submission-accepted",
    "confirmed-revert",
    "submission-unknown",
    "rejected-before-submit"
  ]);
  for (const [index, attempt] of record.attempts.entries()) {
    requireRecord(attempt, `persisted action.attempts[${index}]`);
    requireExactKeys(
      attempt,
      ["attempt_id", "block_number", "block_hash", "status"],
      [],
      `persisted action.attempts[${index}]`
    );
    requireNonEmptyString(
      attempt.attempt_id,
      `persisted action.attempts[${index}].attempt_id`
    );
    requireDecimal(
      attempt.block_number,
      `persisted action.attempts[${index}].block_number`
    );
    if (!BLOCK_HASH.test(attempt.block_hash)) {
      throw new TypeError("Persisted action attempt block hash is invalid.");
    }
    if (!allowedAttemptStates.has(attempt.status)) {
      throw new TypeError("Persisted action attempt status is invalid.");
    }
  }
  for (const field of ["attempt_id", "block_number", "block_hash", "status"]) {
    requireNonEmptyString(active[field], `persisted action.active_attempt.${field}`);
  }
  if (
    active.attempt_id !== record.intent.attempt_id ||
    active.status !== record.state ||
    active.block_number !== record.intent.source_block_number ||
    active.block_hash !== record.intent.source_block_hash
  ) {
    throw new TypeError("Persisted active attempt does not match its intent/state.");
  }
  if (
    !record.attempts.some(
      (attempt) =>
        attempt?.attempt_id === active.attempt_id &&
        attempt.status === active.status
    )
  ) {
    throw new TypeError("Persisted active attempt is absent from attempt history.");
  }
  if (record.state === "reserved") {
    if (Object.hasOwn(record, "outcome")) {
      throw new TypeError("Reserved persisted action cannot have an outcome.");
    }
  } else {
    requireRecord(record.outcome, "persisted action.outcome");
    requireExactKeys(
      record.outcome,
      ["status"],
      ["reference", "code"],
      "persisted action.outcome"
    );
    if (
      ![
        "accepted",
        "confirmed-revert",
        "race-or-revert",
        "rejected-before-submit",
        "requester-error",
        "invalid-requester-outcome"
      ].includes(record.outcome.status)
    ) {
      throw new TypeError("Persisted action outcome status is invalid.");
    }
    const allowedOutcomeByState = {
      "submission-accepted": new Set(["accepted"]),
      "confirmed-revert": new Set(["confirmed-revert"]),
      "submission-unknown": new Set([
        "race-or-revert",
        "requester-error",
        "invalid-requester-outcome"
      ]),
      "rejected-before-submit": new Set(["rejected-before-submit"])
    };
    if (!allowedOutcomeByState[record.state].has(record.outcome.status)) {
      throw new TypeError(
        "Persisted action state does not match its requester outcome."
      );
    }
    validateNonSecretReference(record.outcome.reference);
    if (record.outcome.code !== undefined) {
      requireNonEmptyString(record.outcome.code, "persisted action.outcome.code");
      if (!SAFE_REQUEST_REFERENCE.test(record.outcome.code)) {
        throw new TypeError("Persisted action outcome code is invalid.");
      }
    }
  }
  return record;
}

function createReservedAction(intent, previous) {
  const priorAttempts = previous?.attempts ?? [];
  return {
    kind: "advance-action",
    revision: previous ? previous.revision + 1 : 0,
    state: "reserved",
    active_attempt: {
      attempt_id: intent.attempt_id,
      block_number: intent.source_block_number,
      block_hash: intent.source_block_hash,
      status: "reserved"
    },
    intent,
    attempts: [
      ...priorAttempts,
      {
        attempt_id: intent.attempt_id,
        block_number: intent.source_block_number,
        block_hash: intent.source_block_hash,
        status: "reserved"
      }
    ]
  };
}

async function claimActionAttempt(store, intent) {
  const key = `action:${intent.action_id}`;
  for (;;) {
    const existing = await store.get(key);
    if (!existing) {
      const record = createReservedAction(intent, null);
      const inserted = await store.putIfAbsent(key, record);
      if (inserted.inserted) return { claimed: true, record };
      continue;
    }
    validatePersistedAction(existing);

    if (existing.active_attempt?.attempt_id === intent.attempt_id) {
      return {
        claimed: false,
        status: "duplicate-action",
        reason: "snapshot-attempt-already-recorded",
        record: existing
      };
    }
    if (existing.state !== "confirmed-revert") {
      return {
        claimed: false,
        status: "manual-reconciliation-required",
        reason: `prior-action-${existing.state}`,
        record: existing
      };
    }
    if (
      BigInt(intent.source_block_number) <=
      BigInt(existing.active_attempt.block_number)
    ) {
      return {
        claimed: false,
        status: "reread-and-reevaluate",
        reason: "confirmed-revert-retry-requires-newer-block",
        record: existing
      };
    }

    const next = createReservedAction(intent, existing);
    const claimed = await store.compareAndSet(key, existing.revision, next);
    if (claimed.updated) return { claimed: true, record: next };
  }
}

async function finishActionAttempt(store, intent, state, outcome) {
  const key = `action:${intent.action_id}`;
  const existing = await store.get(key);
  if (existing) validatePersistedAction(existing);
  if (
    !existing ||
    existing.state !== "reserved" ||
    existing.active_attempt?.attempt_id !== intent.attempt_id
  ) {
    throw new Error("Advance action reservation changed before completion.");
  }
  const attempts = existing.attempts.map((attempt) =>
    attempt.attempt_id === intent.attempt_id
      ? { ...attempt, status: state }
      : attempt
  );
  const next = {
    ...existing,
    revision: existing.revision + 1,
    state,
    active_attempt: { ...existing.active_attempt, status: state },
    attempts,
    outcome: clone(outcome)
  };
  const updated = await store.compareAndSet(key, existing.revision, next);
  if (!updated.updated) {
    throw new Error("Advance action completion lost an atomic state race.");
  }
  return next;
}

export function createOrchestratorCore({
  readChainSnapshot,
  requestAdvance,
  store
}) {
  if (typeof readChainSnapshot !== "function") {
    throw new TypeError("readChainSnapshot must be a function.");
  }
  if (typeof requestAdvance !== "function") {
    throw new TypeError("requestAdvance must be a function.");
  }
  validateStore(store);

  async function recordRequest(input) {
    const request = validateRequestRecord(input);
    const record = {
      kind: "request",
      fingerprint: fingerprint(request),
      request
    };
    const saved = await store.putIfAbsent(`request:${request.request_id}`, record);
    if (saved.inserted) return { status: "recorded", request_id: request.request_id };
    validatePersistedRequest(saved.value);
    return {
      status:
        saved.value.fingerprint === record.fingerprint ? "duplicate" : "conflict",
      request_id: request.request_id
    };
  }

  async function recordResponse(input) {
    const response = validateResponseRecord(input);
    const request = await store.get(`request:${response.request_id}`);
    if (!request) {
      return { status: "orphan-rejected", request_id: response.request_id };
    }
    validatePersistedRequest(request);
    const record = {
      kind: "response-acknowledgement",
      fingerprint: fingerprint({ team: request.request.team, response }),
      team: request.request.team,
      response
    };
    assertPersistedResponseIdentity(record, request);
    const saved = await store.putIfAbsent(
      `response:${response.request_id}`,
      record
    );
    if (saved.inserted) return { status: "recorded", request_id: response.request_id };
    validatePersistedResponse(saved.value);
    return {
      status:
        saved.value.fingerprint === record.fingerprint ? "duplicate" : "conflict",
      request_id: response.request_id
    };
  }

  async function pendingRequests() {
    const requests = await store.entries("request:");
    const pending = [];
    for (const entry of requests) {
      validatePersistedRequest(entry.value);
      const requestId = entry.value.request.request_id;
      const response = await store.get(`response:${requestId}`);
      if (response) validatePersistedResponse(response);
      if (!response) {
        pending.push(clone(entry.value.request));
      }
    }
    return pending;
  }

  async function resume() {
    // Chain truth is deliberately read before persisted acknowledgements.
    const snapshot = normalizeChainSnapshot(await readChainSnapshot());
    const evaluation = evaluateChainSnapshot(snapshot);
    const pending = await pendingRequests();
    const actions = await store.entries("action:");
    for (const action of actions) validatePersistedAction(action.value);
    const responses = await store.entries("response:");
    for (const entry of responses) {
      validatePersistedResponse(entry.value);
      const request = await store.get(
        `request:${entry.value.response.request_id}`
      );
      if (!request) {
        throw new TypeError("Persisted response has no persisted request.");
      }
      assertPersistedResponseIdentity(entry.value, request);
    }
    return deepFreeze({
      snapshot,
      evaluation,
      pending_requests: pending,
      prior_actions: actions.map(({ value }) => value)
    });
  }

  async function advanceIfEligible() {
    const initial = normalizeChainSnapshot(await readChainSnapshot());
    const initialEvaluation = evaluateChainSnapshot(initial);
    if (!initialEvaluation.eligible) {
      return deepFreeze({
        status: initialEvaluation.status,
        reason: initialEvaluation.reason,
        snapshot: initial,
        evaluation: initialEvaluation
      });
    }

    // This second read is mandatory and must occur immediately before intent
    // reservation/submission. The core never accepts a caller-supplied reread.
    const preSubmit = normalizeChainSnapshot(await readChainSnapshot());
    const preSubmitEvaluation = evaluateChainSnapshot(preSubmit);
    if (!preSubmitEvaluation.eligible || !samePredicate(initial, preSubmit)) {
      return deepFreeze({
        status: "reread-and-reevaluate",
        reason: "stale-or-ineligible-pre-submit-snapshot",
        snapshot: preSubmit,
        evaluation: preSubmitEvaluation
      });
    }

    const intent = createAdvanceIntent(preSubmit, preSubmitEvaluation);
    const reservation = await claimActionAttempt(store, intent);
    if (!reservation.claimed) {
      return deepFreeze({
        status: reservation.status,
        reason: reservation.reason,
        intent
      });
    }

    let outcome;
    try {
      outcome = await requestAdvance(intent);
    } catch (error) {
      const candidateCode =
        typeof error?.code === "string" &&
        SAFE_REQUEST_REFERENCE.test(error.code) &&
        !/(?:private|secret|token|password|credential|authorization|bearer|github_pat|ghp_|sk-|mk_)/i.test(
          error.code
        )
          ? error.code
          : "ADVANCE_REQUEST_FAILED";
      await finishActionAttempt(store, intent, "submission-unknown", {
        status: "requester-error",
        code: candidateCode
      });
      return deepFreeze({
        status: "manual-reconciliation-required",
        reason: "advance-requester-outcome-unknown",
        intent
      });
    }

    try {
      requireRecord(outcome, "advance requester outcome");
      requireExactKeys(
        outcome,
        ["status"],
        ["reference"],
        "advance requester outcome"
      );
      if (
        ![
          "accepted",
          "confirmed-revert",
          "race-or-revert",
          "rejected-before-submit"
        ].includes(outcome.status)
      ) {
        throw new TypeError("advance requester outcome status is unsupported.");
      }
      const reference = validateNonSecretReference(outcome.reference);
      outcome = deepFreeze({ status: outcome.status, ...(reference && { reference }) });
    } catch {
      await finishActionAttempt(store, intent, "submission-unknown", {
        status: "invalid-requester-outcome"
      });
      return deepFreeze({
        status: "manual-reconciliation-required",
        reason: "invalid-advance-requester-outcome",
        intent
      });
    }

    const finalState = {
      accepted: "submission-accepted",
      "confirmed-revert": "confirmed-revert",
      "race-or-revert": "submission-unknown",
      "rejected-before-submit": "rejected-before-submit"
    }[outcome.status];
    await finishActionAttempt(store, intent, finalState, outcome);

    if (outcome.status !== "accepted") {
      return deepFreeze({
        status:
          outcome.status === "confirmed-revert"
            ? "reread-and-reevaluate"
            : outcome.status === "rejected-before-submit"
              ? "advance-rejected"
              : "manual-reconciliation-required",
        reason: outcome.status,
        intent
      });
    }
    return deepFreeze({
      status: "advance-requested",
      reason: "eligible-current-chain-snapshot",
      intent,
      reference: outcome.reference ?? null
    });
  }

  return Object.freeze({
    recordRequest,
    recordResponse,
    pendingRequests,
    resume,
    advanceIfEligible
  });
}
