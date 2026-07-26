import assert from "node:assert/strict";
import test from "node:test";

import {
  PLAYER_OPERATION_ALLOWLIST,
  UNAVOIDABLE_HARNESS_DIFFERENCES,
  assertAdapterParity,
  createHermesAdapter,
  createOpenClawAdapter,
  createPairedHarnessAdapters,
  validateCommandResult
} from "../src/index.mjs";
import {
  commandResult,
  createBridgeSpy,
  validPoke,
  validResponse
} from "./fixtures.mjs";

function pairedSpies() {
  const openclaw = {
    player: createBridgeSpy(),
    readOnly: createBridgeSpy()
  };
  const hermes = {
    player: createBridgeSpy(),
    readOnly: createBridgeSpy()
  };
  return {
    openclaw,
    hermes,
    adapters: createPairedHarnessAdapters({
      openclaw: {
        seatId: "oc-1",
        playerBridge: openclaw.player.bridge,
        readOnlyBridge: openclaw.readOnly.bridge
      },
      hermes: {
        seatId: "hs-1",
        playerBridge: hermes.player.bridge,
        readOnlyBridge: hermes.readOnly.bridge
      }
    })
  };
}

function adapterWithSpies(factory, seatId) {
  const player = createBridgeSpy();
  const readOnly = createBridgeSpy();
  return {
    player,
    readOnly,
    adapter: factory({
      seatId,
      playerBridge: player.bridge,
      readOnlyBridge: readOnly.bridge
    })
  };
}

test("paired adapters expose identical gameplay, model, schema, and policy contracts", () => {
  const { adapters } = pairedSpies();

  assert.equal(assertAdapterParity(adapters.openclaw, adapters.hermes), true);
  assert.deepEqual(
    adapters.openclaw.contract.kit.operation_allowlist,
    adapters.hermes.contract.kit.operation_allowlist
  );
  assert.deepEqual(
    adapters.openclaw.contract.model_route_and_settings,
    adapters.hermes.contract.model_route_and_settings
  );
  assert.deepEqual(
    adapters.openclaw.contract.transport_policy,
    adapters.hermes.contract.transport_policy
  );
  assert.equal(
    adapters.openclaw.contract.model_route_and_settings.endpoint,
    "https://api.maritime.sh/api/llm/v1"
  );
  assert.equal(
    adapters.hermes.contract.model_route_and_settings.primary_model,
    "gpt-5.4-mini"
  );
});

test("the difference register contains only identity routing and config encoding", () => {
  assert.deepEqual(
    UNAVOIDABLE_HARNESS_DIFFERENCES.map((entry) => entry.field),
    ["harness_identity", "reference_configuration_encoding"]
  );
  assert.ok(
    UNAVOIDABLE_HARNESS_DIFFERENCES.every(
      (entry) => entry.fairness_impact === "none; identity routing only" ||
        entry.fairness_impact.includes("same effective frozen profile")
    )
  );
});

test("every allowed player operation forwards unchanged and validates the shared result", async () => {
  for (const [harness, seatId, factory] of [
    ["openclaw", "oc-1", createOpenClawAdapter],
    ["hermes", "hs-1", createHermesAdapter]
  ]) {
    const { adapter, player, readOnly } = adapterWithSpies(factory, seatId);
    for (const operation of PLAYER_OPERATION_ALLOWLIST) {
      const options = {
        network: "base-sepolia",
        chainId: 84532,
        marker: `${harness}-${operation}`,
        ...(operation === "prepare_commit" ? { choice: "share" } : {})
      };
      const result = await adapter.runGameOperation({
        seatId,
        operation,
        options
      });
      assert.equal(result.operation, operation);
      const expectedSpy =
        operation === "state" || operation === "wallet_auth_status"
          ? readOnly
          : player;
      assert.deepEqual(expectedSpy.calls.at(-1), { operation, options });
    }
    assert.deepEqual(
      readOnly.calls.map(({ operation }) => operation),
      ["state", "wallet_auth_status"]
    );
    assert.deepEqual(
      player.calls.map(({ operation }) => operation),
      ["register", "join", "prepare_commit", "commit", "reveal", "claim"]
    );
  }
});

test("advance and unknown operations never reach either player bridge", async () => {
  const { adapters, openclaw, hermes } = pairedSpies();

  await assert.rejects(
    adapters.openclaw.runGameOperation({
      seatId: "oc-1",
      operation: "advance",
      options: {}
    }),
    /OPERATION_NOT_ALLOWED/
  );
  await assert.rejects(
    adapters.hermes.runGameOperation({
      seatId: "hs-1",
      operation: "configure",
      options: {}
    }),
    /OPERATION_NOT_ALLOWED/
  );
  assert.equal(openclaw.player.calls.length + openclaw.readOnly.calls.length, 0);
  assert.equal(hermes.player.calls.length + hermes.readOnly.calls.length, 0);
});

test("cross-seat operation requests are rejected before bridge dispatch", async () => {
  const { adapters, openclaw, hermes } = pairedSpies();

  await assert.rejects(
    adapters.openclaw.runGameOperation({
      seatId: "oc-2",
      operation: "state",
      options: {}
    }),
    /CROSS_SEAT_REQUEST_REJECTED/
  );
  await assert.rejects(
    adapters.hermes.runGameOperation({
      seatId: "oc-1",
      operation: "state",
      options: {}
    }),
    /CROSS_SEAT_REQUEST_REJECTED/
  );
  assert.equal(openclaw.player.calls.length + openclaw.readOnly.calls.length, 0);
  assert.equal(hermes.player.calls.length + hermes.readOnly.calls.length, 0);
});

test("paired poke fixtures preserve equivalent bounded own-team snapshots", () => {
  const { adapters } = pairedSpies();
  const ocPoke = validPoke();
  const hsPoke = validPoke({ seatId: "hs-1", team: "hermes" });

  const acceptedOc = adapters.openclaw.acceptPoke(ocPoke);
  const acceptedHs = adapters.hermes.acceptPoke(hsPoke);
  assert.equal(acceptedOc.team_chat.messages.length, 1);
  assert.equal(acceptedHs.team_chat.messages.length, 1);
  assert.equal(
    acceptedOc.team_chat.messages[0].message,
    acceptedHs.team_chat.messages[0].message
  );
  assert.equal(acceptedOc.team_chat.through_sequence, 1);
  assert.equal(acceptedHs.team_chat.through_sequence, 1);
});

test("shared-schema empty message windows may retain a positive through_sequence", () => {
  const { adapters } = pairedSpies();
  const poke = validPoke();
  poke.team_chat = { through_sequence: 7, messages: [] };

  const accepted = adapters.openclaw.acceptPoke(poke);
  assert.equal(accepted.team_chat.through_sequence, 7);
  assert.deepEqual(accepted.team_chat.messages, []);
});

test("cross-team and wrong-seat pokes are rejected", () => {
  const { adapters } = pairedSpies();

  assert.throws(
    () =>
      adapters.openclaw.acceptPoke(
        validPoke({ seatId: "hs-1", team: "hermes" })
      ),
    /CROSS_SEAT_REQUEST_REJECTED/
  );
  assert.throws(
    () =>
      adapters.hermes.acceptPoke(
        validPoke({ seatId: "oc-1", team: "openclaw" })
      ),
    /CROSS_SEAT_REQUEST_REJECTED/
  );
});

test("both adapters validate identity and preserve optional team_message verbatim", () => {
  const { adapters } = pairedSpies();
  for (const [adapter, poke] of [
    [adapters.openclaw, validPoke()],
    [adapters.hermes, validPoke({ seatId: "hs-1", team: "hermes" })]
  ]) {
    const message = "  exact response\nwith whitespace 🧭  ";
    const accepted = adapter.acceptResponse(
      poke,
      validResponse(poke, { team_message: message })
    );
    assert.equal(accepted.team_message, message);

    const noMessage = adapter.acceptResponse(poke, validResponse(poke));
    assert.equal(Object.hasOwn(noMessage, "team_message"), false);
  }
});

test("malformed and cross-seat responses fail validation", () => {
  const { adapters } = pairedSpies();
  const poke = validPoke();

  assert.throws(
    () =>
      adapters.openclaw.acceptResponse(poke, {
        ...validResponse(poke),
        extra: true
      }),
    /response.extra is not allowed/
  );
  assert.throws(
    () =>
      adapters.openclaw.acceptResponse(poke, {
        ...validResponse(poke),
        seat_id: "oc-2"
      }),
    /RESPONSE_IDENTITY_MISMATCH/
  );
});

test("private-key-shaped and reveal-salt text is rejected from poke and response messages", () => {
  const { adapters } = pairedSpies();
  const rawKey = `0x${"12".repeat(32)}`;
  const pokeWithKey = validPoke();
  pokeWithKey.team_chat.messages[0].message = `do not propagate ${rawKey}`;
  assert.throws(
    () => adapters.openclaw.acceptPoke(pokeWithKey),
    /PRIVATE_KEY_SHAPED_MATERIAL_REJECTED|SENSITIVE_MATERIAL_REJECTED/
  );

  const poke = validPoke();
  assert.throws(
    () =>
      adapters.openclaw.acceptResponse(
        poke,
        validResponse(poke, { team_message: `revealSalt=${rawKey}` })
      ),
    /PRIVATE_KEY_SHAPED_MATERIAL_REJECTED|PLAYER_LOCAL_MATERIAL_REJECTED|SENSITIVE_MATERIAL_REJECTED/
  );
});

test("prepare choice and salt stay on the player-operation path", async () => {
  const { adapter, player, readOnly } = adapterWithSpies(
    createOpenClawAdapter,
    "oc-1"
  );

  await assert.rejects(
    adapter.runGameOperation({
      seatId: "oc-1",
      operation: "prepare_commit",
      options: { out: "bundles/round-1.json" }
    }),
    /requires a player-local choice/
  );
  await assert.rejects(
    adapter.runGameOperation({
      seatId: "oc-1",
      operation: "state",
      options: { choice: "share" }
    }),
    /PLAYER_DECISION_MATERIAL_REJECTED/
  );
  await assert.rejects(
    adapter.runGameOperation({
      seatId: "oc-1",
      operation: "prepare_commit",
      options: { choice: "share", salt: `0x${"13".repeat(32)}` }
    }),
    /SENSITIVE_MATERIAL_REJECTED/
  );
  const prepared = await adapter.runGameOperation({
    seatId: "oc-1",
    operation: "prepare_commit",
    options: { choice: "share", out: "bundles/round-1.json" }
  });
  assert.equal(prepared.operation, "prepare_commit");
  assert.equal(player.calls.length, 1);
  assert.equal(readOnly.calls.length, 0);

  const pokeWithChoice = validPoke({
    chain_state: { choice: "share" }
  });
  assert.throws(
    () => adapter.acceptPoke(pokeWithChoice),
    /PLAYER_LOCAL_MATERIAL_REJECTED/
  );
});

test("private keys, tokens, and environment dumps never reach the game bridge", async () => {
  const secrets = [
    { GAMEPLAY_WALLET_PRIVATE_KEY: `0x${"11".repeat(32)}` },
    { phaseAdvancerPrivateKey: `0x${"22".repeat(32)}` },
    { authorization: "Bearer not-a-real-token" },
    { environment: { SAFE_NAME: "value" } }
  ];

  for (const [factory, seatId] of [
    [createOpenClawAdapter, "oc-1"],
    [createHermesAdapter, "hs-1"]
  ]) {
    for (const sensitive of secrets) {
      const { adapter, player, readOnly } = adapterWithSpies(factory, seatId);
      await assert.rejects(
        adapter.runGameOperation({
          seatId,
          operation: "join",
          options: sensitive
        }),
        /SENSITIVE_MATERIAL_REJECTED/
      );
      assert.equal(player.calls.length + readOnly.calls.length, 0);
    }
  }
});

test("command result validation rejects mismatches, malformed shapes, and secret output", () => {
  assert.throws(
    () => validateCommandResult(commandResult("join"), "claim"),
    /COMMAND_RESULT_OPERATION_MISMATCH/
  );
  assert.throws(
    () =>
      validateCommandResult(
        commandResult("join", { unexpected: true }),
        "join"
      ),
    /unexpected is not allowed/
  );
  assert.throws(
    () =>
      validateCommandResult(
        commandResult("join", {
          parsed: { wallet_private_key: "must-never-return" }
        }),
        "join"
      ),
    /SENSITIVE_MATERIAL_REJECTED/
  );
});

test("command results redact untyped 32-byte text and reject key-shaped args/parsed values", () => {
  const raw = `0x${"55".repeat(32)}`;
  const sanitized = validateCommandResult(
    commandResult("join", {
      stdout: JSON.stringify({ echoed: raw }),
      stderr: `upstream echoed ${raw}`,
      parsed: {
        transaction_hash: `0x${"66".repeat(32)}`
      },
      error: { code: "UPSTREAM", message: `failure ${raw}` }
    }),
    "join"
  );
  assert.equal(JSON.stringify(sanitized).includes(raw), false);
  assert.equal(
    sanitized.error.message,
    "failure [REDACTED_32_BYTE_VALUE]"
  );
  assert.equal(
    sanitized.parsed.transaction_hash,
    `0x${"66".repeat(32)}`
  );
  const publicState = validateCommandResult(
    commandResult("state", {
      parsed: {
        agentKey: `0x${"77".repeat(32)}`,
        commitment: `0x${"88".repeat(32)}`,
        blockHash: `0x${"99".repeat(32)}`
      }
    }),
    "state"
  );
  assert.equal(publicState.parsed.agentKey, `0x${"77".repeat(32)}`);

  assert.throws(
    () =>
      validateCommandResult(
        commandResult("join", { args: ["game:join", "--", raw] }),
        "join"
      ),
    /PRIVATE_KEY_SHAPED_MATERIAL_REJECTED/
  );
  assert.throws(
    () =>
      validateCommandResult(
        commandResult("join", { parsed: { value: raw } }),
        "join"
      ),
    /PRIVATE_KEY_SHAPED_MATERIAL_REJECTED/
  );
  assert.throws(
    () =>
      validateCommandResult(
        commandResult("join", {
          error: {
            code: "UPSTREAM",
            message: "Authorization: Bearer credential-must-not-propagate"
          }
        }),
        "join"
      ),
    /SENSITIVE_MATERIAL_REJECTED/
  );
});

test("prepare result keeps its reveal salt only inside the player adapter result", async () => {
  const revealSalt = `0x${"33".repeat(32)}`;
  const bridge = {
    async run(operation) {
      return commandResult(operation, {
        stdout: JSON.stringify({ command: "prepare-commit", salt: revealSalt }),
        parsed: {
          command: "prepare-commit",
          salt: revealSalt,
          commitment: `0x${"44".repeat(32)}`,
          outputFile: "bundles/game-12-round-1.json"
        }
      });
    }
  };
  const adapter = createOpenClawAdapter({
    seatId: "oc-1",
    playerBridge: bridge,
    readOnlyBridge: createBridgeSpy().bridge
  });
  const result = await adapter.runGameOperation({
    seatId: "oc-1",
    operation: "prepare_commit",
    options: { choice: "share", out: "bundles/game-12-round-1.json" }
  });

  assert.equal(result.parsed.salt, revealSalt);
  assert.equal(result.stdout.includes(revealSalt), false);
  assert.equal(Object.isFrozen(result.parsed), true);
});

test("configuration rejects secret-bearing or invented adapter options", () => {
  const player = createBridgeSpy();
  const readOnly = createBridgeSpy();
  assert.throws(
    () =>
      createOpenClawAdapter({
        seatId: "oc-1",
        playerBridge: player.bridge,
        readOnlyBridge: readOnly.bridge,
        privateKey: "not-accepted"
      }),
    /unsupported openclaw adapter option/
  );
  assert.throws(
    () =>
      createHermesAdapter({
        seatId: "hs-1",
        playerBridge: player.bridge,
        readOnlyBridge: readOnly.bridge,
        retryPolicy: { maxAttempts: 99 }
      }),
    /unsupported hermes adapter option/
  );
  assert.throws(
    () =>
      createOpenClawAdapter({
        seatId: "oc-1",
        playerBridge: player.bridge,
        readOnlyBridge: player.bridge
      }),
    /must be distinct/
  );
});

test("adapter contracts and accepted artifacts are deeply immutable", () => {
  const { adapters } = pairedSpies();
  assert.equal(Object.isFrozen(adapters.openclaw.contract), true);
  assert.equal(
    Object.isFrozen(adapters.openclaw.contract.model_route_and_settings.settings),
    true
  );

  const poke = adapters.openclaw.acceptPoke(validPoke());
  assert.equal(Object.isFrozen(poke.team_chat.messages[0]), true);
  assert.throws(() => {
    poke.team_chat.messages[0].message = "changed";
  }, TypeError);
});
