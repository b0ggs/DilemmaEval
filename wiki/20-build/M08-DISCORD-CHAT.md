# M08 — Discord team chat

- **Status:** Not started
- **Purpose:** Provide off-chain team chat where every player posts directly under its stable seat label.
- **Accountable owner:** Discord owner — unassigned
- **Evidence reviewer:** Security/operations reviewer — unassigned
- **Classification:** LOCKED; global channel OPTIONAL
- **Navigation:** Previous: [M07](M07-WALLETS-IDENTITY-FUNDING.md) · [Wiki home](../README.md) · [MASTER](../MASTER-IMPLEMENTATION-GUIDE.md) · Next: [M09](M09-ORCHESTRATOR-VM.md)

## Read first

- [ ] [M06](M06-MARITIME-FLEET.md) seat map, [M03](../00-start-here/M03-SECURITY-AND-SECRETS.md) secret rules, and [M01](../00-start-here/M01-RUN-CONFIGURATION.md) Discord references.
- [ ] [S03](../10-first-hour-spikes/S03-POKE-AND-ACT.md) recent-chat handoff and decision sheet [§2.2](../../prisoners-daolemma-tournament-decisions-v1_0.md#22-chat)/[§2.6](../../prisoners-daolemma-tournament-decisions-v1_0.md#26-how-agents-are-driven).

## Inputs and prerequisites

| Input | Classification | Requirement | Source/freshness |
|---|---|---|---|
| Cost/capability rationale | SOURCE-RECORDED rationale / LIVE-VERIFY | The sheet selected Discord in part because it was free and provided full history plus custom webhook names; do not claim those pricing/tier capabilities are current without verification | Check current Discord service/tier before use |
| Team channels | LOCKED | Separate OpenClaw and Hermes channels with full history | Verify access at run time |
| Team webhooks | LOCKED / Secret | One shared webhook per team channel, supplied by environment reference only | Never record URL/token |
| Seat usernames | LOCKED | Agent overrides webhook username with its stable seat label | Match M06 |
| Global channel | OPTIONAL | Cross-team channel may be added or explicitly skipped | Record selection |
| GameChat | LOCKED exclusion | Do not use on-chain GameChat for demo chat | Candidate address is not an instruction to use it |

## Execution checklist

### Shared platform preflight

- [ ] `M08-01` Verify current Discord pricing/tier and the required full-history, webhook-posting, and custom-username behavior; record source, UTC time, and pass/block verdict without assuming the source-stated free rationale is still current.
- [ ] `M08-02` Create/verify two team channels and record non-secret channel references.
- [ ] `M08-03` Configure one secret webhook reference per team and restrict each fleet half to its own team reference.

### Pilot checkpoint

- [ ] `M08-04` Configure the two pilot agents to post directly while overriding username to the exact stable seat label.
- [ ] `M08-05` Send bounded pilot messages and verify author label, team isolation, order, and history.
- [ ] `M08-06` Verify Discord messages do not wake agents and are never used as the orchestration trigger.
- [ ] `M08-07` Record the optional global-channel decision and, if selected, its permitted use.
- [ ] `M08-08` Record the accepted tradeoff: chat is not auditable on-chain, while moves, eliminations, and payouts remain on-chain game truth.

### Full-fleet checkpoint

- [ ] `M08-09` After M10 and M06 full pass, configure and test direct posting for the remaining eight seats.
- [ ] `M08-10` Reconcile all ten seat labels/team paths with the frozen M06 map and mark the full-fleet checkpoint passed.

## Acceptance and evidence

| Checklist | Objective pass condition | Evidence |
|---|---|---|
| M08-01 | Timestamped current-service evidence records pricing/tier and independently exercises full history, webhook posting, and custom usernames | Service reference plus bounded capability test |
| M08-02–M08-03 | Two distinct team paths exist with no cross-team credential access | Sanitized channel/access map |
| M08-04–M08-05 | Pilot pair maps to correct stable seats/channels with retained history | Message references/screenshots with secrets absent |
| M08-06 | Wake tests show Maritime poke—not Discord—is the trigger | Trigger test record |
| M08-07 | Global path is selected or skipped explicitly | Run-record decision |
| M08-08 | Demo language does not claim on-chain chat auditability | Reviewed claim text |
| M08-09–M08-10 | After M10 and M06 full, all ten direct-post paths match the frozen team/seat map | Full seat/message matrix |

## Stop and escalate

- Stop on unverified or unsuitable current pricing/tier/capabilities, webhook disclosure, cross-team posting/access, wrong seat label, missing history, or any attempt to use Discord as wake logic.
- Escalate pricing/capability or access issues to the Discord owner and tournament lead; escalate secret/cross-team issues to the security/fairness reviewers.
- Safe state: disable affected posting through the platform's approved human-owned process and pause dependent tests.

## Handoff and next

At the pilot checkpoint, record current-service evidence, channel references, two-seat posts, trigger test, optional global decision, and incidents; next is [M09 Orchestrator and VM](M09-ORCHESTRATOR-VM.md). After M10 and M06 full, return to the [full-fleet checkpoint](#full-fleet-checkpoint). When both M08 full and [M07 full](M07-WALLETS-IDENTITY-FUNDING.md#full-fleet-checkpoint) are passed, the required next action is [M11 Ten-agent tournament](../30-execute/M11-TEN-AGENT-TOURNAMENT.md); otherwise hand off to M07 full. Minimum context: MASTER, active M06 map, M03, M07 full status, and M10 verdict.

## Source and canon

- [§2.2 Chat](../../prisoners-daolemma-tournament-decisions-v1_0.md#22-chat)
- [§2.3 Direct agent posting](../../prisoners-daolemma-tournament-decisions-v1_0.md#23-agents-and-signing)
- [§2.6 Discord is chat only](../../prisoners-daolemma-tournament-decisions-v1_0.md#26-how-agents-are-driven)
