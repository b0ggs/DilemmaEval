import { PINNED_GAME_REVISION } from "../../game-bridge/src/index.js";
import {
  FROZEN_PROXY_CONFIG,
  assertNoSensitiveMaterial,
  assertResponseIdentity,
  createHarnessConfig,
  parseAndValidateResponse,
  renderHermesReference,
  renderOpenClawReference,
  validatePoke
} from "../../maritime-transport/src/index.mjs";

export const ADAPTER_CONTRACT_VERSION = 1;

export const PLAYER_OPERATION_ALLOWLIST = Object.freeze([
  "state",
  "wallet_auth_status",
  "register",
  "join",
  "prepare_commit",
  "commit",
  "reveal",
  "claim"
]);

export const READ_ONLY_OPERATION_ALLOWLIST = Object.freeze([
  "state",
  "wallet_auth_status"
]);

export const PLAYER_SIGNED_OPERATION_ALLOWLIST = Object.freeze([
  "register",
  "join",
  "prepare_commit",
  "commit",
  "reveal",
  "claim"
]);

export const UNAVOIDABLE_HARNESS_DIFFERENCES = deepFreeze([
  {
    field: "harness_identity",
    openclaw: "openclaw / team openclaw / seat prefix oc-",
    hermes: "hermes / team hermes / seat prefix hs-",
    fairness_impact: "none; identity routing only"
  },
  {
    field: "reference_configuration_encoding",
    openclaw: "custom OpenAI-compatible provider onboarding arguments",
    hermes: "Maritime Hermes inference environment names",
    fairness_impact:
      "none if live verification proves the same effective frozen profile"
  }
]);

const HARNESS_PROFILE = Object.freeze({
  openclaw: Object.freeze({
    team: "openclaw",
    seatPattern: /^oc-[1-5]$/,
    renderReference: renderOpenClawReference
  }),
  hermes: Object.freeze({
    team: "hermes",
    seatPattern: /^hs-[1-5]$/,
    renderReference: renderHermesReference
  })
});

const COMMAND_RESULT_KEYS = new Set([
  "schema_version",
  "operation",
  "command",
  "args",
  "exit_code",
  "signal",
  "stdout",
  "stderr",
  "parsed",
  "error"
]);

const PLAYER_OPERATIONS = new Set(PLAYER_OPERATION_ALLOWLIST);
const READ_ONLY_OPERATIONS = new Set(READ_ONLY_OPERATION_ALLOWLIST);
const PLAYER_SIGNED_OPERATIONS = new Set(PLAYER_SIGNED_OPERATION_ALLOWLIST);
const RAW_32_BYTE_VALUE = /(?<![0-9a-fA-F])(?:0[xX])?[0-9a-fA-F]{64}(?![0-9a-fA-F])/;
const RAW_32_BYTE_VALUE_GLOBAL =
  /(?<![0-9a-fA-F])(?:0[xX])?[0-9a-fA-F]{64}(?![0-9a-fA-F])/g;
const COMMIT_SECRET_TEXT = /\b(?:reveal[ _-]?)?salt\b\s*[:=]/i;
const PUBLIC_32_BYTE_FIELDS = new Set([
  "agentkey",
  "blockhash",
  "commitment",
  "metadatahash",
  "sourceblockhash",
  "transactionhash",
  "txhash"
]);

export function createOpenClawAdapter(options) {
  return createHarnessAdapter("openclaw", options);
}

export function createHermesAdapter(options) {
  return createHarnessAdapter("hermes", options);
}

export function createPairedHarnessAdapters({
  openclaw,
  hermes,
  ...unsupported
}) {
  rejectUnsupported(unsupported, "paired adapter");
  const pair = {
    openclaw: createOpenClawAdapter(openclaw),
    hermes: createHermesAdapter(hermes)
  };
  assertAdapterParity(pair.openclaw, pair.hermes);
  return Object.freeze(pair);
}

export function assertAdapterParity(openclawAdapter, hermesAdapter) {
  assertAdapterIdentity(openclawAdapter, "openclaw");
  assertAdapterIdentity(hermesAdapter, "hermes");

  const left = paritySnapshot(openclawAdapter.contract);
  const right = paritySnapshot(hermesAdapter.contract);
  if (stableStringify(left) !== stableStringify(right)) {
    throw new Error("ADAPTER_PARITY_MISMATCH");
  }
  return true;
}

export function validateCommandResult(result, expectedOperation) {
  assertPlainObject(result, "command result");
  assertExactKeys(result, COMMAND_RESULT_KEYS, COMMAND_RESULT_KEYS, "command result");
  if (result.schema_version !== 1) {
    throw new TypeError("command result.schema_version must equal 1");
  }
  if (!PLAYER_OPERATIONS.has(result.operation)) {
    throw new TypeError("command result.operation is not a player operation");
  }
  if (result.operation !== expectedOperation) {
    throw new Error(
      `COMMAND_RESULT_OPERATION_MISMATCH: expected ${expectedOperation}, received ${String(result.operation)}`
    );
  }
  if (typeof result.command !== "string" || result.command.length === 0) {
    throw new TypeError("command result.command must be a non-empty string");
  }
  if (
    !Array.isArray(result.args) ||
    result.args.some((argument) => typeof argument !== "string")
  ) {
    throw new TypeError("command result.args must contain only strings");
  }
  if (
    result.exit_code !== null &&
    (!Number.isInteger(result.exit_code) || result.exit_code < 0)
  ) {
    throw new TypeError("command result.exit_code must be null or an integer >= 0");
  }
  if (result.signal !== null && typeof result.signal !== "string") {
    throw new TypeError("command result.signal must be null or a string");
  }
  if (typeof result.stdout !== "string" || typeof result.stderr !== "string") {
    throw new TypeError("command result stdout/stderr must be strings");
  }
  if (result.error !== null) {
    assertPlainObject(result.error, "command result.error");
    assertExactKeys(
      result.error,
      new Set(["code", "message"]),
      new Set(["code", "message"]),
      "command result.error"
    );
    for (const field of ["code", "message"]) {
      if (typeof result.error[field] !== "string" || result.error[field].length === 0) {
        throw new TypeError(`command result.error.${field} must be a non-empty string`);
      }
    }
  }
  assertSafeCommandResultMaterial(result, expectedOperation);
  return sanitizeCommandResult(result);
}

function createHarnessAdapter(
  harness,
  {
    seatId,
    playerBridge,
    readOnlyBridge,
    ...unsupported
  } = {}
) {
  rejectUnsupported(unsupported, `${harness} adapter`);
  const profile = HARNESS_PROFILE[harness];
  if (!profile.seatPattern.test(seatId)) {
    throw new TypeError(
      `${harness} seatId must match ${profile.seatPattern.source}`
    );
  }
  if (!playerBridge || typeof playerBridge.run !== "function") {
    throw new TypeError("playerBridge.run must be a function");
  }
  if (!readOnlyBridge || typeof readOnlyBridge.run !== "function") {
    throw new TypeError("readOnlyBridge.run must be a function");
  }
  if (playerBridge === readOnlyBridge) {
    throw new TypeError(
      "playerBridge and readOnlyBridge must be distinct role-scoped objects"
    );
  }

  const harnessConfig = createHarnessConfig(harness);
  const contract = deepFreeze({
    schema_version: ADAPTER_CONTRACT_VERSION,
    harness,
    team: profile.team,
    seat_id: seatId,
    kit: {
      game_revision: PINNED_GAME_REVISION,
      operation_allowlist: [...PLAYER_OPERATION_ALLOWLIST],
      read_only_operation_allowlist: [...READ_ONLY_OPERATION_ALLOWLIST],
      player_signed_operation_allowlist: [
        ...PLAYER_SIGNED_OPERATION_ALLOWLIST
      ],
      command_result_schema:
        "https://dilemmaeval.local/schemas/command-result.schema.json"
    },
    model_route_and_settings: structuredClone(harnessConfig.effective),
    poke_schema: "https://dilemmaeval.local/schemas/poke.schema.json",
    response_schema:
      "https://dilemmaeval.local/schemas/agent-response.schema.json",
    transport_policy: {
      timeout_ms: FROZEN_PROXY_CONFIG.settings.timeout_ms,
      cancellation_grace_ms:
        FROZEN_PROXY_CONFIG.settings.cancellation_grace_ms,
      max_attempts: FROZEN_PROXY_CONFIG.settings.max_attempts,
      retry_delays_ms: [
        ...FROZEN_PROXY_CONFIG.settings.retry_delays_ms
      ]
    },
    signer_boundary: {
      private_key_source: "GAMEPLAY_WALLET_PRIVATE_KEY",
      private_key_owner: "assigned player environment",
      adapter_accepts_secret_material: false,
      player_signing_delegated: false,
      phase_advance_exposed: false,
      read_only_bridge_receives_player_signer: false,
      prepare_material_scope: "assigned-player-process-only"
    },
    installation_reference: profile.renderReference(),
    installation_reference_live_verify: true,
    unavoidable_difference_register: UNAVOIDABLE_HARNESS_DIFFERENCES
  });

  async function runGameOperation({
    seatId: requestedSeatId,
    operation,
    options,
    ...unknown
  }) {
    rejectUnsupported(unknown, "game operation request");
    assertOwnSeat(requestedSeatId, seatId);
    if (!PLAYER_OPERATIONS.has(operation)) {
      throw new Error(
        `OPERATION_NOT_ALLOWED: ${String(operation)} is outside the player adapter`
      );
    }
    assertPlainObject(options, "game operation options");
    assertNoSensitiveMaterial(options, "game_operation.options");
    assertOperationMaterialBoundary(operation, options);
    const bridge = READ_ONLY_OPERATIONS.has(operation)
      ? readOnlyBridge
      : playerBridge;
    const result = await bridge.run(operation, structuredClone(options));
    return deepFreeze(validateCommandResult(result, operation));
  }

  function acceptPoke(poke) {
    validateSharedSchemaPoke(poke);
    assertNoPrivateMaterialInCommunication(poke, "poke");
    assertNoPreparedMaterialInPoke(poke);
    assertOwnSeat(poke.seat_id, seatId);
    if (poke.team !== profile.team) {
      throw new Error(
        `POKE_TEAM_MISMATCH: expected ${profile.team}, received ${String(poke.team)}`
      );
    }
    return deepFreeze(structuredClone(poke));
  }

  function acceptResponse(poke, rawResponse) {
    const pokeSnapshot = acceptPoke(poke);
    const response = parseAndValidateResponse(rawResponse);
    assertNoPrivateMaterialInCommunication(response, "response");
    assertResponseIdentity(pokeSnapshot, response);
    assertOwnSeat(response.seat_id, seatId);
    return deepFreeze(structuredClone(response));
  }

  return Object.freeze({
    harness,
    team: profile.team,
    seatId,
    contract,
    acceptPoke,
    acceptResponse,
    runGameOperation
  });
}

function paritySnapshot(contract) {
  return {
    schema_version: contract.schema_version,
    kit: contract.kit,
    model_route_and_settings: contract.model_route_and_settings,
    poke_schema: contract.poke_schema,
    response_schema: contract.response_schema,
    transport_policy: contract.transport_policy,
    signer_boundary: contract.signer_boundary
  };
}

function assertAdapterIdentity(adapter, expectedHarness) {
  if (
    !adapter ||
    typeof adapter !== "object" ||
    adapter.harness !== expectedHarness ||
    !adapter.contract
  ) {
    throw new TypeError(`expected a ${expectedHarness} harness adapter`);
  }
}

function assertOwnSeat(requestedSeatId, seatId) {
  if (requestedSeatId !== seatId) {
    throw new Error(
      `CROSS_SEAT_REQUEST_REJECTED: expected ${seatId}, received ${String(requestedSeatId)}`
    );
  }
}

function assertSafeCommandResultMaterial(result, operation) {
  for (const [index, argument] of result.args.entries()) {
    rejectRaw32ByteText(argument, `command_result.args[${index}]`);
  }
  assertParsedMaterial(result.parsed, "command_result.parsed", {
    allowPrepareSalt: operation === "prepare_commit"
  });
  const credentialScan = structuredClone(result);
  credentialScan.stdout = redactRaw32ByteValues(credentialScan.stdout);
  credentialScan.stderr = redactRaw32ByteValues(credentialScan.stderr);
  if (credentialScan.error) {
    credentialScan.error.code = redactRaw32ByteValues(
      credentialScan.error.code
    );
    credentialScan.error.message = redactRaw32ByteValues(
      credentialScan.error.message
    );
  }
  // Parsed chain/tool output is checked by the operation-aware scanner above;
  // the transport validator cannot distinguish public bytes32 fields (agent
  // keys, commitments, transaction hashes) from private-key-shaped values.
  credentialScan.parsed = {};
  assertNoSensitiveMaterial(credentialScan, "command_result");
}

function assertOperationMaterialBoundary(operation, options) {
  if (operation === "prepare_commit") {
    if (
      !Object.hasOwn(options, "choice") ||
      (typeof options.choice !== "string" &&
        typeof options.choice !== "number" &&
        typeof options.choice !== "bigint")
    ) {
      throw new TypeError(
        "prepare_commit requires a player-local choice option"
      );
    }
    return;
  }
  for (const key of Object.keys(options)) {
    const normalized = normalizeName(key);
    if (
      normalized === "choice" ||
      normalized === "choicecode" ||
      normalized === "selectedchoice" ||
      normalized === "move"
    ) {
      throw new Error(
        `PLAYER_DECISION_MATERIAL_REJECTED: ${key} is prepare_commit-only`
      );
    }
  }
}

function validateSharedSchemaPoke(poke) {
  try {
    validatePoke(poke);
    return poke;
  } catch (originalError) {
    if (
      !poke ||
      typeof poke !== "object" ||
      !poke.team_chat ||
      !Array.isArray(poke.team_chat.messages) ||
      poke.team_chat.messages.length !== 0 ||
      !Number.isInteger(poke.team_chat.through_sequence) ||
      poke.team_chat.through_sequence < 1
    ) {
      throw originalError;
    }
    const compatibilityProbe = structuredClone(poke);
    compatibilityProbe.team_chat.through_sequence = 0;
    validatePoke(compatibilityProbe);
    return poke;
  }
}

function assertNoPreparedMaterialInPoke(poke) {
  scanKeys(poke.chain_state, "poke.chain_state", (key, path) => {
    const normalized = normalizeName(key);
    if (
      normalized === "choice" ||
      normalized === "choicecode" ||
      normalized === "selectedchoice" ||
      normalized === "move" ||
      normalized === "salt" ||
      normalized.endsWith("salt") ||
      normalized === "preparedcommit" ||
      normalized === "preparedcommitbundle"
    ) {
      throw new Error(`PLAYER_LOCAL_MATERIAL_REJECTED: ${path}`);
    }
  });
}

function assertNoPrivateMaterialInCommunication(value, path) {
  if (typeof value === "string") {
    const leaf = normalizeName(path.split(".").at(-1));
    if (leaf === "message" || leaf === "teammessage") {
      rejectRaw32ByteText(value, path);
      if (COMMIT_SECRET_TEXT.test(value)) {
        throw new Error(`PLAYER_LOCAL_MATERIAL_REJECTED: ${path}`);
      }
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assertNoPrivateMaterialInCommunication(child, `${path}.${key}`);
  }
}

function assertParsedMaterial(value, path, { allowPrepareSalt }) {
  if (typeof value === "string") {
    const leaf = normalizeName(path.split(".").at(-1));
    const permittedPublicDigest =
      PUBLIC_32_BYTE_FIELDS.has(leaf) ||
      (allowPrepareSalt && leaf === "salt");
    if (!permittedPublicDigest) rejectRaw32ByteText(value, path);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const normalized = normalizeName(key);
    if (
      normalized.includes("privatekey") ||
      normalized.includes("walletkey") ||
      normalized.includes("mnemonic") ||
      normalized === "secret" ||
      normalized.endsWith("secret") ||
      normalized.startsWith("seed") ||
      normalized.includes("token") ||
      normalized.includes("authorization") ||
      normalized.includes("apikey") ||
      normalized.includes("password") ||
      normalized.includes("passphrase") ||
      normalized.includes("credential") ||
      normalized.includes("cookie") ||
      normalized === "environment" ||
      normalized === "env" ||
      normalized === "environ"
    ) {
      throw new Error(`SENSITIVE_MATERIAL_REJECTED: ${path}.${key}`);
    }
    if (normalized.endsWith("salt") && !(allowPrepareSalt && normalized === "salt")) {
      throw new Error(`PLAYER_LOCAL_MATERIAL_REJECTED: ${path}.${key}`);
    }
    assertParsedMaterial(child, `${path}.${key}`, { allowPrepareSalt });
  }
}

function scanKeys(value, path, inspect) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    inspect(key, `${path}.${key}`);
    scanKeys(child, `${path}.${key}`, inspect);
  }
}

function rejectRaw32ByteText(value, path) {
  if (RAW_32_BYTE_VALUE.test(value)) {
    throw new Error(`PRIVATE_KEY_SHAPED_MATERIAL_REJECTED: ${path}`);
  }
}

function redactRaw32ByteValues(value) {
  return typeof value === "string"
    ? value.replace(RAW_32_BYTE_VALUE_GLOBAL, "[REDACTED_32_BYTE_VALUE]")
    : value;
}

function sanitizeCommandResult(result) {
  const sanitized = structuredClone(result);
  sanitized.stdout = redactRaw32ByteValues(sanitized.stdout);
  sanitized.stderr = redactRaw32ByteValues(sanitized.stderr);
  if (sanitized.error) {
    sanitized.error.code = redactRaw32ByteValues(sanitized.error.code);
    sanitized.error.message = redactRaw32ByteValues(sanitized.error.message);
  }
  return sanitized;
}

function normalizeName(value) {
  return String(value).toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

function rejectUnsupported(unsupported, label) {
  const keys = Object.keys(unsupported);
  if (keys.length > 0) {
    throw new TypeError(`unsupported ${label} option(s): ${keys.join(", ")}`);
  }
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertExactKeys(value, allowed, required, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new TypeError(`${label}.${key} is not allowed`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`${label}.${key} is required`);
    }
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
