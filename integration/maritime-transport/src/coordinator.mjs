import {
  assertPairedParity,
  createHarnessConfig
} from "./config.mjs";
import { createParityEvidence } from "./redaction.mjs";
import { digest } from "./serialization.mjs";
import {
  assertNoSensitiveMaterial,
  assertResponseIdentity,
  parseAndValidateResponse,
  serializePoke
} from "./validation.mjs";

export class TransportExhaustedError extends Error {
  constructor(message, { cause, attempts }) {
    super(message, { cause });
    this.name = "TransportExhaustedError";
    this.code =
      cause?.code === "TRANSPORT_CANCELLATION_UNCONFIRMED"
        ? cause.code
        : "TRANSPORT_RETRY_EXHAUSTED";
    this.attempts = attempts;
  }
}

export function createRequestCoordinator({
  transport,
  sleep = defaultSleep,
  now = () => Date.now(),
  timers = {
    setTimeout,
    clearTimeout
  },
  openclawConfig = createHarnessConfig("openclaw"),
  hermesConfig = createHarnessConfig("hermes"),
  ...unsupported
}) {
  if (Object.keys(unsupported).length > 0) {
    throw new TypeError(
      `unsupported coordinator option(s): ${Object.keys(unsupported).join(", ")}`
    );
  }
  if (!transport || typeof transport.send !== "function") {
    throw new TypeError("transport.send must be a function");
  }
  if (
    !timers ||
    typeof timers.setTimeout !== "function" ||
    typeof timers.clearTimeout !== "function"
  ) {
    throw new TypeError("timers must provide setTimeout and clearTimeout");
  }
  assertPairedParity(openclawConfig, hermesConfig);
  const runtimePolicy = openclawConfig.effective.settings;

  const requests = new Map();

  function execute({ agentId, harness, poke, metadata = {} }) {
    if (typeof agentId !== "string" || agentId.length === 0) {
      throw new TypeError("agentId must be a non-empty string");
    }
    if (harness !== "openclaw" && harness !== "hermes") {
      throw new TypeError("harness must be openclaw or hermes");
    }
    assertNoSensitiveMaterial(metadata, "metadata");

    const payload = serializePoke(poke);
    const pokeSnapshot = deepFreeze(JSON.parse(payload));
    const metadataSnapshot = deepFreeze(structuredClone(metadata));
    assertTargetIdentity(agentId, harness, pokeSnapshot);
    const fingerprint = digest({
      agentId,
      harness,
      payload
    });
    const existing = requests.get(pokeSnapshot.request_id);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new Error(
          `REQUEST_ID_CONFLICT: ${pokeSnapshot.request_id} is already bound to a different request`
        );
      }
      return existing.promise;
    }

    const promise = runRequest({
      agentId,
      harness,
      poke: pokeSnapshot,
      payload,
      metadata: metadataSnapshot,
      transport,
      runtimePolicy,
      sleep,
      now,
      timers,
      openclawConfig,
      hermesConfig
    });
    requests.set(pokeSnapshot.request_id, { fingerprint, promise });
    return promise;
  }

  return {
    execute,
    has(requestId) {
      return requests.has(requestId);
    },
    size() {
      return requests.size;
    }
  };
}

async function runRequest(options) {
  const attempts = [];
  let lastError;

  for (
    let attempt = 1;
    attempt <= options.runtimePolicy.max_attempts;
    attempt += 1
  ) {
    const startedAt = options.now();
    try {
      const raw = await withTimeout(
        (signal) =>
          options.transport.send({
            agentId: options.agentId,
            harness: options.harness,
            requestId: options.poke.request_id,
            payload: options.payload,
            attempt,
            signal,
            proxyConfig:
              options.harness === "openclaw"
                ? options.openclawConfig.effective
                : options.hermesConfig.effective
          }),
        options.runtimePolicy.timeout_ms,
        options.runtimePolicy.cancellation_grace_ms,
        options.timers
      );
      const response = parseAndValidateResponse(raw);
      assertResponseIdentity(options.poke, response);
      attempts.push({
        attempt,
        outcome: "response",
        duration_ms: Math.max(0, options.now() - startedAt)
      });

      return {
        schema_version: 1,
        request_id: options.poke.request_id,
        response,
        operational_report: {
          status: response.status,
          transaction_hash: response.transaction_hash ?? null,
          authoritative_chain_state: false
        },
        attempts,
        evidence: createParityEvidence({
          openclawConfig: options.openclawConfig,
          hermesConfig: options.hermesConfig,
          requestId: options.poke.request_id,
          payload: options.payload,
          attempts,
          metadata: options.metadata
        })
      };
    } catch (error) {
      lastError = error;
      const retryable = isRetryable(error);
      attempts.push({
        attempt,
        outcome: error.code === "TRANSPORT_TIMEOUT" ? "timeout" : "error",
        code: error.code ?? error.name ?? "ERROR",
        retryable,
        duration_ms: Math.max(0, options.now() - startedAt)
      });

      if (!retryable || attempt === options.runtimePolicy.max_attempts) {
        throw new TransportExhaustedError(
          `request ${options.poke.request_id} failed after ${attempt} attempt(s)`,
          { cause: error, attempts }
        );
      }
      const delay = options.runtimePolicy.retry_delays_ms[attempt - 1];
      await options.sleep(delay);
    }
  }

  throw new TransportExhaustedError("request failed", {
    cause: lastError,
    attempts
  });
}

function isRetryable(error) {
  return error?.code === "TRANSPORT_TIMEOUT" || error?.retryable === true;
}

async function withTimeout(
  operation,
  timeoutMs,
  cancellationGraceMs,
  timers
) {
  const controller = new AbortController();
  let operationPromise;
  try {
    operationPromise = Promise.resolve(operation(controller.signal));
  } catch (error) {
    operationPromise = Promise.reject(error);
  }
  const operationOutcome = operationPromise.then(
    (value) => ({ type: "fulfilled", value }),
    (error) => ({ type: "rejected", error })
  );
  const timeout = scheduledOutcome(timers, timeoutMs, { type: "timeout" });
  const outcome = await Promise.race([operationOutcome, timeout.promise]);
  timeout.cancel();

  if (outcome.type === "fulfilled") return outcome.value;
  if (outcome.type === "rejected") throw outcome.error;

  controller.abort();
  const grace = scheduledOutcome(timers, cancellationGraceMs, {
    type: "cancellation-unconfirmed"
  });
  const cancellation = await Promise.race([operationOutcome, grace.promise]);
  grace.cancel();

  if (cancellation.type === "cancellation-unconfirmed") {
    const error = new Error(
      `transport did not settle within ${cancellationGraceMs}ms after abort`
    );
    error.name = "CancellationError";
    error.code = "TRANSPORT_CANCELLATION_UNCONFIRMED";
    error.retryable = false;
    throw error;
  }

  // A response that completed during the bounded cancellation grace may
  // already represent an agent action. Accept it rather than issuing a
  // duplicate poke. Only a confirmed rejection after abort is retried.
  if (cancellation.type === "fulfilled") {
    return cancellation.value;
  }

  const error = new Error(`transport timed out after ${timeoutMs}ms`);
  error.name = "TimeoutError";
  error.code = "TRANSPORT_TIMEOUT";
  error.retryable = true;
  throw error;
}

function defaultSleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function scheduledOutcome(timers, delayMs, outcome) {
  let handle;
  let cancelled = false;
  const promise = new Promise((resolve) => {
    handle = timers.setTimeout(() => {
      if (!cancelled) resolve(outcome);
    }, delayMs);
  });
  return {
    promise,
    cancel() {
      cancelled = true;
      timers.clearTimeout(handle);
    }
  };
}

function assertTargetIdentity(agentId, harness, poke) {
  const expectedHarness = poke.team === "openclaw" ? "openclaw" : "hermes";
  const expectedPrefix = expectedHarness === "openclaw" ? "oc-" : "hs-";
  if (harness !== expectedHarness) {
    throw new Error(
      `TARGET_HARNESS_MISMATCH: ${poke.team} requires ${expectedHarness}`
    );
  }
  if (!poke.seat_id.startsWith(expectedPrefix)) {
    throw new Error(
      `TARGET_SEAT_MISMATCH: ${poke.team} requires a ${expectedPrefix} seat`
    );
  }
  if (agentId !== poke.seat_id) {
    throw new Error(
      `TARGET_AGENT_MISMATCH: agentId must equal poke.seat_id`
    );
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
