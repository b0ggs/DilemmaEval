# M00 — Project canon

- **Status:** Not started
- **Purpose:** Freeze the tournament interpretation and authority boundaries before implementation.
- **Accountable owner:** Tournament lead — unassigned
- **Evidence reviewer:** Fairness reviewer — unassigned
- **Classification:** LOCKED / CONTRACT-AUTHORITY
- **Navigation:** [Wiki home](../README.md) · [MASTER](../MASTER-IMPLEMENTATION-GUIDE.md) · Next: [M01](M01-RUN-CONFIGURATION.md)

## Read first

- [ ] Read the complete historical [decision sheet](../../prisoners-daolemma-tournament-decisions-v1_0.md), especially §1, §2.1, and §6.
- [ ] Read the complete approved [communication replacement](../../prisoners-daolemma-discord-replacement.md); it has higher authority for team chat, observer, replay, and evidence.
- [ ] Read the [status language](../README.md#status-language) and [coverage map](../90-reference/DECISION-COVERAGE.md).

## Inputs and prerequisites

| Input | Classification | Requirement | Source/freshness |
|---|---|---|---|
| Product scope | LOCKED | 5 OpenClaw versus 5 Hermes agents, same OpenAI model path, on-chain game, off-chain orchestrator-owned team logs | Decision sheet §1–§2 as superseded by replacement §§1–3 |
| Evaluation purpose | LOCKED | Compare how the two full harnesses coordinate, communicate, and survive under the same model and prompt | Decision sheet §1 |
| Floor/optional scale | LOCKED / OPTIONAL / STRETCH | One complete game is the floor; three if time holds; five is stretch | §2.1 |
| Future fleet scale | LOCKED future note; outside current floor | Sixteen or thirty-two players later means adding agents, not changing this ten-player start | §2.1 |
| Gameplay behavior | CONTRACT-AUTHORITY | Never infer behavior beyond verified contract truth | Sheet preamble and §2.1 |
| Gameplay change | LOCKED exclusion | Team-log transport is off-chain and requires no gameplay contract change; existing commit/reveal/default/advance behavior is unchanged | Replacement §§3 and 8 |
| Communication authority | LOCKED | Replacement supersedes every Discord-specific baseline decision/instruction; team chat, observer, replay, and evidence use orchestrator output | Replacement §§1–3, §8, §10 |
| Prohibitions | LOCKED | No contract rewrite; no fancy dashboard before a real game | §6 |

## Execution checklist

- [ ] `M00-01` Record the decision-sheet path and revision/hash in the run record.
- [ ] `M00-02` Record the in-scope floor and explicitly label optional and stretch scope.
- [ ] `M00-03` Record that contract behavior/state controls gameplay facts and that team scoring is a derived layer only.
- [ ] `M00-04` Record the testnet-only, no-contract-rewrite, and dashboard-after-real-game boundaries.
- [ ] `M00-05` Log any conflict or missing contract/implementation source without resolving it by assumption.
- [ ] `M00-06` Keep 16/32-agent future scaling outside the current floor while preserving it as an add-agents-later path.
- [ ] `M00-07` Record the locked evaluation purpose verbatim in meaning: compare coordination, communication, and survival between the two full harnesses under the same model and prompt.
- [ ] `M00-08` Record the authority order: contract truth controls gameplay; the replacement controls communication/observer/replay/evidence; the baseline controls unrelated tournament decisions.
- [ ] `M00-09` Record that the replacement is off-chain informational transport only: it adds no contract behavior, transaction authority, or wake trigger.

## Acceptance and evidence

| Checklist | Objective pass condition | Evidence |
|---|---|---|
| M00-01 | Exact canon revision is reproducible | Run-record source entry |
| M00-02–M00-04 | Scope statement matches §§1, 2, and 6 without additions | Reviewed canon summary |
| M00-05 | Conflicts list exists, including explicit `none found` if empty | Conflict log |
| M00-06 | Current scope remains ten; future scaling is not mistaken for a new game design | Reviewed scope note |
| M00-07 | Canon summary names both full harnesses, all three evaluation dimensions, and the same-model-and-prompt control | Reviewed evaluation-purpose statement |
| M00-08 | No superseded external-chat dependency remains active and all unrelated locks remain intact | Authority/conflict review |
| M00-09 | Architecture preserves existing gameplay behavior and the Maritime poke as the only wake trigger | Reviewed scope/data-flow statement |

## Stop and escalate

- Stop if the decision sheet is absent/changed, a requested feature contradicts it, or verified contract behavior conflicts with the planned demo.
- Escalate product decisions to the tournament lead and contract conflicts to the contract owner/reviewer.
- Safe state: make no live change; mark dependent modules `Blocked` and preserve exact source references.

## Handoff and next

Record status, completed IDs, evidence links, conflicts, exclusions, owner, and reviewer. Next: [M01 Run configuration](M01-RUN-CONFIGURATION.md). Minimum next context: MASTER, M01, this handoff, the decision sheet, and the replacement.

## Source and canon

- [Decision sheet preamble and §1](../../prisoners-daolemma-tournament-decisions-v1_0.md#1-what-this-demo-is)
- [§2.1 Tournament shape](../../prisoners-daolemma-tournament-decisions-v1_0.md#21-tournament-shape)
- [§6 Build order and prohibitions](../../prisoners-daolemma-tournament-decisions-v1_0.md#6-build-order)
- [Replacement §1 Decision](../../prisoners-daolemma-discord-replacement.md#1-decision)
- [Replacement §8 Relationship to gameplay](../../prisoners-daolemma-discord-replacement.md#8-relationship-to-gameplay)
