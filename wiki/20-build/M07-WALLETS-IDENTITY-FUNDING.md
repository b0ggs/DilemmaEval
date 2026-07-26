# M07 — Wallets, ERC-8004 identity, and funding

- **Status:** Not started
- **Purpose:** Register/fund the pilot pair, provision the separate phase-advancer operations wallet, then—only after M10 passes—complete all ten disposable player wallets without crossing authority boundaries.
- **Accountable owner:** Wallet/funding coordinator — unassigned
- **Evidence reviewer:** Security/chain reviewer — unassigned
- **Classification:** LOCKED / LIVE-VERIFY
- **Navigation:** Previous: [M06](M06-MARITIME-FLEET.md) · [Wiki home](../README.md) · [MASTER](../MASTER-IMPLEMENTATION-GUIDE.md) · Next: [M08](M08-TEAM-CHAT-LOGS.md)

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
| Phase-advancer operations wallet | LOCKED | One additional disposable Base Sepolia wallet; never a player seat, identity, entrant, or prize claimant | Public address only in separate operations manifest |
| Fee/budget | LOCKED source value / LIVE-VERIFY | Current selected fee; source starts at 0.001 ETH per agent/game | Recalculate before funding |
| Funding policy | LOCKED | Fund player wallets generously up front; fund the phase advancer only to its approved gas ceiling; lower fee rather than cut players if test ETH is scarce | Calculate player and operations-wallet budgets separately |

## Execution checklist

### Shared preflight

- [ ] `M07-01` Live-verify owner/coordinator, game, auth adapter, current fee, planned game count, and coordinator balance.
- [ ] `M07-02` Determine the supported ERC-8004 registration/auth and funding paths from verified current implementation/contract truth.
- [ ] `M07-02A` Generate or select the separate phase-advancer wallet under the approved disposable-secret policy, independently derive its public address, and freeze that address and its gas ceiling in the public operations manifest.
- [ ] `M07-02B` Provision `PHASE_ADVANCER_PRIVATE_KEY` only to the isolated advancement executor process/service; verify that player adapters, general orchestration, Maritime transport, logs, read-only commands, and repository verification cannot access it.
- [ ] `M07-02C` Under explicit authorization, fund only the operations-manifest address to the approved Base Sepolia gas ceiling and reconcile its public balance. Do not register it with ERC-8004, put it in the ten-seat manifest, join it to a game, pay an entry fee from it, or use it for player actions.

### Pilot checkpoint

- [ ] `M07-03` Derive/match the two M06 pilot public wallet addresses, have each player-local executor register its own identity with its own gameplay key, calculate their bounded pilot budget, fund them under authorization, and reconcile public readbacks. The coordinator schedules and verifies public evidence but never receives a gameplay key or signs registration for a player.
- [ ] `M07-04` Freeze the reviewed two-seat wallet/identity/funding map for M10; do not prepare the remaining eight as a substitute for the pilot.

### Full-fleet checkpoint

- [ ] `M07-05` After M10 passes, derive and independently match the remaining eight public wallet addresses without exposing keys.
- [ ] `M07-06` Under explicit authorization, have each remaining player-local executor register its own identity with its assigned gameplay key; the coordinator receives no key and reconciles only the complete public ten-seat mapping and registration evidence.
- [ ] `M07-07` Calculate per-wallet test ETH for all selected entry fees, gas, planned games, and safety margin.
- [ ] `M07-08` Under explicit authorization, fund all ten wallets generously up front and verify final balances.
- [ ] `M07-09` Record that winners claim prizes themselves and redistribution is skipped; mark the full-fleet checkpoint passed only when M07-05–M07-09 evidence is complete.

## Acceptance and evidence

| Checklist | Objective pass condition | Evidence |
|---|---|---|
| M07-01–M07-02 | Live addresses/config and supported paths are reviewed at current revisions | Readbacks/source references |
| M07-02A–M07-02C | The eleventh wallet is address-bound to a separate operations manifest, isolated to the advancement executor, funded only within its gas ceiling, and absent from every player identity/seat/entry path | Public operations manifest, independent address match, environment-boundary test, authorization, receipt/balance readback |
| M07-03–M07-04 | Two pilot wallets are isolated, registered, sufficiently funded, and frozen | Pilot public map, calculations, receipts/readbacks |
| M07-05–M07-06 | After M10, ten unique public addresses/identities reconcile with M06 | Full public map + receipts |
| M07-07–M07-08 | Every wallet exceeds reviewed budget and coordinator plan covers selected games | Calculation + balance readbacks |
| M07-09 | Claim/redistribution policy is recorded | Run configuration/handoff |

## Stop and escalate

- Stop on wrong chain/address/owner/wiring, seat mismatch, phase-wallet appearance in any player path, derived-address/operations-manifest mismatch, key exposure, unsupported identity path, inadequate budget, or missing funded-action authorization.
- Escalate scarcity to the tournament lead: lower the configurable fee rather than remove players. Escalate contract mismatch to the contract owner.
- Safe state: send no further funds/registrations, preserve public receipts, and quarantine affected seat mappings pending human review.

## Handoff and next

Before M09 or M10 can submit phase advancement, record the public operations manifest, independent address match, isolation evidence, approved funding receipt/readback, and balance—never its key. At the pilot checkpoint, separately record the public two-seat map, calculations, receipts/readbacks, and balances—never player keys; M08 pilot may run in parallel. After M10 and [M06 full](M06-MARITIME-FLEET.md#full-fleet-checkpoint), return to the [M07 full-fleet checkpoint](#full-fleet-checkpoint), which may run beside [M08 full](M08-TEAM-CHAT-LOGS.md#full-fleet-checkpoint). If M08 full is already passed, continue to [M11](../30-execute/M11-TEN-AGENT-TOURNAMENT.md); otherwise hand off to M08 full. Minimum context: MASTER, active M06 map, M03, relevant M01 rows, public operations manifest, and the M10 verdict when scaling.

## Source and canon

- [§2.3 Wallet behavior](../../prisoners-daolemma-tournament-decisions-v1_0.md#23-agents-and-signing)
- [§2.7 Contract and funding](../../prisoners-daolemma-tournament-decisions-v1_0.md#27-contract-and-funding)
- [§5 Wallet/funding coordinator](../../prisoners-daolemma-tournament-decisions-v1_0.md#5-what-to-build-trimmed-to-this-design)
