# S03 — Poke and act

- **Status:** Not started
- **Purpose:** Prove the orchestrator can wake a sleeping Maritime agent, include recent chat, and obtain timely agent-owned commit and reveal actions.
- **Accountable owner:** Orchestrator lead — unassigned
- **Evidence reviewer:** Fairness/chain reviewer — unassigned
- **Classification:** FIRST-THREE-SPIKES HARD GATE / LIVE-VERIFY
- **Navigation:** Previous: [S02](S02-SELF-SIGNING.md) · [Wiki home](../README.md) · [MASTER](../MASTER-IMPLEMENTATION-GUIDE.md) · Next: [S04](S04-OWNER-CONFIG.md)

## Read first

- [ ] [S01](S01-MODEL-PARITY.md) and [S02](S02-SELF-SIGNING.md) are `Passed`; read both handoffs.
- [ ] [M01](../00-start-here/M01-RUN-CONFIGURATION.md) timing values and [M03](../00-start-here/M03-SECURITY-AND-SECRETS.md) boundary handoff.
- [ ] Decision sheet [§2.5](../../prisoners-daolemma-tournament-decisions-v1_0.md#25-orchestrator), [§2.6](../../prisoners-daolemma-tournament-decisions-v1_0.md#26-how-agents-are-driven), [§2.8](../../prisoners-daolemma-tournament-decisions-v1_0.md#28-timing), and [§4.3](../../prisoners-daolemma-tournament-decisions-v1_0.md#4-first-hour-spikes).

## Inputs and prerequisites

| Input | Classification | Requirement | Source/freshness |
|---|---|---|---|
| Wake path | LOCKED / LIVE-VERIFY | Maritime poke wakes sleeping agent; Discord does not | Prove current behavior |
| Chat context | Recommended path / LIVE-VERIFY | Bounded recent team chat included in poke reads cleanly | Test actual ordering/content |
| Deadlines | LIVE-VERIFY / OPEN final values | Read block-based commit/reveal windows and live phase/deadline | Read for every trial |
| Player authority | LOCKED | Agent decides, retains commit material, signs, and submits | Trace boundary |

## Execution checklist

- [ ] `S03-01` Put the selected agent into a documented sleeping state.
- [ ] `S03-02` Read the live phase, current block, and applicable contract deadline.
- [ ] `S03-03` Send the supported Maritime poke with bounded recent sanitized chat.
- [ ] `S03-04` Record wake, context receipt, decision start, submission, receipt, and reveal timestamps/blocks.
- [ ] `S03-05` Verify the agent—not Discord or orchestrator—owns the move, commit/reveal material, signing, and submission.
- [ ] `S03-06` Repeat sufficiently to assess seconds-to-tens-of-seconds latency, deadline margin, early advancement compatibility, and failure/default observation.

## Acceptance and evidence

| Checklist | Objective pass condition | Evidence |
|---|---|---|
| S03-01–S03-03 | Sleeping agent wakes only from the poke and receives fresh ordered chat | Sanitized poke/context trace |
| S03-04 | Commit and reveal receipts fit verified block deadlines with reviewed margin | Block/timestamp timeline |
| S03-05 | Data flow contains no orchestrator decision/signing path | Boundary review |
| S03-06 | Trial matrix supports a reliable proceed verdict and shows default detection | Timing/failure matrix |

## Stop and escalate

- **Failure or indeterminate timing triggers the first-three-spikes stop gate: stop before building or scaling to ten.**
- Stop if wake is unreliable, chat is missing/misordered, deadlines are missed, Discord is needed as a trigger, or the orchestrator touches decisions/signing.
- Escalate wake/read-path issues to Maritime/orchestrator owners and contract timing issues to the chain owner.
- Safe state: do not scale; preserve sanitized traces and let any live test reach a safe contract-defined state under authorized procedures.

## Handoff and next

Record verdict, timing distribution/margin, context proof, defaults, and boundary review. Continue to [S04 Owner config](S04-OWNER-CONFIG.md) only after clearing the hard gate. Minimum context: MASTER, S04, live address/config rows, M03, and spike handoffs.

## Source and canon

- [§2.5 Orchestrator](../../prisoners-daolemma-tournament-decisions-v1_0.md#25-orchestrator)
- [§2.6 How agents are driven](../../prisoners-daolemma-tournament-decisions-v1_0.md#26-how-agents-are-driven)
- [§2.8 Timing](../../prisoners-daolemma-tournament-decisions-v1_0.md#28-timing)
- [§4.3 Poke and act spike](../../prisoners-daolemma-tournament-decisions-v1_0.md#4-first-hour-spikes)
