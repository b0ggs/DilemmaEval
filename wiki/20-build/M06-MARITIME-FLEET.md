# M06 — Ten-agent Maritime fleet

- **Status:** Not started
- **Purpose:** Stage one persistent seat per harness for M10, then—only after the pilot passes—scale to ten separate stable agents.
- **Accountable owner:** Fleet owner — unassigned
- **Evidence reviewer:** Operations/fairness reviewer — unassigned
- **Classification:** LOCKED
- **Navigation:** Previous: [M05](M05-HARNESS-ADAPTERS.md) · [Wiki home](../README.md) · [MASTER](../MASTER-IMPLEMENTATION-GUIDE.md) · Next: [M07](M07-WALLETS-IDENTITY-FUNDING.md)

## Read first

- [ ] [M05](M05-HARNESS-ADAPTERS.md) adapter handoff, [S03](../10-first-hour-spikes/S03-POKE-AND-ACT.md) wake proof, [S05](../10-first-hour-spikes/S05-PERSISTENCE.md) persistence verdict.
- [ ] [M01](../00-start-here/M01-RUN-CONFIGURATION.md) `CFG-SEATS` and [M03](../00-start-here/M03-SECURITY-AND-SECRETS.md) isolation rules.

## Inputs and prerequisites

| Input | Classification | Requirement | Source/freshness |
|---|---|---|---|
| Fleet shape | LOCKED | Ten separate Maritime agents: five OpenClaw, five Hermes | Freeze seat map per run |
| Identity | LOCKED | Stable seat labels and persistent agent identities across planned games | Verify after restarts/gaps |
| Adapter assignment | LOCKED | Correct harness adapter for each five-seat team | Match M05 revisions |
| Resource isolation | Security/fairness control | Per-seat wallet secret boundary; no cross-seat identity/session reuse | Review before funding/play |

## Execution checklist

- [ ] `M06-01` Plan the ten-seat mapping with team, harness, persistent agent ID, and unique public seat label.

### Pilot checkpoint

- [ ] `M06-02` Provision one selected OpenClaw seat and one selected Hermes seat with the accepted adapters.
- [ ] `M06-03` Attach isolated environment/resource placeholders to the pilot pair and verify wake, label, and persistence.
- [ ] `M06-04` Freeze the reviewed two-seat pilot mapping for M07/M08/M10; include immutable team assignment and do not provision the remaining eight before M10 passes.

### Full-fleet checkpoint

- [ ] `M06-05` After M10 passes, provision the remaining four OpenClaw and four Hermes agents.
- [ ] `M06-06` Attach isolated references and verify every one of the ten seats responds to its own poke and label.
- [ ] `M06-07` Restart or pause/return representative agents and confirm identity/session persistence without cross-seat contamination.
- [ ] `M06-08` Freeze the reviewed ten-seat fleet/adapter/team mapping for M07/M08 full checkpoints and M11.

## Acceptance and evidence

| Checklist | Objective pass condition | Evidence |
|---|---|---|
| M06-01–M06-04 | Pilot pair has distinct harnesses/IDs, isolated references, stable wake/labels, and a frozen map | Pilot seat matrix, boundary review, tests |
| M06-05–M06-06 | Only after M10, fleet reaches exactly five seats per harness and ten distinct working IDs | Full seat matrix and fleet test |
| M06-07 | Stable identities survive tested lifecycle | Persistence observations |
| M06-08 | One frozen ten-seat mapping digest is used by M07/M08/M11 | Reviewed mapping reference |

## Stop and escalate

- Stop on duplicate/cross-wired identities, wrong adapter, failed wake, persistence loss, or secret sharing.
- Escalate lifecycle issues to the fleet owner, parity issues to the fairness reviewer, and exposures to the security owner.
- Safe state: keep affected seats offline and block wallet funding/tournament readiness.

## Handoff and next

At the pilot checkpoint, record the two-seat map/digest; [M07 pilot](M07-WALLETS-IDENTITY-FUNDING.md#pilot-checkpoint) and [M08 pilot](M08-TEAM-CHAT-LOGS.md#pilot-checkpoint) may then proceed in parallel. After M10, return to the [full-fleet checkpoint](#full-fleet-checkpoint); once it passes, [M07 full](M07-WALLETS-IDENTITY-FUNDING.md#full-fleet-checkpoint) and [M08 full](M08-TEAM-CHAT-LOGS.md#full-fleet-checkpoint) may proceed in parallel before M11. Minimum context: MASTER, the active checkpoint, relevant M01 rows, M03, and the M10 verdict when scaling.

## Source and canon

- [§2.3 Ten separate Maritime agents](../../prisoners-daolemma-tournament-decisions-v1_0.md#23-agents-and-signing)
- [§5 Maritime fleet setup](../../prisoners-daolemma-tournament-decisions-v1_0.md#5-what-to-build-trimmed-to-this-design)
- [§6.3 Scale to ten](../../prisoners-daolemma-tournament-decisions-v1_0.md#6-build-order)
