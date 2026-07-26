# Credential-free orchestrator core

This leaf implements only the deterministic M09 state, restart, and
idempotency core. It performs no network access and has no runtime dependency.
Its chain reader, persistence store, and advancement requester are injected
interfaces.

It deliberately does **not** contain a signer, key or environment-variable
reader, RPC transaction submission, phase executor, Maritime transport,
gameplay decision, player message, VM process manager, JSONL recovery, or
observer writer. Those remain separate modules and release gates.

## Canonical chain snapshot

The injected reader returns:

```json
{
  "schema_version": 1,
  "game_id": "12",
  "round": 1,
  "phase": "commit",
  "block_number": "123",
  "block_hash": "0x000000000000000000000000000000000000000000000000000000000000007b",
  "alive_count": 10,
  "committed_count": 10,
  "revealed_count": 0,
  "clock": {
    "unit": "block",
    "current": "123",
    "deadline": "140"
  }
}
```

Join uses a `timestamp` clock; commit and reveal use a `block` clock. Terminal
snapshots have `clock: null`. Decimal strings avoid JSON integer loss.
Commit/reveal `clock.current` must equal `block_number`, and the mandatory
pre-submit snapshot may not regress below the first read's block or active
clock value (including the join timestamp).

The core treats a deadline as passed only when `current > deadline`. This is
the exact behavior of pinned
`PrisonersDAOlemma.sol` revision
`955ce16a59b0efecf6ccdf2d391ede83de8902a8`: equality is the last valid join,
commit, or reveal boundary, and advancement becomes deadline-eligible on the
next timestamp/block.

## Advancement rules

- Join is eligible only strictly after its on-chain deadline. Player counts never
  create an early join exit.
- Commit is eligible when `committed_count == alive_count` or its block
  deadline has passed.
- Reveal is eligible when `revealed_count == committed_count` or its block
  deadline has passed. This exact pinned-contract condition matters when a
  living player defaulted by not committing.
- Terminal never advances.
- Agent responses and transaction hashes are acknowledgements only. Recording
  them cannot invoke or affect advancement.

`advanceIfEligible()` reads chain state twice. The second read occurs inside
the method immediately before action reservation and requester invocation. A
semantic predicate token compares game, round, phase, alive count, relevant
acted count, deadline, and deadline-reached state. It intentionally excludes
the observation block so a newer block with identical authoritative predicate
inputs is acceptable. Changed or ineligible state returns
`reread-and-reevaluate`.

The injected requester receives only this frozen intent:

```json
{
  "schema_version": 1,
  "type": "advance-request",
  "action_id": "advance:<sha256>",
  "attempt_id": "advance:<sha256>:<snapshot-sha256>",
  "game_id": "12",
  "round": 1,
  "phase": "commit",
  "source_block_number": "123",
  "source_block_hash": "0x...",
  "source_predicate_token": "<sha256>",
  "reason": "all-alive-committed"
}
```

It may return `accepted`, `confirmed-revert`, `race-or-revert`, or
`rejected-before-submit`, with an optional non-secret reference. These names
are safety claims:

- `accepted` may have submitted and permanently blocks another request for the
  same logical game/round/phase transition.
- `confirmed-revert` proves the attempt had no effect. A retry is possible
  only after another mandatory two-read evaluation at a strictly newer block.
- `race-or-revert`, a thrown error, or malformed outcome is submission-unknown
  and blocks automatic retry pending external/manual reconciliation.
- `rejected-before-submit` is durably rejected and does not auto-retry.

The stable `action_id` identifies exactly one logical game/round/phase
transition. It does not change when eligibility moves from all-acted to
deadline-passed. `attempt_id` separately binds the evidence block, while
`source_predicate_token` records the reviewed predicate. Durable action states
are `reserved`,
`submission-accepted`, `confirmed-revert`, `submission-unknown`, and
`rejected-before-submit`. No requester invocation is retried within a call.

Requester references are typed objects only: either a canonical
`transaction-hash` or a bounded non-secret `request-id`. Arbitrary strings,
credential-shaped IDs, and unknown reference kinds become
submission-unknown and are never persisted.

## Restart and idempotency

`recordRequest()` consumes the full shared poke envelope, validates its
schema-relevant shape, and persists only an immutable non-secret projection:
request/game/round/phase/seat/team/action identity. It atomically claims a
request ID and distinguishes identical duplicates from conflicting reuse.
`recordResponse()` consumes the full shared agent-response envelope, rejects
orphans, binds request/game/round/phase/seat against the persisted request,
derives the team from that request, and preserves optional `team_message` and
structured `error` verbatim. It also distinguishes identical duplicates from
conflicts.

`resume()` reads chain truth before stored acknowledgements, validates loaded
request/response/action record shapes and fingerprints, then reports pending
requests and prior actions without performing a poke or retry.

Production persistence must implement the same async `get`, `putIfAbsent`,
`set`, revision-based `compareAndSet`, and sorted `entries` interface with
durable atomic claims.
`createMemoryStore()` is the deterministic test/fixture implementation; it is
not durable production storage.

## Test

```bash
cd integration/orchestrator-core
npm test
```

Tests are fully mocked and make no live, network, signer, Maritime, or
transaction calls.
