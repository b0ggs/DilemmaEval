# S04 — Owner configuration and deployment reuse

- **Status:** Not started
- **Purpose:** Prove the candidate Base Sepolia deployment is the intended live contract and the expected owner can set player count, fee, and timing so it can later support the ten-player game.
- **Accountable owner:** Contract/chain owner — unassigned
- **Evidence reviewer:** Independent contract reviewer — unassigned
- **Classification:** LIVE-VERIFY; redeploy fallback requires human decision
- **Navigation:** Previous: [S03](S03-POKE-AND-ACT.md) · [Wiki home](../README.md) · [MASTER](../MASTER-IMPLEMENTATION-GUIDE.md) · Next: [S05](S05-PERSISTENCE.md)

## Read first

- [ ] [M01](../00-start-here/M01-RUN-CONFIGURATION.md) candidate address, owner, fee, player, and window rows; [M03](../00-start-here/M03-SECURITY-AND-SECRETS.md) handoff.
- [ ] Decision sheet [§2.7](../../prisoners-daolemma-tournament-decisions-v1_0.md#27-contract-and-funding), [§2.8](../../prisoners-daolemma-tournament-decisions-v1_0.md#28-timing), and [§4.4](../../prisoners-daolemma-tournament-decisions-v1_0.md#4-first-hour-spikes).
- [ ] The actual contract source/interface and supported operator tooling at a recorded revision, if available.

## Inputs and prerequisites

| Input | Classification | Requirement | Source/freshness |
|---|---|---|---|
| Game candidate | Public source value / LIVE-VERIFY | `0x42892BEc3d1d926Db25FfB6A144ee363AaE40A1a` | Verify chain, code, interface/config, and deployment identity live |
| Expected owner/coordinator | Public LOCKED source value / LIVE-VERIFY | `0xDb463b29c82138188d5e425EDe5E0Fcbb09f1408` | Read current owner and separately verify authorized control |
| Config proof/target | LOCKED eventual ten-player target + OPEN windows | Approved spike proof values plus the eventual ten-player, fee, join/commit/reveal targets | Read current values; distinguish proof state from launch state |
| Operator path | LIVE-VERIFY | Supported, reviewed contract configuration/readback path | Do not invent function names or command syntax |

## Execution checklist

- [ ] `S04-01` Read chain/network, code presence, current owner, relevant wiring, current game/activity state, and live config at the candidate game address.
- [ ] `S04-02` Compare current owner to the expected public source address and verify control without exposing the signer.
- [ ] `S04-03` Inspect verified contract behavior/source and supported tooling to identify exact configurable fields, constraints, and safe write preconditions.
- [ ] `S04-04` Record and independently review the exact approved spike values and the eventual ten-player, fee, join-seconds, commit-blocks, and reveal-blocks launch targets.
- [ ] `S04-05` Under current human authorization and safe contract preconditions, apply a supported configuration change that proves player count, fee, and timing control.
- [ ] `S04-06` Read back exact live values, reconcile the receipt with the approved spike values, and record the state left for M10.

## Acceptance and evidence

| Checklist | Objective pass condition | Evidence |
|---|---|---|
| S04-01 | Live read proves intended Base Sepolia contract identity/state | Timestamped readback |
| S04-02 | Current owner matches expected address and authorized signer control is demonstrated safely | Public owner read + custody/control attestation |
| S04-03 | Exact behavior and operator path cite reviewed current sources | Source/tooling revision and review |
| S04-04–S04-06 | Approved proof values match post-write readback/receipt and evidence supports later ten-player launch configuration | Before/approval/receipt/after bundle |

## Stop and escalate

- Stop on chain/address/code/interface/owner/wiring mismatch, unsafe active state, unverified tooling, rejected target values, or missing write authorization.
- Escalate discrepancies to the contract owner and tournament lead. **Redeploy is not automatic; it is a fallback requiring an explicit human choice.**
- Safe state: make no further write, preserve public readbacks, and mark deployment reuse `Blocked`.

## Handoff and next

Record reuse verdict, verified public addresses/config, source/tooling revisions, receipt if any, and fallback decision status. Next: [S05 Persistence](S05-PERSISTENCE.md). Minimum context: MASTER, S05, persistence/debrief rows, and relevant spike handoffs.

## Source and canon

- [§2.7 Contract and funding](../../prisoners-daolemma-tournament-decisions-v1_0.md#27-contract-and-funding)
- [§2.8 Timing](../../prisoners-daolemma-tournament-decisions-v1_0.md#28-timing)
- [§4.4 Owner config spike](../../prisoners-daolemma-tournament-decisions-v1_0.md#4-first-hour-spikes)
