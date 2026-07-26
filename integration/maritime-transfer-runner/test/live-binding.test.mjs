import assert from "node:assert/strict";
import test from "node:test";

import {
  MaritimeLiveBindingError,
  VERIFIED_MARITIME_SDK,
  createCurrentMaritimeLiveBinding
} from "../src/maritime-live-binding.mjs";

const OC_ADDRESS = "0xb9dab46bcd953eb2a3ab4d49a11f800e6be5f356";
const HS_ADDRESS = "0x6d241e69650c08c505ee19668cc251052e23056f";
const TX_HASH = `0x${"ab".repeat(32)}`;

function fixture(chatResponse) {
  const agents = new Map();
  const calls = { provision: [], fetch: [], chat: [] };
  const maritime = {
    agents: {
      async provision(input) {
        calls.provision.push(input);
        const isOc = input.template === "openclaw";
        const agent = {
          id: isOc
            ? "11111111-1111-4111-8111-111111111111"
            : "22222222-2222-4222-8222-222222222222",
          externalId: input.externalId,
          name: input.name,
          framework: input.template,
          status: "active"
        };
        agents.set(agent.id, agent);
        return agent;
      },
      async get(id) {
        return agents.get(id);
      },
      async listEnv() {
        return [
          {
            key: "GAMEPLAY_WALLET_PRIVATE_KEY",
            value: "••••••••",
            isSecret: true
          }
        ];
      },
      async chat(id, command) {
        calls.chat.push({ id, command });
        return { response: chatResponse, error: undefined };
      }
    }
  };
  return {
    calls,
    maritime,
    fetchImpl: async (url, init) => {
      calls.fetch.push({ url, init });
      return { status: url.endsWith("/files") ? 201 : 202 };
    }
  };
}

function input() {
  const instructions =
    "Accept exactly: Send agent <alias> <decimal> ETH";
  return {
    public_plan: {
      network: { chain_id: 84532 },
      alias_directory: [
        {
          alias: "openclaw-1",
          seat_id: "oc-1",
          harness: "openclaw",
          maritime_agent: "dilemmaeval-pilot-openclaw",
          wallet_address: OC_ADDRESS
        },
        {
          alias: "hermes-1",
          seat_id: "hs-1",
          harness: "hermes",
          maritime_agent: "dilemmaeval-pilot-hermes",
          wallet_address: HS_ADDRESS
        }
      ],
      agent_configuration: [
        {
          seat_id: "oc-1",
          instructions
        },
        {
          seat_id: "hs-1",
          instructions
        }
      ]
    },
    transfer: {
      sender_alias: "openclaw-1",
      recipient_alias: "hermes-1",
      amount_eth: "0.000001",
      command: "Send agent hermes-1 0.000001 ETH"
    },
    secret_access: {
      takeMaritimeApiKey: () => `mk_${"m".repeat(20)}`,
      takeWalletPrivateKey: (seat) =>
        seat === "oc-1" ? `0x${"11".repeat(32)}` : `0x${"22".repeat(32)}`
    }
  };
}

test("binding deploys both fixed agents and accepts exact confirmed evidence", async () => {
  const response = JSON.stringify({
    ok: true,
    result: {
      status: "confirmed",
      chain_id: 84532,
      sender: OC_ADDRESS,
      recipient_alias: "hermes-1",
      recipient_address: HS_ADDRESS,
      amount_eth: "0.000001",
      amount_wei: "1000000000000",
      transaction_hash: TX_HASH,
      block_number: 123
    }
  });
  const fake = fixture(response);
  const binding = createCurrentMaritimeLiveBinding({
    maritime: fake.maritime,
    sdkPolicy: VERIFIED_MARITIME_SDK,
    fetchImpl: fake.fetchImpl
  });

  const result = await binding.execute(input());

  assert.equal(result.status, "confirmed");
  assert.equal(result.transaction_hash, TX_HASH);
  assert.equal(fake.calls.provision.length, 2);
  assert.equal(fake.calls.fetch.length, 4);
  assert.equal(fake.calls.chat.length, 1);
  assert.equal(
    fake.calls.chat[0].command,
    "Send agent hermes-1 0.000001 ETH"
  );
  for (const provision of fake.calls.provision) {
    assert.equal(
      provision.env.find(
        ({ key }) => key === "GAMEPLAY_WALLET_PRIVATE_KEY"
      ).secret,
      true
    );
    assert.equal(
      provision.env.find(
        ({ key }) => key === "ALCHEMY_BASE_SEPOLIA_RPC_URL"
      ).value,
      "https://sepolia.base.org"
    );
  }
});

test("binding preserves only an approved ambiguous code and public hash", async () => {
  const fake = fixture(
    JSON.stringify({
      ok: false,
      error: {
        code: "RECEIPT_STATE_UNKNOWN",
        retryable: false,
        public_state: { transaction_hash: TX_HASH }
      }
    })
  );
  const binding = createCurrentMaritimeLiveBinding({
    maritime: fake.maritime,
    sdkPolicy: VERIFIED_MARITIME_SDK,
    fetchImpl: fake.fetchImpl
  });
  await assert.rejects(
    binding.execute(input()),
    (error) =>
      error instanceof MaritimeLiveBindingError &&
      error.code === "RECEIPT_STATE_UNKNOWN" &&
      error.transactionHash === TX_HASH
  );
});
