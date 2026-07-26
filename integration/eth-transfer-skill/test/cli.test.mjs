import assert from "node:assert/strict";
import test from "node:test";

import { CLI_ENV, commandFromArgv, runCli } from "../src/cli-lib.mjs";
import { TransferError } from "../src/index.mjs";

const OPENCLAW = "0x1111111111111111111111111111111111111111";
const HERMES = "0x2222222222222222222222222222222222222222";
const HASH = `0x${"33".repeat(32)}`;
const PRIVATE_KEY = `0x${"44".repeat(32)}`;
const RPC_SECRET = "secret-rpc-token";

function validEnv(overrides = {}) {
  return {
    [CLI_ENV.ownAlias]: "openclaw-1",
    [CLI_ENV.openclawAddress]: OPENCLAW,
    [CLI_ENV.hermesAddress]: HERMES,
    [CLI_ENV.rpcUrl]: `https://example.invalid/v2/${RPC_SECRET}`,
    [CLI_ENV.privateKey]: PRIVATE_KEY,
    ...overrides
  };
}

function outputCapture() {
  const lines = [];
  return {
    lines,
    write(line) {
      lines.push(line);
    }
  };
}

test("accepts only the exact five CLI tokens", () => {
  assert.equal(
    commandFromArgv(["Send", "agent", "hermes-1", "0.001", "ETH"]),
    "Send agent hermes-1 0.001 ETH"
  );
  for (const argv of [
    ["send", "agent", "hermes-1", "0.001", "ETH"],
    ["Send agent hermes-1 0.001 ETH"],
    ["Send", "agent", "hermes-1", "0.001", "eth"],
    ["Send", "agent", "hermes-1", "0.001", "ETH", "extra"]
  ]) {
    assert.throws(() => commandFromArgv(argv), TransferError);
  }
});

test("runs the live adapter contract and prints exactly one public result line", async () => {
  const output = outputCapture();
  const observed = {};
  const exitCode = await runCli({
    argv: ["Send", "agent", "hermes-1", "0.001", "ETH"],
    env: validEnv(),
    write: output.write,
    async createSkill(options) {
      observed.options = options;
      return {
        async execute(command) {
          observed.command = command;
          return {
            status: "confirmed",
            chain_id: 84532,
            sender: OPENCLAW,
            recipient_alias: "hermes-1",
            recipient_address: HERMES,
            amount_eth: "0.001",
            amount_wei: "1000000000000000",
            transaction_hash: HASH,
            block_number: 9
          };
        }
      };
    }
  });

  assert.equal(exitCode, 0);
  assert.equal(output.lines.length, 1);
  assert.equal(observed.command, "Send agent hermes-1 0.001 ETH");
  assert.deepEqual(observed.options.recipientDirectory, {
    "openclaw-1": OPENCLAW,
    "hermes-1": HERMES
  });
  assert.equal(observed.options.expectedSenderAddress, OPENCLAW);
  const rendered = output.lines[0];
  assert.equal(JSON.parse(rendered).ok, true);
  assert.doesNotMatch(rendered, new RegExp(PRIVATE_KEY.slice(2), "i"));
  assert.doesNotMatch(rendered, new RegExp(RPC_SECRET, "i"));
});

test("rejects self-transfer before constructing the live skill", async () => {
  const output = outputCapture();
  let constructed = false;
  const exitCode = await runCli({
    argv: ["Send", "agent", "openclaw-1", "0.001", "ETH"],
    env: validEnv(),
    write: output.write,
    async createSkill() {
      constructed = true;
    }
  });
  assert.equal(exitCode, 1);
  assert.equal(constructed, false);
  assert.equal(output.lines.length, 1);
  assert.equal(JSON.parse(output.lines[0]).error.code, "SELF_TRANSFER_FORBIDDEN");
});

test("prints one redacted public error for hostile failures and malformed env", async () => {
  for (const scenario of [
    {
      env: validEnv({ [CLI_ENV.hermesAddress]: "bad" }),
      createSkill: async () => {
        throw new Error("must not run");
      }
    },
    {
      env: validEnv(),
      createSkill: async () => {
        throw new Error(`leaked ${PRIVATE_KEY} ${RPC_SECRET}`);
      }
    }
  ]) {
    const output = outputCapture();
    const exitCode = await runCli({
      argv: ["Send", "agent", "hermes-1", "0.001", "ETH"],
      write: output.write,
      ...scenario
    });
    assert.equal(exitCode, 1);
    assert.equal(output.lines.length, 1);
    assert.equal(JSON.parse(output.lines[0]).ok, false);
    assert.doesNotMatch(output.lines[0], new RegExp(PRIVATE_KEY.slice(2), "i"));
    assert.doesNotMatch(output.lines[0], new RegExp(RPC_SECRET, "i"));
  }
});

test("whitelists public error state and drops unexpected secret-bearing fields", async () => {
  const output = outputCapture();
  await runCli({
    argv: ["Send", "agent", "hermes-1", "0.001", "ETH"],
    env: validEnv(),
    write: output.write,
    async createSkill() {
      return {
        async execute() {
          throw new TransferError("RECEIPT_STATE_UNKNOWN", "hostile", {
            chain_id: 84532,
            transaction_hash: HASH,
            private_key: PRIVATE_KEY,
            rpc_url: RPC_SECRET
          });
        }
      };
    }
  });
  const rendered = output.lines[0];
  assert.deepEqual(JSON.parse(rendered).error.public_state, {
    chain_id: 84532,
    transaction_hash: HASH
  });
  assert.doesNotMatch(rendered, new RegExp(PRIVATE_KEY.slice(2), "i"));
  assert.doesNotMatch(rendered, new RegExp(RPC_SECRET, "i"));
});
