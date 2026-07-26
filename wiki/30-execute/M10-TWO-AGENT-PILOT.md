# M10 — One-OpenClaw/one-Hermes pilot

- **Status:** Not started
- **Purpose:** Take one OpenClaw and one Hermes Maritime agent through one complete live contract round before scaling execution.
- **Accountable owner:** Integration lead — unassigned
- **Evidence reviewer:** Fairness/chain reviewer — unassigned
- **Classification:** REQUIRED SEQUENTIAL GATE / LIVE-VERIFY
- **Navigation:** Previous: [M09](../20-build/M09-ORCHESTRATOR-VM.md) · [Wiki home](../README.md) · [MASTER](../MASTER-IMPLEMENTATION-GUIDE.md) · Next: [M06 full-fleet checkpoint](../20-build/M06-MARITIME-FLEET.md#full-fleet-checkpoint)

## Read first

- [ ] Required one-game spike verdicts: [S01](../10-first-hour-spikes/S01-MODEL-PARITY.md), [S02](../10-first-hour-spikes/S02-SELF-SIGNING.md), [S03](../10-first-hour-spikes/S03-POKE-AND-ACT.md), and [S04](../10-first-hour-spikes/S04-OWNER-CONFIG.md). Record [S05](../10-first-hour-spikes/S05-PERSISTENCE.md) if available; it gates multi-game learning claims, not this pilot.
- [ ] [M04](../20-build/M04-AGENT-GAME-KIT.md)/[M05](../20-build/M05-HARNESS-ADAPTERS.md)/[M09](../20-build/M09-ORCHESTRATOR-VM.md) handoffs; [M06](../20-build/M06-MARITIME-FLEET.md#pilot-checkpoint)/[M07](../20-build/M07-WALLETS-IDENTITY-FUNDING.md#pilot-checkpoint)/[M08](../20-build/M08-TEAM-CHAT-LOGS.md#pilot-checkpoint) pilot checkpoints.
- [ ] Active [M01](../00-start-here/M01-RUN-CONFIGURATION.md) rows, [M03](../00-start-here/M03-SECURITY-AND-SECRETS.md) rules, and verified contract behavior/configuration required for a two-player round.
- [ ] Decision sheet [§6.2](../../prisoners-daolemma-tournament-decisions-v1_0.md#6-build-order).
- [ ] Replacement [§12 acceptance conditions](../../prisoners-daolemma-discord-replacement.md#12-acceptance-conditions).

## Inputs and prerequisites

| Input | Classification | Requirement | Source/freshness |
|---|---|---|---|
| Pilot seats | Fairness control | One ready seat from each harness with accepted adapter/kit | Verify just before run |
| Pilot contract path | CONTRACT-AUTHORITY / LIVE-VERIFY | Verified live configuration can support the intended full round | Do not assume ten-player launch config fits pilot |
| Model parity | HARD GATE | S01 remains valid at effective runtime | Recheck digests/config |
| Orchestration/chat/signing | LOCKED boundaries | M08/M09 isolated log/idempotency/restart paths and player self-signing paths passed | Smoke check before live actions |

## Execution checklist

- [ ] `M10-01` Freeze the two seat mappings, model parity snapshot, public wallets, live contract/config, and authorization references.
- [ ] `M10-02` Verify balances, identities/auth, both exact team-log paths, Maritime wake, state reads, request/response logging, and chain phase/deadlines.
- [ ] `M10-03` Start/join the supported live pilot path under current human authorization.
- [ ] `M10-04` Let the orchestrator wake both agents with bounded same-team snapshots while each agent independently decides, optionally returns a message, signs, commits, and reveals; validate and append returned text verbatim.
- [ ] `M10-05` Advance phases only from verified contract state/conditions and record a complete round timeline.
- [ ] `M10-06` Reconcile receipts/state, voluntary actions/defaults, latency margin, `through_sequence` snapshots, accepted/rejected records, and orchestrator boundaries.
- [ ] `M10-07` Interrupt after a saved response and before phase completion; resume without duplicate poke/message/action or corrupted log.
- [ ] `M10-08` Prove the pilot required no external chat setup and that log write/read failure neither woke an agent nor changed contract-driven advancement.

## Acceptance and evidence

| Checklist | Objective pass condition | Evidence |
|---|---|---|
| M10-01–M10-02 | Frozen inputs pass all preflight checks | Pilot run record |
| M10-03–M10-05 | Both harnesses complete one contract-defined live round with timely player-owned actions | Chain/timestamp/chat timeline |
| M10-06 | Independent reconciliation finds no unexplained parity, state, default, or authority issue | Pilot reconciliation report |
| M10-07 | Resume behavior preserves chain-derived correctness | Restart trace or linked accepted M09 proof |
| M10-08 | Communication is local/off-chain, not a trigger or authority, and needs no external service | Redacted startup inventory and failure test |

## Stop and escalate

- Stop on parity drift, wrong contract/config, insufficient funds, late/incorrect action, unexplained default, cross-team/duplicate/reordered chat, or orchestrator decision/message/signing.
- Escalate by owning module: parity to S01/M05, signing to S02/M04, wake/timing to S03/M09, contract config to S04.
- Safe state: do not scale; preserve sanitized evidence and let the live contract reach a safe state only through authorized supported procedures.

## Handoff and next

Record full-round verdict, complete timeline, defaults/failures, timing margin, log/config digests, request/response and acceptance/rejection references, restart result, and blockers. Only on `Passed`, continue to [M06 full-fleet checkpoint](../20-build/M06-MARITIME-FLEET.md#full-fleet-checkpoint). After M06 full passes, [M07 full](../20-build/M07-WALLETS-IDENTITY-FUNDING.md#full-fleet-checkpoint) and [M08 full](../20-build/M08-TEAM-CHAT-LOGS.md#full-fleet-checkpoint) may run in parallel; only after both pass continue to [M11 Ten-agent tournament](M11-TEN-AGENT-TOURNAMENT.md). Minimum context: MASTER, M06 full checkpoint, this pilot handoff, frozen fleet/wallet/chat rows, and active live config.

## Source and canon

- [§6.2 Full round with one agent per harness](../../prisoners-daolemma-tournament-decisions-v1_0.md#6-build-order)
- Supporting locked behavior: [§2.3–§2.8](../../prisoners-daolemma-tournament-decisions-v1_0.md#23-agents-and-signing)
- [Replacement §12 Acceptance conditions](../../prisoners-daolemma-discord-replacement.md#12-acceptance-conditions)
