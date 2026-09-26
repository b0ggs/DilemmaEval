# Conference scheduler

`createConferenceRunner` implements the shared `initialize`, `tick`, `getState`,
and `close` interface. The entry point controls the polling interval. Overlapping
ticks share one promise. Initialization acquires a local process lock, rejects a
different run identity, restores state, and reads the chain before scheduling.

The runtime directory must be outside this repository. `coordinator/records.json`
uses mode 0600, serialized writes, fsync, and atomic rename. The process lock is
exclusive; stale recovery requires a verifiably dead PID on the same host. An
unverifiable lock or orphaned recovery guard fails closed. This is a single-host
runner, not a distributed leader election mechanism.

The scheduler reuses orchestrator-core for strict chain predicates and durable
advance intent bookkeeping, and TeamLogStore for isolated team snapshots and
accepted text. Discussion and gameplay request identities are deterministic per
run/game/round/action/seat. Three seats execute concurrently, while each commit
waits for that round's discussion pass and a fresh chain read. Only chain events
count completed games, and only games with a creation event at or after the
configured run start block qualify. Cancellation counts remain separate.

The confirmed cursor's block hash is persisted. Live mode requires the chain
adapter's `readBlockHash` method and verifies the prior checkpoint before every
snapshot used for dispatch. A conflicting canonical hash fails closed with
`CONFIRMED_CHAIN_REORG`; the runner does not guess a rollback or keep submitting.

Launch and gameplay intent records are written before adapter calls. Every agent
dispatch receives one absolute deadline plus an abort signal. The runner aborts
at that boundary and remains bounded even if an adapter ignores abort. Only an
explicit, non-ambiguous `MARITIME_DISPATCH_EXPIRED` is recorded as
`rejected-before-submit`; it may retry while the same phase is current, using the
same request ID. A generic timeout, reserved record found after a crash, or other
ambiguous response is **not retried automatically**. Later chain activity
reconciles it. If no activity appears, operator investigation is required; there
is no receipt/status API in the shared adapter contract that authorizes clearing
such a record. Never delete a runtime record merely to force a retry. Confirmed
launcher rejection/revert permits the same action identity to be reconsidered on
a later block.

Outstanding awards and cancellation refunds are retained and checked from
historical terminal snapshots. One terminal game is processed per tick in a fair
rotation so a settlement backlog remains bounded. The standard `claim` envelope
carries the actual terminal chain snapshot; the player runtime chooses the
contract's claim or refund operation. Stop time prevents new launches and allows
active-game and settlement work to finish.

Spectator calls have a bound and are never allowed to accumulate overlapping
requests. Telegram health and agent failures appear as sanitized issue codes;
provider replies and error text do not enter durable state. Optional timing
settings are `agent_timeout_ms`, `adapter_timeout_ms`, and
`spectator_timeout_ms`; live values require measured agent latency.

Run `node --test integration/conference-runner/test/runner/*.test.mjs` from the
repository root. These are labeled fixture tests, including restart, deadline,
counter, isolation, timeout, and cutoff checks. They are not evidence of real
Maritime gameplay or any external transaction.
