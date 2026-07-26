import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { deriveEthereumAddress } from "../../game-bridge/src/index.js";
import { parseTransferRequest } from "../../eth-transfer-skill/src/index.mjs";

export const LIVE_TRANSFER_AUTHORIZATION =
  "AUTHORIZE_DILEMMAEVAL_TWO_SEAT_TRANSFER_DEMO";
export const VERIFIED_LIVE_BINDING_ATTESTATION =
  "OPERATOR_VERIFIED_CURRENT_MARITIME_DEPLOY_AND_CHAT_BINDING";
export const TRANSFER_COMMAND_SYNTAX = "Send agent <alias> <decimal> ETH";
export const WALLET_ENVIRONMENT_KEY = "GAMEPLAY_WALLET_PRIVATE_KEY";

export const IDENTICAL_AGENT_INSTRUCTIONS = Object.freeze([
  "Accept exactly: Send agent <alias> <decimal> ETH",
  "For an accepted command, use code execution exactly once: node /opt/dilemma-transfer/src/cli.mjs Send agent <alias> <decimal> ETH",
  "Return the helper's single JSON line without rewriting it.",
  "Reject amounts over the fixed maximum of 0.01 ETH.",
  "Resolve alias only from the supplied two-seat public alias directory.",
  "Send positive decimal ETH on Base Sepolia from only your assigned wallet.",
  "Reject unknown aliases, self-transfers, malformed amounts, and all other commands.",
  "Never reveal keys, tokens, RPC URLs, environment values, or seed material.",
  "Return only concise public transaction evidence or a concise error."
].join("\n"));

const PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const COMMAND =
  /^Send agent ([a-z0-9][a-z0-9-]{0,62}) ((?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?) ETH$/;
const ENV_KEYS = new Set([
  "MARITIME_API_KEY",
  "ALCHEMY_BASE_SEPOLIA_RPC_URL",
  "ALCHEMY_API_KEY",
  "PLAYER_WALLETS_DIRECTORY"
]);
const REQUIRED_ENV_KEYS = [
  "MARITIME_API_KEY",
  "ALCHEMY_BASE_SEPOLIA_RPC_URL",
  "PLAYER_WALLETS_DIRECTORY"
];
const MARITIME_KEY = /^mk_[A-Za-z0-9_-]{8,}$/;
const RAW_PRIVATE_KEY = /(?:0[xX])?[0-9a-fA-F]{64}/;
const SECRET_FIELD =
  /(private.?key|api.?key|rpc.?url|token|secret|password|mnemonic|seed|credential|authorization|environment|env)/i;

const SEATS = Object.freeze([
  Object.freeze({
    seat_id: "oc-1",
    alias: "openclaw-1",
    team: "openclaw",
    harness: "openclaw",
    maritime_agent: "dilemmaeval-pilot-openclaw",
    wallet_file: "openclaw-1.json"
  }),
  Object.freeze({
    seat_id: "hs-1",
    alias: "hermes-1",
    team: "hermes",
    harness: "hermes",
    maritime_agent: "dilemmaeval-pilot-hermes",
    wallet_file: "hermes-1.json"
  })
]);

export class TransferRunnerError extends Error {
  constructor(code, message, publicState = {}) {
    super(`${code}: ${message}`);
    this.name = "TransferRunnerError";
    this.code = code;
    this.publicState = deepFreeze(structuredClone(publicState));
  }
}

export function createMaritimeTransferRunner({
  secretRoot,
  fileSystem = { lstat, readFile },
  deriveAddress = deriveEthereumAddress,
  liveBinding
} = {}) {
  if (typeof secretRoot !== "string" || secretRoot.length === 0) {
    throw new TypeError("secretRoot must be a non-empty absolute path");
  }
  const root = resolve(secretRoot);
  if (root !== secretRoot) {
    throw new TypeError("secretRoot must be an absolute normalized path");
  }
  assertFileSystem(fileSystem);
  if (typeof deriveAddress !== "function") {
    throw new TypeError("deriveAddress must be a function");
  }
  if (
    liveBinding !== undefined &&
    (liveBinding === null ||
      typeof liveBinding !== "object" ||
      typeof liveBinding.execute !== "function")
  ) {
    throw new TypeError("liveBinding.execute must be a function when supplied");
  }

  return Object.freeze({
    async dryRun() {
      const loaded = await loadFixedInputs({
        root,
        fileSystem,
        deriveAddress
      });
      try {
        return buildPublicPlan(loaded.publicWallets);
      } finally {
        loaded.clear();
      }
    },

    async executeLive({ authorization, bindingAttestation, senderAlias, command } = {}) {
      if (authorization !== LIVE_TRANSFER_AUTHORIZATION) {
        throw fail(
          "LIVE_AUTHORIZATION_REQUIRED",
          "exact transfer-demo live authorization is required"
        );
      }
      if (bindingAttestation !== VERIFIED_LIVE_BINDING_ATTESTATION) {
        throw fail(
          "LIVE_BINDING_ATTESTATION_REQUIRED",
          "operator verification of the current Maritime deploy/chat binding is required"
        );
      }
      if (!liveBinding) {
        throw fail(
          "LIVE_BINDING_DEFERRED",
          "the current Maritime deploy/chat binding has not been injected"
        );
      }

      const loaded = await loadFixedInputs({
        root,
        fileSystem,
        deriveAddress
      });
      let plan;
      let transfer;
      let secretAccess;
      let bindingResult;

      try {
        plan = buildPublicPlan(loaded.publicWallets);
        transfer = parseTransferCommand({
          senderAlias,
          command,
          aliases: plan.alias_directory.map(({ alias }) => alias)
        });
        secretAccess = createOneRunSecretAccess(loaded);
        bindingResult = await liveBinding.execute({
          public_plan: plan,
          transfer,
          secret_access: secretAccess
        });
        assertPublicOutput(bindingResult);
      } catch (error) {
        if (
          error?.name === "MaritimeLiveBindingError" &&
          typeof error.code === "string" &&
          /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code) &&
          (error.transactionHash === null ||
            /^0x[0-9a-fA-F]{64}$/.test(error.transactionHash))
        ) {
          throw fail(
            "LIVE_TRANSFER_NOT_CONFIRMED",
            "the agent transfer was not confirmed; do not retry before chain reconciliation",
            {
              ambiguous_code: error.code,
              transaction_hash: error.transactionHash
            }
          );
        }
        throw fail(
          "LIVE_BINDING_FAILED",
          "the external binding failed; secret-bearing details were suppressed"
        );
      } finally {
        secretAccess?.clear();
        loaded.clear();
      }

      assertConfirmedBindingResult(bindingResult, transfer);
      return deepFreeze({
        schema_version: 1,
        status: "live-binding-completed",
        network: plan.network,
        alias_directory: plan.alias_directory,
        transfer,
        binding_result: bindingResult ?? null,
        secret_values_exposed: false
      });
    }
  });
}

export function parseTransferCommand({ senderAlias, command, aliases } = {}) {
  if (
    !Array.isArray(aliases) ||
    aliases.length !== 2 ||
    new Set(aliases).size !== 2 ||
    aliases.some((alias) => typeof alias !== "string")
  ) {
    throw new TypeError("aliases must contain exactly two distinct strings");
  }
  if (!aliases.includes(senderAlias)) {
    throw fail("UNKNOWN_SENDER_ALIAS", "sender alias is not in the public directory");
  }
  if (typeof command !== "string") {
    throw fail("INVALID_TRANSFER_COMMAND", `command must match: ${TRANSFER_COMMAND_SYNTAX}`);
  }
  const match = COMMAND.exec(command);
  if (!match) {
    throw fail("INVALID_TRANSFER_COMMAND", `command must match: ${TRANSFER_COMMAND_SYNTAX}`);
  }
  const [, recipientAlias, amountEth] = match;
  if (!aliases.includes(recipientAlias)) {
    throw fail(
      "UNKNOWN_RECIPIENT_ALIAS",
      "recipient alias is not in the public directory"
    );
  }
  if (recipientAlias === senderAlias) {
    throw fail("SELF_TRANSFER_REJECTED", "sender and recipient aliases must differ");
  }
  if (/^0(?:\.0+)?$/.test(amountEth)) {
    throw fail("INVALID_TRANSFER_AMOUNT", "decimal ETH amount must be positive");
  }
  let bounded;
  try {
    bounded = parseTransferRequest(command);
  } catch {
    throw fail(
      "INVALID_TRANSFER_AMOUNT",
      "decimal ETH amount must be positive and no more than 0.01 ETH"
    );
  }

  return deepFreeze({
    sender_alias: senderAlias,
    recipient_alias: recipientAlias,
    amount_eth: bounded.amount_eth,
    command
  });
}

async function loadFixedInputs({ root, fileSystem, deriveAddress }) {
  const walletsDirectory = resolve(root, "wallets");
  const envPath = resolve(root, "pilot.env");
  const walletPaths = SEATS.map((seat) =>
    resolve(walletsDirectory, seat.wallet_file)
  );

  await assertSecurePath(fileSystem, root, 0o700, "secret root");
  await assertSecurePath(fileSystem, walletsDirectory, 0o700, "wallet directory");
  await assertSecurePath(fileSystem, envPath, 0o600, "pilot.env");
  for (const [index, path] of walletPaths.entries()) {
    await assertSecurePath(
      fileSystem,
      path,
      0o600,
      `${SEATS[index].wallet_file}`
    );
  }

  const envSource = await safeRead(fileSystem, envPath, "pilot.env");
  const env = parsePilotEnvironment(envSource, walletsDirectory);
  let apiKey = env.MARITIME_API_KEY;
  let rpcUrl = env.ALCHEMY_BASE_SEPOLIA_RPC_URL;

  const walletSecrets = new Map();
  const publicWallets = [];
  const fingerprints = new Set();
  try {
    for (const [index, seat] of SEATS.entries()) {
      const source = await safeRead(
        fileSystem,
        walletPaths[index],
        seat.wallet_file
      );
      const wallet = parseWallet(source, seat, deriveAddress);
      const fingerprint = createHash("sha256")
        .update(wallet.privateKey)
        .digest("hex");
      if (fingerprints.has(fingerprint)) {
        throw fail(
          "DUPLICATE_WALLET_SECRET",
          "the two selected wallet files must contain distinct keys"
        );
      }
      if (
        publicWallets.some(
          ({ wallet_address }) => wallet_address === wallet.address
        )
      ) {
        throw fail(
          "DUPLICATE_WALLET_ADDRESS",
          "the two selected wallets must have distinct public addresses"
        );
      }
      fingerprints.add(fingerprint);
      walletSecrets.set(seat.seat_id, wallet.privateKey);
      publicWallets.push({
        ...seat,
        wallet_address: wallet.address
      });
    }
  } catch (error) {
    walletSecrets.clear();
    apiKey = undefined;
    rpcUrl = undefined;
    throw error;
  }

  return {
    publicWallets,
    takeApiKey() {
      const value = apiKey;
      apiKey = undefined;
      return value;
    },
    takeRpcUrl() {
      const value = rpcUrl;
      rpcUrl = undefined;
      return value;
    },
    takeWalletKey(seatId) {
      const value = walletSecrets.get(seatId);
      walletSecrets.delete(seatId);
      return value;
    },
    clear() {
      apiKey = undefined;
      rpcUrl = undefined;
      walletSecrets.clear();
    }
  };
}

function parsePilotEnvironment(source, expectedWalletsDirectory) {
  const values = {};
  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = /^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) {
      throw fail(
        "PILOT_ENV_INVALID",
        `pilot.env contains an invalid entry at line ${index + 1}`
      );
    }
    const [, key, rawValue] = match;
    const value =
      (rawValue.startsWith("\"") && rawValue.endsWith("\"")) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
        ? rawValue.slice(1, -1)
        : rawValue;
    if (!ENV_KEYS.has(key)) {
      throw fail("PILOT_ENV_UNKNOWN_FIELD", "pilot.env contains an unsupported field");
    }
    if (Object.hasOwn(values, key)) {
      throw fail("PILOT_ENV_DUPLICATE_FIELD", "pilot.env contains a duplicate field");
    }
    values[key] = value;
  }
  for (const key of REQUIRED_ENV_KEYS) {
    if (!Object.hasOwn(values, key) || values[key].length === 0) {
      throw fail("PILOT_ENV_MISSING_FIELD", "pilot.env is missing a required field");
    }
  }
  if (!MARITIME_KEY.test(values.MARITIME_API_KEY)) {
    throw fail("MARITIME_API_KEY_INVALID", "Maritime credential format is invalid");
  }
  if (resolve(values.PLAYER_WALLETS_DIRECTORY) !== expectedWalletsDirectory) {
    throw fail(
      "WALLET_DIRECTORY_MISMATCH",
      "PLAYER_WALLETS_DIRECTORY must select the fixed pilot wallets directory"
    );
  }
  assertAlchemyBaseSepoliaUrl(values.ALCHEMY_BASE_SEPOLIA_RPC_URL);
  if (
    Object.hasOwn(values, "ALCHEMY_API_KEY") &&
    (!/^[A-Za-z0-9_-]{8,}$/.test(values.ALCHEMY_API_KEY) ||
      new URL(values.ALCHEMY_BASE_SEPOLIA_RPC_URL).pathname
        .split("/")
        .filter(Boolean)
        .at(-1) !== values.ALCHEMY_API_KEY)
  ) {
    throw fail(
      "ALCHEMY_API_KEY_MISMATCH",
      "standalone Alchemy key must match the RPC URL"
    );
  }
  return values;
}

function assertAlchemyBaseSepoliaUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw fail("ALCHEMY_RPC_URL_INVALID", "Alchemy Base Sepolia RPC URL is invalid");
  }
  if (
    parsed.protocol !== "https:" ||
    !parsed.hostname.endsWith(".alchemy.com") ||
    !/^\/v2\/[A-Za-z0-9_-]{8,}$/.test(parsed.pathname) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw fail("ALCHEMY_RPC_URL_INVALID", "Alchemy Base Sepolia RPC URL is invalid");
  }
}

function parseWallet(source, seat, deriveAddress) {
  let input;
  try {
    input = JSON.parse(source);
  } catch {
    throw fail("WALLET_JSON_INVALID", `${seat.wallet_file} is not valid JSON`);
  }
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  ) {
    throw fail("WALLET_JSON_INVALID", `${seat.wallet_file} must contain one object`);
  }
  const expectedKeys = ["seat_id", "team", "address", "private_key"];
  if (
    Object.keys(input).length !== expectedKeys.length ||
    expectedKeys.some((key) => !Object.hasOwn(input, key))
  ) {
    throw fail(
      "WALLET_JSON_FIELDS_INVALID",
      `${seat.wallet_file} must contain only the approved wallet fields`
    );
  }
  const expectedWalletSeat =
    seat.seat_id === "oc-1" ? "openclaw-1" : "hermes-1";
  if (input.seat_id !== expectedWalletSeat || input.team !== seat.team) {
    throw fail(
      "WALLET_IDENTITY_MISMATCH",
      `${seat.wallet_file} does not match its fixed seat`
    );
  }
  if (typeof input.address !== "string" || !ADDRESS.test(input.address)) {
    throw fail(
      "WALLET_PUBLIC_ADDRESS_INVALID",
      `${seat.wallet_file} has an invalid public address`
    );
  }
  if (typeof input.private_key !== "string" || !PRIVATE_KEY.test(input.private_key)) {
    throw fail(
      "WALLET_SECRET_INVALID",
      `${seat.wallet_file} has invalid private-key format`
    );
  }
  let derived;
  try {
    derived = deriveAddress(input.private_key).toLowerCase();
  } catch {
    throw fail(
      "WALLET_SECRET_INVALID",
      `${seat.wallet_file} could not be derived locally`
    );
  }
  if (derived !== input.address.toLowerCase()) {
    throw fail(
      "WALLET_ADDRESS_MISMATCH",
      `${seat.wallet_file} public address does not match its locally derived address`
    );
  }
  return { address: derived, privateKey: input.private_key };
}

function buildPublicPlan(publicWallets) {
  const aliasDirectory = publicWallets.map(
    ({
      alias,
      seat_id,
      team,
      harness,
      maritime_agent,
      wallet_address
    }) => ({
      alias,
      seat_id,
      team,
      harness,
      maritime_agent,
      wallet_address
    })
  );
  return deepFreeze({
    schema_version: 1,
    plan_kind: "dilemmaeval.two-seat-transfer-chat-demo",
    mode: "dry-run",
    network: { name: "base-sepolia", chain_id: 84532 },
    alias_directory: aliasDirectory,
    agent_configuration: aliasDirectory.map(({ seat_id, maritime_agent }) => ({
      seat_id,
      maritime_agent,
      wallet_environment_key: WALLET_ENVIRONMENT_KEY,
      instructions: IDENTICAL_AGENT_INSTRUCTIONS
    })),
    chat_contract: {
      exact_command_syntax: TRANSFER_COMMAND_SYNTAX,
      decimal_places_max: 18,
      maximum_amount_eth: "0.01"
    },
    local_validation: {
      pilot_configuration_loaded: true,
      selected_wallet_files: ["openclaw-1.json", "hermes-1.json"],
      wallet_count: 2,
      addresses_derived_locally: true,
      supplied_addresses_match: true,
      private_keys_distinct: true,
      addresses_distinct: true,
      secret_values_exposed: false
    },
    live_gate: {
      status: "deferred_explicit_authorization",
      authorization_required: true,
      binding_attestation_required: true,
      injected_binding: "current_maritime_deploy_and_chat_binding"
    }
  });
}

function createOneRunSecretAccess(loaded) {
  let active = true;
  return Object.freeze({
    takeMaritimeApiKey() {
      assertActive(active);
      return loaded.takeApiKey();
    },
    takeAlchemyRpcUrl() {
      assertActive(active);
      return loaded.takeRpcUrl();
    },
    takeWalletPrivateKey(seatId) {
      assertActive(active);
      if (!SEATS.some((seat) => seat.seat_id === seatId)) {
        throw fail("UNKNOWN_SECRET_SEAT", "wallet secret requested for an unknown seat");
      }
      return loaded.takeWalletKey(seatId);
    },
    clear() {
      active = false;
      loaded.clear();
    }
  });
}

async function assertSecurePath(fileSystem, path, expectedMode, label) {
  let information;
  try {
    information = await fileSystem.lstat(path);
  } catch {
    throw fail("SECRET_PATH_UNAVAILABLE", `${label} is unavailable`);
  }
  if (
    !information ||
    typeof information.isSymbolicLink !== "function" ||
    information.isSymbolicLink()
  ) {
    throw fail("SECRET_PATH_UNSAFE", `${label} must not be a symbolic link`);
  }
  if ((information.mode & 0o777) !== expectedMode) {
    throw fail(
      "SECRET_PATH_PERMISSIONS_INVALID",
      `${label} must have mode ${expectedMode.toString(8)}`
    );
  }
}

async function safeRead(fileSystem, path, label) {
  try {
    return await fileSystem.readFile(path, "utf8");
  } catch {
    throw fail("SECRET_FILE_READ_FAILED", `${label} could not be read`);
  }
}

function assertFileSystem(fileSystem) {
  if (
    !fileSystem ||
    typeof fileSystem !== "object" ||
    typeof fileSystem.lstat !== "function" ||
    typeof fileSystem.readFile !== "function"
  ) {
    throw new TypeError("fileSystem must expose lstat and readFile functions");
  }
}

function assertActive(active) {
  if (!active) {
    throw fail("SECRET_ACCESS_CLOSED", "one-run secret access is closed");
  }
}

function assertConfirmedBindingResult(result, transfer) {
  if (
    !result ||
    result.status !== "confirmed" ||
    result.chain_id !== 84532 ||
    result.sender_alias !== transfer.sender_alias ||
    result.recipient_alias !== transfer.recipient_alias ||
    result.amount_eth !== transfer.amount_eth ||
    !/^0x[0-9a-fA-F]{40}$/.test(result.sender_address) ||
    !/^0x[0-9a-fA-F]{40}$/.test(result.recipient_address) ||
    !/^(?:0|[1-9][0-9]*)$/.test(result.amount_wei) ||
    !/^0x[0-9a-fA-F]{64}$/.test(result.transaction_hash) ||
    !Number.isSafeInteger(result.block_number) ||
    result.block_number < 0
  ) {
    throw fail(
      "LIVE_BINDING_RESULT_INVALID",
      "live binding did not return confirmed public transaction evidence"
    );
  }
}

function fail(code, message, publicState = {}) {
  return new TransferRunnerError(code, message, publicState);
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export function assertPublicOutput(value, path = "$") {
  if (typeof value === "string") {
    const approvedTransactionHash =
      path.endsWith(".transaction_hash") &&
      /^0x[0-9a-fA-F]{64}$/.test(value);
    if (RAW_PRIVATE_KEY.test(value) && !approvedTransactionHash) {
      throw fail("SECRET_OUTPUT_REJECTED", "output contains key-shaped text");
    }
    return true;
  }
  if (!value || typeof value !== "object") return true;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_FIELD.test(key) && !isSafePublicMetadata(key, child)) {
      throw fail("SECRET_OUTPUT_REJECTED", `output field at ${path} is not public`);
    }
    assertPublicOutput(child, `${path}.${key}`);
  }
  return true;
}

function isSafePublicMetadata(key, value) {
  return (
    (key === "secret_values_exposed" && value === false) ||
    (key === "private_keys_distinct" && value === true) ||
    (key === "wallet_environment_key" &&
      value === WALLET_ENVIRONMENT_KEY) ||
    (key === "authorization_required" && value === true)
  );
}
