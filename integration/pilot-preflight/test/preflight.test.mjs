import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  BASE_SEPOLIA_CHAIN_ID,
  PILOT_AGENT_REFERENCES,
  PUBLIC_SEAT_MANIFEST_SCHEMA,
  assertNoSecretInput,
  buildTwoSeatPilotPlan,
  isDeeplyFrozen,
  validateTwoSeatManifest
} from "../src/index.mjs";
import { publicManifest } from "./fixtures.mjs";

test("validates exactly the shared-schema public fields for oc-1 and hs-1", () => {
  const manifest = publicManifest();
  manifest.seats.reverse();

  const validated = validateTwoSeatManifest(manifest);

  assert.deepEqual(
    validated.seats.map(({ seat_id }) => seat_id),
    ["oc-1", "hs-1"]
  );
  assert.equal(validated.network, "base-sepolia");
  assert.equal(isDeeplyFrozen(validated), true);
});

test("normalizes address case and rejects case-insensitive duplicates", () => {
  const manifest = publicManifest();
  manifest.seats[0].wallet_address =
    "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  manifest.seats[1].wallet_address =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  assert.throws(
    () => validateTwoSeatManifest(manifest),
    (error) => error.code === "DUPLICATE_WALLET_ADDRESS"
  );
});

test("rejects malformed Ethereum addresses and non-idempotent agent references", () => {
  const malformed = publicManifest();
  malformed.seats[0].wallet_address = "0x1234";
  assert.throws(
    () => validateTwoSeatManifest(malformed),
    (error) => error.code === "INVALID_WALLET_ADDRESS"
  );

  const unstableAgent = publicManifest();
  unstableAgent.seats[1].maritime_agent = "unstable-hermes-reference";
  assert.throws(
    () => validateTwoSeatManifest(unstableAgent),
    (error) => error.code === "INVALID_AGENT_REFERENCE"
  );
});

test("requires the exact stable SDK idempotency references for both seats", () => {
  const validated = validateTwoSeatManifest(publicManifest());
  assert.equal(
    validated.seats[0].maritime_agent,
    PILOT_AGENT_REFERENCES["oc-1"]
  );
  assert.equal(
    validated.seats[1].maritime_agent,
    PILOT_AGENT_REFERENCES["hs-1"]
  );

  for (const [index, reference] of [
    [0, "dilemmaeval-pilot-openclaw-2"],
    [1, "dilemmaeval-pilot-openclaw"]
  ]) {
    const manifest = publicManifest();
    manifest.seats[index].maritime_agent = reference;
    assert.throws(
      () => validateTwoSeatManifest(manifest),
      (error) => error.code === "INVALID_AGENT_REFERENCE"
    );
  }
});

test("rejects wrong seats, team/harness mismatches, and non-Base-Sepolia", () => {
  const wrongSeat = publicManifest();
  wrongSeat.seats[0].seat_id = "oc-2";
  assert.throws(
    () => validateTwoSeatManifest(wrongSeat),
    (error) => error.code === "INVALID_PILOT_SEAT_ID"
  );

  const wrongTeam = publicManifest();
  wrongTeam.seats[0].team = "hermes";
  assert.throws(
    () => validateTwoSeatManifest(wrongTeam),
    (error) => error.code === "SEAT_TEAM_MISMATCH"
  );

  const wrongNetwork = publicManifest({ network: "base" });
  assert.throws(
    () => validateTwoSeatManifest(wrongNetwork),
    (error) => error.code === "UNSUPPORTED_NETWORK"
  );
});

test("rejects every extra field, prioritizing secret-field errors", () => {
  const unknown = publicManifest({ chain_id: 84532 });
  assert.throws(
    () => validateTwoSeatManifest(unknown),
    (error) => error.code === "UNKNOWN_FIELD"
  );

  for (const [field, value] of [
    ["privateKey", "not-printed"],
    ["env", {}],
    ["api_token", "not-printed"],
    ["rpc_url", "not-printed"],
    ["authorization", "not-printed"]
  ]) {
    const manifest = publicManifest();
    manifest.seats[0][field] = value;
    assert.throws(
      () => validateTwoSeatManifest(manifest),
      (error) => error.code === "SECRET_FIELD_REJECTED",
      field
    );
  }
});

test("rejects private-key-, token-, assignment-, and RPC-secret-shaped values", () => {
  const values = [
    `0x${"ab".repeat(32)}`,
    `sk-${"a".repeat(20)}`,
    `mk_${"a".repeat(20)}`,
    "eyJabcdefghi.abcdefghijk.abcdefghijk",
    "api_key=value-that-must-not-enter-a-public-manifest",
    "https://base-sepolia.g.alchemy.com/v2/secretvalue123",
    "https://example.quiknode.pro/not-public"
  ];
  for (const value of values) {
    const manifest = publicManifest({ game_id: value });
    assert.throws(
      () => validateTwoSeatManifest(manifest),
      (error) =>
        error.code ===
        (value.includes("quiknode")
          ? "INVALID_GAME_ID"
          : "SECRET_VALUE_REJECTED"),
      value.slice(0, 8)
    );
  }
  assert.equal(assertNoSecretInput(publicManifest()), true);
});

test("sensitive field names never reflect opaque suffixes", () => {
  const marker = "opaque-value-that-must-not-reflect";
  const manifest = publicManifest();
  manifest[`privateKey_${marker}`] = "value";
  assert.throws(
    () => validateTwoSeatManifest(manifest),
    (error) => {
      assert.equal(error.code, "SECRET_FIELD_REJECTED");
      assert.equal(error.message.includes(marker), false);
      return true;
    }
  );
});

test("secret-shaped object keys are rejected without reflection", () => {
  for (const marker of [
    `0x${"ab".repeat(32)}`,
    "mk_secret-shaped-field-name",
    "https://base-sepolia.g.alchemy.com/v2/secretvalue123"
  ]) {
    const manifest = publicManifest();
    manifest[marker] = "value";
    assert.throws(
      () => validateTwoSeatManifest(manifest),
      (error) => {
        assert.equal(error.code, "SECRET_VALUE_REJECTED");
        assert.equal(error.message.includes(marker), false);
        return true;
      }
    );
  }
});

test("emits a deterministic, deeply immutable, secret-free pending plan", () => {
  const left = buildTwoSeatPilotPlan(publicManifest());
  const reorderedInput = publicManifest();
  reorderedInput.seats.reverse();
  const right = buildTwoSeatPilotPlan(reorderedInput);

  assert.deepEqual(left, right);
  assert.equal(left.source_schema, PUBLIC_SEAT_MANIFEST_SCHEMA);
  assert.deepEqual(left.network, {
    name: "base-sepolia",
    chain_id: BASE_SEPOLIA_CHAIN_ID
  });
  assert.equal(left.live_execution.preflight_executes_live, false);
  assert.equal(
    left.live_execution.sdk_surface_status,
    "verified-maritime-sdk-0.6.0"
  );
  assert.equal(left.steps.length, 6);
  assert.deepEqual(
    Object.fromEntries(
      ["oc-1", "hs-1"].map((seatId) => [
        seatId,
        left.steps.filter((step) => step.target.seat_id === seatId).length
      ])
    ),
    { "oc-1": 3, "hs-1": 3 }
  );
  assert.ok(left.steps.every((step) => step.status === "pending"));
  assert.ok(
    left.steps.every(
      (step) =>
        step.authorization.required === true &&
        step.authorization.grant === "explicit_operator_approval"
    )
  );
  assert.deepEqual(
    [...new Set(left.steps.map(({ type }) => type))],
    [
      "create_agent",
      "configure_wallet_environment",
      "verify_masked_wallet_environment"
    ]
  );
  assert.equal(isDeeplyFrozen(left), true);
  assert.equal(
    JSON.stringify(left).includes("GAMEPLAY_WALLET_PRIVATE_KEY"),
    true
  );
  assert.equal(JSON.stringify(left).includes("0xabababab"), false);
});

test("shared schema constants and public fields remain reconciled", async () => {
  const schema = JSON.parse(
    await readFile(
      new URL("../../shared/schemas/seat-manifest.schema.json", import.meta.url),
      "utf8"
    )
  );
  assert.equal(schema.$id, PUBLIC_SEAT_MANIFEST_SCHEMA);
  assert.equal(schema.properties.schema_version.const, 1);
  assert.equal(schema.properties.network.const, "base-sepolia");
  assert.deepEqual(new Set(schema.required), new Set([
    "schema_version",
    "network",
    "game_id",
    "seats"
  ]));
  assert.deepEqual(
    new Set(schema.properties.seats.items.required),
    new Set([
      "seat_id",
      "team",
      "harness",
      "maritime_agent",
      "wallet_address"
    ])
  );
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.seats.items.additionalProperties, false);
});
