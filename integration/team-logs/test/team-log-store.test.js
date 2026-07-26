import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  appendFile,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { TeamLogStore } from "../src/index.js";

const seats = Object.freeze([
  { seat_id: "oc-1", team: "openclaw" },
  { seat_id: "oc-2", team: "openclaw" },
  { seat_id: "hs-1", team: "hermes" },
  { seat_id: "hs-2", team: "hermes" }
]);

async function fixture(options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "dilemma-team-logs-"));
  let tick = 0;
  const store = new TeamLogStore({
    runtimeRoot: root,
    gameId: "12",
    seats,
    clock: () => new Date(1_700_000_000_000 + tick++),
    ...options
  });
  await store.initialize();
  return { root, store };
}

function expected(overrides = {}) {
  return {
    request_id: "game-12-round-1-commit-oc-1",
    game_id: "12",
    round: 1,
    phase: "commit",
    seat_id: "oc-1",
    team: "openclaw",
    ...overrides
  };
}

function response(context = expected(), overrides = {}) {
  return {
    schema_version: 1,
    request_id: context.request_id,
    game_id: context.game_id,
    round: context.round,
    phase: context.phase,
    seat_id: context.seat_id,
    status: "submitted",
    transaction_hash: null,
    error: null,
    ...overrides
  };
}

async function jsonl(file) {
  const text = await readFile(file, "utf8");
  return text === ""
    ? []
    : text
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line));
}

test("paired teams append verbatim with isolated per-team sequence and cursor", async () => {
  const { store } = await fixture();
  const open = expected();
  const hermes = expected({
    request_id: "game-12-round-1-commit-hs-1",
    seat_id: "hs-1",
    team: "hermes"
  });
  const exact = "  Keep\nspacing 🦀  ";

  const [a, b] = await Promise.all([
    store.acceptResponse(response(open, { team_message: exact }), open),
    store.acceptResponse(response(hermes, { team_message: "Hermes only" }), hermes)
  ]);
  assert.deepEqual([a.message_record.sequence, b.message_record.sequence], [1, 1]);
  assert.equal(a.message_record.message, exact);

  const openSnapshot = await store.buildSnapshot({
    seat_id: "oc-1",
    team: "openclaw"
  });
  const hermesSnapshot = await store.buildSnapshot({
    seat_id: "hs-1",
    team: "hermes"
  });
  assert.deepEqual(openSnapshot.messages.map((m) => m.message), [exact]);
  assert.deepEqual(hermesSnapshot.messages.map((m) => m.message), ["Hermes only"]);
  assert.equal(openSnapshot.through_sequence, 1);
  assert.equal(hermesSnapshot.through_sequence, 1);
  assert.equal((await jsonl(store.paths.openclaw))[0].message, exact);
  await assert.rejects(
    store.buildSnapshot({ seat_id: "oc-1", team: "hermes" }),
    /immutable assignment/
  );
});

test("missing and empty team_message are valid, nonblocking, and ledger-only", async () => {
  const { store } = await fixture();
  const one = await store.acceptResponse(response(), expected());
  const twoContext = expected({ request_id: "empty" });
  const two = await store.acceptResponse(
    response(twoContext, { team_message: "" }),
    twoContext
  );
  assert.equal(one.accepted, true);
  assert.equal(two.accepted, true);
  assert.equal(one.message_record, null);
  assert.deepEqual(await jsonl(store.paths.openclaw), []);
  assert.equal((await jsonl(store.paths.ledger)).length, 2);
});

test("rejects request-id reuse across restart and keeps valid logs unchanged", async () => {
  const { root, store } = await fixture();
  const original = response(expected(), { team_message: "same" });
  assert.equal((await store.acceptResponse(original, expected())).accepted, true);
  assert.equal((await store.acceptResponse(original, expected())).reason, "DUPLICATE_REQUEST");

  const restarted = new TeamLogStore({
    runtimeRoot: root,
    gameId: "12",
    seats
  });
  await restarted.initialize();
  assert.equal(
    (await restarted.acceptResponse(JSON.stringify(original), expected())).reason,
    "DUPLICATE_REQUEST"
  );
  assert.equal((await jsonl(store.paths.openclaw)).length, 1);
  assert.equal((await jsonl(store.paths.ledger)).length, 3);
});

test("same request and seat cannot accept changed, empty, or missing messages twice", async () => {
  const { store } = await fixture();
  const original = response(expected(), { team_message: "first" });
  assert.equal((await store.acceptResponse(original, expected())).accepted, true);
  assert.equal(
    (
      await store.acceptResponse(
        response(expected(), { team_message: "changed" }),
        expected()
      )
    ).reason,
    "REQUEST_ID_CONFLICT"
  );
  assert.deepEqual(
    (await jsonl(store.paths.openclaw)).map((entry) => entry.message),
    ["first"]
  );

  const emptyContext = expected({ request_id: "empty-idempotency" });
  assert.equal(
    (
      await store.acceptResponse(
        response(emptyContext, { team_message: "" }),
        emptyContext
      )
    ).accepted,
    true
  );
  assert.equal(
    (
      await store.acceptResponse(
        response(emptyContext, { team_message: "" }),
        emptyContext
      )
    ).reason,
    "DUPLICATE_REQUEST"
  );
  assert.equal(
    (
      await store.acceptResponse(
        response(emptyContext),
        emptyContext
      )
    ).reason,
    "DUPLICATE_REQUEST"
  );
  assert.equal((await jsonl(store.paths.journal)).length, 2);
});

test("likely secret-bearing text is rejected without verbatim persistence", async () => {
  const { store } = await fixture();
  const secret = `GAMEPLAY_WALLET_PRIVATE_KEY=0x${"ab".repeat(32)}`;
  const result = await store.acceptResponse(
    response(expected(), { team_message: secret }),
    expected()
  );
  assert.equal(result.reason, "LIKELY_SECRET_BEARING_MESSAGE");
  assert.deepEqual(await jsonl(store.paths.openclaw), []);
  assert.deepEqual(await jsonl(store.paths.journal), []);
  const ledgerText = await readFile(store.paths.ledger, "utf8");
  assert.doesNotMatch(ledgerText, /GAMEPLAY_WALLET_PRIVATE_KEY|abababab/);
  const [entry] = await jsonl(store.paths.ledger);
  assert.equal(entry.message, null);
  assert.equal(entry.message_length, secret.length);
  assert.match(entry.message_digest, /^[0-9a-f]{64}$/);
});

test("rejects malformed, identity mismatch, stale, wrong team, and oversized responses", async () => {
  const { store } = await fixture({ limits: { maxMessageChars: 4 } });
  const cases = [
    ["{", expected(), "MALFORMED_JSON"],
    [response(expected(), { extra: true }), expected(), "MALFORMED_RESPONSE"],
    [response(expected(), { request_id: 1n }), expected(), "MALFORMED_RESPONSE"],
    [response(expected(), { request_id: "other" }), expected(), "MISMATCHED_REQUEST_ID"],
    [response(expected(), { game_id: "13" }), expected(), "WRONG_GAME"],
    [response(expected(), { round: 0 }), expected(), "STALE_ROUND"],
    [response(expected(), { phase: "reveal" }), expected(), "WRONG_PHASE"],
    [response(expected(), { seat_id: "oc-2" }), expected(), "WRONG_SEAT"],
    [response(), expected({ team: "hermes" }), "WRONG_TEAM"],
    [response(expected(), { team_message: "12345" }), expected(), "MESSAGE_TOO_LONG"]
  ];
  for (const [raw, context, reason] of cases) {
    assert.equal((await store.acceptResponse(raw, context)).reason, reason);
  }
  assert.deepEqual(await jsonl(store.paths.openclaw), []);
  assert.deepEqual(await jsonl(store.paths.hermes), []);
  const ledger = await jsonl(store.paths.ledger);
  assert.equal(ledger.length, cases.length);
  assert.ok(ledger.every((entry) => entry.accepted === false));
});

test("snapshot cutoff selects latest bounded history in ascending order", async () => {
  const { store } = await fixture({
    limits: {
      maxMessageChars: 4,
      maxSnapshotChars: 6,
      maxHistoryMessages: 2
    }
  });
  for (const [index, message] of ["aa", "bbb", "cc", "ddd"].entries()) {
    const context = expected({
      request_id: `r-${index}`,
      seat_id: index % 2 ? "oc-2" : "oc-1"
    });
    await store.acceptResponse(response(context, { team_message: message }), context);
  }
  const snapshot = await store.buildSnapshot({
    seat_id: "oc-1",
    team: "openclaw"
  });
  assert.equal(snapshot.through_sequence, 4);
  assert.deepEqual(snapshot.messages.map((entry) => entry.sequence), [3, 4]);
  assert.deepEqual(snapshot.messages.map((entry) => entry.message), ["cc", "ddd"]);
  assert.ok(snapshot.messages.reduce((n, entry) => n + entry.message.length, 0) <= 6);
});

test("opposing-team traffic does not change a team's cursor or sequence", async () => {
  const { store } = await fixture();
  const openOne = expected({ request_id: "open-one" });
  await store.acceptResponse(
    response(openOne, { team_message: "o1" }),
    openOne
  );
  for (let index = 0; index < 3; index += 1) {
    const hermes = expected({
      request_id: `hermes-${index}`,
      seat_id: "hs-1",
      team: "hermes"
    });
    await store.acceptResponse(
      response(hermes, { team_message: `h${index}` }),
      hermes
    );
  }
  let snapshot = await store.buildSnapshot({
    seat_id: "oc-1",
    team: "openclaw"
  });
  assert.equal(snapshot.through_sequence, 1);
  assert.deepEqual(snapshot.messages.map((entry) => entry.sequence), [1]);

  const openTwo = expected({ request_id: "open-two" });
  await store.acceptResponse(
    response(openTwo, { team_message: "o2" }),
    openTwo
  );
  snapshot = await store.buildSnapshot({
    seat_id: "oc-1",
    team: "openclaw"
  });
  assert.equal(snapshot.through_sequence, 2);
  assert.deepEqual(snapshot.messages.map((entry) => entry.sequence), [1, 2]);
});

test("unsafe game ids cannot escape the canonical runtime path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dilemma-team-logs-"));
  for (const gameId of ["../escape", "..", ".", "nested/game", "nested\\game"]) {
    assert.throws(
      () => new TeamLogStore({ runtimeRoot: root, gameId, seats }),
      /gameId is not safe/
    );
  }
});

test("restart rejects a cross-team record injected into the wrong log", async () => {
  const { root, store } = await fixture();
  const corrupt = {
    schema_version: 1,
    game_id: "12",
    round: 1,
    phase: "commit",
    team: "hermes",
    seat_id: "hs-1",
    sequence: 1,
    received_at: "2026-07-26T12:00:00.000Z",
    request_id: "corrupt-cross-team",
    message: "must not leak"
  };
  await appendFile(store.paths.openclaw, `${JSON.stringify(corrupt)}\n`, "utf8");
  const restarted = new TeamLogStore({
    runtimeRoot: root,
    gameId: "12",
    seats
  });
  await assert.rejects(restarted.initialize(), /immutable seat\/team assignment/);
});

test("restart rejects accepted ledger evidence that conflicts with its journal", async () => {
  const { root, store } = await fixture();
  await store.acceptResponse(
    response(expected(), { team_message: "consistent" }),
    expected()
  );
  const ledger = await jsonl(store.paths.ledger);
  ledger[0].phase = "reveal";
  await writeFile(
    store.paths.ledger,
    `${ledger.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    "utf8"
  );

  const restarted = new TeamLogStore({
    runtimeRoot: root,
    gameId: "12",
    seats
  });
  await assert.rejects(
    restarted.initialize(),
    /accepted ledger decision conflicts/
  );
});

test("trailing partial line is preserved and only complete lines are recovered", async () => {
  const { root, store } = await fixture();
  await store.acceptResponse(
    response(expected(), { team_message: "complete" }),
    expected()
  );
  await appendFile(store.paths.openclaw, '{"schema_version":1,"message":"never', "utf8");

  const restarted = new TeamLogStore({
    runtimeRoot: root,
    gameId: "12",
    seats
  });
  await restarted.initialize();

  const files = await readdir(path.dirname(store.paths.openclaw));
  const damaged = files.find((name) => name.startsWith("openclaw.damaged-"));
  const recovered = files.find((name) => name.startsWith("openclaw.recovered-"));
  assert.ok(damaged);
  assert.ok(recovered);
  assert.match(await readFile(path.join(path.dirname(store.paths.openclaw), damaged), "utf8"), /never$/);
  assert.equal((await jsonl(path.join(path.dirname(store.paths.openclaw), recovered))).length, 1);
  assert.equal((await jsonl(store.paths.openclaw)).length, 1);
  assert.ok((await jsonl(store.paths.ledger)).some((entry) => entry.kind === "recovery"));
});

test("partial acceptance ledger is preserved and recovered before reconciliation", async () => {
  const { root, store } = await fixture();
  await store.acceptResponse(
    response(expected(), { team_message: "complete" }),
    expected()
  );
  await appendFile(store.paths.ledger, '{"schema_version":1,"kind":"never', "utf8");

  const restarted = new TeamLogStore({
    runtimeRoot: root,
    gameId: "12",
    seats
  });
  await restarted.initialize();

  const files = await readdir(path.dirname(store.paths.ledger));
  const damaged = files.find((name) =>
    name.startsWith("acceptance-ledger.damaged-")
  );
  const recovered = files.find((name) =>
    name.startsWith("acceptance-ledger.recovered-")
  );
  assert.ok(damaged);
  assert.ok(recovered);
  assert.match(
    await readFile(path.join(path.dirname(store.paths.ledger), damaged), "utf8"),
    /never$/
  );
  assert.ok(
    (await jsonl(restarted.paths.ledger)).some(
      (entry) => entry.kind === "recovery" && entry.source === "acceptance-ledger"
    )
  );
});

test("partial acceptance journal is preserved without duplicating materialized records", async () => {
  const { root, store } = await fixture();
  await store.acceptResponse(
    response(expected(), { team_message: "complete" }),
    expected()
  );
  await appendFile(store.paths.journal, '{"schema_version":1,"kind":"never', "utf8");

  const restarted = new TeamLogStore({
    runtimeRoot: root,
    gameId: "12",
    seats
  });
  await restarted.initialize();
  const files = await readdir(restarted.directory);
  assert.ok(
    files.some((name) => name.startsWith("acceptance-journal.damaged-"))
  );
  assert.equal((await jsonl(restarted.paths.openclaw)).length, 1);
  assert.equal(
    (await jsonl(restarted.paths.ledger)).filter((entry) => entry.accepted).length,
    1
  );
});

test("same-clock recoveries use exclusive artifacts and never overwrite evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dilemma-team-logs-"));
  const clock = () => new Date("2026-07-26T12:00:00.000Z");
  let store = new TeamLogStore({
    runtimeRoot: root,
    gameId: "12",
    seats,
    clock
  });
  await store.initialize();
  await appendFile(store.paths.openclaw, "partial-one", "utf8");

  store = new TeamLogStore({ runtimeRoot: root, gameId: "12", seats, clock });
  await store.initialize();
  await appendFile(store.paths.openclaw, "partial-two", "utf8");

  store = new TeamLogStore({ runtimeRoot: root, gameId: "12", seats, clock });
  await store.initialize();
  const files = await readdir(store.directory);
  const damaged = files.filter((name) =>
    name.startsWith("openclaw.damaged-")
  );
  assert.equal(damaged.length, 2);
  const contents = await Promise.all(
    damaged.map((name) => readFile(path.join(store.directory, name), "utf8"))
  );
  assert.deepEqual(new Set(contents), new Set(["partial-one", "partial-two"]));
});

test("team write failure leaves a journal intent that is reconciled before later work", async () => {
  const { root } = await fixture();
  const real = await import("node:fs/promises");
  let failTeamAppend = false;
  const failingFs = {
    ...real,
    appendFile: async (file, ...args) => {
      if (failTeamAppend && file.endsWith("openclaw.jsonl")) {
        failTeamAppend = false;
        throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
      }
      return real.appendFile(file, ...args);
    }
  };
  const store = new TeamLogStore({
    runtimeRoot: root,
    gameId: "13",
    seats,
    fs: failingFs
  });
  await store.initialize();
  failTeamAppend = true;
  await assert.rejects(
    store.acceptResponse(
      response(expected({ game_id: "13" }), { team_message: "x" }),
      expected({ game_id: "13" })
    ),
    /disk full/
  );
  const context = expected({ game_id: "13", request_id: "retry" });
  const accepted = await store.acceptResponse(
    response(context, { team_message: "y" }),
    context
  );
  assert.equal(accepted.message_record.sequence, 2);
  assert.deepEqual(
    (await jsonl(store.paths.openclaw)).map((entry) => entry.message),
    ["x", "y"]
  );
});

test("ledger write failure is reconciled without duplicating the durable message", async () => {
  const real = await import("node:fs/promises");
  const root = await mkdtemp(path.join(os.tmpdir(), "dilemma-team-logs-"));
  let failLedger = false;
  const failingFs = {
    ...real,
    appendFile: async (file, data, ...args) => {
      if (
        failLedger &&
        file.endsWith("acceptance-ledger.jsonl") &&
        String(data).includes('"accepted":true')
      ) {
        failLedger = false;
        throw Object.assign(new Error("ledger unavailable"), { code: "EIO" });
      }
      return real.appendFile(file, data, ...args);
    }
  };
  const store = new TeamLogStore({
    runtimeRoot: root,
    gameId: "12",
    seats,
    fs: failingFs
  });
  await store.initialize();
  const raw = response(expected(), { team_message: "durable" });
  failLedger = true;
  await assert.rejects(store.acceptResponse(raw, expected()), /ledger unavailable/);
  assert.equal((await jsonl(store.paths.openclaw)).length, 1);
  assert.equal(
    (await store.acceptResponse(raw, expected())).reason,
    "DUPLICATE_REQUEST"
  );
  assert.equal(
    (await jsonl(store.paths.ledger)).filter(
      (entry) => entry.kind === "response_decision" && entry.accepted
    ).length,
    1
  );
  const nextContext = expected({ request_id: "after-ledger-failure" });
  const next = await store.acceptResponse(
    response(nextContext, { team_message: "next" }),
    nextContext
  );
  assert.equal(next.message_record.sequence, 2);
});

test("restart reconciles an intent when the process stopped before the team append", async () => {
  const real = await import("node:fs/promises");
  const root = await mkdtemp(path.join(os.tmpdir(), "dilemma-team-logs-"));
  let failOnce = false;
  const failingFs = {
    ...real,
    appendFile: async (file, ...args) => {
      if (failOnce && file.endsWith("openclaw.jsonl")) {
        failOnce = false;
        throw Object.assign(new Error("team append interrupted"), { code: "EIO" });
      }
      return real.appendFile(file, ...args);
    }
  };
  const first = new TeamLogStore({
    runtimeRoot: root,
    gameId: "12",
    seats,
    fs: failingFs
  });
  await first.initialize();
  failOnce = true;
  await assert.rejects(
    first.acceptResponse(
      response(expected(), { team_message: "journaled" }),
      expected()
    ),
    /team append interrupted/
  );

  const restarted = new TeamLogStore({ runtimeRoot: root, gameId: "12", seats });
  await restarted.initialize();
  assert.deepEqual(
    (await jsonl(restarted.paths.openclaw)).map((entry) => entry.message),
    ["journaled"]
  );
  assert.equal(
    (await jsonl(restarted.paths.ledger)).filter((entry) => entry.accepted).length,
    1
  );
});

test("restart reconciles acceptance evidence after a team/ledger split write", async () => {
  const real = await import("node:fs/promises");
  const root = await mkdtemp(path.join(os.tmpdir(), "dilemma-team-logs-"));
  let failOnce = true;
  const failingFs = {
    ...real,
    appendFile: async (file, data, ...args) => {
      if (
        failOnce &&
        file.endsWith("acceptance-ledger.jsonl") &&
        String(data).includes('"accepted":true')
      ) {
        failOnce = false;
        throw Object.assign(new Error("ledger append interrupted"), { code: "EIO" });
      }
      return real.appendFile(file, data, ...args);
    }
  };
  const first = new TeamLogStore({
    runtimeRoot: root,
    gameId: "12",
    seats,
    fs: failingFs
  });
  await first.initialize();
  await assert.rejects(
    first.acceptResponse(
      response(expected(), { team_message: "team-first" }),
      expected()
    ),
    /ledger append interrupted/
  );

  const restarted = new TeamLogStore({ runtimeRoot: root, gameId: "12", seats });
  await restarted.initialize();
  assert.equal((await jsonl(restarted.paths.openclaw)).length, 1);
  assert.equal(
    (await jsonl(restarted.paths.ledger)).filter((entry) => entry.accepted).length,
    1
  );
  assert.equal(
    (
      await restarted.acceptResponse(
        response(expected(), { team_message: "team-first" }),
        expected()
      )
    ).reason,
    "DUPLICATE_REQUEST"
  );
});

test("filesystem read failures propagate during initialization", async () => {
  const real = await import("node:fs/promises");
  const root = await mkdtemp(path.join(os.tmpdir(), "dilemma-team-logs-"));
  const failingFs = {
    ...real,
    readFile: async () => {
      throw Object.assign(new Error("read denied"), { code: "EIO" });
    }
  };
  const store = new TeamLogStore({
    runtimeRoot: root,
    gameId: "12",
    seats,
    fs: failingFs
  });
  await assert.rejects(store.initialize(), /read denied/);
});
