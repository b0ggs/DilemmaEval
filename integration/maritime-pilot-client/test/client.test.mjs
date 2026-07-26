import assert from "node:assert/strict";
import test from "node:test";

import {
  LIVE_PILOT_AUTHORIZATION,
  VERIFIED_SDK_POLICY,
  WALLET_ENVIRONMENT_KEY,
  createMaritimePilotExecutor
} from "../src/index.mjs";
import { publicManifest, sdkSpy } from "./fixtures.mjs";

const OC_KEY = `0x${"11".repeat(32)}`;
const HS_KEY = `0x${"22".repeat(32)}`;

function secretProvider(overrides = {}) {
  const values = { "oc-1": OC_KEY, "hs-1": HS_KEY, ...overrides };
  const calls = [];
  return {
    calls,
    provider: async (seatId) => {
      calls.push(seatId);
      return values[seatId];
    }
  };
}

test("requires exact live authorization before secrets or SDK calls", async () => {
  const sdk = sdkSpy();
  const secrets = secretProvider();
  const executor = createMaritimePilotExecutor({
    maritime: sdk.maritime,
    secretProvider: secrets.provider,
    sdkPolicy: VERIFIED_SDK_POLICY
  });

  await assert.rejects(
    executor.execute({ manifest: publicManifest() }),
    (error) => error.code === "LIVE_AUTHORIZATION_REQUIRED"
  );
  assert.deepEqual(secrets.calls, []);
  assert.deepEqual(sdk.calls, []);
});

test("provisions stable SDK identities then isolates, reloads, and verifies secrets", async () => {
  const sdk = sdkSpy();
  const secrets = secretProvider();
  const executor = createMaritimePilotExecutor({
    maritime: sdk.maritime,
    secretProvider: secrets.provider,
    sdkPolicy: VERIFIED_SDK_POLICY
  });

  const result = await executor.execute({
    manifest: publicManifest(),
    authorization: LIVE_PILOT_AUTHORIZATION
  });

  assert.deepEqual(secrets.calls, ["oc-1", "hs-1"]);
  assert.deepEqual(
    sdk.calls.filter(({ method }) => method === "provision"),
    [
      {
        method: "provision",
        input: {
          externalId: "dilemmaeval-pilot-openclaw",
          name: "dilemmaeval-pilot-openclaw",
          template: "openclaw"
        }
      },
      {
        method: "provision",
        input: {
          externalId: "dilemmaeval-pilot-hermes",
          name: "dilemmaeval-pilot-hermes",
          template: "hermes"
        }
      }
    ]
  );
  const secretCalls = sdk.calls.filter(({ method }) => method === "setEnv");
  assert.equal(secretCalls.length, 2);
  assert.deepEqual(
    secretCalls.map(({ id, key, options }) => ({ id, key, options })),
    [
      {
        id: "11111111-1111-4111-8111-111111111111",
        key: WALLET_ENVIRONMENT_KEY,
        options: { secret: true }
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        key: WALLET_ENVIRONMENT_KEY,
        options: { secret: true }
      }
    ]
  );
  assert.equal(secretCalls[0].value, OC_KEY);
  assert.equal(secretCalls[1].value, HS_KEY);
  assert.equal(result.status, "two-seat-pilot-configured");
  assert.equal(result.wallet_environment.length, 2);
  assert.ok(result.wallet_environment.every((item) => item.secret === true));
  assert.equal(Object.isFrozen(result.wallet_environment[0]), true);
  assert.equal(JSON.stringify(result).includes(OC_KEY), false);
  assert.equal(JSON.stringify(result).includes(HS_KEY), false);
});

test("rejects malformed and duplicate wallet secrets before provisioning", async () => {
  for (const overrides of [
    { "oc-1": "not-a-private-key" },
    { "hs-1": OC_KEY }
  ]) {
    const sdk = sdkSpy();
    const secrets = secretProvider(overrides);
    const executor = createMaritimePilotExecutor({
      maritime: sdk.maritime,
      secretProvider: secrets.provider,
      sdkPolicy: VERIFIED_SDK_POLICY
    });
    await assert.rejects(
      executor.execute({
        manifest: publicManifest(),
        authorization: LIVE_PILOT_AUTHORIZATION
      }),
      (error) =>
        error.code === "PLAYER_SECRET_INVALID" ||
        error.code === "DUPLICATE_PLAYER_SECRET"
    );
    assert.deepEqual(sdk.calls, []);
  }
});

test("rejects a valid key assigned to the wrong public wallet before provisioning", async () => {
  const sdk = sdkSpy();
  const secrets = secretProvider();
  const manifest = publicManifest();
  manifest.seats[0].wallet_address =
    "0x3333333333333333333333333333333333333333";
  const executor = createMaritimePilotExecutor({
    maritime: sdk.maritime,
    secretProvider: secrets.provider,
    sdkPolicy: VERIFIED_SDK_POLICY
  });

  await assert.rejects(
    executor.execute({
      manifest,
      authorization: LIVE_PILOT_AUTHORIZATION
    }),
    (error) => error.code === "PLAYER_WALLET_ADDRESS_MISMATCH"
  );
  assert.deepEqual(sdk.calls, []);
});

test("secret provider errors never reflect their secret text", async () => {
  const sdk = sdkSpy();
  const marker = `0x${"aa".repeat(32)}`;
  const executor = createMaritimePilotExecutor({
    maritime: sdk.maritime,
    secretProvider: async () => {
      throw new Error(marker);
    },
    sdkPolicy: VERIFIED_SDK_POLICY
  });
  await assert.rejects(
    executor.execute({
      manifest: publicManifest(),
      authorization: LIVE_PILOT_AUTHORIZATION
    }),
    (error) => {
      assert.equal(JSON.stringify(error).includes(marker), false);
      assert.equal(error.message.includes(marker), false);
      return error.code === "PLAYER_SECRET_UNAVAILABLE";
    }
  );
});

test("ambiguous secret and reload writes stop without retry or deletion", async () => {
  for (const failAt of [
    "setEnv:11111111-1111-4111-8111-111111111111",
    "reloadEnv:11111111-1111-4111-8111-111111111111"
  ]) {
    const sdk = sdkSpy({ failAt });
    const secrets = secretProvider();
    const executor = createMaritimePilotExecutor({
      maritime: sdk.maritime,
      secretProvider: secrets.provider,
      sdkPolicy: VERIFIED_SDK_POLICY
    });
    await assert.rejects(
      executor.execute({
        manifest: publicManifest(),
        authorization: LIVE_PILOT_AUTHORIZATION
      }),
      (error) => {
        assert.equal(error.publicState.ambiguous_external_write, true);
        assert.equal(JSON.stringify(error).includes(OC_KEY), false);
        return true;
      }
    );
    assert.equal(
      sdk.calls.filter(({ method }) => method === "setEnv").length,
      1
    );
    assert.equal(
      sdk.calls.some(({ method }) => method === "delete"),
      false
    );
  }
});

test("partial provisioning reports only public recovery state", async () => {
  const sdk = sdkSpy({ failAt: "provision:hermes" });
  const secrets = secretProvider();
  const executor = createMaritimePilotExecutor({
    maritime: sdk.maritime,
    secretProvider: secrets.provider,
    sdkPolicy: VERIFIED_SDK_POLICY
  });
  await assert.rejects(
    executor.execute({
      manifest: publicManifest(),
      authorization: LIVE_PILOT_AUTHORIZATION
    }),
    (error) => {
      assert.equal(error.code, "MARITIME_PROVISION_FAILED");
      assert.equal(error.publicState.ambiguous_external_write, true);
      assert.deepEqual(error.publicState.agents, [
        {
          seat_id: "oc-1",
          harness: "openclaw",
          external_id: "dilemmaeval-pilot-openclaw",
          agent_id: "11111111-1111-4111-8111-111111111111",
          status: "deploying"
        }
      ]);
      assert.equal(JSON.stringify(error.publicState).includes(OC_KEY), false);
      return true;
    }
  );
});

test("unmasked or absent wallet environment fails closed", async () => {
  for (const envOverride of [
    [],
    [
      {
        key: WALLET_ENVIRONMENT_KEY,
        value: OC_KEY,
        isSecret: true
      }
    ],
    [
      {
        key: WALLET_ENVIRONMENT_KEY,
        value: "33".repeat(32),
        isSecret: true
      }
    ],
    [
      {
        key: WALLET_ENVIRONMENT_KEY,
        value: `0X${"44".repeat(32)}`,
        isSecret: true
      }
    ],
    [
      {
        key: WALLET_ENVIRONMENT_KEY,
        value: "plain-text-was-not-masked",
        isSecret: true
      }
    ],
    [
      {
        key: WALLET_ENVIRONMENT_KEY,
        value: "••••",
        isSecret: false
      }
    ]
  ]) {
    const sdk = sdkSpy({ envOverride });
    const secrets = secretProvider();
    const executor = createMaritimePilotExecutor({
      maritime: sdk.maritime,
      secretProvider: secrets.provider,
      sdkPolicy: VERIFIED_SDK_POLICY
    });
    await assert.rejects(
      executor.execute({
        manifest: publicManifest(),
        authorization: LIVE_PILOT_AUTHORIZATION
      }),
      /MARITIME_SECRET_NOT_(CONFIRMED|MASKED)/
    );
  }
});

test("rejects non-UUID and secret-shaped public agent IDs", async () => {
  for (const agentIdOverride of [
    "agent-openclaw",
    "mk_not-a-public-agent-id",
    "https://example.invalid/agent"
  ]) {
    const sdk = sdkSpy({ agentIdOverride });
    const secrets = secretProvider();
    const executor = createMaritimePilotExecutor({
      maritime: sdk.maritime,
      secretProvider: secrets.provider,
      sdkPolicy: VERIFIED_SDK_POLICY
    });
    await assert.rejects(
      executor.execute({
        manifest: publicManifest(),
        authorization: LIVE_PILOT_AUTHORIZATION
      }),
      (error) => error.code === "MARITIME_AGENT_RESPONSE_INVALID"
    );
  }
});

test("requires provider proof of exact agent external ID, name, and framework", async () => {
  for (const field of ["externalId", "name", "framework"]) {
    const sdk = sdkSpy({ agentOverride: { [field]: undefined } });
    const secrets = secretProvider();
    const executor = createMaritimePilotExecutor({
      maritime: sdk.maritime,
      secretProvider: secrets.provider,
      sdkPolicy: VERIFIED_SDK_POLICY
    });
    await assert.rejects(
      executor.execute({
        manifest: publicManifest(),
        authorization: LIVE_PILOT_AUTHORIZATION
      }),
      (error) => error.code === "MARITIME_AGENT_IDENTITY_MISMATCH"
    );
  }
});

test("requires the exact verified zero-retry SDK policy", () => {
  const sdk = sdkSpy();
  const secrets = secretProvider();
  for (const sdkPolicy of [
    undefined,
    { ...VERIFIED_SDK_POLICY, maxRetries: 2 },
    { ...VERIFIED_SDK_POLICY, version: "0.5.0" },
    { ...VERIFIED_SDK_POLICY, extra: true }
  ]) {
    assert.throws(
      () =>
        createMaritimePilotExecutor({
          maritime: sdk.maritime,
          secretProvider: secrets.provider,
          sdkPolicy
        }),
      /maxRetries: 0/
    );
  }
});

test("client surface must expose only the four verified SDK methods", () => {
  const secrets = secretProvider();
  for (const missing of ["provision", "setEnv", "reloadEnv", "listEnv"]) {
    const sdk = sdkSpy();
    sdk.maritime.agents[missing] = undefined;
    assert.throws(
      () =>
        createMaritimePilotExecutor({
          maritime: sdk.maritime,
          secretProvider: secrets.provider,
          sdkPolicy: VERIFIED_SDK_POLICY
        }),
      new RegExp(missing)
    );
  }
});
