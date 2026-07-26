import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { deriveEthereumAddress } from "../../game-bridge/src/index.js";
import {
  IDENTICAL_AGENT_INSTRUCTIONS,
  LIVE_TRANSFER_AUTHORIZATION,
  TRANSFER_COMMAND_SYNTAX,
  VERIFIED_LIVE_BINDING_ATTESTATION,
  assertPublicOutput,
  createMaritimeTransferRunner,
  parseTransferCommand
} from "../src/index.mjs";

const OC_KEY = `0x${"11".repeat(32)}`;
const HS_KEY = `0x${"22".repeat(32)}`;
const CONFIRMED_BINDING_RESULT = Object.freeze({
  status: "confirmed",
  chain_id: 84532,
  sender_alias: "openclaw-1",
  sender_address: deriveEthereumAddress(OC_KEY).toLowerCase(),
  recipient_alias: "hermes-1",
  recipient_address: deriveEthereumAddress(HS_KEY).toLowerCase(),
  amount_eth: "0.001",
  amount_wei: "1000000000000000",
  transaction_hash: `0x${"ab".repeat(32)}`,
  block_number: 123
});

async function secretFixture({
  ocKey = OC_KEY,
  hsKey = HS_KEY,
  ocAddress = deriveEthereumAddress(ocKey),
  hsAddress = deriveEthereumAddress(hsKey),
  env = {},
  extraWallet = false
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "maritime-transfer-runner-"));
  const wallets = join(root, "wallets");
  await mkdir(wallets, { mode: 0o700 });
  await chmod(root, 0o700);
  const envValues = {
    MARITIME_API_KEY: `mk_${"a".repeat(20)}`,
    ALCHEMY_BASE_SEPOLIA_RPC_URL:
      `https://base-sepolia.g.alchemy.com/v2/${"b".repeat(20)}`,
    ALCHEMY_API_KEY: `${"b".repeat(20)}`,
    PLAYER_WALLETS_DIRECTORY: wallets,
    ...env
  };
  await writeFile(
    join(root, "pilot.env"),
    Object.entries(envValues)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n"),
    { mode: 0o600 }
  );
  for (const wallet of [
    {
      filename: "openclaw-1.json",
      seat_id: "openclaw-1",
      team: "openclaw",
      address: ocAddress,
      private_key: ocKey
    },
    {
      filename: "hermes-1.json",
      seat_id: "hermes-1",
      team: "hermes",
      address: hsAddress,
      private_key: hsKey
    }
  ]) {
    const { filename, ...contents } = wallet;
    await writeFile(join(wallets, filename), JSON.stringify(contents), {
      mode: 0o600
    });
  }
  if (extraWallet) {
    await writeFile(join(wallets, "openclaw-2.json"), "not read", {
      mode: 0o600
    });
  }
  return { root, wallets, envValues };
}

test("dry-run loads only pilot.env and the two fixed wallet files", async () => {
  const fixture = await secretFixture({ extraWallet: true });
  const reads = [];
  const fs = await import("node:fs/promises");
  const runner = createMaritimeTransferRunner({
    secretRoot: fixture.root,
    fileSystem: {
      lstat: fs.lstat,
      readFile: async (...args) => {
        reads.push(args[0]);
        return fs.readFile(...args);
      }
    }
  });

  const plan = await runner.dryRun();

  assert.deepEqual(
    reads.map((path) => path.slice(fixture.root.length + 1)),
    ["pilot.env", "wallets/openclaw-1.json", "wallets/hermes-1.json"]
  );
  assert.deepEqual(plan.local_validation.selected_wallet_files, [
    "openclaw-1.json",
    "hermes-1.json"
  ]);
  assert.equal(plan.local_validation.wallet_count, 2);
  assert.equal(Object.isFrozen(plan.alias_directory[0]), true);
});

test("derives matching public addresses and builds a public alias directory", async () => {
  const fixture = await secretFixture();
  const plan = await createMaritimeTransferRunner({
    secretRoot: fixture.root
  }).dryRun();

  assert.deepEqual(
    plan.alias_directory.map(({ alias, seat_id, maritime_agent }) => ({
      alias,
      seat_id,
      maritime_agent
    })),
    [
      {
        alias: "openclaw-1",
        seat_id: "oc-1",
        maritime_agent: "dilemmaeval-pilot-openclaw"
      },
      {
        alias: "hermes-1",
        seat_id: "hs-1",
        maritime_agent: "dilemmaeval-pilot-hermes"
      }
    ]
  );
  assert.equal(
    plan.alias_directory[0].wallet_address,
    deriveEthereumAddress(OC_KEY).toLowerCase()
  );
  assert.equal(
    plan.alias_directory[1].wallet_address,
    deriveEthereumAddress(HS_KEY).toLowerCase()
  );
  assert.equal(assertPublicOutput(plan), true);
});

test("agent instructions are concise and byte-identical for both harnesses", async () => {
  const fixture = await secretFixture();
  const plan = await createMaritimeTransferRunner({
    secretRoot: fixture.root
  }).dryRun();

  assert.equal(plan.agent_configuration.length, 2);
  assert.equal(
    plan.agent_configuration[0].instructions,
    plan.agent_configuration[1].instructions
  );
  assert.equal(
    plan.agent_configuration[0].instructions,
    IDENTICAL_AGENT_INSTRUCTIONS
  );
  assert.match(IDENTICAL_AGENT_INSTRUCTIONS, /Send agent <alias> <decimal> ETH/);
  assert.equal(plan.chat_contract.exact_command_syntax, TRANSFER_COMMAND_SYNTAX);
});

test("dry-run never invokes an injected live binding", async () => {
  const fixture = await secretFixture();
  let calls = 0;
  const runner = createMaritimeTransferRunner({
    secretRoot: fixture.root,
    liveBinding: {
      async execute() {
        calls += 1;
      }
    }
  });

  await runner.dryRun();
  assert.equal(calls, 0);
});

test("live execution fails before file reads without exact authorization", async () => {
  const fixture = await secretFixture();
  let reads = 0;
  const fs = await import("node:fs/promises");
  const runner = createMaritimeTransferRunner({
    secretRoot: fixture.root,
    fileSystem: {
      lstat: fs.lstat,
      readFile: async (...args) => {
        reads += 1;
        return fs.readFile(...args);
      }
    },
    liveBinding: { execute: async () => {} }
  });

  await assert.rejects(
    runner.executeLive({
      bindingAttestation: VERIFIED_LIVE_BINDING_ATTESTATION,
      senderAlias: "openclaw-1",
      command: "Send agent hermes-1 0.001 ETH"
    }),
    (error) => error.code === "LIVE_AUTHORIZATION_REQUIRED"
  );
  assert.equal(reads, 0);
});

test("live execution requires binding attestation and an injected binding", async () => {
  const fixture = await secretFixture();
  const withoutBinding = createMaritimeTransferRunner({
    secretRoot: fixture.root
  });

  await assert.rejects(
    withoutBinding.executeLive({
      authorization: LIVE_TRANSFER_AUTHORIZATION,
      senderAlias: "openclaw-1",
      command: "Send agent hermes-1 0.001 ETH"
    }),
    (error) => error.code === "LIVE_BINDING_ATTESTATION_REQUIRED"
  );
  await assert.rejects(
    withoutBinding.executeLive({
      authorization: LIVE_TRANSFER_AUTHORIZATION,
      bindingAttestation: VERIFIED_LIVE_BINDING_ATTESTATION,
      senderAlias: "openclaw-1",
      command: "Send agent hermes-1 0.001 ETH"
    }),
    (error) => error.code === "LIVE_BINDING_DEFERRED"
  );
});

test("authorized fake binding gets one-run secret capabilities, never public values", async () => {
  const fixture = await secretFixture();
  let received;
  const runner = createMaritimeTransferRunner({
    secretRoot: fixture.root,
    liveBinding: {
      async execute(input) {
        received = {
          public_plan: input.public_plan,
          transfer: input.transfer,
          apiKeyMatches:
            input.secret_access.takeMaritimeApiKey() ===
            fixture.envValues.MARITIME_API_KEY,
          rpcMatches:
            input.secret_access.takeAlchemyRpcUrl() ===
            fixture.envValues.ALCHEMY_BASE_SEPOLIA_RPC_URL,
          ocMatches:
            input.secret_access.takeWalletPrivateKey("oc-1") === OC_KEY,
          hsMatches:
            input.secret_access.takeWalletPrivateKey("hs-1") === HS_KEY
        };
        return CONFIRMED_BINDING_RESULT;
      }
    }
  });

  const result = await runner.executeLive({
    authorization: LIVE_TRANSFER_AUTHORIZATION,
    bindingAttestation: VERIFIED_LIVE_BINDING_ATTESTATION,
    senderAlias: "openclaw-1",
    command: "Send agent hermes-1 0.001 ETH"
  });

  assert.equal(received.apiKeyMatches, true);
  assert.equal(received.rpcMatches, true);
  assert.equal(received.ocMatches, true);
  assert.equal(received.hsMatches, true);
  assert.equal(result.status, "live-binding-completed");
  assert.equal(
    result.binding_result.transaction_hash,
    CONFIRMED_BINDING_RESULT.transaction_hash
  );
  assert.equal(JSON.stringify(result).includes(OC_KEY), false);
  assert.equal(
    JSON.stringify(result).includes(fixture.envValues.MARITIME_API_KEY),
    false
  );
});

test("live execution rejects missing or malformed confirmation evidence", async () => {
  const fixture = await secretFixture();
  const runner = createMaritimeTransferRunner({
    secretRoot: fixture.root,
    liveBinding: { execute: async () => undefined }
  });
  await assert.rejects(
    runner.executeLive({
      authorization: LIVE_TRANSFER_AUTHORIZATION,
      bindingAttestation: VERIFIED_LIVE_BINDING_ATTESTATION,
      senderAlias: "openclaw-1",
      command: "Send agent hermes-1 0.001 ETH"
    }),
    (error) => error.code === "LIVE_BINDING_RESULT_INVALID"
  );
});

test("validates the exact transfer command and decimal amount", () => {
  const aliases = ["openclaw-1", "hermes-1"];
  const parsed = parseTransferCommand({
    senderAlias: "openclaw-1",
    command: "Send agent hermes-1 0.000001 ETH",
    aliases
  });
  assert.deepEqual(parsed, {
    sender_alias: "openclaw-1",
    recipient_alias: "hermes-1",
    amount_eth: "0.000001",
    command: "Send agent hermes-1 0.000001 ETH"
  });

  for (const command of [
    "send agent hermes-1 1 ETH",
    "Send agent hermes-1 1 eth",
    "Send agent hermes-1 1e-3 ETH",
    "Send agent hermes-1 0 ETH",
    "Send agent unknown 1 ETH",
    "Send agent openclaw-1 1 ETH",
    "Send 1 ETH to hermes-1",
    "Send agent hermes-1 0.010000000000000001 ETH",
    "Send agent hermes-1 100 ETH"
  ]) {
    assert.throws(
      () =>
        parseTransferCommand({
          senderAlias: "openclaw-1",
          command,
          aliases
        }),
      (error) => error instanceof Error,
      command
    );
  }
});

test("rejects wallet mismatches, duplicate keys, and unsafe permissions", async () => {
  const mismatched = await secretFixture({
    ocAddress: "0x3333333333333333333333333333333333333333"
  });
  await assert.rejects(
    createMaritimeTransferRunner({ secretRoot: mismatched.root }).dryRun(),
    (error) => error.code === "WALLET_ADDRESS_MISMATCH"
  );

  const duplicate = await secretFixture({ hsKey: OC_KEY });
  await assert.rejects(
    createMaritimeTransferRunner({ secretRoot: duplicate.root }).dryRun(),
    (error) => error.code === "DUPLICATE_WALLET_SECRET"
  );

  const unsafe = await secretFixture();
  await chmod(join(unsafe.root, "pilot.env"), 0o644);
  await assert.rejects(
    createMaritimeTransferRunner({ secretRoot: unsafe.root }).dryRun(),
    (error) => error.code === "SECRET_PATH_PERMISSIONS_INVALID"
  );
});

test("errors and public plans never reflect supplied secret values", async () => {
  const fixture = await secretFixture();
  const plan = await createMaritimeTransferRunner({
    secretRoot: fixture.root
  }).dryRun();
  const serialized = JSON.stringify(plan);
  for (const secret of [
    OC_KEY,
    HS_KEY,
    fixture.envValues.MARITIME_API_KEY,
    fixture.envValues.ALCHEMY_BASE_SEPOLIA_RPC_URL
  ]) {
    assert.equal(serialized.includes(secret), false);
  }

  const badEnv = await secretFixture({
    env: { MARITIME_API_KEY: `mk_${"x".repeat(20)}_bad value` }
  });
  await assert.rejects(
    createMaritimeTransferRunner({ secretRoot: badEnv.root }).dryRun(),
    (error) => {
      assert.equal(
        error.message.includes(badEnv.envValues.MARITIME_API_KEY),
        false
      );
      return error.code === "MARITIME_API_KEY_INVALID";
    }
  );
});

test("optional standalone Alchemy key must match the RPC URL", async () => {
  const fixture = await secretFixture({
    env: { ALCHEMY_API_KEY: `${"c".repeat(20)}` }
  });
  await assert.rejects(
    createMaritimeTransferRunner({ secretRoot: fixture.root }).dryRun(),
    (error) => error.code === "ALCHEMY_API_KEY_MISMATCH"
  );
});

test("accepts standard dotenv whitespace around the assignment operator", async () => {
  const fixture = await secretFixture();
  const envPath = join(fixture.root, "pilot.env");
  const source = await (await import("node:fs/promises")).readFile(envPath, "utf8");
  await writeFile(
    envPath,
    source.replace(
      `ALCHEMY_API_KEY=${fixture.envValues.ALCHEMY_API_KEY}`,
      `ALCHEMY_API_KEY = ${fixture.envValues.ALCHEMY_API_KEY}`
    ),
    { mode: 0o600 }
  );
  const plan = await createMaritimeTransferRunner({
    secretRoot: fixture.root
  }).dryRun();
  assert.equal(plan.local_validation.wallet_count, 2);
});
