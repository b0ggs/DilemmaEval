# M09 — Orchestrator and cloud VM

- **Status:** Not started
- **Purpose:** Run a resumable always-on non-agent coordinator that follows chain state and owns deterministic team-log transport without influencing player decisions or messages.
- **Accountable owner:** VM/orchestrator owner — OPEN/unassigned
- **Evidence reviewer:** Fairness/operations reviewer — unassigned
- **Classification:** LOCKED behavior / OPEN VM location and owner / LIVE-VERIFY timing
- **Navigation:** Previous: [M08](M08-TEAM-CHAT-LOGS.md) · [Wiki home](../README.md) · [MASTER](../MASTER-IMPLEMENTATION-GUIDE.md) · Next: [M10](../30-execute/M10-TWO-AGENT-PILOT.md)

## Read first

- [ ] [S03](../10-first-hour-spikes/S03-POKE-AND-ACT.md) wake/timing handoff, [M08 pilot checkpoint](M08-TEAM-CHAT-LOGS.md#pilot-checkpoint) handoff, [M04](M04-AGENT-GAME-KIT.md) state/response surface, [M01](../00-start-here/M01-RUN-CONFIGURATION.md) VM/timing/live contract/chat rows, and [M03](../00-start-here/M03-SECURITY-AND-SECRETS.md).
- [ ] Decision sheet [§2.5](../../prisoners-daolemma-tournament-decisions-v1_0.md#25-orchestrator), [§2.6](../../prisoners-daolemma-tournament-decisions-v1_0.md#26-how-agents-are-driven), [§2.8](../../prisoners-daolemma-tournament-decisions-v1_0.md#28-timing), [§2.9](../../prisoners-daolemma-tournament-decisions-v1_0.md#29-observer), and [§3.4](../../prisoners-daolemma-tournament-decisions-v1_0.md#3-open-items-still-to-decide).
- [ ] Replacement [§§4–10](../../prisoners-daolemma-discord-replacement.md#4-team-message-logs).

## Inputs and prerequisites

| Input | Classification | Requirement | Source/freshness |
|---|---|---|---|
| VM | OPEN | Human-selected small cloud VM and accountable operator; not a laptop | Resolve before deploy |
| Orchestrator authority | LOCKED | Watch chain, construct pokes, validate structured responses, append agent-authored messages verbatim, advance phases from chain truth, and write derived observer state | Review every action path |
| Timing | LIVE-VERIFY / OPEN final windows | Join in seconds; commit/reveal in blocks; early advance when all alive agents acted | Read live every phase |
| Gameplay boundary | LOCKED / CONTRACT-AUTHORITY | Never choose a move/message, change text, sign/send a player transaction, or advance because an agent claims it acted | Trace and negative-test |
| Restart | LOCKED | `request_id` idempotency, request/response persistence, auto-restart, chain-derived resume, log sequence recovery, and partial-line preservation | Test from interruption |
| State file | LOCKED minimal observer input | Derived current state, clearly non-authoritative | Reconcile with chain |

## Execution checklist

- [ ] `M09-01` Resolve and record the approved cloud VM and accountable operator.
- [ ] `M09-02` Implement/verify supported chain reads, Maritime pokes, response validation, serialized JSONL appends, phase advancement, request/response logs, and state-file writes at exact source revisions.
- [ ] `M09-03` Prove no code/data path chooses a move/message, rewrites agent text, holds a player key, signs, or submits a player transaction.
- [ ] `M09-04` Drive deadlines from current chain phase/block/config; treat windows as maxima and advance commit/reveal only when the relevant on-chain count equals `aliveCount` or the on-chain deadline passed.
- [ ] `M09-05` For each relevant poke, construct an identical-schema bounded same-team snapshot in ascending sequence, accepted-before-construction, with exact `through_sequence`.
- [ ] `M09-06` Validate request/game/round/phase/seat/team/schema/length/duplicate status; append accepted `team_message` text verbatim and record every acceptance/rejection.
- [ ] `M09-07` Persist non-secret request/response/idempotency state; on restart reread chain truth, last valid sequence, and request log before any retry.
- [ ] `M09-08` Configure auto-restart and test interruption after response persistence/before phase completion, proving no duplicate poke/message/action.
- [ ] `M09-09` Test partial JSONL recovery by preserving the damaged original, copying complete records, recording recovery, and reconciling derived state with chain truth.
- [ ] `M09-10` Prove team-log reads/writes are off-chain informational transport and never a second wake trigger or gameplay authority.

## Acceptance and evidence

| Checklist | Objective pass condition | Evidence |
|---|---|---|
| M09-01 | VM location/operator OPEN item has an explicit human decision | Decision reference |
| M09-02 | Every capability maps to supported current interfaces; Maritime syntax is cited only after live verification | Revisioned capability map/tests |
| M09-03–M09-04 | Boundary review finds zero decision/message/player-signing paths and advancement follows chain counts/deadlines only | Data-flow/code review and chain timeline |
| M09-05–M09-06 | Pokes are reproducible through sequence and accepted text is attributable/verbatim while invalid responses are recorded and excluded | Poke/request/response/log fixtures |
| M09-07–M09-09 | Restart and partial-line recovery preserve originals and resume without duplicate/unsafe action; derived state matches chain | Failure-injection/reconciliation report |
| M09-10 | Chat failure/writes cannot wake an agent, manufacture an action, or advance a phase | Negative-test report |

## Stop and escalate

- Stop on unresolved VM ownership, stale/timer-only phase logic, duplicate requests/messages/actions, restart ambiguity, unsafe partial-line handling, missing/cross-team chat, secret persistence, unverified Maritime transport, or any orchestrator influence over player choice/message/signing.
- Escalate contract-condition questions to the contract owner and authority violations to the fairness/security reviewers.
- Safe state: halt automatic writes/pokes, retain sanitized logs, and reread chain state before any human-approved recovery.

## Handoff and next

Record VM/operator decision, orchestrator revision, transport proof, schema/config digests, boundary review, acceptance/rejection fixtures, timing/restart/recovery tests, and state schema. Next: [M10 Two-agent pilot](../30-execute/M10-TWO-AGENT-PILOT.md). Minimum context: MASTER, M10, all spike verdicts, M04/M05/M09 handoffs, M06–M08 pilot checkpoints, and active run rows.

## Source and canon

- [§2.5 Orchestrator](../../prisoners-daolemma-tournament-decisions-v1_0.md#25-orchestrator)
- [§2.6 Agent drive/read path](../../prisoners-daolemma-tournament-decisions-v1_0.md#26-how-agents-are-driven)
- [§2.8 Timing](../../prisoners-daolemma-tournament-decisions-v1_0.md#28-timing)
- [§2.9 State file](../../prisoners-daolemma-tournament-decisions-v1_0.md#29-observer)
- [§3.4 VM open item](../../prisoners-daolemma-tournament-decisions-v1_0.md#3-open-items-still-to-decide)
- [Replacement §4 Team message logs](../../prisoners-daolemma-discord-replacement.md#4-team-message-logs)
- [Replacement §5 Maritime poke](../../prisoners-daolemma-discord-replacement.md#5-maritime-poke)
- [Replacement §6 Agent response](../../prisoners-daolemma-discord-replacement.md#6-agent-response)
- [Replacement §8 Relationship to gameplay](../../prisoners-daolemma-discord-replacement.md#8-relationship-to-gameplay)
- [Replacement §9 Restart and duplicate handling](../../prisoners-daolemma-discord-replacement.md#9-restart-and-duplicate-handling)
