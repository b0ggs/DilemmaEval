import assert from "node:assert/strict";
import test from "node:test";

import {
  assertResponseIdentity,
  parseAndValidateResponse,
  serializePoke,
  validateAgentResponse,
  validatePoke
} from "../src/index.mjs";
import { validPoke, validResponse } from "./fixtures.mjs";

test("valid poke serializes without modifying message text", () => {
  const poke = validPoke();
  const originalMessage = poke.team_chat.messages[0].message;
  const serialized = serializePoke(poke);

  assert.equal(validatePoke(poke), poke);
  assert.equal(JSON.parse(serialized).team_chat.messages[0].message, originalMessage);
});

test("invalid poke is rejected against the shared envelope shape", () => {
  const poke = validPoke({ unexpected: true });
  assert.throws(() => validatePoke(poke), /unexpected is not allowed/);
});

test("response identity must match the poke", () => {
  const poke = validPoke();
  const response = validResponse(poke);
  assert.equal(assertResponseIdentity(poke, response), true);

  assert.throws(
    () => assertResponseIdentity(poke, { ...response, seat_id: "oc-2" }),
    /RESPONSE_IDENTITY_MISMATCH: seat_id/
  );
});

test("optional team_message may be absent, empty, or preserved verbatim", () => {
  const poke = validPoke();
  assert.equal(Object.hasOwn(validateAgentResponse(validResponse(poke)), "team_message"), false);
  assert.equal(validateAgentResponse(validResponse(poke, { team_message: "" })).team_message, "");

  const text = "  exact response text\nwith newline 🧭  ";
  const parsed = parseAndValidateResponse(
    JSON.stringify(validResponse(poke, { team_message: text }))
  );
  assert.equal(parsed.team_message, text);
});

test("Maritime response wrapper is parsed and validated", () => {
  const poke = validPoke();
  const response = validResponse(poke);
  assert.deepEqual(
    parseAndValidateResponse({ response: JSON.stringify(response) }),
    response
  );
});

test("gameplay private key fields are never accepted", () => {
  const poke = validPoke({
    chain_state: { GAMEPLAY_WALLET_PRIVATE_KEY: "never-record-this" }
  });
  assert.throws(() => validatePoke(poke), /SENSITIVE_MATERIAL_REJECTED/);
});

test("poke phase and requested action must agree", () => {
  assert.throws(
    () => validatePoke(validPoke({ requested_action: "reveal" })),
    /requested_action must equal poke.phase/
  );
});

test("poke team and every message seat prefix must agree", () => {
  assert.throws(
    () => validatePoke(validPoke({ seat_id: "hs-1" })),
    /seat_id must use the oc- prefix/
  );
  const poke = validPoke();
  poke.team_chat.messages[0].seat_id = "hs-1";
  poke.team_chat.messages[0].team = "openclaw";
  assert.throws(() => validatePoke(poke), /seat_id must use the oc- prefix/);
});

test("cross-team, cross-game, and future message context is rejected", () => {
  const crossTeam = validPoke();
  crossTeam.team_chat.messages[0].team = "hermes";
  crossTeam.team_chat.messages[0].seat_id = "hs-1";
  assert.throws(() => validatePoke(crossTeam), /team must equal poke.team/);

  const crossGame = validPoke();
  crossGame.team_chat.messages[0].game_id = "other-game";
  assert.throws(() => validatePoke(crossGame), /game_id must equal poke.game_id/);

  const futureRound = validPoke();
  futureRound.team_chat.messages[0].round = 3;
  assert.throws(() => validatePoke(futureRound), /must not be later than poke.round/);

  const futurePhase = validPoke();
  futurePhase.team_chat.messages[0].phase = "reveal";
  assert.throws(() => validatePoke(futurePhase), /must not be later than poke.phase/);
});

test("snapshot sequences are strictly ascending, unique, and exact through_sequence", () => {
  const base = validPoke().team_chat.messages[0];
  const descending = validPoke();
  descending.team_chat.through_sequence = 2;
  descending.team_chat.messages = [
    { ...base, sequence: 2 },
    { ...base, sequence: 1, request_id: "another" }
  ];
  assert.throws(() => validatePoke(descending), /strictly ascending and unique/);

  const pastCursor = validPoke();
  pastCursor.team_chat.through_sequence = 2;
  assert.throws(
    () => validatePoke(pastCursor),
    /must equal the highest included message sequence/
  );

  const beyondCursor = validPoke();
  beyondCursor.team_chat.messages[0].sequence = 2;
  assert.throws(() => validatePoke(beyondCursor), /must not exceed/);

  const empty = validPoke();
  empty.team_chat.messages = [];
  empty.team_chat.through_sequence = 7;
  assert.equal(validatePoke(empty), empty);
  assert.equal(JSON.parse(serializePoke(empty)).team_chat.through_sequence, 7);
});

test("message text rejects private-key-shaped material in every shared text channel", () => {
  const privateKeyShaped = `0x${"cd".repeat(32)}`;

  const poke = validPoke();
  poke.team_chat.messages[0].message = `Do not relay ${privateKeyShaped}`;
  assert.throws(
    () => validatePoke(poke),
    /SENSITIVE_MATERIAL_REJECTED: input\.team_chat\.messages\.0\.message/
  );

  assert.throws(
    () =>
      validateAgentResponse(
        validResponse(validPoke(), { team_message: privateKeyShaped })
      ),
    /SENSITIVE_MATERIAL_REJECTED: input\.team_message/
  );

  assert.throws(
    () =>
      validateAgentResponse(
        validResponse(validPoke(), {
          status: "error",
          error: {
            code: "LOCAL_FAILURE",
            message: `Signer returned ${privateKeyShaped}`
          }
        })
      ),
    /SENSITIVE_MATERIAL_REJECTED: input\.error\.message/
  );
});

test("ordinary human messages and errors remain verbatim", () => {
  const poke = validPoke();
  poke.team_chat.messages[0].message =
    "  Wait for block 123456, then commit together 🧭  ";
  assert.equal(
    validatePoke(poke).team_chat.messages[0].message,
    "  Wait for block 123456, then commit together 🧭  "
  );

  const response = validResponse(poke, {
    status: "error",
    team_message: "No transaction submitted; I will wait.",
    error: {
      code: "RPC_UNAVAILABLE",
      message: "RPC request timed out after 30 seconds."
    }
  });
  assert.equal(
    validateAgentResponse(response).error.message,
    "RPC request timed out after 30 seconds."
  );
});

test("generic key, mnemonic, seed, token, auth, password, cookie, and env dumps are rejected", () => {
  for (const sensitive of [
    { wallet_private_key: "secret" },
    { signingPrivateKey: "secret" },
    { value: `0x${"ab".repeat(32)}` },
    { mnemonic: "words" },
    { seed_phrase: "words" },
    { commit_salt: "words" },
    { accessToken: "mk_secret" },
    { Authorization: "Bearer value" },
    { headers: { "x-api-key": "value" } },
    { apiKey: "value" },
    { password: "value" },
    { cookie: "value" },
    { environment: { SAFE_NAME: "value" } }
  ]) {
    assert.throws(
      () => validatePoke(validPoke({ chain_state: sensitive })),
      /SENSITIVE_MATERIAL_REJECTED/
    );
  }
});
