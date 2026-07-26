import { deriveEthereumAddress } from "../../game-bridge/src/index.js";

const OC_KEY = `0x${"11".repeat(32)}`;
const HS_KEY = `0x${"22".repeat(32)}`;

export function publicManifest() {
  return {
    schema_version: 1,
    network: "base-sepolia",
    game_id: "two-seat-pilot",
    seats: [
      {
        seat_id: "oc-1",
        team: "openclaw",
        harness: "openclaw",
        maritime_agent: "dilemmaeval-pilot-openclaw",
        wallet_address: deriveEthereumAddress(OC_KEY)
      },
      {
        seat_id: "hs-1",
        team: "hermes",
        harness: "hermes",
        maritime_agent: "dilemmaeval-pilot-hermes",
        wallet_address: deriveEthereumAddress(HS_KEY)
      }
    ]
  };
}

export function sdkSpy({
  failAt,
  envOverride,
  agentIdOverride,
  agentOverride
} = {}) {
  const calls = [];
  const ids = {
    openclaw: "11111111-1111-4111-8111-111111111111",
    hermes: "22222222-2222-4222-8222-222222222222"
  };
  const agents = {
    async provision(input) {
      calls.push({ method: "provision", input });
      if (failAt === `provision:${input.template}`) throw new Error("secret");
      return {
        id: agentIdOverride ?? ids[input.template],
        externalId: input.externalId,
        name: input.name,
        framework: input.template,
        status: "deploying",
        ignored_secret_value: "must-not-be-returned",
        ...agentOverride
      };
    },
    async setEnv(id, key, value, options) {
      calls.push({
        method: "setEnv",
        id,
        key,
        value,
        options
      });
      if (failAt === `setEnv:${id}`) throw new Error(value);
      return { key, value: "[MASKED]", isSecret: true };
    },
    async reloadEnv(id) {
      calls.push({ method: "reloadEnv", id });
      if (failAt === `reloadEnv:${id}`) throw new Error("failed");
    },
    async listEnv(id) {
      calls.push({ method: "listEnv", id });
      if (failAt === `listEnv:${id}`) throw new Error("failed");
      return (
        envOverride ?? [
          {
            key: "GAMEPLAY_WALLET_PRIVATE_KEY",
            value: "••••••••",
            isSecret: true
          }
        ]
      );
    }
  };
  return { maritime: { agents }, calls };
}
