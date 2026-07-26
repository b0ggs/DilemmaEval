# M08 — Team chat logs

- **Status:** Not started
- **Purpose:** Provide isolated, off-chain team communication through two orchestrator-owned append-only JSONL logs without adding another service or wake trigger.
- **Accountable owner:** Team-log/orchestrator developer — unassigned
- **Evidence reviewer:** Security/fairness reviewer — unassigned
- **Classification:** LOCKED replacement design / FAIRNESS CONTROL
- **Navigation:** Previous: [M07](M07-WALLETS-IDENTITY-FUNDING.md) · [Wiki home](../README.md) · [MASTER](../MASTER-IMPLEMENTATION-GUIDE.md) · Next: [M09](M09-ORCHESTRATOR-VM.md)

## Read first

- [ ] [M06](M06-MARITIME-FLEET.md) seat/team map, [M03](../00-start-here/M03-SECURITY-AND-SECRETS.md) isolation rules, and [M01](../00-start-here/M01-RUN-CONFIGURATION.md) `CFG-CHAT-*` rows.
- [ ] [S03](../10-first-hour-spikes/S03-POKE-AND-ACT.md) poke/response handoff.
- [ ] Complete replacement [§§1–12](../../prisoners-daolemma-discord-replacement.md); it supersedes the historical decision sheet for team chat, observer, replay, and evidence.

## Inputs and prerequisites

| Input | Classification | Requirement | Source/freshness |
|---|---|---|---|
| Log paths | LOCKED | `runtime/chat/<game-id>/openclaw.jsonl` and `runtime/chat/<game-id>/hermes.jsonl` | Create per game; orchestrator is sole writer |
| Message record | LOCKED schema | `schema_version`, game/round/phase/team/seat identity, unique increasing `sequence`, UTC `received_at`, `request_id`, verbatim `message` | Validate before append |
| Poke snapshot | LOCKED schema / RUN-FROZEN limits | `request_id`, game/round/phase/seat/team, `chain_state`, `team_chat.through_sequence`, `team_chat.messages`, `requested_action`, and `response_schema_version`; same-team eligible messages ascending and bounded identically | Construct before each poke |
| Response envelope | LOCKED schema | `schema_version`, matching request/game/round/phase/seat, `status`, `transaction_hash`, optional `team_message`, and `error` | Treat reported status/hash as operational, not chain truth |
| Acceptance records | LOCKED evidence control | Retain response identity, validation decision, rejection reason when applicable, and receive time for every accepted/rejected response; only valid messages enter a team log | Retain for evidence |
| Transport | VERIFIED DOCS / LIVE-VERIFY INSTALLED CLI | The final addendum verifies `maritime chat <agent> "<serialized-poke>" --json` returning `{ response }`, plus the equivalent REST call; check `maritime guide --json` for installed-CLI drift | Cite installed command manifest/revision |
| Concurrency | LOCKED implementation rule | Serialize appends in the single orchestrator; if multiple writers exist, use the same schema in storage with a unique sequence constraint | Review topology before test |

## Execution checklist

### Shared deterministic implementation

- [ ] `M08-01` Remove every external chat credential, bot, channel, API, package, rate-limit, and service setup dependency from the run configuration and startup path.
- [ ] `M08-02` Create the two exact per-game JSONL paths and a serialized append path that never edits/deletes earlier in-game records.
- [ ] `M08-03` Validate schema, game/round/phase, immutable seat/team assignment, `request_id`, duplication, and configured message length before acceptance.
- [ ] `M08-04` Assign a unique increasing `sequence` in orchestrator acceptance order, append accepted agent text verbatim to only its own-team log, and record rejected responses without inserting them into either team log.
- [ ] `M08-05` Build each snapshot from only own-team messages accepted before poke construction, ascending by sequence, capped by identical frozen per-message/total/history limits, and record exact `through_sequence`.
- [ ] `M08-06` Give both harnesses identical message opportunities, fields, response schema, timeout/retry rules, limits, and deterministic or recorded wave ordering.
- [ ] `M08-07` Prove a missing/empty `team_message` is valid and that log read/write failure neither creates a transaction nor permits early phase advancement.

### Pilot checkpoint

- [ ] `M08-08` With one seat per team, round-trip attributable message/poke/response fixtures and verify exact bytes, ordering, snapshot cutoff, and strict team isolation.
- [ ] `M08-09` Reject wrong-team, wrong-seat, malformed, duplicate, stale/mismatched-request, and oversized fixtures; prove both valid-log hashes remain correct.
- [ ] `M08-10` Interrupt after response persistence and before phase completion; resume from chain state plus request logs without a duplicate poke or message.
- [ ] `M08-11` End a JSONL fixture with a partial line; preserve the damaged original, copy only complete records to a recovered file, record recovery, and never reconstruct the damaged message.

### Full-fleet checkpoint

- [ ] `M08-12` After M10 and M06 full pass, reconcile all ten immutable seat/team assignments and rerun isolation/sequence tests across both five-seat teams.
- [ ] `M08-13` Freeze log schema, limits, timeout/retry policy, wave order, display delay, and evidence destinations before M11.

## Acceptance and evidence

| Checklist | Objective pass condition | Evidence |
|---|---|---|
| M08-01 | Startup succeeds with no external chat configuration or service | Redacted dependency inventory and startup log |
| M08-02–M08-04 | Accepted records receive unique increasing sequences in the correct exact paths and preserve message bytes; rejected records never enter valid logs | Raw test logs, acceptance ledger, hashes |
| M08-05–M08-07 | Snapshots are reproducible through `through_sequence`, protocol limits are identical, and chat failure is gameplay-neutral | Snapshot fixtures, parity table, failure tests |
| M08-08–M08-09 | Pilot proves attribution, verbatim storage, idempotency, ordering, bounds, and strict team isolation | Paired positive/negative test report |
| M08-10–M08-11 | Restart and partial-line recovery preserve evidence without duplicates, silent loss, or invented content | Before/after request/log sets and recovery record |
| M08-12–M08-13 | All ten seats map correctly and one frozen communication configuration is ready for M11 | Full-fleet matrix and config digest |

## Stop and escalate

- Stop on cross-team access, rewritten text, non-unique/out-of-order sequence, unrecorded rejection, duplicated request/message, unsafe recovery, unequal limits/opportunities, secret-bearing content, or chat affecting chain advancement.
- Stop if the installed command manifest or a dry probe contradicts the
  addendum's verified transport syntax; resolve drift before live use.
- Escalate isolation/security issues to the security owner, fairness divergence to the fairness reviewer, and transport/recovery gaps to the orchestrator owner.
- Safe state: stop pokes/appends/publication, preserve originals and hashes, reread chain truth, and keep dependent modules blocked.

## Handoff and next

At the pilot checkpoint, record exact schema/config digests, supported transport reference, two-seat fixtures, acceptance/rejection ledger, isolation test, restart/recovery results, and incidents; next is [M09 Orchestrator and VM](M09-ORCHESTRATOR-VM.md). After M10 and M06 full, return to the [full-fleet checkpoint](#full-fleet-checkpoint). When M08 full and [M07 full](M07-WALLETS-IDENTITY-FUNDING.md#full-fleet-checkpoint) both pass, continue to [M11 Ten-agent tournament](../30-execute/M11-TEN-AGENT-TOURNAMENT.md). Minimum context: MASTER, active M06 map, M03, frozen `CFG-CHAT-*` rows, M07 full status, and the M10 verdict.

## Source and canon

- [Replacement §4 Team message logs](../../prisoners-daolemma-discord-replacement.md#4-team-message-logs)
- [Replacement §5 Maritime poke](../../prisoners-daolemma-discord-replacement.md#5-maritime-poke)
- [Replacement §6 Agent response](../../prisoners-daolemma-discord-replacement.md#6-agent-response)
- [Replacement §7 Fairness rules](../../prisoners-daolemma-discord-replacement.md#7-fairness-rules)
- [Replacement §8 Relationship to gameplay](../../prisoners-daolemma-discord-replacement.md#8-relationship-to-gameplay)
- [Replacement §9 Restart and duplicate handling](../../prisoners-daolemma-discord-replacement.md#9-restart-and-duplicate-handling)
- [Replacement §§11–12 Checklist and acceptance](../../prisoners-daolemma-discord-replacement.md#11-implementation-checklist)
