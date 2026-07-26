import {
  BASE_SEPOLIA_CHAIN_ID,
  TransferError,
  createRecipientDirectory,
  parseTransferRequest
} from "./index.mjs";
import { createLiveEthTransferSkill } from "./live.mjs";

export const CLI_ENV = Object.freeze({
  ownAlias: "GAMEPLAY_WALLET_ALIAS",
  openclawAddress: "OPENCLAW_1_WALLET_ADDRESS",
  hermesAddress: "HERMES_1_WALLET_ADDRESS",
  rpcUrl: "ALCHEMY_BASE_SEPOLIA_RPC_URL",
  privateKey: "GAMEPLAY_WALLET_PRIVATE_KEY"
});

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/;
const WEI = /^(?:0|[1-9][0-9]*)$/;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const PUBLIC_STATE_FIELDS = Object.freeze({
  expected_chain_id: "chain",
  chain_id: "chain",
  sender: "address",
  available_wei: "wei",
  required_wei: "wei",
  gas_reserve_wei: "wei",
  transaction_hash: "hash"
});

export async function runCli({
  argv = process.argv.slice(2),
  env = process.env,
  createSkill = createLiveEthTransferSkill,
  write = (line) => process.stdout.write(line)
} = {}) {
  let payload;
  let exitCode = 1;
  try {
    const command = commandFromArgv(argv);
    const request = parseTransferRequest(command);
    const ownAlias = env?.[CLI_ENV.ownAlias];
    if (ownAlias !== "openclaw-1" && ownAlias !== "hermes-1") {
      throw new TransferError(
        "OWN_ALIAS_INVALID",
        "The configured wallet alias is invalid."
      );
    }
    if (request.recipient_alias === ownAlias) {
      throw new TransferError(
        "SELF_TRANSFER_FORBIDDEN",
        "Transfers to the executing wallet alias are forbidden."
      );
    }

    const recipientDirectory = createRecipientDirectory({
      "openclaw-1": env?.[CLI_ENV.openclawAddress],
      "hermes-1": env?.[CLI_ENV.hermesAddress]
    });
    const skill = await createSkill({
      recipientDirectory,
      rpcUrl: env?.[CLI_ENV.rpcUrl],
      expectedSenderAddress: recipientDirectory[ownAlias],
      env
    });
    const result = await skill.execute(command);
    payload = { ok: true, result: publicResult(result) };
    exitCode = 0;
  } catch (error) {
    payload = { ok: false, error: publicError(error) };
  }

  write(`${JSON.stringify(payload)}\n`);
  return exitCode;
}

export function commandFromArgv(argv) {
  if (
    !Array.isArray(argv) ||
    argv.length !== 5 ||
    argv[0] !== "Send" ||
    argv[1] !== "agent" ||
    argv[4] !== "ETH"
  ) {
    throw new TransferError(
      "CLI_ARGUMENTS_INVALID",
      "CLI arguments do not match the exact transfer grammar."
    );
  }
  return argv.join(" ");
}

function publicResult(result) {
  if (
    !result ||
    typeof result !== "object" ||
    result.status !== "confirmed" ||
    result.chain_id !== BASE_SEPOLIA_CHAIN_ID ||
    !ADDRESS.test(result.sender) ||
    (result.recipient_alias !== "openclaw-1" &&
      result.recipient_alias !== "hermes-1") ||
    !ADDRESS.test(result.recipient_address) ||
    typeof result.amount_eth !== "string" ||
    !DECIMAL.test(result.amount_eth) ||
    typeof result.amount_wei !== "string" ||
    !WEI.test(result.amount_wei) ||
    !HASH.test(result.transaction_hash) ||
    !Number.isSafeInteger(result.block_number) ||
    result.block_number < 0
  ) {
    throw new TransferError(
      "PUBLIC_RESULT_INVALID",
      "Transfer result was not safe to serialize."
    );
  }
  return {
    status: "confirmed",
    chain_id: BASE_SEPOLIA_CHAIN_ID,
    sender: result.sender.toLowerCase(),
    recipient_alias: result.recipient_alias,
    recipient_address: result.recipient_address.toLowerCase(),
    amount_eth: result.amount_eth,
    amount_wei: result.amount_wei,
    transaction_hash: result.transaction_hash.toLowerCase(),
    block_number: result.block_number
  };
}

function publicError(error) {
  if (!(error instanceof TransferError) || !ERROR_CODE.test(error.code)) {
    return {
      code: "INTERNAL_ERROR",
      retryable: false,
      public_state: {}
    };
  }
  return {
    code: error.code,
    retryable: false,
    public_state: sanitizePublicState(error.publicState)
  };
}

function sanitizePublicState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return {};
  const output = {};
  for (const [key, kind] of Object.entries(PUBLIC_STATE_FIELDS)) {
    const value = state[key];
    if (kind === "chain" && value === BASE_SEPOLIA_CHAIN_ID) {
      output[key] = value;
    } else if (kind === "address" && typeof value === "string" && ADDRESS.test(value)) {
      output[key] = value.toLowerCase();
    } else if (kind === "wei" && typeof value === "string" && WEI.test(value)) {
      output[key] = value;
    } else if (kind === "hash" && typeof value === "string" && HASH.test(value)) {
      output[key] = value.toLowerCase();
    }
  }
  return output;
}
