# M11 — Ten-agent tournament and floor game

- **Status:** Not started
- **Purpose:** Run one complete five-versus-five game end to end on Base Sepolia.
- **Accountable owner:** Tournament operator — unassigned
- **Evidence reviewer:** Independent fairness/chain reviewer — unassigned
- **Classification:** LOCKED FLOOR / LIVE-VERIFY
- **Navigation:** Previous: [M10](M10-TWO-AGENT-PILOT.md) · [Wiki home](../README.md) · [MASTER](../MASTER-IMPLEMENTATION-GUIDE.md) · Next: [M13](../40-observe/M13-EVIDENCE-EXPORT.md)

## Read first

- [ ] [M10](M10-TWO-AGENT-PILOT.md) is `Passed`; read its handoff.
- [ ] Frozen [M01](../00-start-here/M01-RUN-CONFIGURATION.md) rows; accepted [M04](../20-build/M04-AGENT-GAME-KIT.md)/[M05](../20-build/M05-HARNESS-ADAPTERS.md)/[M09](../20-build/M09-ORCHESTRATOR-VM.md) handoffs; [M06](../20-build/M06-MARITIME-FLEET.md)/[M07](../20-build/M07-WALLETS-IDENTITY-FUNDING.md)/[M08](../20-build/M08-TEAM-CHAT-LOGS.md) full-fleet checkpoints.
- [ ] Decision sheet [§2.1](../../prisoners-daolemma-tournament-decisions-v1_0.md#21-tournament-shape), [§2.3](../../prisoners-daolemma-tournament-decisions-v1_0.md#23-agents-and-signing), [§2.7](../../prisoners-daolemma-tournament-decisions-v1_0.md#27-contract-and-funding), [§2.8](../../prisoners-daolemma-tournament-decisions-v1_0.md#28-timing), and [§6.3–§6.4](../../prisoners-daolemma-tournament-decisions-v1_0.md#6-build-order).
- [ ] Replacement [§§7–10](../../prisoners-daolemma-discord-replacement.md#7-fairness-rules).

## Inputs and prerequisites

| Input | Classification | Requirement | Source/freshness |
|---|---|---|---|
| Teams | LOCKED | Five OpenClaw versus five Hermes, ten separate stable agents | Match frozen seat map |
| Contract/config | CONTRACT-AUTHORITY / LIVE-VERIFY | Intended Base Sepolia deployment, ten-player config, fee, timing, idle/safe start | Read immediately before launch |
| Funds/auth/chat | LIVE-VERIFY | All ten identities, balances, self-signing, immutable team assignments, and isolated team-log paths ready | Preflight all seats |
| Game count | OPEN | At least one; this module delivers the floor game | Additional games wait for M12 |
| Default behavior | LOCKED | Contract scores missed commit/reveal as Share, so silence alone does not eliminate the agent; evidence still marks `defaulted` | Reconcile every round |

## Execution checklist

- [ ] `M11-01` Using the S04-reviewed supported path and current human authorization, set/read back the ten-player, fee, join, commit, and reveal launch configuration on the reusable deployment.
- [ ] `M11-02` Freeze and review the ten-seat, model/settings, kit/adapter, contract/config, fee, timing, and evidence snapshot.
- [ ] `M11-03` Preflight all ten agents, public wallets, registrations/auth, balances, log/team mappings, Maritime pokes, schema/limits/order parity, and orchestrator idempotency/restart state.
- [ ] `M11-04` Under current authorization, start the supported game and have all ten player agents join/sign for themselves.
- [ ] `M11-05` For each phase, read chain truth, poke relevant alive agents with their bounded same-team snapshot, validate/record responses, append accepted messages verbatim, and record deadlines/actions/receipts plus `through_sequence`.
- [ ] `M11-06` Advance early when verified contract conditions allow; otherwise respect the configured maximum block/second windows.
- [ ] `M11-07` Mark every missed commit/reveal `defaulted` separately from voluntary Share and reconcile eliminations.
- [ ] `M11-08` Continue until the contract-defined game end; record contract winners and have winners claim their prizes through their own signing path.
- [ ] `M11-09` Freeze the raw sanitized evidence set immediately for M13 export, including both raw logs, chat config/limits, poke snapshots, accepted/rejected records, request/response logs, and file hashes.

## Acceptance and evidence

| Checklist | Objective pass condition | Evidence |
|---|---|---|
| M11-01–M11-03 | Launch config is read back and ten/ten seats pass a timestamped readiness review | Config receipt/readback + signed readiness matrix |
| M11-04–M11-06 | Complete chain/game timeline has ten self-signing players, isolated bounded chat, and state-driven orchestration | Receipts, blocks, phase/poke/log trace |
| M11-07 | Intentional/defaulted states and eliminations are separately reconcilable | Action/default ledger |
| M11-08 | Contract reaches its verified end and winners/claims are recorded | Terminal readback and public claim evidence |
| M11-09 | Evidence set is immutable/referenced and secret-free | Artifact index/digests and scan |

## Stop and escalate

- Before launch, stop on any failed seat, parity drift, wrong/stale config, inadequate balance, auth/chat/wake failure, cross-team access, idempotency/recovery ambiguity, or missing authorization.
- During play, do not improvise contract behavior or let the orchestrator compensate by choosing/signing. Record failures/defaults and follow only reviewed contract/tool paths.
- Escalate to the tournament and applicable module owner; preserve chain truth and sanitized evidence.
- Safe state: do not launch another game until M13 reconciles this one.

## Handoff and next

Record terminal status, game/seat references, timeline, defaults, winners/claims, incidents, and raw evidence index. Next: [M13 Evidence export](../40-observe/M13-EVIDENCE-EXPORT.md). Minimum context: MASTER, M13, M11 handoff, active run record, actual export tooling.

## Source and canon

- [§2.1 Tournament shape](../../prisoners-daolemma-tournament-decisions-v1_0.md#21-tournament-shape)
- [§2.3 Defaults/signing](../../prisoners-daolemma-tournament-decisions-v1_0.md#23-agents-and-signing)
- [§2.7 Funding/claims](../../prisoners-daolemma-tournament-decisions-v1_0.md#27-contract-and-funding)
- [§2.8 Timing](../../prisoners-daolemma-tournament-decisions-v1_0.md#28-timing)
- [§6.3–§6.4 Scale and complete game](../../prisoners-daolemma-tournament-decisions-v1_0.md#6-build-order)
- [Replacement §7 Fairness rules](../../prisoners-daolemma-discord-replacement.md#7-fairness-rules)
- [Replacement §8 Relationship to gameplay](../../prisoners-daolemma-discord-replacement.md#8-relationship-to-gameplay)
- [Replacement §9 Restart and duplicate handling](../../prisoners-daolemma-discord-replacement.md#9-restart-and-duplicate-handling)
- [Replacement §10 Observer and evidence](../../prisoners-daolemma-discord-replacement.md#10-observer-and-evidence)
