# M02 — Roles and handoffs

- **Status:** Not started
- **Purpose:** Give each module an accountable owner, evidence reviewer, authority boundary, and bounded handoff.
- **Accountable owner:** Tournament lead — unassigned
- **Evidence reviewer:** Operations reviewer — unassigned
- **Classification:** Implementation control; not a new product decision
- **Navigation:** Previous: [M01](M01-RUN-CONFIGURATION.md) · [Wiki home](../README.md) · [MASTER](../MASTER-IMPLEMENTATION-GUIDE.md) · Next: [M03](M03-SECURITY-AND-SECRETS.md)

## Read first

- [ ] [M00](M00-PROJECT-CANON.md) handoff and required [M01](M01-RUN-CONFIGURATION.md) ownership rows.
- [ ] [Module template](../90-reference/MODULE-TEMPLATE.md) and [run record](../90-reference/RUN-EVIDENCE-RECORD.md).
- [ ] Replacement [§11 implementation checklist](../../prisoners-daolemma-discord-replacement.md#11-implementation-checklist).

## Inputs and prerequisites

| Input | Classification | Requirement | Source/freshness |
|---|---|---|---|
| VM owner | OPEN | Resolve before M09 | Decision sheet §3.4 |
| Module roster | Implementation control | Named accountable human/role and evidence reviewer per module | Confirm availability per run |
| Live-action authority | Implementation control | Current approval reference and exact scope | Reconfirm at action time |
| Handoff record | Implementation control | Sanitized evidence and minimum next context | Update at module completion |

## Execution checklist

- [ ] `M02-01` Assign an accountable owner and evidence reviewer to M00–M14 and S01–S05.
- [ ] `M02-02` Assign tournament, fairness, security, contract/chain, fleet, wallet/funding, team-log/orchestrator, recovery, scoring, evidence, and observer responsibilities.
- [ ] `M02-03` Record who may authorize each external write, funded action, agent invocation, and platform change.
- [ ] `M02-04` Require every module handoff to list status, completed IDs, evidence, decisions, deviations, blockers, next page, and minimum context.
- [ ] `M02-05` Cold-review a sample handoff using only its stated minimum context.

## Acceptance and evidence

| Checklist | Objective pass condition | Evidence |
|---|---|---|
| M02-01–M02-02 | All 20 action pages have available owners/reviewers | Role matrix |
| M02-03 | No live action relies on implied authority | Authority matrix/references |
| M02-04 | Handoff contains every required field and no secret | Sample completed handoff |
| M02-05 | Reviewer can identify next safe action without loading unrelated pages | Review note |

## Stop and escalate

- Stop if an external-action module lacks an accountable human, independent evidence review, or current authorization path.
- Escalate assignment gaps to the tournament lead and authority conflicts to the responsible human owners.
- Safe state: perform read-only documentation work only; mark affected modules `Blocked`.

## Handoff and next

Record role matrix location, unresolved assignments, and reviewed handoff example. Next: [M03 Security and secrets](M03-SECURITY-AND-SECRETS.md). Minimum next context: MASTER, M03, role/authority rows, relevant M01 resources.

## Source and canon

- [§2.5 Orchestrator role boundary](../../prisoners-daolemma-tournament-decisions-v1_0.md#25-orchestrator)
- [§3.4 VM location and ownership open item](../../prisoners-daolemma-tournament-decisions-v1_0.md#3-open-items-still-to-decide)
- [Replacement §11 Implementation roles](../../prisoners-daolemma-discord-replacement.md#11-implementation-checklist)
- Ownership/review mechanics on this page are implementation controls, not locked tournament decisions.
