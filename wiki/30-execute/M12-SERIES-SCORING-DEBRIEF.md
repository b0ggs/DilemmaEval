# M12 — Series scoring and equal debrief

- **Status:** Not started
- **Purpose:** Derive team results from contract winners and, when selected, deliver equal factual debriefs before additional games.
- **Accountable owner:** Scoring/debrief owner — unassigned
- **Evidence reviewer:** Fairness reviewer — unassigned
- **Classification:** OPTIONAL after one-game floor; games four/five STRETCH; debrief path OPEN
- **Navigation:** Previous: [M14](../40-observe/M14-OBSERVER-REPLAY.md) · [Wiki home](../README.md) · [MASTER](../MASTER-IMPLEMENTATION-GUIDE.md) · Next: [MASTER closeout](../MASTER-IMPLEMENTATION-GUIDE.md#closeout)

## Read first

- [ ] [M11](M11-TEN-AGENT-TOURNAMENT.md) and [M13](../40-observe/M13-EVIDENCE-EXPORT.md) passed; [M14](../40-observe/M14-OBSERVER-REPLAY.md) fallback is ready.
- [ ] [M01](../00-start-here/M01-RUN-CONFIGURATION.md) game-count/debrief selections and [S05](../10-first-hour-spikes/S05-PERSISTENCE.md) persistence verdict.
- [ ] Decision sheet [§2.1](../../prisoners-daolemma-tournament-decisions-v1_0.md#21-tournament-shape), [§3.2/§3.5](../../prisoners-daolemma-tournament-decisions-v1_0.md#3-open-items-still-to-decide), and [§6.6](../../prisoners-daolemma-tournament-decisions-v1_0.md#6-build-order).

## Inputs and prerequisites

| Input | Classification | Requirement | Source/freshness |
|---|---|---|---|
| Per-game winners | CONTRACT-AUTHORITY | Verified surviving contract winners and frozen seat/team map | Reconcile from each game's evidence |
| Game score | LOCKED | More surviving contract winners on a team wins; equal counts or no winners is a draw | Derive, never write to contract |
| Series score | LOCKED | Team with more game wins wins the series | Record draws separately |
| Game count | OPEN | One, three, or five; one already satisfies floor | Freeze before continuation |
| Debrief | OPEN; required for learning claim | Same factual summary delivered so it persists for all agents in both harnesses | Verify before game two |

## Execution checklist

- [ ] `M12-01` Validate the immutable seat-to-team mapping used in the completed game's evidence.
- [ ] `M12-02` Count surviving contract winners per team and derive the game win/draw exactly from the locked rule.
- [ ] `M12-03` Independently reproduce and review the derived result without treating it as contract output.
- [ ] `M12-04` If only one game is selected, record the result and skip debrief-dependent continuation.
- [ ] `M12-05` If more games are selected, resolve the OPEN delivery paths and build one identical factual, strategy-neutral debrief from reconciled evidence.
- [ ] `M12-06` Deliver the same debrief to all ten persistent agents and prove it lands equivalently in both harnesses.
- [ ] `M12-07` After every completed game, repeat evidence reconciliation, scoring, and equal factual debrief before waking agents for the next game.
- [ ] `M12-08` Run games two/three only if timing holds; attempt games four/five only as explicit stretch work.
- [ ] `M12-09` Aggregate game wins and declare a series winner only when one team has more game wins; escalate any presentation requirement not covered by the locked rule.

## Acceptance and evidence

| Checklist | Objective pass condition | Evidence |
|---|---|---|
| M12-01–M12-03 | Independent scorer reproduces each game result from contract winners | Scoring worksheet + evidence links |
| M12-04 | One-game stop is explicitly valid when selected | Run decision |
| M12-05–M12-06 | Debrief content is identical, factual, persistent, and strategy-neutral | Digest, delivery/recall records |
| M12-07 | Each inter-game boundary has its own reconciled, identical debrief proof | Per-game delivery records |
| M12-08 | Optional/stretch labeling and evidence remain intact | Per-game records |
| M12-09 | Series outcome follows game-win count only | Reviewed series ledger |

## Stop and escalate

- Stop additional games on failed S05 parity, unresolved/asymmetric debrief, invalid evidence, resource/timing risk, or parity/config drift.
- Stop scoring on uncertain contract winners or changed seat mapping; never ask the contract to name a team winner.
- Escalate uncovered tie/presentation policy or learning-claim questions to the tournament/fairness leads.
- Safe state: retain the accepted one-game floor and report only contract winners plus defensible derived results.

## Handoff and next

Record per-game winner counts, derived results, series ledger, debrief digest/delivery proof, optional/stretch status, and unresolved presentation questions. Next: [MASTER closeout](../MASTER-IMPLEMENTATION-GUIDE.md#closeout). Minimum context: MASTER, this handoff, per-game M13 packages.

## Source and canon

- [§2.1 Game and series scoring](../../prisoners-daolemma-tournament-decisions-v1_0.md#21-tournament-shape)
- [§3.2 and §3.5 open game-count/debrief items](../../prisoners-daolemma-tournament-decisions-v1_0.md#3-open-items-still-to-decide)
- [§6.6 Optional games](../../prisoners-daolemma-tournament-decisions-v1_0.md#6-build-order)
