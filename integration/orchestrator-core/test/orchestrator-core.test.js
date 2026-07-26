import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createMemoryStore,
  createOrchestratorCore,
  evaluateChainSnapshot,
  normalizeChainSnapshot
} from "../src/index.js";

const HASH_A = `0x${"01".repeat(32)}`;
const HASH_B = `0x${"02".repeat(32)}`;

function snapshot(overrides = {}) {
  const phase = overrides.phase ?? "commit";
  const blockNumber = overrides.block_number ?? "100";
  const clocks = {
    join: { unit: "timestamp", current: "100", deadline: "110" },
    commit: { unit: "block", current: blockNumber, deadline: "110" },
    reveal: { unit: "block", current: blockNumber, deadline: "110" },
    terminal: null
  };
  return {
    schema_version: 1,
    game_id: "12",
    round: 1,
    phase,
    block_number: blockNumber,
    block_hash: HASH_A,
    alive_count: 10,
    committed_count: 0,
    revealed_count: 0,
    clock: clocks[phase],
    ...overrides
  };
}

function request(overrides = {}) {
  const phase = overrides.phase ?? "commit";
  const seatId = overrides.seat_id ?? "oc-1";
  const team = overrides.team ?? (seatId.startsWith("oc-") ? "openclaw" : "hermes");
  const base = {
    request_id: "game-12-round-1-commit-oc-1",
    game_id: "12",
    round: 1,
    phase,
    seat_id: seatId,
    team,
    chain_state: {},
    team_chat: { through_sequence: 0, messages: [] },
    requested_action: phase,
    response_schema_version: 1
  };
  return { ...base, ...overrides };
}

function responseFor(poke, overrides = {}) {
  return {
    schema_version: 1,
    request_id: poke.request_id,
    game_id: poke.game_id,
    round: poke.round,
    phase: poke.phase,
    seat_id: poke.seat_id,
    status: "submitted",
    transaction_hash: `0x${"ab".repeat(32)}`,
    error: null,
    ...overrides
  };
}

function sequenceReader(items, calls = []) {
  let index = 0;
  return async () => {
    calls.push(`read:${index}`);
    const item = items[Math.min(index, items.length - 1)];
    index += 1;
    return structuredClone(item);
  };
}

function coreWith({
  snapshots = [snapshot()],
  requester = async () => ({ status: "accepted" }),
  store = createMemoryStore(),
  calls = []
} = {}) {
  return createOrchestratorCore({
    readChainSnapshot: sequenceReader(snapshots, calls),
    requestAdvance: async (intent) => {
      calls.push("request-advance");
      return requester(intent);
    },
    store
  });
}

test("join never exits early from player counts", () => {
  const result = evaluateChainSnapshot(
    snapshot({
      phase: "join",
      alive_count: 10,
      committed_count: 10,
      revealed_count: 10
    })
  );
  assert.equal(result.status, "wait");
  assert.equal(result.reason, "predicate-not-met");
});

test("join advances only after its timestamp deadline", () => {
  const atDeadline = evaluateChainSnapshot(
    snapshot({
      phase: "join",
      clock: { unit: "timestamp", current: "110", deadline: "110" }
    })
  );
  const result = evaluateChainSnapshot(
    snapshot({
      phase: "join",
      clock: { unit: "timestamp", current: "111", deadline: "110" }
    })
  );
  assert.equal(atDeadline.status, "wait");
  assert.equal(result.status, "advance-eligible");
  assert.equal(result.reason, "join-deadline-reached");
});

test("commit advances when all alive players committed", () => {
  const result = evaluateChainSnapshot(snapshot({ committed_count: 10 }));
  assert.equal(result.status, "advance-eligible");
  assert.equal(result.reason, "all-alive-committed");
});

test("commit advances only after its block deadline", () => {
  const atDeadline = evaluateChainSnapshot(
    snapshot({
      block_number: "110",
      clock: { unit: "block", current: "110", deadline: "110" }
    })
  );
  const result = evaluateChainSnapshot(
    snapshot({
      block_number: "111",
      clock: { unit: "block", current: "111", deadline: "110" }
    })
  );
  assert.equal(atDeadline.status, "wait");
  assert.equal(result.status, "advance-eligible");
  assert.equal(result.reason, "commit-deadline-reached");
});

test("reveal advances from revealed-to-committed count, not alive count", () => {
  const notReady = evaluateChainSnapshot(
    snapshot({ phase: "reveal", committed_count: 8, revealed_count: 7 })
  );
  const ready = evaluateChainSnapshot(
    snapshot({ phase: "reveal", committed_count: 8, revealed_count: 8 })
  );
  assert.equal(notReady.status, "wait");
  assert.equal(ready.reason, "all-committed-revealed");
});

test("reveal deadline is strict and equality remains open", () => {
  const atDeadline = evaluateChainSnapshot(
    snapshot({
      phase: "reveal",
      committed_count: 8,
      revealed_count: 7,
      block_number: "110",
      clock: { unit: "block", current: "110", deadline: "110" }
    })
  );
  const afterDeadline = evaluateChainSnapshot(
    snapshot({
      phase: "reveal",
      committed_count: 8,
      revealed_count: 7,
      block_number: "111",
      clock: { unit: "block", current: "111", deadline: "110" }
    })
  );
  assert.equal(atDeadline.status, "wait");
  assert.equal(afterDeadline.reason, "reveal-deadline-reached");
});

test("terminal never advances", () => {
  const result = evaluateChainSnapshot(snapshot({ phase: "terminal" }));
  assert.equal(result.status, "terminal");
  assert.equal(result.eligible, false);
});

test("wrong clock units and impossible counts fail closed", () => {
  assert.throws(
    () =>
      normalizeChainSnapshot(
        snapshot({ clock: { unit: "timestamp", current: "1", deadline: "2" } })
      ),
    /clock unit/
  );
  assert.throws(
    () => normalizeChainSnapshot(snapshot({ committed_count: 11 })),
    /cannot exceed/
  );
  assert.throws(
    () =>
      normalizeChainSnapshot(
        snapshot({ committed_count: 8, revealed_count: 9 })
      ),
    /cannot exceed/
  );
});

test("noncanonical decimals and extra fields fail closed", () => {
  assert.throws(
    () => normalizeChainSnapshot(snapshot({ block_number: "01" })),
    /canonical/
  );
  assert.throws(
    () => normalizeChainSnapshot({ ...snapshot(), acknowledgement: true }),
    /invalid fields/
  );
});

test("eligible action requires two reads before requester invocation", async () => {
  const calls = [];
  const core = coreWith({
    snapshots: [
      snapshot({ committed_count: 10 }),
      snapshot({ committed_count: 10, block_number: "101", block_hash: HASH_B })
    ],
    calls
  });
  const result = await core.advanceIfEligible();
  assert.equal(result.status, "advance-requested");
  assert.deepEqual(calls, ["read:0", "read:1", "request-advance"]);
});

test("ineligible action performs no requester call", async () => {
  const calls = [];
  const result = await coreWith({ calls }).advanceIfEligible();
  assert.equal(result.status, "wait");
  assert.deepEqual(calls, ["read:0"]);
});

test("phase change on mandatory reread returns reevaluate", async () => {
  const calls = [];
  const result = await coreWith({
    snapshots: [
      snapshot({ committed_count: 10 }),
      snapshot({
        phase: "reveal",
        committed_count: 10,
        revealed_count: 0,
        block_number: "101",
        block_hash: HASH_B
      })
    ],
    calls
  }).advanceIfEligible();
  assert.equal(result.status, "reread-and-reevaluate");
  assert.deepEqual(calls, ["read:0", "read:1"]);
});

test("regressed pre-submit block is stale even when predicate is unchanged", async () => {
  const calls = [];
  const result = await coreWith({
    snapshots: [
      snapshot({
        committed_count: 10,
        block_number: "101",
        block_hash: HASH_B
      }),
      snapshot({ committed_count: 10 })
    ],
    calls
  }).advanceIfEligible();
  assert.equal(result.status, "reread-and-reevaluate");
  assert.deepEqual(calls, ["read:0", "read:1"]);
});

test("regressed join timestamp is stale even when both reads are deadline-eligible", async () => {
  const calls = [];
  const result = await coreWith({
    snapshots: [
      snapshot({
        phase: "join",
        block_number: "100",
        clock: { unit: "timestamp", current: "112", deadline: "110" }
      }),
      snapshot({
        phase: "join",
        block_number: "101",
        block_hash: HASH_B,
        clock: { unit: "timestamp", current: "111", deadline: "110" }
      })
    ],
    calls
  }).advanceIfEligible();
  assert.equal(result.status, "reread-and-reevaluate");
  assert.equal(result.reason, "stale-or-ineligible-pre-submit-snapshot");
  assert.deepEqual(calls, ["read:0", "read:1"]);
});

test("relevant count change on reread invalidates predicate token", async () => {
  const calls = [];
  const result = await coreWith({
    snapshots: [
      snapshot({
        block_number: "111",
        clock: { unit: "block", current: "111", deadline: "110" },
        committed_count: 8
      }),
      snapshot({
        clock: { unit: "block", current: "112", deadline: "110" },
        committed_count: 9,
        block_number: "112",
        block_hash: HASH_B
      })
    ],
    calls
  }).advanceIfEligible();
  assert.equal(result.status, "reread-and-reevaluate");
  assert.deepEqual(calls, ["read:0", "read:1"]);
});

test("newer block with unchanged predicate inputs remains eligible", async () => {
  const result = await coreWith({
    snapshots: [
      snapshot({ committed_count: 10 }),
      snapshot({ committed_count: 10, block_number: "101", block_hash: HASH_B })
    ]
  }).advanceIfEligible();
  assert.equal(result.status, "advance-requested");
  assert.equal(result.intent.source_block_number, "101");
  assert.equal(result.intent.source_block_hash, HASH_B);
});

test("requester receives only the frozen credential-free intent", async () => {
  let captured;
  const result = await coreWith({
    snapshots: [snapshot({ committed_count: 10 })],
    requester: async (intent) => {
      captured = intent;
      assert.equal(Object.isFrozen(intent), true);
      return {
        status: "accepted",
        reference: { kind: "request-id", value: "queue-1" }
      };
    }
  }).advanceIfEligible();
  assert.deepEqual(Object.keys(captured).sort(), [
    "action_id",
    "attempt_id",
    "game_id",
    "phase",
    "reason",
    "round",
    "schema_version",
    "source_block_hash",
    "source_block_number",
    "source_predicate_token",
    "type"
  ]);
  assert.equal(JSON.stringify(captured).includes("key"), false);
  assert.deepEqual(result.reference, { kind: "request-id", value: "queue-1" });
});

test("ambiguous race-or-revert requires manual reconciliation", async () => {
  let attempts = 0;
  const store = createMemoryStore();
  const requester = async () => {
    attempts += 1;
    return { status: "race-or-revert" };
  };
  const result = await coreWith({
    snapshots: [snapshot({ committed_count: 10 })],
    requester,
    store
  }).advanceIfEligible();
  const later = await coreWith({
    snapshots: [
      snapshot({
        committed_count: 10,
        block_number: "101",
        block_hash: HASH_B
      })
    ],
    requester,
    store
  }).advanceIfEligible();
  assert.equal(result.status, "manual-reconciliation-required");
  assert.equal(later.status, "manual-reconciliation-required");
  assert.equal(attempts, 1);
});

test("requester throw remains submission-unknown and is never retried", async () => {
  let attempts = 0;
  const store = createMemoryStore();
  const requester = async () => {
    attempts += 1;
    throw Object.assign(new Error("transport lost"), {
      code: "CONNECTION_LOST"
    });
  };
  const result = await coreWith({
    snapshots: [snapshot({ committed_count: 10 })],
    requester,
    store
  }).advanceIfEligible();
  const later = await coreWith({
    snapshots: [
      snapshot({
        committed_count: 10,
        block_number: "101",
        block_hash: HASH_B
      })
    ],
    requester,
    store
  }).advanceIfEligible();
  assert.equal(result.status, "manual-reconciliation-required");
  assert.equal(later.status, "manual-reconciliation-required");
  assert.equal(attempts, 1);
});

test("persisted action prevents duplicate submission after restart", async () => {
  const store = createMemoryStore();
  let attempts = 0;
  const requester = async () => {
    attempts += 1;
    return { status: "accepted" };
  };
  const first = await coreWith({
    snapshots: [snapshot({ committed_count: 10 })],
    requester,
    store
  }).advanceIfEligible();
  const restarted = await coreWith({
    snapshots: [snapshot({ committed_count: 10 })],
    requester,
    store
  }).advanceIfEligible();
  assert.equal(first.status, "advance-requested");
  assert.equal(restarted.status, "duplicate-action");
  assert.equal(attempts, 1);
});

test("accepted submission remains blocked at a newer eligible block", async () => {
  const store = createMemoryStore();
  let attempts = 0;
  const requester = async () => {
    attempts += 1;
    return { status: "accepted" };
  };
  await coreWith({
    snapshots: [snapshot({ committed_count: 10 })],
    requester,
    store
  }).advanceIfEligible();
  const later = await coreWith({
    snapshots: [
      snapshot({
        committed_count: 10,
        block_number: "101",
        block_hash: HASH_B
      })
    ],
    requester,
    store
  }).advanceIfEligible();
  assert.equal(later.status, "manual-reconciliation-required");
  assert.equal(later.reason, "prior-action-submission-accepted");
  assert.equal(attempts, 1);
});

test("logical action identity survives count-to-deadline predicate transition", async () => {
  const store = createMemoryStore();
  let attempts = 0;
  const requester = async () => {
    attempts += 1;
    return { status: "accepted" };
  };
  const early = await coreWith({
    snapshots: [snapshot({ committed_count: 10 })],
    requester,
    store
  }).advanceIfEligible();
  const afterDeadline = await coreWith({
    snapshots: [
      snapshot({
        committed_count: 10,
        block_number: "111",
        block_hash: HASH_B
      })
    ],
    requester,
    store
  }).advanceIfEligible();

  assert.equal(early.status, "advance-requested");
  assert.equal(afterDeadline.status, "manual-reconciliation-required");
  assert.equal(early.intent.action_id, afterDeadline.intent.action_id);
  assert.notEqual(
    early.intent.source_predicate_token,
    afterDeadline.intent.source_predicate_token
  );
  assert.equal(attempts, 1);
});

test("simultaneous eligible evaluations atomically claim one attempt", async () => {
  const store = createMemoryStore();
  let attempts = 0;
  const requester = async () => {
    attempts += 1;
    await Promise.resolve();
    return { status: "accepted" };
  };
  const first = coreWith({
    snapshots: [snapshot({ committed_count: 10 })],
    requester,
    store
  });
  const second = coreWith({
    snapshots: [snapshot({ committed_count: 10 })],
    requester,
    store
  });
  const results = await Promise.all([
    first.advanceIfEligible(),
    second.advanceIfEligible()
  ]);
  assert.equal(attempts, 1);
  assert.deepEqual(
    results.map(({ status }) => status).sort(),
    ["advance-requested", "duplicate-action"]
  );
});

test("confirmed revert retries only with a newly evidenced eligible block", async () => {
  const store = createMemoryStore();
  let attempts = 0;
  const requester = async () => {
    attempts += 1;
    return attempts === 1
      ? {
          status: "confirmed-revert",
          reference: {
            kind: "transaction-hash",
            value: `0x${"cd".repeat(32)}`
          }
        }
      : {
          status: "accepted",
          reference: { kind: "request-id", value: "queue-2" }
        };
  };

  const first = await coreWith({
    snapshots: [snapshot({ committed_count: 10 })],
    requester,
    store
  }).advanceIfEligible();
  const sameBlock = await coreWith({
    snapshots: [snapshot({ committed_count: 10 })],
    requester,
    store
  }).advanceIfEligible();
  const newerBlock = await coreWith({
    snapshots: [
      snapshot({
        committed_count: 10,
        block_number: "101",
        block_hash: HASH_B
      })
    ],
    requester,
    store
  }).advanceIfEligible();

  assert.equal(first.status, "reread-and-reevaluate");
  assert.equal(sameBlock.status, "duplicate-action");
  assert.equal(newerBlock.status, "advance-requested");
  assert.equal(attempts, 2);
  const [action] = await store.entries("action:");
  assert.equal(action.value.state, "submission-accepted");
  assert.equal(action.value.attempts.length, 2);
  assert.deepEqual(
    action.value.attempts.map(({ status }) => status),
    ["confirmed-revert", "submission-accepted"]
  );
});

test("atomic request claim distinguishes duplicate from conflict", async () => {
  const core = coreWith();
  assert.equal((await core.recordRequest(request())).status, "recorded");
  assert.equal((await core.recordRequest(request())).status, "duplicate");
  assert.equal(
    (
      await core.recordRequest(
        request({ game_id: "13" })
      )
    ).status,
    "conflict"
  );
});

test("response acknowledgement rejects orphan and deduplicates", async () => {
  const core = coreWith();
  const poke = request();
  const response = responseFor(poke);
  assert.equal((await core.recordResponse(response)).status, "orphan-rejected");
  await core.recordRequest(poke);
  assert.equal((await core.recordResponse(response)).status, "recorded");
  assert.equal((await core.recordResponse(response)).status, "duplicate");
  assert.equal(
    (await core.recordResponse({ ...response, status: "observed" })).status,
    "conflict"
  );
});

test("full shared response is identity-bound and preserves optional fields", async () => {
  const store = createMemoryStore();
  const core = coreWith({ store });
  const poke = request();
  await core.recordRequest(poke);
  const response = responseFor(poke, {
    status: "error",
    transaction_hash: null,
    team_message: "verbatim team note",
    error: { code: "PLAYER_ACTION_FAILED", message: "failed locally" }
  });
  assert.equal((await core.recordResponse(response)).status, "recorded");

  const wrongSeat = responseFor(poke, { seat_id: "oc-2" });
  await assert.rejects(
    core.recordResponse(wrongSeat),
    /RESPONSE_IDENTITY_MISMATCH/
  );
  const [stored] = await store.entries("response:");
  assert.equal(stored.value.team, "openclaw");
  assert.equal(stored.value.response.team_message, "verbatim team note");
  assert.deepEqual(stored.value.response.error, response.error);
});

test("agent acknowledgements cannot cause early advancement", async () => {
  const calls = [];
  const core = coreWith({ calls });
  for (let index = 1; index <= 5; index += 1) {
    const requestId = `game-12-round-1-commit-oc-${index}`;
    const poke = request({ request_id: requestId, seat_id: `oc-${index}` });
    await core.recordRequest(poke);
    await core.recordResponse(responseFor(poke));
  }
  const result = await core.advanceIfEligible();
  assert.equal(result.status, "wait");
  assert.deepEqual(calls, ["read:0"]);
});

test("resume reads chain truth before persistence and does not act", async () => {
  const calls = [];
  const base = createMemoryStore();
  const store = {
    async get(key) {
      calls.push(`store:get:${key}`);
      return base.get(key);
    },
    async putIfAbsent(key, value) {
      return base.putIfAbsent(key, value);
    },
    async set(key, value) {
      return base.set(key, value);
    },
    async compareAndSet(key, expectedRevision, value) {
      return base.compareAndSet(key, expectedRevision, value);
    },
    async entries(prefix) {
      calls.push(`store:entries:${prefix}`);
      return base.entries(prefix);
    }
  };
  const core = coreWith({ store, calls });
  await core.recordRequest(request());
  calls.length = 0;
  const resumed = await core.resume();
  assert.equal(calls[0], "read:0");
  assert.equal(calls.includes("request-advance"), false);
  assert.equal(resumed.pending_requests.length, 1);
  assert.equal(resumed.evaluation.status, "wait");
});

test("completed response is not returned as pending on restart", async () => {
  const core = coreWith();
  const poke = request();
  await core.recordRequest(poke);
  await core.recordResponse(responseFor(poke, { status: "observed" }));
  const resumed = await core.resume();
  assert.deepEqual(resumed.pending_requests, []);
});

test("resume rejects malformed persisted request, response, and action records", async () => {
  const malformedRequest = createMemoryStore([
    {
      key: "request:bad",
      value: { kind: "request", fingerprint: "wrong", request: {} }
    }
  ]);
  await assert.rejects(
    coreWith({ store: malformedRequest }).resume(),
    /persisted request/i
  );

  const malformedAction = createMemoryStore([
    {
      key: "action:bad",
      value: {
        kind: "advance-action",
        revision: 0,
        state: "submission-accepted"
      }
    }
  ]);
  await assert.rejects(
    coreWith({ store: malformedAction }).resume(),
    /persisted action has invalid fields/i
  );

  const malformedResponse = createMemoryStore([
    {
      key: "response:bad",
      value: {
        kind: "response-acknowledgement",
        fingerprint: "wrong",
        team: "openclaw",
        response: {}
      }
    }
  ]);
  await assert.rejects(
    coreWith({ store: malformedResponse }).resume(),
    /response has invalid fields/i
  );
});

test("request action mismatch fails closed", async () => {
  const core = coreWith();
  await assert.rejects(
    core.recordRequest(request({ requested_action: "reveal" })),
    /must equal/
  );
});

test("malformed requester result becomes submission-unknown", async () => {
  const core = coreWith({
    snapshots: [snapshot({ committed_count: 10 })],
    requester: async () => ({ status: "accepted", transaction: "forbidden" })
  });
  const result = await core.advanceIfEligible();
  assert.equal(result.status, "manual-reconciliation-required");
  assert.equal(result.reason, "invalid-advance-requester-outcome");
});

test("secret-shaped and untyped requester references are never persisted", async () => {
  for (const reference of [
    "queue-1",
    { kind: "request-id", value: "sk-secret-credential" },
    { kind: "transaction-hash", value: "not-a-hash" }
  ]) {
    const store = createMemoryStore();
    const core = coreWith({
      snapshots: [snapshot({ committed_count: 10 })],
      requester: async () => ({ status: "accepted", reference }),
      store
    });
    const result = await core.advanceIfEligible();
    assert.equal(result.status, "manual-reconciliation-required");
    const [action] = await store.entries("action:");
    assert.equal(action.value.state, "submission-unknown");
    assert.deepEqual(action.value.outcome, {
      status: "invalid-requester-outcome"
    });
  }
});
