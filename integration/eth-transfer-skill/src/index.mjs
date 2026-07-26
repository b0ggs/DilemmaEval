export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const GAMEPLAY_PRIVATE_KEY_ENV = "GAMEPLAY_WALLET_PRIVATE_KEY";
export const MAX_TRANSFER_WEI = 10_000_000_000_000_000n; // 0.01 ETH
export const MIN_GAS_RESERVE_WEI = 50_000_000_000_000n; // 0.00005 ETH

const ETH_SCALE = 1_000_000_000_000_000_000n;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
export const RECIPIENT_ALIASES = Object.freeze(["openclaw-1", "hermes-1"]);
const ALIAS = /^(?:openclaw-1|hermes-1)$/;
const AMOUNT = /^(?:0|[1-9][0-9]*)(?:\.([0-9]{1,18}))?$/;
const COMMAND =
  /^Send agent (openclaw-1|hermes-1) ((?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?) ETH$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;

export class TransferError extends Error {
  constructor(code, message, publicState = {}) {
    super(message);
    this.name = "TransferError";
    this.code = code;
    this.retryable = false;
    this.publicState = Object.freeze({ ...publicState });
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: false,
      public_state: this.publicState
    };
  }
}

export function createRecipientDirectory(entries) {
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
    throw validationError("RECIPIENT_DIRECTORY_INVALID");
  }
  const pairs = Object.entries(entries);
  if (
    pairs.length !== RECIPIENT_ALIASES.length ||
    !RECIPIENT_ALIASES.every((alias) => Object.hasOwn(entries, alias))
  ) {
    throw validationError("RECIPIENT_DIRECTORY_INVALID");
  }

  const normalized = {};
  const seen = new Set();
  for (const [alias, address] of pairs) {
    if (!ALIAS.test(alias) || typeof address !== "string" || !ADDRESS.test(address)) {
      throw validationError("RECIPIENT_DIRECTORY_INVALID");
    }
    const lower = address.toLowerCase();
    if (seen.has(lower)) {
      throw validationError("RECIPIENT_DIRECTORY_DUPLICATE_ADDRESS");
    }
    seen.add(lower);
    normalized[alias] = lower;
  }
  return Object.freeze(normalized);
}

export function parseTransferRequest(input) {
  if (typeof input === "string") {
    const match = COMMAND.exec(input);
    if (!match) {
      throw validationError("COMMAND_GRAMMAR_INVALID");
    }
    return normalizeTransfer(match[2], match[1]);
  }

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw validationError("TRANSFER_REQUEST_INVALID");
  }
  const keys = Object.keys(input).sort();
  if (
    keys.length !== 3 ||
    keys[0] !== "action" ||
    keys[1] !== "amount_eth" ||
    keys[2] !== "recipient_alias" ||
    input.action !== "send_eth" ||
    typeof input.amount_eth !== "string" ||
    typeof input.recipient_alias !== "string"
  ) {
    throw validationError("TRANSFER_REQUEST_INVALID");
  }
  return normalizeTransfer(input.amount_eth, input.recipient_alias);
}

export function decimalEthToWei(value) {
  if (typeof value !== "string") {
    throw validationError("AMOUNT_INVALID");
  }
  const match = AMOUNT.exec(value);
  if (!match) {
    throw validationError("AMOUNT_INVALID");
  }
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * ETH_SCALE + BigInt(fraction.padEnd(18, "0") || "0");
}

export function weiToDecimalEth(value) {
  const wei = toNonNegativeBigInt(value, "AMOUNT_INVALID");
  const whole = wei / ETH_SCALE;
  const fraction = (wei % ETH_SCALE).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function createEthTransferSkill({
  recipientDirectory,
  provider,
  signerFactory,
  timeoutMs = 30_000,
  expectedSenderAddress
}) {
  const directory = createRecipientDirectory(recipientDirectory);
  assertRuntime(provider, signerFactory);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
    throw validationError("TIMEOUT_INVALID");
  }
  const reserve = MIN_GAS_RESERVE_WEI;
  if (
    expectedSenderAddress !== undefined &&
    (typeof expectedSenderAddress !== "string" || !ADDRESS.test(expectedSenderAddress))
  ) {
    throw validationError("EXPECTED_SENDER_INVALID");
  }
  const expectedSender = expectedSenderAddress?.toLowerCase();
  let inFlight = false;
  let latched = false;

  return Object.freeze({
    recipientDirectory: directory,
    async execute(input) {
      if (latched) {
        throw new TransferError(
          "TRANSFER_INSTANCE_LATCHED",
          "A prior send has uncertain post-submission state. Create a new instance only after operator verification."
        );
      }
      if (inFlight) {
        throw new TransferError(
          "TRANSFER_ALREADY_IN_PROGRESS",
          "A transfer is already in progress."
        );
      }
      inFlight = true;
      try {
        return await executeTransfer({
          input,
          directory,
          provider,
          signerFactory,
          timeoutMs,
          reserve,
          expectedSender,
          latch() {
            latched = true;
          },
          confirm() {
            latched = false;
          }
        });
      } finally {
        inFlight = false;
      }
    }
  });
}

async function executeTransfer({
  input,
  directory,
  provider,
  signerFactory,
  timeoutMs,
  reserve,
  expectedSender,
  latch,
  confirm
}) {
  const request = parseTransferRequest(input);
  const recipient = directory[request.recipient_alias];
  if (!recipient) {
    throw validationError("RECIPIENT_ALIAS_UNKNOWN");
  }

  const network = await guarded(
    () => provider.getNetwork(),
    timeoutMs,
    "NETWORK_CHECK_FAILED"
  );
  if (
    !network ||
    toChainId(network.chainId) !== BASE_SEPOLIA_CHAIN_ID
  ) {
    throw new TransferError(
      "WRONG_CHAIN",
      "The provider is not connected to Base Sepolia.",
      { expected_chain_id: BASE_SEPOLIA_CHAIN_ID }
    );
  }

  let signer;
  try {
    signer = await signerFactory(provider);
  } catch {
    throw new TransferError("SIGNER_INITIALIZATION_FAILED", "Local signer initialization failed.");
  }
  if (
    !signer ||
    typeof signer.getAddress !== "function" ||
    typeof signer.estimateGas !== "function" ||
    typeof signer.sendTransaction !== "function"
  ) {
    throw new TransferError("SIGNER_INITIALIZATION_FAILED", "Local signer initialization failed.");
  }

  const sender = await guarded(
    () => signer.getAddress(),
    timeoutMs,
    "SIGNER_ADDRESS_FAILED"
  );
  if (typeof sender !== "string" || !ADDRESS.test(sender)) {
    throw new TransferError("SIGNER_ADDRESS_INVALID", "Local signer returned an invalid address.");
  }
  if (expectedSender && sender.toLowerCase() !== expectedSender) {
    throw new TransferError(
      "SENDER_ADDRESS_MISMATCH",
      "The local signing key does not match the configured wallet alias."
    );
  }
  if (sender.toLowerCase() === recipient) {
    throw new TransferError(
      "SELF_TRANSFER_FORBIDDEN",
      "Transfers to the local signing wallet are forbidden."
    );
  }

  const transfer = Object.freeze({
    to: recipient,
    value: request.amount_wei,
    chainId: BASE_SEPOLIA_CHAIN_ID
  });
  const [balanceValue, feeData] = await Promise.all([
    guarded(() => provider.getBalance(sender), timeoutMs, "BALANCE_CHECK_FAILED"),
    guarded(() => provider.getFeeData(), timeoutMs, "FEE_CHECK_FAILED")
  ]);

  const balance = toNonNegativeBigInt(balanceValue, "BALANCE_RESPONSE_INVALID");
  const checkedFees = selectCheckedFees(feeData);
  const feeBoundTransfer = Object.freeze({
    ...transfer,
    ...checkedFees.transactionFields
  });
  const gasLimitValue = await guarded(
    () => signer.estimateGas(feeBoundTransfer),
    timeoutMs,
    "GAS_ESTIMATE_FAILED"
  );
  const gasLimit = toPositiveBigInt(gasLimitValue, "GAS_RESPONSE_INVALID");
  const gasBudget = gasLimit * checkedFees.budgetFeePerGas;
  const required = request.amount_wei + gasBudget + reserve;
  if (balance < required) {
    throw new TransferError(
      "INSUFFICIENT_BALANCE",
      "Balance is insufficient for the amount, estimated gas, and reserve.",
      {
        chain_id: BASE_SEPOLIA_CHAIN_ID,
        sender: sender.toLowerCase(),
        available_wei: balance.toString(),
        required_wei: required.toString(),
        gas_reserve_wei: reserve.toString()
      }
    );
  }

  const transaction = Object.freeze({
    ...feeBoundTransfer,
    gasLimit
  });
  let submitted;
  latch();
  try {
    submitted = await withTimeout(
      Promise.resolve().then(() => signer.sendTransaction(transaction)),
      timeoutMs
    );
  } catch (error) {
    const timedOut = error === TIMEOUT;
    throw new TransferError(
      timedOut ? "SUBMISSION_STATE_UNKNOWN" : "TRANSACTION_SUBMISSION_FAILED",
      timedOut
        ? "Transaction submission timed out; its chain state is unknown. Do not retry blindly."
        : "Transaction submission failed. Do not retry without confirming wallet state."
    );
  }
  if (
    !submitted ||
    typeof submitted.hash !== "string" ||
    !HASH.test(submitted.hash) ||
    typeof submitted.wait !== "function"
  ) {
    throw new TransferError(
      "SUBMISSION_RESPONSE_INVALID",
      "Transaction submission returned an invalid response. Do not retry blindly."
    );
  }

  const publicSubmitted = {
    chain_id: BASE_SEPOLIA_CHAIN_ID,
    transaction_hash: submitted.hash.toLowerCase()
  };
  let receipt;
  try {
    receipt = await withTimeout(Promise.resolve().then(() => submitted.wait(1)), timeoutMs);
  } catch {
    throw new TransferError(
      "RECEIPT_STATE_UNKNOWN",
      "Receipt confirmation failed or timed out. Do not retry blindly.",
      publicSubmitted
    );
  }
  if (
    !receipt ||
    receipt.status !== 1 ||
    !Number.isSafeInteger(Number(receipt.blockNumber)) ||
    Number(receipt.blockNumber) < 0
  ) {
    throw new TransferError(
      receipt?.status === 0 ? "TRANSACTION_REVERTED" : "RECEIPT_INVALID",
      receipt?.status === 0
        ? "The transaction was mined but reverted."
        : "The transaction receipt was invalid.",
      publicSubmitted
    );
  }

  confirm();
  return Object.freeze({
    status: "confirmed",
    chain_id: BASE_SEPOLIA_CHAIN_ID,
    sender: sender.toLowerCase(),
    recipient_alias: request.recipient_alias,
    recipient_address: recipient,
    amount_eth: request.amount_eth,
    amount_wei: request.amount_wei.toString(),
    transaction_hash: submitted.hash.toLowerCase(),
    block_number: Number(receipt.blockNumber)
  });
}

function normalizeTransfer(amountEth, recipientAlias) {
  if (!ALIAS.test(recipientAlias)) {
    throw validationError("RECIPIENT_ALIAS_INVALID");
  }
  const amountWei = decimalEthToWei(amountEth);
  if (amountWei <= 0n) {
    throw validationError("AMOUNT_MUST_BE_POSITIVE");
  }
  if (amountWei > MAX_TRANSFER_WEI) {
    throw validationError("AMOUNT_EXCEEDS_MAXIMUM");
  }
  return Object.freeze({
    action: "send_eth",
    amount_eth: weiToDecimalEth(amountWei),
    amount_wei: amountWei,
    recipient_alias: recipientAlias
  });
}

function selectCheckedFees(feeData) {
  if (!feeData || typeof feeData !== "object") {
    throw new TransferError("FEE_RESPONSE_INVALID", "Provider fee data was invalid.");
  }
  if (feeData.maxFeePerGas !== null && feeData.maxFeePerGas !== undefined) {
    const maxFeePerGas = toPositiveBigInt(
      feeData.maxFeePerGas,
      "FEE_RESPONSE_INVALID"
    );
    const maxPriorityFeePerGas = toNonNegativeBigInt(
      feeData.maxPriorityFeePerGas,
      "FEE_RESPONSE_INVALID"
    );
    if (maxPriorityFeePerGas > maxFeePerGas) {
      throw new TransferError("FEE_RESPONSE_INVALID", "Provider fee data was invalid.");
    }
    return {
      budgetFeePerGas: maxFeePerGas,
      transactionFields: Object.freeze({
        type: 2,
        maxFeePerGas,
        maxPriorityFeePerGas
      })
    };
  }
  const gasPrice = toPositiveBigInt(feeData.gasPrice, "FEE_RESPONSE_INVALID");
  return {
    budgetFeePerGas: gasPrice,
    transactionFields: Object.freeze({ type: 0, gasPrice })
  };
}

function assertRuntime(provider, signerFactory) {
  if (
    !provider ||
    typeof provider.getNetwork !== "function" ||
    typeof provider.getBalance !== "function" ||
    typeof provider.getFeeData !== "function" ||
    typeof signerFactory !== "function"
  ) {
    throw validationError("RUNTIME_INVALID");
  }
}

function toChainId(value) {
  try {
    return Number(BigInt(value));
  } catch {
    return NaN;
  }
}

function toNonNegativeBigInt(value, code) {
  try {
    const result = BigInt(value);
    if (result < 0n) throw new Error();
    return result;
  } catch {
    throw validationError(code);
  }
}

function toPositiveBigInt(value, code) {
  const result = toNonNegativeBigInt(value, code);
  if (result === 0n) throw validationError(code);
  return result;
}

function validationError(code) {
  return new TransferError(code, "Transfer request or runtime configuration is invalid.");
}

const TIMEOUT = Symbol("timeout");

async function withTimeout(promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(TIMEOUT), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function guarded(operation, timeoutMs, code) {
  try {
    return await withTimeout(Promise.resolve().then(operation), timeoutMs);
  } catch {
    throw new TransferError(code, "A required pre-submission check failed.");
  }
}
