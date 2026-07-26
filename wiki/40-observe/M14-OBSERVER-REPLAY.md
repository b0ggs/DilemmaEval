# M14 — Observer and replay

- **Status:** Not started
- **Purpose:** Present chat from orchestrator-owned team logs and replay one accepted real-evidence package without leaking active strategy or claiming gameplay authority.
- **Accountable owner:** Observer owner — unassigned
- **Evidence reviewer:** Evidence/fairness reviewer — unassigned
- **Classification:** Replay REQUIRED fallback; public display delay RUN-FROZEN; stats page OPEN / OPTIONAL
- **Navigation:** Previous: [M13](M13-EVIDENCE-EXPORT.md) · [Wiki home](../README.md) · [MASTER](../MASTER-IMPLEMENTATION-GUIDE.md) · Next: [M12](../30-execute/M12-SERIES-SCORING-DEBRIEF.md)

## Read first

- [ ] [M13](M13-EVIDENCE-EXPORT.md) passed and its immutable package/manifest is available.
- [ ] [M08](../20-build/M08-TEAM-CHAT-LOGS.md) schema/config handoff, [M09](../20-build/M09-ORCHESTRATOR-VM.md) state-file schema, and [M01](../00-start-here/M01-RUN-CONFIGURATION.md) `CFG-CHAT-DISPLAY`/`CFG-STATS-PAGE`.
- [ ] Replacement [§10 observer/evidence](../../prisoners-daolemma-discord-replacement.md#10-observer-and-evidence) and decision sheet default distinction [§2.3](../../prisoners-daolemma-tournament-decisions-v1_0.md#23-agents-and-signing).

## Inputs and prerequisites

| Input | Classification | Requirement | Source/freshness |
|---|---|---|---|
| Chat source | LOCKED | Read raw orchestrator-owned team logs or the accepted M13 copies; never a separate message service | Match game/package digest |
| Public display | RUN-FROZEN fairness/security control | Select live, end-of-round, or end-of-game publication; delay whenever live visibility could leak strategy to active agents/operators | Freeze before game; never alter agent snapshots |
| Replay | LOCKED fallback | Use real accepted saved evidence and an unmistakable persistent `REPLAY` label | Reference M13 digest |
| Default display | LOCKED | Show `defaulted` separately from voluntary Share even though contract scoring is Share | Reconcile with chain evidence |
| Stats page | OPEN / OPTIONAL | Small page may pull orchestrator state/log output every few seconds | Start only after M11 + M13 pass |
| Observer authority | CONTRACT-AUTHORITY boundary | Display derived/pulled data; never imply observer output changes chain truth | Include provenance/staleness |

## Execution checklist

- [ ] `M14-01` Record and review the public-display delay before launch; prove active agents receive the same frozen snapshots regardless of public display mode.
- [ ] `M14-02` Render chat directly from raw team JSONL in ascending `sequence`, preserving verbatim content and team/seat attribution.
- [ ] `M14-03` Build/verify replay from the accepted M13 package only and display a persistent, unmistakable `REPLAY` label plus package digest.
- [ ] `M14-04` Display phase/actions/eliminations/defaults/winners/payout evidence with chain/evidence provenance and separate derived team scoring.
- [ ] `M14-05` Display missed commit/reveal as `defaulted`, distinct from voluntary Share.
- [ ] `M14-06` Exercise delayed/public and replay modes; prove no cross-team premature visibility and no synthetic/example data presented as a real run.
- [ ] `M14-07` Reconstruct selected poke snapshots from logs/config/`through_sequence` and match M13 exactly.
- [ ] `M14-08` Record the OPEN stats-page choice as `Skipped` or `Selected`.
- [ ] `M14-09` If selected **after the floor game**, keep it small: pull orchestrator output every few seconds, expose update/staleness/publication-delay state, and reconcile samples with chain truth.

## Acceptance and evidence

| Checklist | Objective pass condition | Evidence |
|---|---|---|
| M14-01–M14-02 | Display policy is frozen, does not alter agent inputs, prevents prohibited leakage, and renders exact ordered log content | Reviewed policy, paired snapshot/display fixtures |
| M14-03–M14-04 | Replay digest matches M13 and labels/provenance remain visible | Replay capture + manifest match |
| M14-05 | Defaulted fixture is visually/textually distinct from voluntary Share | Reviewed display evidence |
| M14-06 | Public/replay modes preserve isolation/delay and use only captured real data | Failure-mode and leakage tests |
| M14-07 | Observer independently reconstructs exact chat snapshots agents received | Snapshot reconstruction report |
| M14-08–M14-09 | Optional decision is explicit; any page is post-floor, small, pulling, delayed as frozen, and reconciled | Decision/build timestamps and sample checks |

## Stop and escalate

- Stop display on premature cross-team visibility, wrong team/seat attribution, rewritten/reordered chat, unlabeled replay, synthetic data presented as real, stale data without indication, hidden defaults, score shown as contract output, or evidence-digest mismatch.
- Stop any stats/dashboard work before M11 and M13 pass.
- Escalate evidence issues to M13, leakage/display fairness issues to the fairness/security reviewers, and scope expansion to the tournament lead.
- Safe state: stop public publication and use only a clearly labeled delayed replay of the last accepted package after its permitted release point.

## Handoff and next

Record observer mode, publication delay, replay package digest, ordering/attribution/leakage/default/snapshot tests, optional stats decision, reconciliation results, and limitations. Next: [M12 Series scoring and debrief](../30-execute/M12-SERIES-SCORING-DEBRIEF.md) when additional games are selected, otherwise [MASTER closeout](../MASTER-IMPLEMENTATION-GUIDE.md#closeout). Minimum context: MASTER, chosen next page, M13/M14 handoffs, and relevant M01 rows.

## Source and canon

- [Replacement §10 Observer and evidence](../../prisoners-daolemma-discord-replacement.md#10-observer-and-evidence)
- [Replacement §12 Acceptance conditions](../../prisoners-daolemma-discord-replacement.md#12-acceptance-conditions)
- [Decision sheet §2.3 Defaulted observer distinction](../../prisoners-daolemma-tournament-decisions-v1_0.md#23-agents-and-signing)
- [Decision sheet §3.3 Stats-page open item](../../prisoners-daolemma-tournament-decisions-v1_0.md#3-open-items-still-to-decide)
- [Decision sheet §6.5 plus dashboard prohibition](../../prisoners-daolemma-tournament-decisions-v1_0.md#6-build-order)
