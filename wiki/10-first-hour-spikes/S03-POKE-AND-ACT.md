# S03 — Poke and act

- **Status:** Not started
- **Purpose:** Prove the orchestrator can wake a sleeping Maritime agent, include a bounded same-team log snapshot, and obtain a timely structured agent response plus agent-owned commit and reveal actions.
- **Accountable owner:** Orchestrator lead — unassigned
- **Evidence reviewer:** Fairness/chain reviewer — unassigned
- **Classification:** FIRST-THREE-SPIKES HARD GATE / LIVE-VERIFY
- **Navigation:** Previous: [S02](S02-SELF-SIGNING.md) · [Wiki home](../README.md) · [MASTER](../MASTER-IMPLEMENTATION-GUIDE.md) · Next: [S04](S04-OWNER-CONFIG.md)

## Read first

- [ ] [S01](S01-MODEL-PARITY.md) and [S02](S02-SELF-SIGNING.md) are `Passed`; read both handoffs.
- [ ] [M01](../00-start-here/M01-RUN-CONFIGURATION.md) timing values and [M03](../00-start-here/M03-SECURITY-AND-SECRETS.md) boundary handoff.
- [ ] Decision sheet [§2.5](../../prisoners-daolemma-tournament-decisions-v1_0.md#25-orchestrator), [§2.6](../../prisoners-daolemma-tournament-decisions-v1_0.md#26-how-agents-are-driven), [§2.8](../../prisoners-daolemma-tournament-decisions-v1_0.md#28-timing), and [§4.3](../../prisoners-daolemma-tournament-decisions-v1_0.md#4-first-hour-spikes).
- [ ] Replacement [§§4–7](../../prisoners-daolemma-discord-replacement.md#4-team-message-logs) and [§8](../../prisoners-daolemma-discord-replacement.md#8-relationship-to-gameplay).

## Inputs and prerequisites

| Input | Classification | Requirement | Source/freshness |
|---|---|---|---|
| Wake path | LOCKED / LIVE-VERIFY | Maritime poke is the only wake trigger; team-log writes are not a separate trigger | Prove current behavior |
| Transport syntax | LIVE-VERIFY | The proposed `maritime chat <agent> "<serialized-poke>" --json` is an example to verify against installed Maritime, never established tooling truth | Cite supported current path/revision |
| Chat context | LOCKED fairness rule / RUN-FROZEN limits | Same-team messages accepted before construction, ascending sequence, bounded identically, with `through_sequence` | Test actual selection/order/content |
| Response | LOCKED schema | Matching `request_id` envelope; optional `team_message` may be empty and must not block gameplay | Validate positive and negative fixtures |
| Deadlines | LIVE-VERIFY / OPEN final values | Read block-based commit/reveal windows and live phase/deadline | Read for every trial |
| Player authority | LOCKED | Agent decides, retains commit material, signs, and submits | Trace boundary |

## Execution checklist

- [ ] `S03-01` Put the selected agent into a documented sleeping state.
- [ ] `S03-02` Read the live phase, current block, and applicable contract deadline.
- [ ] `S03-03` Resolve the supported Maritime chat/REST invocation from current tooling, recording the example CLI syntax as `LIVE-VERIFY` until proven.
- [ ] `S03-04` Construct a serialized poke with only the agent's team messages, the frozen limits, and an exact `through_sequence`; send it through the verified Maritime path.
- [ ] `S03-05` Record wake, exact context receipt, structured response, decision start, submission, receipt, and reveal timestamps/blocks.
- [ ] `S03-06` Validate request/seat/game/round/phase identity and preserve any returned `team_message` verbatim; prove an empty message is non-blocking.
- [ ] `S03-07` Verify the agent—not the orchestrator—owns the move, message, commit/reveal material, signing, and submission.
- [ ] `S03-08` Repeat sufficiently to assess seconds-to-tens-of-seconds latency, deadline margin, early advancement compatibility, failure/default observation, and identical behavior for both harnesses.

## Acceptance and evidence

| Checklist | Objective pass condition | Evidence |
|---|---|---|
| S03-01–S03-04 | Sleeping agent wakes only from a verified Maritime poke and receives exactly its eligible same-team snapshot through the recorded sequence | Tooling reference and sanitized poke/context trace |
| S03-05–S03-06 | Response is attributable, schema-valid, non-blocking when message-empty, and verbatim when accepted | Request/response and accepted/rejected fixtures |
| S03-05 | Commit and reveal receipts fit verified block deadlines with reviewed margin | Block/timestamp timeline |
| S03-07 | Data flow contains no orchestrator decision/message/signing path | Boundary review |
| S03-08 | Paired trial matrix supports a reliable proceed verdict and shows default detection without protocol asymmetry | Timing/failure/fairness matrix |

## Stop and escalate

- **Failure or indeterminate timing triggers the first-three-spikes stop gate: stop before building or scaling to ten.**
- Stop if wake/tooling is unverified, chat is missing/misordered/cross-team, `through_sequence` is wrong, deadlines are missed, a log write becomes a trigger, or the orchestrator touches decisions/messages/signing.
- Escalate wake/read-path issues to Maritime/orchestrator owners and contract timing issues to the chain owner.
- Safe state: do not scale; preserve sanitized traces and let any live test reach a safe contract-defined state under authorized procedures.

## Handoff and next

Record verdict, timing distribution/margin, context proof, defaults, and boundary review. Continue to [S04 Owner config](S04-OWNER-CONFIG.md) only after clearing the hard gate. Minimum context: MASTER, S04, live address/config rows, M03, and spike handoffs.

## Source and canon

- [§2.5 Orchestrator](../../prisoners-daolemma-tournament-decisions-v1_0.md#25-orchestrator)
- [§2.6 How agents are driven](../../prisoners-daolemma-tournament-decisions-v1_0.md#26-how-agents-are-driven)
- [§2.8 Timing](../../prisoners-daolemma-tournament-decisions-v1_0.md#28-timing)
- [§4.3 Poke and act spike](../../prisoners-daolemma-tournament-decisions-v1_0.md#4-first-hour-spikes)
- [Replacement §5 Maritime poke](../../prisoners-daolemma-discord-replacement.md#5-maritime-poke)
- [Replacement §6 Agent response](../../prisoners-daolemma-discord-replacement.md#6-agent-response)
- [Replacement §7 Fairness rules](../../prisoners-daolemma-discord-replacement.md#7-fairness-rules)
- [Replacement §8 Relationship to gameplay](../../prisoners-daolemma-discord-replacement.md#8-relationship-to-gameplay)
