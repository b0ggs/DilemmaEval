# Reliability rehearsal — September 25

**Completed:** Games 13 and 14 both passed, giving three consecutive audited successes including Game 12. The controlled runner/operator restart passed with no duplicate requests. [Combined evidence](evidence/reliability-summary-2026-09-25.json). Runner/operator are stopped, contract idle, and port 8787 serves the saved Game 14 proof. All three games ended in round one.

The user authorized a supervised sequence using the existing Hermes/OpenClaw roster, plus a controlled restart. Target two additional clean games after audited Game 12. One lead owns all external operations. Do not provision, replace agents, purchase capacity, or expand the roster in this rehearsal.

1. Fresh readiness, wallet reserve and pending-nonce checks before each game.
2. First game: `PROOF_PAUSE_AFTER_JOIN=1` exits the bounded helper cleanly after three confirmed joins and completed dispatches. Stop the sole operator; restart it with the same operator directory. Resume with the same proof config/runtime/report and actual `PROOF_GAME_ID`, omitting the pause flag. Keep the creation fuse intact.
3. Require exactly one creation, exactly three unique joins, and no repeated acknowledged requests across restart. Audit actual commits/reveals, zero defaults, Telegram strategy/result delivery and final chain state.
4. On clean proof, run and audit the next bounded game. A failure interrupts the sequence for diagnosis; uncertain actions are never blindly replayed.
5. Record proof and timing. Graceful restart evidence does not establish crash recovery during a pending transaction or unattended continuous scheduling.

First runtime: `/private/tmp/dilemma-reliability-20260925a`; evidence `evidence/reliability-20260925a.json`; confirmed created Game 13. The local viewer at port 8787 now serves the saved Game 14 proof; earlier saved proofs remain on disk. Only one runner/operator may own the live runtime.

## Paid capacity and expansion

[Maritime pricing](https://maritime.sh/pricing) and [limits](https://maritime.sh/docs/limits), checked September 25, list Free: 3 machines/1 awake; Starter: $20/month, 20 machines/5 awake; Growth: $100/month, 100 machines/25 awake. These current names replace historical references to “Pro” in this repository. An awake-slot limit is distinct from provisioned count. Model-provider costs are not estimated here.

Game 12 satisfies the original prerequisite for considering an upgrade. Recommended sequence: Starter for concurrent operation of the same three agents, verify repeated games/restart with parallel dispatch, then five agents. For ten or twenty simultaneously awake game agents, Growth supplies the stated capacity; first validate the smaller roster. Upgrading alone does not prove reliability.

Before expansion, verify actual account entitlement, idle contract defaults for the intended player count (currently 3/3), unique wallets/admissions/causes and gas reserves, exact runtime installation evidence, and the roster reconciliation budget. Current local validators permit 20 seats, ten per harness, but `reconcileRoster` defaults to a three-agent budget. Capacity must be explicit in callers; no silent expansion. Preserve source revision, contract rules and private per-player choices.
