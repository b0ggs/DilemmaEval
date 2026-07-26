import assert from "node:assert/strict";
import test from "node:test";

import {
  BASE_SEPOLIA_CHAIN_ID,
  MAX_TRANSFER_WEI,
  TransferError,
  createEthTransferSkill,
  createRecipientDirectory,
  decimalEthToWei,
  parseTransferRequest
} from "../src/index.mjs";

const SENDER = "0x1111111111111111111111111111111111111111";
const RECIPIENT = "0x2222222222222222222222222222222222222222";
const OPENCLAW = "0x3333333333333333333333333333333333333333";
const HASH = `0x${"ab".repeat(32)}`;
const SECRET = `0x${"cd".repeat(32)}`;

function runtime(overrides = {}) {
  const calls = [];
  const provider = {
    async getNetwork() {
      calls.push("network");
      return { chainId: BASE_SEPOLIA_CHAIN_ID };
    },
    async getBalance(address) {
      calls.push(["balance", address]);
      return 2n * 10n ** 18n;
    },
    async getFeeData() {
      calls.push("fee");
      return {
        maxFeePerGas: 2_000_000_000n,
        maxPriorityFeePerGas: 1_000_000_000n
      };
    },
    ...overrides.provider
  };
  const signer = {
    async getAddress() {
      calls.push("address");
      return SENDER;
    },
    async estimateGas(tx) {
      calls.push(["estimate", tx]);
      return 21_000n;
    },
    async sendTransaction(tx) {
      calls.push(["send", tx]);
      return {
        hash: HASH,
        async wait(confirmations) {
          calls.push(["wait", confirmations]);
          return { status: 1, blockNumber: 123 };
        }
      };
    },
    ...overrides.signer
  };
  const skill = createEthTransferSkill({
    recipientDirectory: {
      "openclaw-1": OPENCLAW,
      "hermes-1": RECIPIENT
    },
    provider,
    signerFactory: async () => signer,
    timeoutMs: overrides.timeoutMs ?? 1_000,
    ...overrides.skillOptions
  });
  return { calls, provider, signer, skill };
}

test("parses the exact command and structured grammar into wei", () => {
  assert.deepEqual(parseTransferRequest("Send agent hermes-1 0.001 ETH"), {
    action: "send_eth",
    amount_eth: "0.001",
    amount_wei: 1_000_000_000_000_000n,
    recipient_alias: "hermes-1"
  });
  assert.deepEqual(
    parseTransferRequest({
      action: "send_eth",
      amount_eth: "0.000000000000000001",
      recipient_alias: "openclaw-1"
    }).amount_wei,
    1n
  );
  assert.equal(decimalEthToWei("0.01"), MAX_TRANSFER_WEI);
});

test("rejects grammar variants, floats, zero, negatives, precision overflow, max overflow, and extras", () => {
  for (const input of [
    "send agent hermes-1 0.001 ETH",
    "Send agent stranger 0.001 ETH",
    "Send agent hermes-1 .1 ETH",
    "Send agent hermes-1 1e-3 ETH",
    "Send agent hermes-1 0 ETH",
    "Send agent hermes-1 -1 ETH",
    "Send agent hermes-1 0.0000000000000000001 ETH",
    "Send agent hermes-1 0.010000000000000001 ETH",
    {
      action: "send_eth",
      amount_eth: 0.001,
      recipient_alias: "hermes-1"
    },
    {
      action: "send_eth",
      amount_eth: "0.001",
      recipient_alias: "hermes-1",
      to: RECIPIENT
    }
  ]) {
    assert.throws(() => parseTransferRequest(input), TransferError);
  }
});

test("freezes a public alias directory and rejects arbitrary/duplicate addresses", () => {
  const directory = createRecipientDirectory({
    "openclaw-1": OPENCLAW,
    "hermes-1": RECIPIENT
  });
  assert.equal(Object.isFrozen(directory), true);
  assert.equal(directory["hermes-1"], RECIPIENT);
  assert.throws(
    () => createRecipientDirectory({ "openclaw-1": OPENCLAW }),
    TransferError
  );
  assert.throws(
    () =>
      createRecipientDirectory({
        "openclaw-1": OPENCLAW,
        stranger: RECIPIENT
      }),
    TransferError
  );
  assert.throws(
    () =>
      createRecipientDirectory({
        "openclaw-1": RECIPIENT,
        "hermes-1": RECIPIENT.toUpperCase().replace("0X", "0x")
      }),
    TransferError
  );
});

test("checks network, balance, gas and reserve before one send, then returns only public fields", async () => {
  const { calls, skill } = runtime();
  const result = await skill.execute("Send agent hermes-1 0.001 ETH");

  assert.deepEqual(result, {
    status: "confirmed",
    chain_id: BASE_SEPOLIA_CHAIN_ID,
    sender: SENDER,
    recipient_alias: "hermes-1",
    recipient_address: RECIPIENT,
    amount_eth: "0.001",
    amount_wei: "1000000000000000",
    transaction_hash: HASH,
    block_number: 123
  });
  assert.equal(calls.filter((entry) => Array.isArray(entry) && entry[0] === "send").length, 1);
  assert.deepEqual(
    calls.find((entry) => Array.isArray(entry) && entry[0] === "send")[1],
    {
      to: RECIPIENT,
      value: 1_000_000_000_000_000n,
      chainId: BASE_SEPOLIA_CHAIN_ID,
      gasLimit: 21_000n,
      type: 2,
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n
    }
  );
  assert.deepEqual(
    calls.find((entry) => Array.isArray(entry) && entry[0] === "estimate")[1],
    {
      to: RECIPIENT,
      value: 1_000_000_000_000_000n,
      chainId: BASE_SEPOLIA_CHAIN_ID,
      type: 2,
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n
    }
  );
  assert.equal(calls.at(-1)[0], "wait");
  assert.doesNotMatch(JSON.stringify(result), new RegExp(SECRET.slice(2), "i"));
});

test("fails closed on wrong chain and unknown aliases without sending", async () => {
  const wrong = runtime({ provider: { async getNetwork() { return { chainId: 1 }; } } });
  await assert.rejects(
    wrong.skill.execute("Send agent hermes-1 0.001 ETH"),
    (error) => error.code === "WRONG_CHAIN"
  );
  assert.equal(wrong.calls.some((entry) => Array.isArray(entry) && entry[0] === "send"), false);

  const unknown = runtime();
  await assert.rejects(
    unknown.skill.execute({
      action: "send_eth",
      amount_eth: "0.001",
      recipient_alias: "stranger"
    }),
    (error) => error.code === "RECIPIENT_ALIAS_INVALID"
  );
  assert.deepEqual(unknown.calls, []);
});

test("rejects a signing key that does not match the configured own address before sending", async () => {
  const calls = [];
  const provider = {
    async getNetwork() {
      return { chainId: BASE_SEPOLIA_CHAIN_ID };
    },
    async getBalance() {
      calls.push("balance");
      return 10n ** 18n;
    },
    async getFeeData() {
      calls.push("fee");
      return { gasPrice: 1n };
    }
  };
  const skill = createEthTransferSkill({
    recipientDirectory: {
      "openclaw-1": OPENCLAW,
      "hermes-1": RECIPIENT
    },
    provider,
    expectedSenderAddress: OPENCLAW,
    signerFactory: async () => ({
      async getAddress() {
        return SENDER;
      },
      async estimateGas() {
        calls.push("estimate");
        return 21_000n;
      },
      async sendTransaction() {
        calls.push("send");
      }
    })
  });
  await assert.rejects(
    skill.execute("Send agent hermes-1 0.001 ETH"),
    (error) => error.code === "SENDER_ADDRESS_MISMATCH"
  );
  assert.deepEqual(calls, []);
});

test("rejects self-transfer in the core even without CLI or expected-sender configuration", async () => {
  const { calls, skill } = runtime({
    signer: {
      async getAddress() {
        calls.push("address-self");
        return RECIPIENT;
      }
    }
  });
  await assert.rejects(
    skill.execute("Send agent hermes-1 0.001 ETH"),
    (error) => error.code === "SELF_TRANSFER_FORBIDDEN"
  );
  assert.equal(calls.some((entry) => Array.isArray(entry) && entry[0] === "send"), false);
  assert.equal(calls.includes("fee"), false);
});

test("the minimum gas reserve is immutable and cannot be overridden to zero", async () => {
  const amount = 1_000_000_000_000_000n;
  const gas = 21_000n * 2_000_000_000n;
  const { calls, skill } = runtime({
    provider: {
      async getBalance() {
        return amount + gas;
      }
    },
    skillOptions: { gasReserveWei: 0n }
  });
  await assert.rejects(
    skill.execute("Send agent hermes-1 0.001 ETH"),
    (error) =>
      error.code === "INSUFFICIENT_BALANCE" &&
      error.publicState.gas_reserve_wei === "50000000000000"
  );
  assert.equal(calls.some((entry) => Array.isArray(entry) && entry[0] === "send"), false);
});

test("refuses an insufficient balance including estimated gas and reserve", async () => {
  const { calls, skill } = runtime({
    provider: {
      async getBalance() {
        return 1_000_000_000_000_000n;
      }
    }
  });
  await assert.rejects(
    skill.execute("Send agent hermes-1 0.001 ETH"),
    (error) =>
      error.code === "INSUFFICIENT_BALANCE" &&
      error.retryable === false &&
      !JSON.stringify(error).includes(SECRET)
  );
  assert.equal(calls.some((entry) => Array.isArray(entry) && entry[0] === "send"), false);
});

test("never retries a send and reports uncertain receipt state with only the transaction hash", async () => {
  let sends = 0;
  const { skill } = runtime({
    signer: {
      async sendTransaction() {
        sends += 1;
        return {
          hash: HASH,
          async wait() {
            throw new Error(`provider leaked ${SECRET}`);
          }
        };
      }
    }
  });
  await assert.rejects(
    skill.execute("Send agent hermes-1 0.001 ETH"),
    (error) => {
      assert.equal(error.code, "RECEIPT_STATE_UNKNOWN");
      assert.equal(error.retryable, false);
      assert.deepEqual(error.publicState, {
        chain_id: BASE_SEPOLIA_CHAIN_ID,
        transaction_hash: HASH
      });
      assert.doesNotMatch(JSON.stringify(error), new RegExp(SECRET.slice(2), "i"));
      return true;
    }
  );
  assert.equal(sends, 1);
  await assert.rejects(
    skill.execute("Send agent hermes-1 0.001 ETH"),
    (error) => error.code === "TRANSFER_INSTANCE_LATCHED"
  );
  assert.equal(sends, 1);
});

test("latches permanently after an invalid post-send response", async () => {
  let sends = 0;
  const { skill } = runtime({
    signer: {
      async sendTransaction() {
        sends += 1;
        return { hash: "invalid", wait: async () => ({ status: 1, blockNumber: 1 }) };
      }
    }
  });
  await assert.rejects(
    skill.execute("Send agent hermes-1 0.001 ETH"),
    (error) => error.code === "SUBMISSION_RESPONSE_INVALID"
  );
  await assert.rejects(
    skill.execute("Send agent hermes-1 0.001 ETH"),
    (error) => error.code === "TRANSFER_INSTANCE_LATCHED"
  );
  assert.equal(sends, 1);
});

test("latches after sendTransaction throws because submission state may be unknown", async () => {
  let sends = 0;
  const { skill } = runtime({
    signer: {
      async sendTransaction() {
        sends += 1;
        throw new Error("connection closed after submission");
      }
    }
  });
  await assert.rejects(
    skill.execute("Send agent hermes-1 0.001 ETH"),
    (error) => error.code === "TRANSACTION_SUBMISSION_FAILED"
  );
  await assert.rejects(
    skill.execute("Send agent hermes-1 0.001 ETH"),
    (error) => error.code === "TRANSFER_INSTANCE_LATCHED"
  );
  assert.equal(sends, 1);
});

test("redacts hostile provider errors and times out without a send", async () => {
  const hostile = runtime({
    provider: {
      async getBalance() {
        throw new Error(`RPC ${SECRET}`);
      }
    }
  });
  await assert.rejects(hostile.skill.execute("Send agent hermes-1 0.001 ETH"), (error) => {
    assert.equal(error.code, "BALANCE_CHECK_FAILED");
    assert.doesNotMatch(JSON.stringify(error), new RegExp(SECRET.slice(2), "i"));
    return true;
  });

  const timed = runtime({
    timeoutMs: 100,
    provider: { getNetwork: () => new Promise(() => {}) }
  });
  await assert.rejects(
    timed.skill.execute("Send agent hermes-1 0.001 ETH"),
    (error) => error.code === "NETWORK_CHECK_FAILED"
  );
  assert.equal(timed.calls.some((entry) => Array.isArray(entry) && entry[0] === "send"), false);
});

test("serializes reverted receipts and malformed runtime responses without secrets", async () => {
  const reverted = runtime({
    signer: {
      async sendTransaction() {
        return {
          hash: HASH,
          async wait() {
            return { status: 0, blockNumber: 4, detail: SECRET };
          }
        };
      }
    }
  });
  await assert.rejects(reverted.skill.execute("Send agent hermes-1 0.001 ETH"), (error) => {
    assert.equal(error.code, "TRANSACTION_REVERTED");
    assert.doesNotMatch(JSON.stringify(error), new RegExp(SECRET.slice(2), "i"));
    return true;
  });
  await assert.rejects(
    reverted.skill.execute("Send agent hermes-1 0.001 ETH"),
    (error) => error.code === "TRANSFER_INSTANCE_LATCHED"
  );
});
