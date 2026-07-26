# M14 — Observer and replay

- **Status:** Not started
- **Purpose:** Present Discord live chat and a real-evidence replay, with an optional small pulling stats page after the floor game.
- **Accountable owner:** Observer owner — unassigned
- **Evidence reviewer:** Evidence/fairness reviewer — unassigned
- **Classification:** Replay REQUIRED fallback; stats page OPEN / OPTIONAL
- **Navigation:** Previous: [M13](M13-EVIDENCE-EXPORT.md) · [Wiki home](../README.md) · [MASTER](../MASTER-IMPLEMENTATION-GUIDE.md) · Next: [M12](../30-execute/M12-SERIES-SCORING-DEBRIEF.md)

## Read first

- [ ] [M13](M13-EVIDENCE-EXPORT.md) passed and its immutable package/manifest is available.
- [ ] [M08](../20-build/M08-DISCORD-CHAT.md) Discord handoff, [M09](../20-build/M09-ORCHESTRATOR-VM.md) state-file schema, and [M01](../00-start-here/M01-RUN-CONFIGURATION.md) `CFG-STATS-PAGE`.
- [ ] Decision sheet [§2.3](../../prisoners-daolemma-tournament-decisions-v1_0.md#23-agents-and-signing), [§2.9](../../prisoners-daolemma-tournament-decisions-v1_0.md#29-observer), [§3.3](../../prisoners-daolemma-tournament-decisions-v1_0.md#3-open-items-still-to-decide), and [§6.5–§6 prohibition](../../prisoners-daolemma-tournament-decisions-v1_0.md#6-build-order).

## Inputs and prerequisites

| Input | Classification | Requirement | Source/freshness |
|---|---|---|---|
| Live chat | LOCKED | Discord itself is the live chat feed | Use actual team history |
| Replay | LOCKED fallback | Real accepted saved evidence and unmistakable replay label | Reference M13 digest |
| Default display | LOCKED | Show `defaulted` separately from voluntary Share even though contract scoring is Share | Reconcile with evidence |
| Stats page | OPEN / OPTIONAL | Small page may pull orchestrator state file every few seconds | Start only after M11 + M13 pass |
| Observer authority | CONTRACT-AUTHORITY boundary | Display derived/pulled data; never imply observer changes chain truth | Include provenance/staleness |

## Execution checklist

- [ ] `M14-01` Verify Discord team histories provide the intended live chat view.
- [ ] `M14-02` Build/verify replay from the accepted M13 package only and display a persistent, unmistakable `REPLAY` label.
- [ ] `M14-03` Display phase/actions/eliminations/winners/payout evidence with chain/evidence provenance and separate derived team scoring.
- [ ] `M14-04` Display missed commit/reveal as `defaulted`, distinct from voluntary Share.
- [ ] `M14-05` Exercise replay when live timing is unavailable and prove no synthetic/example data is presented as a real run.
- [ ] `M14-06` Record the OPEN stats-page choice as `Skipped` or `Selected`.
- [ ] `M14-07` If selected **after the floor game**, keep it small: pull the orchestrator state file every few seconds, expose update/staleness state, and reconcile samples with chain truth.

## Acceptance and evidence

| Checklist | Objective pass condition | Evidence |
|---|---|---|
| M14-01 | Discord history is usable as the real live feed | Channel/message references |
| M14-02–M14-03 | Replay digest matches M13 and labels/provenance remain visible | Replay capture + manifest match |
| M14-04 | Defaulted fixture is visually/textually distinct from voluntary Share | Reviewed display evidence |
| M14-05 | Fallback uses only captured real data and is always labeled | Failure-mode test |
| M14-06–M14-07 | Optional decision is explicit; any page is post-floor, small, pulling, and reconciled | Decision/build timestamps and sample checks |

## Stop and escalate

- Stop display on unlabeled replay, synthetic data presented as real, stale data without indication, hidden defaults, score shown as contract output, or evidence-digest mismatch.
- Stop any stats/dashboard work before M11 and M13 pass.
- Escalate evidence issues to M13, display fairness issues to the fairness reviewer, and scope expansion to the tournament lead.
- Safe state: fall back to Discord plus a clearly labeled replay of the last accepted package.

## Handoff and next

Record observer mode, replay package digest, label/default tests, optional stats decision, reconciliation results, and limitations. Next: [M12 Series scoring and debrief](../30-execute/M12-SERIES-SCORING-DEBRIEF.md) when additional games are selected, otherwise [MASTER closeout](../MASTER-IMPLEMENTATION-GUIDE.md#closeout). Minimum context: MASTER, chosen next page, M13/M14 handoffs, relevant M01 rows.

## Source and canon

- [§2.3 Defaulted observer distinction](../../prisoners-daolemma-tournament-decisions-v1_0.md#23-agents-and-signing)
- [§2.9 Observer and replay](../../prisoners-daolemma-tournament-decisions-v1_0.md#29-observer)
- [§3.3 Stats-page open item](../../prisoners-daolemma-tournament-decisions-v1_0.md#3-open-items-still-to-decide)
- [§6.5 plus dashboard prohibition](../../prisoners-daolemma-tournament-decisions-v1_0.md#6-build-order)
