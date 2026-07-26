# S05 — Persistence parity

- **Status:** Not started
- **Purpose:** Prove the same agent returns after a gap with memory intact in both harnesses, using equivalent factual input.
- **Accountable owner:** Persistence fairness lead — unassigned
- **Evidence reviewer:** Fairness reviewer — unassigned
- **Classification:** Required spike; OPEN delivery design for multi-game debrief
- **Navigation:** Previous: [S04](S04-OWNER-CONFIG.md) · [Wiki home](../README.md) · [MASTER](../MASTER-IMPLEMENTATION-GUIDE.md) · Next: [M04](../20-build/M04-AGENT-GAME-KIT.md)

## Read first

- [ ] [S01](S01-MODEL-PARITY.md) parity handoff; [M01](../00-start-here/M01-RUN-CONFIGURATION.md) `CFG-DEBRIEF`; [M03](../00-start-here/M03-SECURITY-AND-SECRETS.md) redaction rules.
- [ ] Decision sheet [§3.5](../../prisoners-daolemma-tournament-decisions-v1_0.md#3-open-items-still-to-decide) and [§4.5](../../prisoners-daolemma-tournament-decisions-v1_0.md#4-first-hour-spikes).

## Inputs and prerequisites

| Input | Classification | Requirement | Source/freshness |
|---|---|---|---|
| Persistence fixture | RUN-FROZEN | Identical factual, strategy-neutral content and recall rubric | Hash before both runs |
| Gap/sleep | RUN-FROZEN | Equivalent pause and return conditions | Freeze before test |
| Harness contributors | Implementation responsibility | One named OpenClaw persistence contributor and one named Hermes persistence contributor work under the accountable lead | Confirm assignments before test |
| Harness delivery | LIVE-VERIFY | Actual persistence/memory mechanism in each harness | Inspect effective behavior |
| Multi-game debrief path | OPEN; conditional | Equal factual summary that lands in each agent's memory | Must be selected before game two |

## Execution checklist

- [ ] `S05-00` Assign one OpenClaw persistence contributor and one Hermes persistence contributor under the single accountable lead.
- [ ] `S05-01` Freeze one factual, strategy-neutral memory fixture, gap conditions, and scoring rubric.
- [ ] `S05-02` Deliver the identical fixture through each harness's actual persistent-agent path.
- [ ] `S05-03` Apply equivalent sleep/gap conditions and return to the same agent identities.
- [ ] `S05-04` Run the same factual recall probe after resumption.
- [ ] `S05-05` Compare retained facts, delivery semantics, failures, and asymmetries.
- [ ] `S05-06` Issue a one-game and multi-game claim verdict separately.

## Acceptance and evidence

| Checklist | Objective pass condition | Evidence |
|---|---|---|
| S05-00 | Two harness-specific contributors and one accountable lead are named with non-overlapping accountability | Assignment record |
| S05-01 | Fixture/rubric/gap are identical and pre-frozen | Digests and approved test plan |
| S05-02–S05-04 | Same persistent identities receive and recall under equivalent conditions | Sanitized paired traces/outputs |
| S05-05 | All differences are enumerated and reviewed | Difference report |
| S05-06 | Verdict does not overclaim learning beyond proven delivery | Signed fairness verdict |

## Stop and escalate

- Stop the persistence/learning claim if identity continuity, delivery, gap conditions, or retained facts differ materially.
- Escalate mechanism selection through the accountable persistence fairness lead, with input from both harness contributors and the tournament lead.
- Safe state: preserve the one-game floor, label multi-game learning `Blocked`, and do not deliver asymmetric debriefs.

## Handoff and next

Record the accountable lead, both harness contributors, one-game/multi-game verdicts, effective delivery paths, evidence, and open debrief decision. Next: [M04 Agent game kit](../20-build/M04-AGENT-GAME-KIT.md). Minimum context: MASTER, M04, all spike verdicts, relevant M01 rows, and M03.

## Source and canon

- [§3.5 Debrief delivery open item](../../prisoners-daolemma-tournament-decisions-v1_0.md#3-open-items-still-to-decide)
- [§4.5 Persistence spike](../../prisoners-daolemma-tournament-decisions-v1_0.md#4-first-hour-spikes)
