import assert from "node:assert/strict";
import test from "node:test";

import {
  TransportExhaustedError,
  createFakeTransport,
  createRequestCoordinator
} from "../src/index.mjs";
import { validPoke, validResponse } from "./fixtures.mjs";

function immediateTimers() {
  return {
    setTimeout(callback) {
      return setTimeout(callback, 0);
    },
    clearTimeout(handle) {
      clearTimeout(handle);
    }
  };
}

test("timeout retries the exact request id and payload, then succeeds", async () => {
  const poke = validPoke();
  const transport = createFakeTransport([
    ({ signal }) =>
      new Promise((_, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(Object.assign(new Error("aborted"), { code: "ABORTED" })),
          { once: true }
        );
      }),
    validResponse(poke, { team_message: "done" })
  ]);
  const coordinator = createRequestCoordinator({
    transport,
    sleep: async () => {},
    timers: immediateTimers()
  });

  const result = await coordinator.execute({
    agentId: "oc-1",
    harness: "openclaw",
    poke
  });

  assert.equal(result.response.team_message, "done");
  assert.equal(result.attempts[0].outcome, "timeout");
  assert.equal(transport.calls.length, 2);
  assert.equal(transport.calls[0].requestId, transport.calls[1].requestId);
  assert.equal(transport.calls[0].payload, transport.calls[1].payload);
});

test("retry exhaustion is bounded and exposes sanitized attempt facts", async () => {
  const poke = validPoke();
  const transport = createFakeTransport([
    { type: "throw", code: "TEMPORARY", retryable: true },
    { type: "throw", code: "TEMPORARY", retryable: true },
    { type: "throw", code: "TEMPORARY", retryable: true }
  ]);
  const coordinator = createRequestCoordinator({
    transport,
    sleep: async () => {}
  });

  await assert.rejects(
    coordinator.execute({ agentId: "oc-1", harness: "openclaw", poke }),
    (error) => {
      assert.equal(error instanceof TransportExhaustedError, true);
      assert.equal(error.code, "TRANSPORT_RETRY_EXHAUSTED");
      assert.equal(error.attempts.length, 3);
      return true;
    }
  );
  assert.equal(transport.calls.length, 3);
});

test("duplicate request returns one in-flight/result and does not double-send", async () => {
  const poke = validPoke();
  let release;
  const transport = createFakeTransport([
    () =>
      new Promise((resolve) => {
        release = () => resolve(validResponse(poke));
      })
  ]);
  const coordinator = createRequestCoordinator({ transport });

  const first = coordinator.execute({ agentId: "oc-1", harness: "openclaw", poke });
  const duplicate = coordinator.execute({
    agentId: "oc-1",
    harness: "openclaw",
    poke: structuredClone(poke)
  });
  assert.equal(first, duplicate);
  assert.equal(transport.calls.length, 1);

  release();
  const [firstResult, duplicateResult] = await Promise.all([first, duplicate]);
  assert.equal(firstResult, duplicateResult);
  assert.equal(transport.calls.length, 1);

  const cached = await coordinator.execute({
    agentId: "oc-1",
    harness: "openclaw",
    poke: structuredClone(poke)
  });
  assert.equal(cached, firstResult);
  assert.equal(transport.calls.length, 1);
});

test("same request id with changed payload fails closed", async () => {
  const poke = validPoke();
  const transport = createFakeTransport([validResponse(poke)]);
  const coordinator = createRequestCoordinator({ transport });
  await coordinator.execute({ agentId: "oc-1", harness: "openclaw", poke });

  assert.throws(
    () =>
      coordinator.execute({
        agentId: "oc-1",
        harness: "openclaw",
        poke: validPoke({ round: 3 })
      }),
    /REQUEST_ID_CONFLICT/
  );
});

test("agent status and transaction hash are explicitly non-authoritative", async () => {
  const poke = validPoke();
  const transport = createFakeTransport([validResponse(poke)]);
  const coordinator = createRequestCoordinator({ transport });
  const result = await coordinator.execute({
    agentId: "oc-1",
    harness: "openclaw",
    poke
  });

  assert.equal(result.operational_report.status, "submitted");
  assert.equal(result.operational_report.authoritative_chain_state, false);
});

test("an abort-ignoring timeout fails closed without an overlapping retry", async () => {
  const poke = validPoke();
  let active = 0;
  let maximumActive = 0;
  let calls = 0;
  const transport = {
    async send() {
      calls += 1;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      return new Promise(() => {});
    }
  };
  const coordinator = createRequestCoordinator({
    transport,
    sleep: async () => {},
    timers: immediateTimers()
  });

  await assert.rejects(
    coordinator.execute({ agentId: "oc-1", harness: "openclaw", poke }),
    (error) => {
      assert.equal(error.code, "TRANSPORT_CANCELLATION_UNCONFIRMED");
      assert.equal(error.cause.code, "TRANSPORT_CANCELLATION_UNCONFIRMED");
      assert.equal(error.attempts.length, 1);
      return true;
    }
  );
  assert.equal(calls, 1);
  assert.equal(maximumActive, 1);
  assert.equal(active, 1);
});

test("a response fulfilled during cancellation grace is accepted without a retry", async () => {
  const poke = validPoke();
  let calls = 0;
  const transport = {
    send({ signal }) {
      calls += 1;
      return new Promise((resolve) => {
        signal.addEventListener(
          "abort",
          () => resolve(validResponse(poke, { team_message: "late but complete" })),
          { once: true }
        );
      });
    }
  };
  const coordinator = createRequestCoordinator({
    transport,
    sleep: async () => {},
    timers: immediateTimers()
  });

  const result = await coordinator.execute({
    agentId: "oc-1",
    harness: "openclaw",
    poke
  });
  assert.equal(result.response.team_message, "late but complete");
  assert.equal(calls, 1);
  assert.equal(result.attempts.length, 1);
});

test("agent id, harness, team, and seat prefix are bound before send", () => {
  const poke = validPoke();
  const transport = createFakeTransport([validResponse(poke)]);
  const coordinator = createRequestCoordinator({ transport });

  assert.throws(
    () =>
      coordinator.execute({
        agentId: "hs-1",
        harness: "hermes",
        poke
      }),
    /TARGET_HARNESS_MISMATCH/
  );
  assert.throws(
    () =>
      coordinator.execute({
        agentId: "oc-2",
        harness: "openclaw",
        poke
      }),
    /TARGET_AGENT_MISMATCH/
  );
  assert.equal(transport.calls.length, 0);
});

test("poke identity is snapshotted before asynchronous response validation", async () => {
  const poke = validPoke();
  let release;
  const transport = {
    send() {
      return new Promise((resolve) => {
        release = resolve;
      });
    }
  };
  const coordinator = createRequestCoordinator({ transport });
  const pending = coordinator.execute({
    agentId: "oc-1",
    harness: "openclaw",
    poke
  });

  poke.request_id = "req-mutated";
  poke.round = 99;
  release(validResponse(poke));

  await assert.rejects(pending, (error) => {
    assert.match(error.cause.message, /RESPONSE_IDENTITY_MISMATCH: request_id/);
    return true;
  });
});

test("runtime timeout/retry overrides are rejected instead of hidden from evidence", () => {
  const transport = createFakeTransport([]);
  assert.throws(
    () => createRequestCoordinator({ transport, timeoutMs: 1, maxAttempts: 99 }),
    /unsupported coordinator option/
  );
});

test("reported runtime policy is the exact policy used by the coordinator", async () => {
  const poke = validPoke();
  const transport = createFakeTransport([validResponse(poke)]);
  const coordinator = createRequestCoordinator({ transport });
  const result = await coordinator.execute({
    agentId: "oc-1",
    harness: "openclaw",
    poke
  });

  assert.deepEqual(result.evidence.runtime_policy, {
    timeout_ms: 30_000,
    cancellation_grace_ms: 1_000,
    max_attempts: 3,
    retry_delays_ms: [250, 1_000]
  });
  assert.deepEqual(
    result.evidence.runtime_policy,
    Object.fromEntries(
      Object.entries(transport.calls[0].proxyConfig.settings).filter(([key]) =>
        [
          "timeout_ms",
          "cancellation_grace_ms",
          "max_attempts",
          "retry_delays_ms"
        ].includes(key)
      )
    )
  );
});

test("Hermes uses the same transport policy with a bound Hermes identity", async () => {
  const base = validPoke();
  const poke = validPoke({
    seat_id: "hs-1",
    team: "hermes",
    team_chat: {
      through_sequence: 1,
      messages: [
        {
          ...base.team_chat.messages[0],
          team: "hermes",
          seat_id: "hs-2"
        }
      ]
    }
  });
  const transport = createFakeTransport([validResponse(poke)]);
  const result = await createRequestCoordinator({ transport }).execute({
    agentId: "hs-1",
    harness: "hermes",
    poke
  });

  assert.equal(result.evidence.parity_equal, true);
  assert.equal(transport.calls[0].harness, "hermes");
  assert.equal(
    transport.calls[0].proxyConfig.settings.timeout_ms,
    result.evidence.runtime_policy.timeout_ms
  );
});

test("sensitive metadata is rejected before any transport call", () => {
  const poke = validPoke();
  const transport = createFakeTransport([validResponse(poke)]);
  const coordinator = createRequestCoordinator({ transport });

  assert.throws(
    () =>
      coordinator.execute({
        agentId: "oc-1",
        harness: "openclaw",
        poke,
        metadata: { authToken: "mk_secret" }
      }),
    /SENSITIVE_MATERIAL_REJECTED/
  );
  assert.equal(transport.calls.length, 0);
});
