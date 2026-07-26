# M07 — Wallets, ERC-8004 identity, and funding

- **Status:** Not started
- **Purpose:** Register/fund the pilot pair, then—only after M10 passes—complete all ten disposable player wallets without crossing authority boundaries.
- **Accountable owner:** Wallet/funding coordinator — unassigned
- **Evidence reviewer:** Security/chain reviewer — unassigned
- **Classification:** LOCKED / LIVE-VERIFY
- **Navigation:** Previous: [M06](M06-MARITIME-FLEET.md) · [Wiki home](../README.md) · [MASTER](../MASTER-IMPLEMENTATION-GUIDE.md) · Next: [M08](M08-DISCORD-CHAT.md)

## Read first

- [ ] [M06](M06-MARITIME-FLEET.md) frozen seat map, [S02](../10-first-hour-spikes/S02-SELF-SIGNING.md) signing proof, [S04](../10-first-hour-spikes/S04-OWNER-CONFIG.md) live deployment/config handoff, and [M03](../00-start-here/M03-SECURITY-AND-SECRETS.md).
- [ ] [M01](../00-start-here/M01-RUN-CONFIGURATION.md) owner, auth adapter, fee, RPC, and game-count rows.
- [ ] Actual verified auth/identity and funding tooling; do not infer commands from this page.

## Inputs and prerequisites

| Input | Classification | Requirement | Source/freshness |
|---|---|---|---|
| Owner/coordinator | Public LOCKED source value / LIVE-VERIFY | Expected `0xDb463b29c82138188d5e425EDe5E0Fcbb09f1408`; verify live/current authorized control | Before coordinator actions |
| Auth adapter | Public candidate / LIVE-VERIFY | `0xc893Ca037b796e7710a4948Bbb6fBfb94539b806` | Verify code/wiring/interface live |
| Player wallets | LOCKED | Ten disposable, isolated Base Sepolia wallets reused across games | Public addresses only in record |
| Fee/budget | LOCKED source value / LIVE-VERIFY | Current selected fee; source starts at 0.001 ETH per agent/game | Recalculate before funding |
| Funding policy | LOCKED | Fund generously up front; lower fee rather than cut players if test ETH is scarce | Include gas/planned games/margin |

## Execution checklist

### Shared preflight

- [ ] `M07-01` Live-verify owner/coordinator, game, auth adapter, current fee, planned game count, and coordinator balance.
- [ ] `M07-02` Determine the supported ERC-8004 registration/auth and funding paths from verified current implementation/contract truth.

### Pilot checkpoint

- [ ] `M07-03` Derive/match the two M06 pilot public wallet addresses, register their identities, calculate their bounded pilot budget, fund them under authorization, and reconcile public readbacks.
- [ ] `M07-04` Freeze the reviewed two-seat wallet/identity/funding map for M10; do not prepare the remaining eight as a substitute for the pilot.

### Full-fleet checkpoint

- [ ] `M07-05` After M10 passes, derive and independently match the remaining eight public wallet addresses without exposing keys.
- [ ] `M07-06` Under explicit authorization, register all remaining identities and reconcile the complete ten-seat mapping.
- [ ] `M07-07` Calculate per-wallet test ETH for all selected entry fees, gas, planned games, and safety margin.
- [ ] `M07-08` Under explicit authorization, fund all ten wallets generously up front and verify final balances.
- [ ] `M07-09` Record that winners claim prizes themselves and redistribution is skipped; mark the full-fleet checkpoint passed only when M07-05–M07-09 evidence is complete.

## Acceptance and evidence

| Checklist | Objective pass condition | Evidence |
|---|---|---|
| M07-01–M07-02 | Live addresses/config and supported paths are reviewed at current revisions | Readbacks/source references |
| M07-03–M07-04 | Two pilot wallets are isolated, registered, sufficiently funded, and frozen | Pilot public map, calculations, receipts/readbacks |
| M07-05–M07-06 | After M10, ten unique public addresses/identities reconcile with M06 | Full public map + receipts |
| M07-07–M07-08 | Every wallet exceeds reviewed budget and coordinator plan covers selected games | Calculation + balance readbacks |
| M07-09 | Claim/redistribution policy is recorded | Run configuration/handoff |

## Stop and escalate

- Stop on wrong chain/address/owner/wiring, seat mismatch, key exposure, unsupported identity path, inadequate budget, or missing funded-action authorization.
- Escalate scarcity to the tournament lead: lower the configurable fee rather than remove players. Escalate contract mismatch to the contract owner.
- Safe state: send no further funds/registrations, preserve public receipts, and quarantine affected seat mappings pending human review.

## Handoff and next

At the pilot checkpoint, record the public two-seat map, calculations, receipts/readbacks, and balances—never keys; M08 pilot may run in parallel. After M10 and [M06 full](M06-MARITIME-FLEET.md#full-fleet-checkpoint), return to the [M07 full-fleet checkpoint](#full-fleet-checkpoint), which may run beside [M08 full](M08-DISCORD-CHAT.md#full-fleet-checkpoint). If M08 full is already passed, continue to [M11](../30-execute/M11-TEN-AGENT-TOURNAMENT.md); otherwise hand off to M08 full. Minimum context: MASTER, active M06 map, M03, relevant M01 rows, and the M10 verdict when scaling.

## Source and canon

- [§2.3 Wallet behavior](../../prisoners-daolemma-tournament-decisions-v1_0.md#23-agents-and-signing)
- [§2.7 Contract and funding](../../prisoners-daolemma-tournament-decisions-v1_0.md#27-contract-and-funding)
- [§5 Wallet/funding coordinator](../../prisoners-daolemma-tournament-decisions-v1_0.md#5-what-to-build-trimmed-to-this-design)
