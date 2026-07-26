import assert from "node:assert/strict";
import test from "node:test";

import {
  FROZEN_PROXY_CONFIG,
  assertPairedParity,
  createHarnessConfig,
  createParityEvidence,
  renderHermesReference,
  renderOpenClawReference,
  validateHarnessConfig
} from "../src/index.mjs";
import { validPoke } from "./fixtures.mjs";

test("paired harnesses resolve to the same frozen Maritime proxy profile", () => {
  const openclaw = createHarnessConfig("openclaw");
  const hermes = createHarnessConfig("hermes");

  assert.equal(assertPairedParity(openclaw, hermes), true);
  assert.deepEqual(openclaw.effective, hermes.effective);
  assert.equal(openclaw.effective.endpoint, "https://api.maritime.sh/api/llm/v1");
  assert.equal(openclaw.effective.primary_model, "gpt-5.4-mini");
  assert.equal(openclaw.effective.fallback_model, "gpt-4o");
});

test("a parity-sensitive mismatch is rejected", () => {
  const openclaw = createHarnessConfig("openclaw");
  const hermes = structuredClone(createHarnessConfig("hermes"));
  hermes.effective.settings.temperature = 0.5;

  assert.throws(() => assertPairedParity(openclaw, hermes), /SETTINGS_MISMATCH/);
});

test("native api.openai.com is forbidden", () => {
  const openclaw = structuredClone(createHarnessConfig("openclaw"));
  openclaw.effective.endpoint = "https://api.openai.com/v1";

  assert.throws(
    () => validateHarnessConfig(openclaw, "openclaw"),
    /FORBIDDEN_NATIVE_OPENAI_ROUTE/
  );
});

test("reference renderers contain no credential value and preserve effective parity", () => {
  const openclaw = renderOpenClawReference();
  const hermes = renderHermesReference();

  assert.equal(openclaw.reference_only, true);
  assert.equal(hermes.live_verify, true);
  assert.equal(openclaw.credential_env_name, "MARITIME_TOKEN");
  assert.equal(hermes.credential_env_name, "MARITIME_TOKEN");
  assert.deepEqual(openclaw.effective, FROZEN_PROXY_CONFIG);
  assert.deepEqual(hermes.effective, FROZEN_PROXY_CONFIG);
  assert.doesNotMatch(JSON.stringify({ openclaw, hermes }), /Bearer |mk_[A-Za-z0-9]/);
});

test("parity evidence independently rejects native OpenAI and arbitrary profiles", () => {
  const poke = validPoke();
  const effective = {
    endpoint: "https://api.openai.com/v1",
    primary_model: "different",
    settings: { temperature: 9 }
  };
  assert.throws(
    () =>
      createParityEvidence({
        openclawConfig: { harness: "openclaw", effective },
        hermesConfig: {
          harness: "hermes",
          effective: structuredClone(effective)
        },
        requestId: poke.request_id,
        payload: JSON.stringify(poke)
      }),
    /FORBIDDEN_NATIVE_OPENAI_ROUTE/
  );
});

test("runtime policy bounds are part of frozen harness validation", () => {
  const openclaw = structuredClone(createHarnessConfig("openclaw"));
  openclaw.effective.settings.max_attempts = 99;
  assert.throws(
    () => validateHarnessConfig(openclaw, "openclaw"),
    /max_attempts must be an integer from 1 through 5/
  );
});
