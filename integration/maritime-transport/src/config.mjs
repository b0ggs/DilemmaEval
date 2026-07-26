import { stableStringify } from "./serialization.mjs";

export const MARITIME_PROXY_ENDPOINT = "https://api.maritime.sh/api/llm/v1";
export const PRIMARY_MODEL = "gpt-5.4-mini";
export const FALLBACK_MODEL = "gpt-4o";

const paritySettings = {
  temperature: 0,
  max_output_tokens: 2048,
  reasoning_effort: "low",
  prompt_profile: "dilemmaeval-agent-v1",
  tool_profile: "pinned-game-bridge-v1",
  response_schema_version: 1,
  team_chat_max_messages: 20,
  timeout_ms: 30_000,
  cancellation_grace_ms: 1_000,
  max_attempts: 3,
  retry_delays_ms: [250, 1_000]
};

export const FROZEN_PROXY_CONFIG = deepFreeze({
  schema_version: 1,
  provider: "maritime-openai-compatible",
  endpoint: MARITIME_PROXY_ENDPOINT,
  primary_model: PRIMARY_MODEL,
  fallback_model: FALLBACK_MODEL,
  fallback_policy: {
    order: [PRIMARY_MODEL, FALLBACK_MODEL],
    fallback_only_on: ["model_not_found", "model_unavailable"]
  },
  settings: paritySettings
});

export function createHarnessConfig(harness) {
  if (harness !== "openclaw" && harness !== "hermes") {
    throw new TypeError(`unsupported harness: ${String(harness)}`);
  }

  return deepFreeze({
    schema_version: 1,
    harness,
    effective: structuredClone(FROZEN_PROXY_CONFIG)
  });
}

export function assertPairedParity(openclawConfig, hermesConfig) {
  validateHarnessConfig(openclawConfig, "openclaw");
  validateHarnessConfig(hermesConfig, "hermes");

  const left = stableStringify(openclawConfig.effective);
  const right = stableStringify(hermesConfig.effective);
  if (left !== right) {
    throw new Error("PARITY_MISMATCH: effective harness configurations differ");
  }

  return true;
}

export function validateHarnessConfig(config, expectedHarness) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new TypeError("harness configuration must be an object");
  }
  if (config.harness !== expectedHarness) {
    throw new Error(
      `HARNESS_MISMATCH: expected ${expectedHarness}, received ${String(config.harness)}`
    );
  }

  const effective = config.effective;
  if (!effective || typeof effective !== "object" || Array.isArray(effective)) {
    throw new TypeError("effective proxy configuration must be an object");
  }
  rejectNativeOpenAiEndpoint(effective.endpoint);

  if (effective.endpoint !== MARITIME_PROXY_ENDPOINT) {
    throw new Error(`ROUTE_MISMATCH: endpoint must be ${MARITIME_PROXY_ENDPOINT}`);
  }
  if (effective.primary_model !== PRIMARY_MODEL) {
    throw new Error(`MODEL_MISMATCH: primary model must be ${PRIMARY_MODEL}`);
  }
  if (effective.fallback_model !== FALLBACK_MODEL) {
    throw new Error(`MODEL_MISMATCH: fallback model must be ${FALLBACK_MODEL}`);
  }
  validateRuntimePolicy(effective.settings);

  if (stableStringify(effective) !== stableStringify(FROZEN_PROXY_CONFIG)) {
    throw new Error("SETTINGS_MISMATCH: effective configuration is not the frozen profile");
  }

  return true;
}

export function validateRuntimePolicy(settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new TypeError("runtime settings must be an object");
  }
  if (
    !Number.isInteger(settings.timeout_ms) ||
    settings.timeout_ms < 1 ||
    settings.timeout_ms > 120_000
  ) {
    throw new TypeError("timeout_ms must be an integer from 1 through 120000");
  }
  if (
    !Number.isInteger(settings.cancellation_grace_ms) ||
    settings.cancellation_grace_ms < 1 ||
    settings.cancellation_grace_ms > 5_000
  ) {
    throw new TypeError(
      "cancellation_grace_ms must be an integer from 1 through 5000"
    );
  }
  if (
    !Number.isInteger(settings.max_attempts) ||
    settings.max_attempts < 1 ||
    settings.max_attempts > 5
  ) {
    throw new TypeError("max_attempts must be an integer from 1 through 5");
  }
  if (
    !Array.isArray(settings.retry_delays_ms) ||
    settings.retry_delays_ms.length !== settings.max_attempts - 1 ||
    settings.retry_delays_ms.some(
      (delay) => !Number.isInteger(delay) || delay < 0 || delay > 30_000
    )
  ) {
    throw new TypeError(
      "retry_delays_ms must have max_attempts - 1 entries from 0 through 30000"
    );
  }
  return true;
}

export function rejectNativeOpenAiEndpoint(endpoint) {
  if (typeof endpoint !== "string" || endpoint.length === 0) {
    throw new TypeError("proxy endpoint must be a non-empty string");
  }

  let hostname;
  try {
    hostname = new URL(endpoint).hostname.toLowerCase();
  } catch {
    throw new TypeError("proxy endpoint must be an absolute URL");
  }

  if (hostname === "api.openai.com" || hostname.endsWith(".api.openai.com")) {
    throw new Error("FORBIDDEN_NATIVE_OPENAI_ROUTE");
  }
}

export function renderOpenClawReference() {
  return deepFreeze({
    schema_version: 1,
    harness: "openclaw",
    reference_only: true,
    live_verify: true,
    credential_env_name: "MARITIME_TOKEN",
    onboard_arguments: [
      "--auth-choice",
      "custom-api-key",
      "--custom-base-url",
      MARITIME_PROXY_ENDPOINT,
      "--custom-model-id",
      PRIMARY_MODEL,
      "--custom-compatibility",
      "openai"
    ],
    effective: structuredClone(FROZEN_PROXY_CONFIG),
    note:
      "Representative custom OpenAI-compatible provider data; verify current OpenClaw syntax and apply the frozen fallback/settings explicitly."
  });
}

export function renderHermesReference() {
  return deepFreeze({
    schema_version: 1,
    harness: "hermes",
    reference_only: true,
    live_verify: true,
    credential_env_name: "MARITIME_TOKEN",
    environment_names_and_nonsecret_values: {
      HERMES_INFERENCE_PROVIDER: "openrouter",
      HERMES_INFERENCE_MODEL: PRIMARY_MODEL,
      OPENROUTER_BASE_URL: MARITIME_PROXY_ENDPOINT
    },
    effective: structuredClone(FROZEN_PROXY_CONFIG),
    note:
      "Representative Maritime Hermes proxy data; verify current environment names and apply the frozen fallback/settings explicitly."
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return value;
}
