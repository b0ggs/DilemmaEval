import { digest } from "./serialization.mjs";
import { assertPairedParity } from "./config.mjs";
import {
  assertNoSensitiveMaterial,
  serializePoke,
  validatePoke
} from "./validation.mjs";

const REDACTED = "[REDACTED]";
const SENSITIVE_KEY =
  /(authorization|auth.?token|access.?token|refresh.?token|token|api.?key|secret|password|passphrase|private.?key|wallet.?key|credential|cookie|mnemonic|seed.?phrase|recovery.?phrase)/i;

export function redactSensitive(value, parentKey = "") {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item, parentKey));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) {
      output[key] = REDACTED;
    } else if (
      /^(env|environ|environment|processEnv|environmentVariables|headers)$/i.test(key) &&
      child &&
      typeof child === "object"
    ) {
      output[key] = Object.fromEntries(Object.keys(child).map((name) => [name, REDACTED]));
    } else {
      output[key] = redactSensitive(child, key);
    }
  }
  return output;
}

export function createParityEvidence({
  openclawConfig,
  hermesConfig,
  requestId,
  payload,
  attempts = [],
  recordedAt = new Date().toISOString(),
  metadata = {}
}) {
  assertPairedParity(openclawConfig, hermesConfig);
  assertNoSensitiveMaterial(metadata, "metadata");
  if (typeof payload !== "string") {
    throw new TypeError("payload must be serialized JSON");
  }
  let parsedPoke;
  try {
    parsedPoke = JSON.parse(payload);
  } catch (error) {
    throw new TypeError("payload must be serialized JSON", { cause: error });
  }
  validatePoke(parsedPoke);
  const canonicalPayload = serializePoke(parsedPoke);
  if (canonicalPayload !== payload) {
    throw new Error("PAYLOAD_SERIALIZATION_MISMATCH");
  }
  if (requestId !== parsedPoke.request_id) {
    throw new Error("EVIDENCE_REQUEST_ID_MISMATCH");
  }

  const settings = openclawConfig.effective.settings;
  return {
    schema_version: 1,
    recorded_at: recordedAt,
    request_id: requestId,
    route: openclawConfig.effective.endpoint,
    primary_model: openclawConfig.effective.primary_model,
    fallback_model: openclawConfig.effective.fallback_model,
    openclaw_effective_digest: digest(openclawConfig.effective),
    hermes_effective_digest: digest(hermesConfig.effective),
    parity_equal:
      digest(openclawConfig.effective) === digest(hermesConfig.effective),
    frozen_profile_match: true,
    runtime_policy: {
      timeout_ms: settings.timeout_ms,
      cancellation_grace_ms: settings.cancellation_grace_ms,
      max_attempts: settings.max_attempts,
      retry_delays_ms: [...settings.retry_delays_ms]
    },
    payload_digest: digest(payload),
    attempts: redactSensitive(attempts),
    metadata: redactSensitive(metadata)
  };
}

export { REDACTED };
