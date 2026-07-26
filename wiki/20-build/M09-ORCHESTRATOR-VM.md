# M09 — Orchestrator and cloud VM

- **Status:** Not started
- **Purpose:** Run a resumable always-on non-agent coordinator that follows chain state without influencing player decisions.
- **Accountable owner:** VM/orchestrator owner — OPEN/unassigned
- **Evidence reviewer:** Fairness/operations reviewer — unassigned
- **Classification:** LOCKED behavior / OPEN VM location and owner / LIVE-VERIFY timing
- **Navigation:** Previous: [M08](M08-DISCORD-CHAT.md) · [Wiki home](../README.md) · [MASTER](../MASTER-IMPLEMENTATION-GUIDE.md) · Next: [M10](../30-execute/M10-TWO-AGENT-PILOT.md)

## Read first

- [ ] [S03](../10-first-hour-spikes/S03-POKE-AND-ACT.md) wake/timing handoff, [M08 pilot checkpoint](M08-DISCORD-CHAT.md#pilot-checkpoint) handoff, [M04](M04-AGENT-GAME-KIT.md) state surface, [M01](../00-start-here/M01-RUN-CONFIGURATION.md) VM/timing/live contract rows, and [M03](../00-start-here/M03-SECURITY-AND-SECRETS.md).
- [ ] Decision sheet [§2.5](../../prisoners-daolemma-tournament-decisions-v1_0.md#25-orchestrator), [§2.6](../../prisoners-daolemma-tournament-decisions-v1_0.md#26-how-agents-are-driven), [§2.8](../../prisoners-daolemma-tournament-decisions-v1_0.md#28-timing), [§2.9](../../prisoners-daolemma-tournament-decisions-v1_0.md#29-observer), and [§3.4](../../prisoners-daolemma-tournament-decisions-v1_0.md#3-open-items-still-to-decide).

## Inputs and prerequisites

| Input | Classification | Requirement | Source/freshness |
|---|---|---|---|
| VM | OPEN | Human-selected small cloud VM and accountable operator; not a laptop | Resolve before deploy |
| Orchestrator authority | LOCKED | Watch chain, poke agents, advance phases, relay recent chat, write state file only | Review every action path |
| Timing | LIVE-VERIFY / OPEN final windows | Join in seconds; commit/reveal in blocks; early advance when all alive agents acted | Read live every phase |
| Restart | LOCKED | Auto-restart wrapper and chain-derived resume mid-game | Test from interruption |
| State file | LOCKED minimal observer input | Derived current state, clearly non-authoritative | Reconcile with chain |

## Execution checklist

- [ ] `M09-01` Resolve and record the approved cloud VM and accountable operator.
- [ ] `M09-02` Implement/verify supported chain reads, Maritime pokes, phase advancement, recent-chat relay, and state-file write paths at exact source revisions.
- [ ] `M09-03` Prove no code/data path chooses a move, authors an agent message, holds a player key, or submits a player transaction.
- [ ] `M09-04` Drive deadlines from current chain phase/block/config; treat windows as maxima and advance early only when verified contract conditions allow.
- [ ] `M09-05` Include bounded, ordered, recent team chat in each relevant poke while agents remain direct Discord authors.
- [ ] `M09-06` Persist only resumable non-secret state; on restart reread chain truth before acting.
- [ ] `M09-07` Configure the approved auto-restart mechanism and test interruption/resumption plus state-file reconciliation.

## Acceptance and evidence

| Checklist | Objective pass condition | Evidence |
|---|---|---|
| M09-01 | VM location/operator OPEN item has an explicit human decision | Decision reference |
| M09-02 | Every capability maps to supported current interfaces | Revisioned capability map/tests |
| M09-03 | Boundary review finds zero decision/message/player-signing paths | Data-flow/code review |
| M09-04–M09-05 | Phase traces use live blocks/state and deliver ordered recent chat | Timeline/context traces |
| M09-06–M09-07 | Restart recovers from chain without duplicate/unsafe action; file matches chain | Failure-injection/reconciliation report |

## Stop and escalate

- Stop on unresolved VM ownership, stale/timer-only phase logic, duplicate actions, restart ambiguity, missing chat, secret persistence, or any orchestrator influence over player choice/message/signing.
- Escalate contract-condition questions to the contract owner and authority violations to the fairness/security reviewers.
- Safe state: halt automatic writes/pokes, retain sanitized logs, and reread chain state before any human-approved recovery.

## Handoff and next

Record VM/operator decision, orchestrator revision, boundary review, timing/restart tests, and state schema. Next: [M10 Two-agent pilot](../30-execute/M10-TWO-AGENT-PILOT.md). Minimum context: MASTER, M10, all spike verdicts, M04/M05/M09 handoffs, M06–M08 pilot checkpoints, and active run rows.

## Source and canon

- [§2.5 Orchestrator](../../prisoners-daolemma-tournament-decisions-v1_0.md#25-orchestrator)
- [§2.6 Agent drive/read path](../../prisoners-daolemma-tournament-decisions-v1_0.md#26-how-agents-are-driven)
- [§2.8 Timing](../../prisoners-daolemma-tournament-decisions-v1_0.md#28-timing)
- [§2.9 State file](../../prisoners-daolemma-tournament-decisions-v1_0.md#29-observer)
- [§3.4 VM open item](../../prisoners-daolemma-tournament-decisions-v1_0.md#3-open-items-still-to-decide)
