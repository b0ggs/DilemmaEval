# M13 — Evidence export and reconciliation

- **Status:** Not started
- **Purpose:** Export a sanitized, reproducible package after each game and reconcile it to chain truth.
- **Accountable owner:** Evidence owner — unassigned
- **Evidence reviewer:** Independent chain/fairness reviewer — unassigned
- **Classification:** REQUIRED FOR FLOOR / CONTRACT-AUTHORITY
- **Navigation:** Previous: [M11](../30-execute/M11-TEN-AGENT-TOURNAMENT.md) · [Wiki home](../README.md) · [MASTER](../MASTER-IMPLEMENTATION-GUIDE.md) · Next: [M14](M14-OBSERVER-REPLAY.md)

## Read first

- [ ] [M11](../30-execute/M11-TEN-AGENT-TOURNAMENT.md) handoff/raw artifact index and [M03](../00-start-here/M03-SECURITY-AND-SECRETS.md) redaction rules.
- [ ] Actual existing repository evidence-export commands at an exact revision; this guide intentionally does not invent their syntax.
- [ ] Decision sheet [§2.9](../../prisoners-daolemma-tournament-decisions-v1_0.md#29-observer), [§5](../../prisoners-daolemma-tournament-decisions-v1_0.md#5-what-to-build-trimmed-to-this-design), and [§6.4](../../prisoners-daolemma-tournament-decisions-v1_0.md#6-build-order).
- [ ] Replacement [§9](../../prisoners-daolemma-discord-replacement.md#9-restart-and-duplicate-handling) and [§10](../../prisoners-daolemma-discord-replacement.md#10-observer-and-evidence).

## Inputs and prerequisites

| Input | Classification | Requirement | Source/freshness |
|---|---|---|---|
| Chain evidence | CONTRACT-AUTHORITY | Game state, actions, eliminations, winners, payouts/claims as supported by verified chain data | Query/freeze after game |
| Run evidence | Derived/supporting | Config, seat map, phase trace, both raw team logs, acceptance/rejection ledger, request/response records, poke snapshots, recovery records, failures/defaults | Match same game/run ID |
| Snapshot proof | LOCKED evidence requirement | Chat config/limits and exact `through_sequence` for every poke reconstruct what each agent could see | Reproduce from frozen logs |
| Export path | LIVE-VERIFY | Existing supported repo command/workflow | Inspect actual current repo |
| Secrets/unrevealed material | Excluded | Never export keys, tokens, credentials, secret-bearing prompts/environment dumps, or still-sensitive move material | Scan before handoff |

## Execution checklist

- [ ] `M13-01` Identify and review the existing supported export command/workflow and its exact source revision.
- [ ] `M13-02` Export the completed game's raw on-chain evidence and record game/chain/address identifiers.
- [ ] `M13-03` Add frozen run config, seat mapping, phase/timing trace, public transaction references, both raw team JSONL logs, chat config/limits, every poke's `through_sequence`, accepted/rejected records, redacted orchestrator request/response logs, and any recovery record.
- [ ] `M13-04` Reconcile every action, missed action, `defaulted` label, elimination, contract winner, and payout/claim against chain truth.
- [ ] `M13-05` Record derived team scoring separately from contract outputs.
- [ ] `M13-06` Remove/redact excluded material, compute a hash for every exported file, and have an independent reviewer reproduce key conclusions plus every supplied chat snapshot.
- [ ] `M13-07` Freeze the accepted package for replay and later games.
- [ ] `M13-08` Label chat and agent-reported status/transaction hashes as off-chain operational evidence; derive moves, defaults, eliminations, winners, and payouts only from chain truth.

## Acceptance and evidence

| Checklist | Objective pass condition | Evidence |
|---|---|---|
| M13-01 | Workflow is supported and revisioned, not invented | Source/tooling reference |
| M13-02–M13-03 | Package identifies one complete game and contains every required raw/derived communication and chain input | Evidence manifest and required-file matrix |
| M13-04–M13-05 | Reviewer reconciles chain facts and separately reproduces derived labels/score | Reconciliation report |
| M13-06 | Secret scan passes, every file hash is stable, and snapshots reproduce through their recorded sequence | Scan/reviewer results, hashes, reconstruction report |
| M13-07 | Replay consumes the immutable accepted reference | Frozen package location/reference |
| M13-08 | Package makes the off-chain/chain-authority boundary explicit and contains no status-based gameplay inference | Reviewed manifest labels and reconciliation report |

## Stop and escalate

- Stop acceptance on missing/contradictory chain records, unsupported export tooling, mixed game IDs, missing raw logs/limits/sequence/acceptance/request records, irreproducible snapshots, unexplained defaults, or secret leakage.
- Escalate chain mismatches to the contract/evidence owners and fairness labels/scoring to the fairness owner.
- Safe state: quarantine the package, do not use it for replay or claims, and preserve original public references for re-export.

## Handoff and next

Record evidence manifest/digests, reconciliation verdict, redaction scan, exceptions, and immutable replay source. Next: [M14 Observer and replay](M14-OBSERVER-REPLAY.md). Minimum context: MASTER, M14, M13 handoff/package manifest, stats-page decision.

## Source and canon

- [§2.9 Observer/replay evidence](../../prisoners-daolemma-tournament-decisions-v1_0.md#29-observer)
- [§5 Existing-repo evidence export](../../prisoners-daolemma-tournament-decisions-v1_0.md#5-what-to-build-trimmed-to-this-design)
- [§6.4 Complete game with evidence](../../prisoners-daolemma-tournament-decisions-v1_0.md#6-build-order)
- [Replacement §9 Restart and duplicate handling](../../prisoners-daolemma-discord-replacement.md#9-restart-and-duplicate-handling)
- [Replacement §10 Observer and evidence](../../prisoners-daolemma-discord-replacement.md#10-observer-and-evidence)
