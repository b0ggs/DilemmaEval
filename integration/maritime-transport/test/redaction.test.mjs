import assert from "node:assert/strict";
import test from "node:test";

import {
  REDACTED,
  createHarnessConfig,
  createParityEvidence,
  redactSensitive
} from "../src/index.mjs";
import { validPoke } from "./fixtures.mjs";

test("authorization, tokens, credentials, private keys, and env values are redacted", () => {
  const redacted = redactSensitive({
    headers: { Authorization: "Bearer mk_secret", "x-trace": "also hidden as header value" },
    api_token: "mk_secret",
    accessToken: "mk_access",
    authToken: "mk_auth",
    cookie: "session=value",
    mnemonic: "word list",
    clientSecret: "secret",
    signing_private_key: "secret",
    environment: { SAFE_NAME: "value", ANOTHER: "value" },
    safe: "visible"
  });

  assert.deepEqual(redacted.headers, {
    Authorization: REDACTED,
    "x-trace": REDACTED
  });
  assert.equal(redacted.api_token, REDACTED);
  assert.equal(redacted.accessToken, REDACTED);
  assert.equal(redacted.authToken, REDACTED);
  assert.equal(redacted.cookie, REDACTED);
  assert.equal(redacted.mnemonic, REDACTED);
  assert.equal(redacted.clientSecret, REDACTED);
  assert.equal(redacted.signing_private_key, REDACTED);
  assert.deepEqual(redacted.environment, { SAFE_NAME: REDACTED, ANOTHER: REDACTED });
  assert.equal(redacted.safe, "visible");
  assert.doesNotMatch(JSON.stringify(redacted), /mk_secret|Bearer|\"value\"/);
});

test("parity evidence contains digests and redacted metadata, not payload or secrets", () => {
  const poke = validPoke();
  const payload = JSON.stringify(poke);
  const evidence = createParityEvidence({
    openclawConfig: createHarnessConfig("openclaw"),
    hermesConfig: createHarnessConfig("hermes"),
    requestId: poke.request_id,
    payload,
    metadata: {
      trace_label: "pilot"
    },
    recordedAt: "2026-07-26T12:00:00.000Z"
  });

  assert.equal(evidence.parity_equal, true);
  assert.equal(evidence.metadata.trace_label, "pilot");
  assert.equal(Object.hasOwn(evidence, "payload"), false);
  assert.doesNotMatch(JSON.stringify(evidence), /mk_secret/);
});

test("evidence refuses gameplay private key material instead of merely redacting it", () => {
  assert.throws(
    () =>
      createParityEvidence({
        openclawConfig: createHarnessConfig("openclaw"),
        hermesConfig: createHarnessConfig("hermes"),
        requestId: "req",
        payload: "{}",
        metadata: { gameplay_wallet_private_key: "secret" }
      }),
    /SENSITIVE_MATERIAL_REJECTED/
  );
});

test("evidence rejects common credential metadata rather than recording redactions", () => {
  const poke = validPoke();
  for (const metadata of [
    { accessToken: "mk_secret" },
    { authToken: "mk_secret" },
    { cookie: "session=value" },
    { environment: { TOKEN: "value" } }
  ]) {
    assert.throws(
      () =>
        createParityEvidence({
          openclawConfig: createHarnessConfig("openclaw"),
          hermesConfig: createHarnessConfig("hermes"),
          requestId: poke.request_id,
          payload: JSON.stringify(poke),
          metadata
        }),
      /SENSITIVE_MATERIAL_REJECTED/
    );
  }
});
