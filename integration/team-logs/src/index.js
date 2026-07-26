import path from "node:path";
import * as defaultFs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { createHash } from "node:crypto";

const TEAMS = new Set(["openclaw", "hermes"]);
const PHASES = new Set(["join", "commit", "reveal", "claim"]);
const STATUSES = new Set(["submitted", "observed", "skipped", "error"]);
const SEAT_PATTERN = /^(oc|hs)-[1-5]$/;
const TX_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const SAFE_GAME_ID = /^[A-Za-z0-9._-]+$/;

export const DEFAULT_LIMITS = Object.freeze({
  maxMessageChars: 2_000,
  maxSnapshotChars: 8_000,
  maxHistoryMessages: 20
});

export class TeamLogConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "TeamLogConfigurationError";
    this.code = "INVALID_CONFIGURATION";
  }
}

export class TeamLogCorruptionError extends Error {
  constructor(message, file) {
    super(message);
    this.name = "TeamLogCorruptionError";
    this.code = "CORRUPT_LOG";
    this.file = file;
  }
}

export class TeamLogStore {
  #fs;
  #clock;
  #queue = Promise.resolve();
  #initialized = false;
  #seats;
  #decisions = new Map();
  #messageRecords = new Map();
  #acceptedLedgerKeys = new Set();
  #nextSequence = new Map([
    ["openclaw", 1],
    ["hermes", 1]
  ]);
  #recoveryCounter = 0;

  constructor({
    runtimeRoot,
    gameId,
    seats,
    limits = {},
    fs = defaultFs,
    clock = () => new Date()
  }) {
    if (typeof runtimeRoot !== "string" || runtimeRoot.length === 0) {
      throw new TeamLogConfigurationError("runtimeRoot must be a non-empty string");
    }
    if (
      typeof gameId !== "string" ||
      !SAFE_GAME_ID.test(gameId) ||
      gameId === "." ||
      gameId === ".."
    ) {
      throw new TeamLogConfigurationError("gameId is not safe for a runtime path");
    }
    if (!Array.isArray(seats) || seats.length === 0) {
      throw new TeamLogConfigurationError("seats must be a non-empty array");
    }

    this.runtimeRoot = path.resolve(runtimeRoot);
    this.gameId = gameId;
    this.directory = path.join(
      this.runtimeRoot,
      "runtime",
      "chat",
      this.gameId
    );
    this.paths = Object.freeze({
      openclaw: path.join(this.directory, "openclaw.jsonl"),
      hermes: path.join(this.directory, "hermes.jsonl"),
      ledger: path.join(this.directory, "acceptance-ledger.jsonl"),
      journal: path.join(this.directory, "acceptance-journal.jsonl")
    });
    this.limits = Object.freeze(validateLimits({ ...DEFAULT_LIMITS, ...limits }));
    this.#seats = freezeSeatMap(seats);
    this.#fs = fs;
    this.#clock = clock;
  }

  initialize() {
    return this.#enqueue(() => this.#initializeUnsafe());
  }

  acceptResponse(rawResponse, expected) {
    return this.#enqueue(async () => {
      await this.#initializeUnsafe();
      await this.#reconcileAllIntents();
      const receivedAt = isoTime(this.#clock);
      const parsed = parseResponse(rawResponse);
      if (!parsed.ok) {
        return this.#reject({
          receivedAt,
          expected,
          response: null,
          reason: parsed.reason
        });
      }

      const response = parsed.value;
      const schemaReason = validateAgentResponse(response);
      if (schemaReason) {
        return this.#reject({ receivedAt, expected, response, reason: schemaReason });
      }

      const contextReason = this.#validateContext(response, expected);
      if (contextReason) {
        return this.#reject({ receivedAt, expected, response, reason: contextReason });
      }

      const message = response.team_message;
      if (message !== undefined && message.length > this.limits.maxMessageChars) {
        return this.#reject({
          receivedAt,
          expected,
          response,
          reason: "MESSAGE_TOO_LONG"
        });
      }

      if (message !== undefined && message.length > 0 && likelyContainsSecret(message)) {
        return this.#reject({
          receivedAt,
          expected,
          response,
          reason: "LIKELY_SECRET_BEARING_MESSAGE"
        });
      }

      const decisionKey = decisionKeyFor(response.request_id, response.seat_id);
      const existing = this.#decisions.get(decisionKey);
      if (existing) {
        const reason = sameDecision(existing, response, expected.team)
          ? "DUPLICATE_REQUEST"
          : "REQUEST_ID_CONFLICT";
        return this.#reject({ receivedAt, expected, response, reason });
      }

      const acceptedMessage =
        message === undefined || message.length === 0 ? null : message;
      const intent = Object.freeze({
        schema_version: 1,
        kind: "acceptance_intent",
        received_at: receivedAt,
        game_id: response.game_id,
        round: response.round,
        phase: response.phase,
        team: expected.team,
        seat_id: response.seat_id,
        request_id: response.request_id,
        message: acceptedMessage,
        message_digest:
          typeof acceptedMessage === "string"
            ? digestMessage(acceptedMessage)
            : null,
        message_length:
          typeof acceptedMessage === "string" ? acceptedMessage.length : 0
      });

      // The journal is the write-ahead acceptance decision. If either materialized
      // append fails, initialization or the next queued operation reconciles it.
      await this.#appendJson(this.paths.journal, intent);
      this.#decisions.set(decisionKey, intent);
      const record = await this.#ensureIntentMaterialized(intent);

      return Object.freeze({
        accepted: true,
        reason: null,
        message_record: record
      });
    });
  }

  buildSnapshot({ seat_id: seatId, team }) {
    return this.#enqueue(async () => {
      await this.#initializeUnsafe();
      if (!TEAMS.has(team)) {
        throw new TeamLogConfigurationError("snapshot team must be openclaw or hermes");
      }
      if (this.#seats.get(seatId) !== team) {
        throw new TeamLogConfigurationError(
          "snapshot seat/team violates the immutable assignment"
        );
      }

      // Capture the cursor before the file read. Appends use this same queue, so
      // no later accepted message can enter this snapshot.
      const records = await this.#readJsonLines(this.paths[team]);
      for (const record of records) {
        validateStoredMessage(record);
        if (
          record.game_id !== this.gameId ||
          record.team !== team ||
          this.#seats.get(record.seat_id) !== team
        ) {
          throw new TeamLogCorruptionError(
            "snapshot source violates game or immutable team isolation",
            this.paths[team]
          );
        }
      }
      const throughSequence =
        records.length === 0 ? 0 : records[records.length - 1].sequence;
      const eligible = records.filter(
        (record) =>
          record.team === team &&
          Number.isInteger(record.sequence) &&
          record.sequence <= throughSequence
      );
      const messages = boundedLatest(eligible, this.limits);

      return Object.freeze({
        through_sequence: throughSequence,
        messages: messages.map((message) => Object.freeze({ ...message }))
      });
    });
  }

  #enqueue(task) {
    const result = this.#queue.then(task, task);
    this.#queue = result.catch(() => undefined);
    return result;
  }

  async #initializeUnsafe() {
    if (this.#initialized) return;
    this.#decisions.clear();
    this.#messageRecords.clear();
    this.#acceptedLedgerKeys.clear();
    this.#nextSequence = new Map([
      ["openclaw", 1],
      ["hermes", 1]
    ]);
    await this.#fs.mkdir(this.directory, { recursive: true });

    const recoveryEvents = [];
    const ledgerResult = await this.#recoverAndReadJsonl(
      this.paths.ledger,
      "acceptance-ledger"
    );
    recoveryEvents.push(...ledgerResult.recoveries);
    const journalResult = await this.#recoverAndReadJsonl(
      this.paths.journal,
      "acceptance-journal"
    );
    recoveryEvents.push(...journalResult.recoveries);

    for (const team of TEAMS) {
      const result = await this.#recoverAndReadJsonl(this.paths[team], team);
      recoveryEvents.push(...result.recoveries);
      const records = result.records;
      let previousSequence = 0;
      for (const record of records) {
        validateStoredMessage(record);
        if (
          !Number.isInteger(record.sequence) ||
          record.sequence <= previousSequence
        ) {
          throw new TeamLogCorruptionError(
            "stored team messages are not in increasing sequence order",
            this.paths[team]
          );
        }
        previousSequence = record.sequence;
        if (record.game_id !== this.gameId) {
          throw new TeamLogCorruptionError(
            `stored message has wrong game_id in ${this.directory}`,
            this.paths[team]
          );
        }
        const assignedTeam = this.#seats.get(record.seat_id);
        if (record.team !== team || assignedTeam !== team) {
          throw new TeamLogCorruptionError(
            "stored message violates immutable seat/team assignment",
            this.paths[team]
          );
        }
        const key = decisionKeyFor(record.request_id, record.seat_id);
        if (this.#messageRecords.has(key)) {
          throw new TeamLogCorruptionError(
            "stored team messages reuse a request_id and seat",
            this.paths[team]
          );
        }
        this.#messageRecords.set(key, record);
      }
      this.#nextSequence.set(team, previousSequence + 1);
    }

    const acceptedLedgerEntries = new Map();
    for (const entry of ledgerResult.records) {
      validateLedgerEntry(entry, this.gameId);
      if (entry.kind === "response_decision" && entry.accepted === true) {
        const key = decisionKeyFor(entry.request_id, entry.seat_id);
        if (this.#acceptedLedgerKeys.has(key)) {
          throw new TeamLogCorruptionError(
            "acceptance ledger contains duplicate accepted decisions",
            this.paths.ledger
          );
        }
        this.#acceptedLedgerKeys.add(key);
        acceptedLedgerEntries.set(key, entry);
      }
    }

    for (const intent of journalResult.records) {
      validateIntent(intent, this.gameId, this.#seats, this.paths.journal);
      const key = decisionKeyFor(intent.request_id, intent.seat_id);
      if (this.#decisions.has(key)) {
        throw new TeamLogCorruptionError(
          "acceptance journal reuses a request_id and seat",
          this.paths.journal
        );
      }
      this.#decisions.set(key, Object.freeze(intent));
    }

    // Upgrade/reconcile records produced before the write-ahead journal existed.
    for (const record of this.#messageRecords.values()) {
      const key = decisionKeyFor(record.request_id, record.seat_id);
      if (!this.#decisions.has(key)) {
        const intent = intentFromStoredRecord(record);
        validateIntent(intent, this.gameId, this.#seats, this.paths.journal);
        await this.#appendJson(this.paths.journal, intent);
        this.#decisions.set(key, intent);
      }
    }

    for (const [key, entry] of acceptedLedgerEntries) {
      if (!this.#decisions.has(key)) {
        const intent = intentFromLedgerEntry(entry);
        validateIntent(intent, this.gameId, this.#seats, this.paths.journal);
        await this.#appendJson(this.paths.journal, intent);
        this.#decisions.set(key, intent);
      }
    }

    for (const [key, entry] of acceptedLedgerEntries) {
      const intent = this.#decisions.get(key);
      const record = this.#messageRecords.get(key) ?? null;
      if (!acceptedLedgerMatchesIntent(entry, intent, record)) {
        throw new TeamLogCorruptionError(
          "accepted ledger decision conflicts with its journal/team evidence",
          this.paths.ledger
        );
      }
    }

    await this.#reconcileAllIntents();

    for (const recovery of recoveryEvents) {
      await this.#appendJson(this.paths.ledger, recovery);
    }
    this.#initialized = true;
  }

  async #recoverAndReadJsonl(file, label) {
    let content;
    try {
      content = await this.#fs.readFile(file, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") {
        await this.#fs.appendFile(file, "", "utf8");
        return { records: [], recoveries: [] };
      }
      throw error;
    }

    if (content === "" || content.endsWith("\n")) {
      return { records: parseCompleteLines(content, file), recoveries: [] };
    }

    const finalNewline = content.lastIndexOf("\n");
    const complete = finalNewline === -1 ? "" : content.slice(0, finalNewline + 1);
    const damaged = await this.#copyEvidenceExclusive(file, `${label}.damaged`);
    const recovered = await this.#writeEvidenceExclusive(
      complete,
      `${label}.recovered`
    );
    await this.#fs.writeFile(file, complete, "utf8");
    const recovery = Object.freeze({
      schema_version: 1,
      kind: "recovery",
      game_id: this.gameId,
      source: label,
      recovered_at: isoTime(this.#clock),
      damaged_file: path.basename(damaged),
      recovered_file: path.basename(recovered),
      canonical_file: path.basename(file),
      copied_complete_bytes: Buffer.byteLength(complete),
      preserved_trailing_bytes: Buffer.byteLength(content.slice(complete.length))
    });

    return {
      records: parseCompleteLines(complete, recovered),
      recoveries: [recovery]
    };
  }

  async #copyEvidenceExclusive(source, prefix) {
    for (;;) {
      const candidate = this.#nextRecoveryPath(prefix);
      try {
        await this.#fs.copyFile(source, candidate, fsConstants.COPYFILE_EXCL);
        return candidate;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
    }
  }

  async #writeEvidenceExclusive(content, prefix) {
    for (;;) {
      const candidate = this.#nextRecoveryPath(prefix);
      try {
        await this.#fs.writeFile(candidate, content, {
          encoding: "utf8",
          flag: "wx"
        });
        return candidate;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
    }
  }

  #nextRecoveryPath(prefix) {
    const recoveryId = recoveryToken(this.#clock, this.#recoveryCounter++);
    return path.join(this.directory, `${prefix}-${recoveryId}.jsonl`);
  }

  async #reconcileAllIntents() {
    for (const intent of this.#decisions.values()) {
      await this.#ensureIntentMaterialized(intent);
    }
  }

  async #ensureIntentMaterialized(intent) {
    const key = decisionKeyFor(intent.request_id, intent.seat_id);
    let record = this.#messageRecords.get(key) ?? null;
    const hasMessage = typeof intent.message === "string" && intent.message.length > 0;

    if (record) {
      if (!hasMessage || !storedRecordMatchesIntent(record, intent)) {
        throw new TeamLogCorruptionError(
          "journal intent conflicts with its stored team message",
          this.paths[intent.team]
        );
      }
    } else if (hasMessage) {
      record = Object.freeze({
        schema_version: 1,
        game_id: intent.game_id,
        round: intent.round,
        phase: intent.phase,
        team: intent.team,
        seat_id: intent.seat_id,
        sequence: this.#nextSequence.get(intent.team),
        received_at: intent.received_at,
        request_id: intent.request_id,
        message: intent.message
      });
      await this.#appendJson(this.paths[intent.team], record);
      this.#messageRecords.set(key, record);
      this.#nextSequence.set(intent.team, record.sequence + 1);
    }

    if (!this.#acceptedLedgerKeys.has(key)) {
      await this.#appendJson(
        this.paths.ledger,
        intentLedgerRecord(intent, record?.sequence ?? null)
      );
      this.#acceptedLedgerKeys.add(key);
    }

    return record;
  }

  async #readJsonLines(file, { missingIsEmpty = false } = {}) {
    let content;
    try {
      content = await this.#fs.readFile(file, "utf8");
    } catch (error) {
      if (missingIsEmpty && error?.code === "ENOENT") return [];
      throw error;
    }
    if (content !== "" && !content.endsWith("\n")) {
      throw new TeamLogCorruptionError("JSONL file ends in a partial line", file);
    }
    return parseCompleteLines(content, file);
  }

  async #appendJson(file, value) {
    try {
      await this.#fs.appendFile(file, `${JSON.stringify(value)}\n`, "utf8");
    } catch (error) {
      // A failed append may have written a prefix. Force the next queued
      // operation through recovery and journal reconciliation.
      this.#initialized = false;
      throw error;
    }
  }

  async #reject({ receivedAt, expected, response, reason }) {
    const safeExpected = normalizeExpectedForLedger(expected);
    await this.#appendJson(this.paths.ledger, {
      schema_version: 1,
      kind: "response_decision",
      received_at: receivedAt,
      request_id: safeText(response?.request_id, safeExpected.request_id),
      game_id: safeText(response?.game_id, safeExpected.game_id),
      round: safeInteger(response?.round, safeExpected.round),
      phase: safeText(response?.phase, safeExpected.phase),
      seat_id: safeText(response?.seat_id, safeExpected.seat_id),
      team: safeText(safeExpected.team),
      message: null,
      message_digest:
        typeof response?.team_message === "string"
          ? digestMessage(response.team_message)
          : null,
      message_length:
        typeof response?.team_message === "string"
          ? response.team_message.length
          : null,
      accepted: false,
      reason
    });
    return Object.freeze({ accepted: false, reason, message_record: null });
  }

  #validateContext(response, expected) {
    const expectedReason = validateExpected(expected);
    if (expectedReason) return expectedReason;

    const assignedTeam = this.#seats.get(expected.seat_id);
    if (assignedTeam === undefined) return "UNKNOWN_SEAT";
    if (assignedTeam !== expected.team) return "WRONG_TEAM";
    if (expected.game_id !== this.gameId) return "WRONG_GAME";
    if (response.request_id !== expected.request_id) return "MISMATCHED_REQUEST_ID";
    if (response.game_id !== expected.game_id) return "WRONG_GAME";
    if (response.round < expected.round) return "STALE_ROUND";
    if (response.round !== expected.round) return "WRONG_ROUND";
    if (response.phase !== expected.phase) return "WRONG_PHASE";
    if (response.seat_id !== expected.seat_id) return "WRONG_SEAT";
    return null;
  }
}

function validateLimits(limits) {
  for (const key of [
    "maxMessageChars",
    "maxSnapshotChars",
    "maxHistoryMessages"
  ]) {
    if (!Number.isInteger(limits[key]) || limits[key] < 1) {
      throw new TeamLogConfigurationError(`${key} must be a positive integer`);
    }
  }
  if (limits.maxHistoryMessages > 20) {
    throw new TeamLogConfigurationError("maxHistoryMessages cannot exceed 20");
  }
  if (limits.maxSnapshotChars < limits.maxMessageChars) {
    throw new TeamLogConfigurationError(
      "maxSnapshotChars cannot be smaller than maxMessageChars"
    );
  }
  return limits;
}

function freezeSeatMap(seats) {
  const map = new Map();
  for (const seat of seats) {
    if (
      !seat ||
      typeof seat !== "object" ||
      !SEAT_PATTERN.test(seat.seat_id ?? "") ||
      !TEAMS.has(seat.team)
    ) {
      throw new TeamLogConfigurationError("invalid seat/team assignment");
    }
    if (map.has(seat.seat_id)) {
      throw new TeamLogConfigurationError(`duplicate seat ${seat.seat_id}`);
    }
    if (
      (seat.seat_id.startsWith("oc-") && seat.team !== "openclaw") ||
      (seat.seat_id.startsWith("hs-") && seat.team !== "hermes")
    ) {
      throw new TeamLogConfigurationError(
        `seat prefix and team disagree for ${seat.seat_id}`
      );
    }
    map.set(seat.seat_id, seat.team);
  }
  return map;
}

function parseResponse(raw) {
  if (typeof raw === "string") {
    try {
      return { ok: true, value: JSON.parse(raw) };
    } catch {
      return { ok: false, reason: "MALFORMED_JSON" };
    }
  }
  return { ok: true, value: raw };
}

function validateAgentResponse(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "MALFORMED_RESPONSE";
  }
  const allowed = new Set([
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
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    return "MALFORMED_RESPONSE";
  }
  if (
    value.schema_version !== 1 ||
    typeof value.request_id !== "string" ||
    value.request_id.length === 0 ||
    typeof value.game_id !== "string" ||
    value.game_id.length === 0 ||
    !Number.isInteger(value.round) ||
    value.round < 0 ||
    !PHASES.has(value.phase) ||
    !SEAT_PATTERN.test(value.seat_id ?? "") ||
    !STATUSES.has(value.status)
  ) {
    return "MALFORMED_RESPONSE";
  }
  if (
    value.transaction_hash !== undefined &&
    value.transaction_hash !== null &&
    (typeof value.transaction_hash !== "string" ||
      !TX_PATTERN.test(value.transaction_hash))
  ) {
    return "MALFORMED_RESPONSE";
  }
  if (
    value.team_message !== undefined &&
    typeof value.team_message !== "string"
  ) {
    return "MALFORMED_RESPONSE";
  }
  if (
    value.error !== undefined &&
    value.error !== null &&
    (!value.error ||
      typeof value.error !== "object" ||
      Array.isArray(value.error) ||
      Object.keys(value.error).some(
        (key) => key !== "code" && key !== "message"
      ) ||
      typeof value.error.code !== "string" ||
      value.error.code.length === 0 ||
      typeof value.error.message !== "string" ||
      value.error.message.length === 0)
  ) {
    return "MALFORMED_RESPONSE";
  }
  return null;
}

function validateExpected(expected) {
  if (!expected || typeof expected !== "object") return "MALFORMED_EXPECTED";
  if (
    typeof expected.request_id !== "string" ||
    expected.request_id.length === 0 ||
    typeof expected.game_id !== "string" ||
    expected.game_id.length === 0 ||
    !Number.isInteger(expected.round) ||
    expected.round < 0 ||
    !PHASES.has(expected.phase) ||
    !SEAT_PATTERN.test(expected.seat_id ?? "") ||
    !TEAMS.has(expected.team)
  ) {
    return "MALFORMED_EXPECTED";
  }
  return null;
}

function normalizeExpectedForLedger(expected) {
  return expected && typeof expected === "object" ? expected : {};
}

function safeText(primary, fallback) {
  if (typeof primary === "string") return primary;
  return typeof fallback === "string" ? fallback : null;
}

function safeInteger(primary, fallback) {
  if (Number.isInteger(primary)) return primary;
  return Number.isInteger(fallback) ? fallback : null;
}

function intentLedgerRecord(intent, messageSequence) {
  return {
    schema_version: 1,
    kind: "response_decision",
    received_at: intent.received_at,
    request_id: intent.request_id,
    game_id: intent.game_id,
    round: intent.round,
    phase: intent.phase,
    seat_id: intent.seat_id,
    team: intent.team,
    message: intent.message,
    message_digest: intent.message_digest,
    message_length: intent.message_length,
    accepted: true,
    reason: null,
    message_sequence: messageSequence
  };
}

function decisionKeyFor(requestId, seatId) {
  return JSON.stringify([requestId, seatId]);
}

function sameDecision(intent, response, team) {
  const message =
    response.team_message === undefined || response.team_message.length === 0
      ? null
      : response.team_message;
  return (
    intent.game_id === response.game_id &&
    intent.round === response.round &&
    intent.phase === response.phase &&
    intent.team === team &&
    intent.seat_id === response.seat_id &&
    intent.message === message
  );
}

function intentFromStoredRecord(record) {
  return Object.freeze({
    schema_version: 1,
    kind: "acceptance_intent",
    received_at: record.received_at,
    game_id: record.game_id,
    round: record.round,
    phase: record.phase,
    team: record.team,
    seat_id: record.seat_id,
    request_id: record.request_id,
    message: record.message,
    message_digest: digestMessage(record.message),
    message_length: record.message.length
  });
}

function intentFromLedgerEntry(entry) {
  const message = typeof entry.message === "string" ? entry.message : null;
  if (message && likelyContainsSecret(message)) {
    throw new TeamLogCorruptionError(
      "legacy acceptance ledger contains likely secret-bearing message"
    );
  }
  return Object.freeze({
    schema_version: 1,
    kind: "acceptance_intent",
    received_at: entry.received_at,
    game_id: entry.game_id,
    round: entry.round,
    phase: entry.phase,
    team: entry.team,
    seat_id: entry.seat_id,
    request_id: entry.request_id,
    message,
    message_digest: message === null ? null : digestMessage(message),
    message_length: message === null ? 0 : message.length
  });
}

function storedRecordMatchesIntent(record, intent) {
  return (
    record.game_id === intent.game_id &&
    record.round === intent.round &&
    record.phase === intent.phase &&
    record.team === intent.team &&
    record.seat_id === intent.seat_id &&
    record.request_id === intent.request_id &&
    record.message === intent.message
  );
}

function validateIntent(intent, gameId, seats, file) {
  const exactKeys = new Set([
    "schema_version",
    "kind",
    "received_at",
    "game_id",
    "round",
    "phase",
    "team",
    "seat_id",
    "request_id",
    "message",
    "message_digest",
    "message_length"
  ]);
  if (
    !intent ||
    typeof intent !== "object" ||
    Array.isArray(intent) ||
    Object.keys(intent).length !== exactKeys.size ||
    Object.keys(intent).some((key) => !exactKeys.has(key)) ||
    intent.schema_version !== 1 ||
    intent.kind !== "acceptance_intent" ||
    intent.game_id !== gameId ||
    !Number.isInteger(intent.round) ||
    intent.round < 0 ||
    !PHASES.has(intent.phase) ||
    !TEAMS.has(intent.team) ||
    !SEAT_PATTERN.test(intent.seat_id ?? "") ||
    seats.get(intent.seat_id) !== intent.team ||
    typeof intent.request_id !== "string" ||
    intent.request_id.length === 0 ||
    !Number.isFinite(Date.parse(intent.received_at)) ||
    (intent.message !== null && typeof intent.message !== "string") ||
    (intent.message === null
      ? intent.message_digest !== null || intent.message_length !== 0
      : intent.message_digest !== digestMessage(intent.message) ||
        intent.message_length !== intent.message.length) ||
    (typeof intent.message === "string" &&
      intent.message.length > 0 &&
      likelyContainsSecret(intent.message))
  ) {
    throw new TeamLogCorruptionError("invalid acceptance journal intent", file);
  }
}

function validateLedgerEntry(entry, gameId) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new TeamLogCorruptionError("invalid acceptance ledger entry");
  }
  if (entry.schema_version !== 1) {
    throw new TeamLogCorruptionError("acceptance ledger entry has wrong schema");
  }
  if (entry.kind === "recovery") {
    if (entry.game_id !== gameId) {
      throw new TeamLogCorruptionError("recovery entry has wrong game");
    }
    return;
  }
  if (entry.kind !== "response_decision" || typeof entry.accepted !== "boolean") {
    throw new TeamLogCorruptionError("invalid response decision ledger entry");
  }
  if (
    entry.accepted &&
    (entry.reason !== null ||
      entry.game_id !== gameId ||
      !Number.isInteger(entry.round) ||
      entry.round < 0 ||
      !PHASES.has(entry.phase) ||
      !Number.isFinite(Date.parse(entry.received_at)) ||
      typeof entry.request_id !== "string" ||
      entry.request_id.length === 0 ||
      !SEAT_PATTERN.test(entry.seat_id ?? "") ||
      !TEAMS.has(entry.team) ||
      (entry.team === "openclaw" && !entry.seat_id.startsWith("oc-")) ||
      (entry.team === "hermes" && !entry.seat_id.startsWith("hs-")) ||
      (entry.message !== null && typeof entry.message !== "string") ||
      (typeof entry.message === "string" && likelyContainsSecret(entry.message)) ||
      (entry.message_digest !== undefined &&
        entry.message_digest !==
          (entry.message === null ? null : digestMessage(entry.message))) ||
      (entry.message_length !== undefined &&
        entry.message_length !==
          (entry.message === null ? 0 : entry.message.length)))
  ) {
    throw new TeamLogCorruptionError("invalid accepted ledger decision");
  }
  if (
    !entry.accepted &&
    (typeof entry.reason !== "string" ||
      entry.reason.length === 0 ||
      entry.message !== null ||
      (entry.request_id !== null && typeof entry.request_id !== "string") ||
      (entry.seat_id !== null &&
        entry.seat_id !== undefined &&
        typeof entry.seat_id !== "string") ||
      (entry.team !== null && entry.team !== undefined && typeof entry.team !== "string"))
  ) {
    throw new TeamLogCorruptionError("rejected ledger decision contains message text");
  }
}

function acceptedLedgerMatchesIntent(entry, intent, record) {
  if (!intent) return false;
  const expectedSequence = record?.sequence ?? null;
  return (
    entry.received_at === intent.received_at &&
    entry.game_id === intent.game_id &&
    entry.round === intent.round &&
    entry.phase === intent.phase &&
    entry.team === intent.team &&
    entry.seat_id === intent.seat_id &&
    entry.request_id === intent.request_id &&
    entry.message === intent.message &&
    (entry.message_digest === undefined ||
      entry.message_digest === intent.message_digest) &&
    (entry.message_length === undefined ||
      entry.message_length === intent.message_length) &&
    (entry.message_sequence === undefined ||
      entry.message_sequence === expectedSequence)
  );
}

function digestMessage(message) {
  return createHash("sha256").update(message, "utf8").digest("hex");
}

function likelyContainsSecret(message) {
  const patterns = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i,
    /\b(?:mk_|sk-|ghp_|github_pat_)[A-Za-z0-9_-]{12,}\b/i,
    /\b0x[0-9a-fA-F]{64}\b/,
    /\b[A-Z0-9_]*(?:PRIVATE_KEY|API_KEY|TOKEN|PASSWORD|SECRET)[A-Z0-9_]*\s*[:=]\s*\S+/i,
    /"[^"]*(?:private[_-]?key|api[_-]?key|token|password|secret)[^"]*"\s*:\s*"[^"]+"/i
  ];
  return patterns.some((pattern) => pattern.test(message));
}

function validateStoredMessage(record) {
  const keys = [
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
  ];
  if (
    !record ||
    typeof record !== "object" ||
    Array.isArray(record) ||
    Object.keys(record).length !== keys.length ||
    keys.some((key) => !(key in record)) ||
    record.schema_version !== 1 ||
    typeof record.game_id !== "string" ||
    !Number.isInteger(record.round) ||
    record.round < 0 ||
    !PHASES.has(record.phase) ||
    !TEAMS.has(record.team) ||
    !SEAT_PATTERN.test(record.seat_id ?? "") ||
    !Number.isInteger(record.sequence) ||
    record.sequence < 1 ||
    !Number.isFinite(Date.parse(record.received_at)) ||
    typeof record.request_id !== "string" ||
    record.request_id.length === 0 ||
    typeof record.message !== "string" ||
    likelyContainsSecret(record.message)
  ) {
    throw new TeamLogCorruptionError("invalid stored team message");
  }
}

function parseCompleteLines(content, file) {
  if (content === "") return [];
  const lines = content.endsWith("\n")
    ? content.slice(0, -1).split("\n")
    : content.split("\n");
  return lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new TeamLogCorruptionError(
        `invalid JSON on complete line ${index + 1}`,
        file
      );
    }
  });
}

function boundedLatest(records, limits) {
  const selected = [];
  let chars = 0;
  for (let index = records.length - 1; index >= 0; index -= 1) {
    if (selected.length >= limits.maxHistoryMessages) break;
    const record = records[index];
    if (record.message.length > limits.maxMessageChars) continue;
    if (chars + record.message.length > limits.maxSnapshotChars) continue;
    selected.push(record);
    chars += record.message.length;
  }
  return selected.reverse();
}

function isoTime(clock) {
  const value = clock();
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
    throw new TeamLogConfigurationError("clock must return a valid Date");
  }
  return value.toISOString();
}

function recoveryToken(clock, counter) {
  return `${isoTime(clock).replaceAll(/[^0-9A-Za-z]/g, "")}-${counter}`;
}
