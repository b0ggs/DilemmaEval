import assert from "node:assert/strict";
import test from "node:test";

import { createLiveEthTransferSkill } from "../src/live.mjs";

const KEY = `0x${"11".repeat(32)}`;
const RECIPIENT = "0x2222222222222222222222222222222222222222";
const SENDER = "0x3333333333333333333333333333333333333333";
const OPENCLAW = "0x5555555555555555555555555555555555555555";
const HASH = `0x${"44".repeat(32)}`;

test("reads the private key only from GAMEPLAY_WALLET_PRIVATE_KEY and constructs a local wallet", async () => {
  const observed = {};
  class FakeProvider {
    constructor(url, chainId, options) {
      Object.assign(observed, { url, chainId, options });
    }
    async send(method, params) {
      observed.rawChainChecks = (observed.rawChainChecks ?? 0) + 1;
      observed.rawMethod = method;
      observed.rawParams = params;
      return "0x14a34";
    }
    async getBalance() {
      return 10n ** 18n;
    }
    async getFeeData() {
      return { gasPrice: 1n };
    }
  }
  class FakeWallet {
    constructor(key, provider) {
      observed.key = key;
      observed.provider = provider;
    }
    async getAddress() {
      return SENDER;
    }
    async estimateGas() {
      return 21_000n;
    }
    async sendTransaction() {
      return {
        hash: HASH,
        async wait() {
          return { status: 1, blockNumber: 1 };
        }
      };
    }
  }
  const skill = await createLiveEthTransferSkill({
    recipientDirectory: {
      "openclaw-1": OPENCLAW,
      "hermes-1": RECIPIENT
    },
    rpcUrl: "https://base-sepolia.example.invalid/v2/redacted",
    env: { GAMEPLAY_WALLET_PRIVATE_KEY: KEY },
    ethersModule: { JsonRpcProvider: FakeProvider, Wallet: FakeWallet }
  });
  assert.equal(observed.key, undefined);
  // Wallet construction is deferred until execution; setup performs no signing.
  const result = await skill.execute("Send agent hermes-1 0.001 ETH");
  assert.equal(observed.key, KEY);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(KEY.slice(2), "i"));
  assert.equal(observed.chainId, undefined);
  assert.equal(observed.options, undefined);
  assert.equal(observed.rawMethod, "eth_chainId");
  assert.deepEqual(observed.rawParams, []);
  assert.equal(observed.rawChainChecks, 1);
});

test("checks raw eth_chainId freshly on every successful execution", async () => {
  let rawChecks = 0;
  class FakeProvider {
    async send(method) {
      assert.equal(method, "eth_chainId");
      rawChecks += 1;
      return "0x14a34";
    }
    async getBalance() {
      return 10n ** 18n;
    }
    async getFeeData() {
      return { gasPrice: 1n };
    }
  }
  class FakeWallet {
    async getAddress() {
      return SENDER;
    }
    async estimateGas() {
      return 21_000n;
    }
    async sendTransaction() {
      return {
        hash: HASH,
        async wait() {
          return { status: 1, blockNumber: rawChecks };
        }
      };
    }
  }
  const skill = await createLiveEthTransferSkill({
    recipientDirectory: {
      "openclaw-1": SENDER,
      "hermes-1": RECIPIENT
    },
    expectedSenderAddress: SENDER,
    rpcUrl: "https://base-sepolia.example.invalid/v2/redacted",
    env: { GAMEPLAY_WALLET_PRIVATE_KEY: KEY },
    ethersModule: { JsonRpcProvider: FakeProvider, Wallet: FakeWallet }
  });
  await skill.execute("Send agent hermes-1 0.0001 ETH");
  await skill.execute("Send agent hermes-1 0.0001 ETH");
  assert.equal(rawChecks, 2);
});

test("rejects missing keys and non-HTTPS or credential-bearing RPC URLs before loading ethers", async () => {
  for (const rpcUrl of [
    "http://example.invalid",
    "https://user:pass@example.invalid",
    "not-a-url"
  ]) {
    await assert.rejects(
      createLiveEthTransferSkill({
        recipientDirectory: {
          "openclaw-1": OPENCLAW,
          "hermes-1": RECIPIENT
        },
        rpcUrl,
        env: { GAMEPLAY_WALLET_PRIVATE_KEY: KEY },
        ethersModule: {}
      })
    );
  }
  await assert.rejects(
    createLiveEthTransferSkill({
      recipientDirectory: {
        "openclaw-1": OPENCLAW,
        "hermes-1": RECIPIENT
      },
      rpcUrl: "https://example.invalid",
      env: {},
      ethersModule: {}
    }),
    (error) => error.code === "GAMEPLAY_PRIVATE_KEY_MISSING"
  );
});

test("redacts RPC URLs when the runtime constructor throws", async () => {
  const rpcSecret = "alchemy-secret-value";
  class HostileProvider {
    constructor() {
      throw new Error(`failed for ${rpcSecret}`);
    }
  }
  await assert.rejects(
    createLiveEthTransferSkill({
      recipientDirectory: {
        "openclaw-1": OPENCLAW,
        "hermes-1": RECIPIENT
      },
      rpcUrl: `https://example.invalid/v2/${rpcSecret}`,
      env: { GAMEPLAY_WALLET_PRIVATE_KEY: KEY },
      ethersModule: { JsonRpcProvider: HostileProvider, Wallet: class {} }
    }),
    (error) => {
      assert.equal(error.code, "LIVE_RUNTIME_INITIALIZATION_FAILED");
      assert.doesNotMatch(JSON.stringify(error), new RegExp(rpcSecret, "i"));
      return true;
    }
  );
});
