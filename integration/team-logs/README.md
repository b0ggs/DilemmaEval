# Team logs

Zero-dependency Node.js (20+) implementation of the DilemmaEval off-chain team
message store. The orchestrator is the only supported writer.

The store writes the canonical files:

```text
<runtimeRoot>/runtime/chat/<game-id>/openclaw.jsonl
<runtimeRoot>/runtime/chat/<game-id>/hermes.jsonl
<runtimeRoot>/runtime/chat/<game-id>/acceptance-ledger.jsonl
<runtimeRoot>/runtime/chat/<game-id>/acceptance-journal.jsonl
```

It validates the shared response envelope, an immutable seat/team manifest, and
the expected request context before accepting a message. Accepted message text
is passed to `JSON.stringify` without trimming or rewriting. Rejections are
evidence records and never enter a team log. Likely secret-bearing messages
(private keys, common API-token formats, authorization values, secret-bearing
environment assignments, and PEM private keys) are rejected before verbatim
persistence. Rejection evidence stores only message length and SHA-256 digest,
never rejected text.

`request_id` plus `seat_id` is the acceptance idempotency key. A changed,
missing, or empty retry cannot create another accepted decision or message.
The append-only acceptance journal is written first; initialization reconciles
any journaled decision missing its team record or acceptance-ledger evidence.

## API

```js
import { TeamLogStore } from "./src/index.js";

const logs = new TeamLogStore({
  runtimeRoot: "/srv/dilemma",
  gameId: "12",
  seats: [
    { seat_id: "oc-1", team: "openclaw" },
    { seat_id: "hs-1", team: "hermes" }
  ],
  limits: {
    maxMessageChars: 2_000,
    maxSnapshotChars: 8_000,
    maxHistoryMessages: 20
  }
});

await logs.initialize();
await logs.acceptResponse(rawJsonOrObject, {
  request_id: "game-12-round-1-commit-oc-1",
  game_id: "12",
  round: 1,
  phase: "commit",
  seat_id: "oc-1",
  team: "openclaw"
});

const snapshot = await logs.buildSnapshot({
  seat_id: "oc-1",
  team: "openclaw"
});
```

`team_message` may be missing or empty; in either case the response is valid,
the decision is recorded, and no message line is appended. `acceptResponse`
returns `{ accepted, reason, message_record }`. Validation rejections resolve
normally with `accepted: false`; filesystem failures reject the promise.

`buildSnapshot` verifies the seat/team pair against the immutable manifest and
returns only that team’s records, in ascending sequence order, bounded by the
same configured history and character limits. `through_sequence` is the
highest sequence in that team's own log when construction starts. Sequences are
per-team, so opposing-team activity cannot be inferred from cursor changes or
gaps.

## Crash recovery

On initialization, a trailing partial line in either team log, the acceptance
ledger, or the journal is copied byte-for-byte to a `.damaged-*` evidence file.
Only complete lines are copied into an exclusive `.recovered-*` evidence file
and the canonical exact path. Exclusive creation prevents a repeated timestamp
or restart from overwriting earlier evidence. The action is appended to the
acceptance ledger. A damaged line is never parsed, completed, or reconstructed.

## Test

```bash
npm test --prefix integration/team-logs
```

This module deliberately has no chain, wallet, game-rule, Maritime, or external
chat dependency.
