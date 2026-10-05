# Conference demo implementation guide

> **Current operators:** Read [STATUS.md](STATUS.md) first and follow the approved [V2 implementation](FAST-ITERATION-IMPLEMENTATION-v2.md). This guide preserves the original three-agent design and build sequence as a technical reference; V2 governs the active work.

**Event:** September 25, 2026, America/New_York.
**Branch:** `codex/converge-demo-2026-09-25`, created from `bcc7490`.
**Historical starting scope:** three Maritime agents, two spectator rooms, continuous games on Base Sepolia.
**Status when this guide was written:** local implementation and fixture integration tested; credential smoke check passed; live setup and rehearsal remained outstanding. See [STATUS.md](STATUS.md) for the active target and verified present state.

**Development workflow:** follow the root [AGENTS.md](../AGENTS.md) for the V2 scope, standing authorization and implementation workflow.

## 1. Use this guide for the conference build

The deliverable is a phone demo: show both teams' live conversations, open a website with a completed-game count and current game, and tap a real transaction on Basescan. Games continue without someone starting each one.

This document is the entry point for this branch. It replaces the old wiki's conference build sequence, mandatory two-seat-then-ten-seat progression, fixed five-versus-five roster, and treatment of a website as optional. Telegram is now part of the spectator experience. The original wiki, decision sheets, and handoff remain historical references; do not check off their milestones as conference progress.

Reuse working code and the original game implementation. Preserve the real game rules, chain-derived results, separate player identities, private key boundaries, and separation of team inputs. A shorter implementation plan does not make a mocked game or a simulated transcript a live demo.

The current task produced documentation and read-only chain evidence. It did not provision agents, configure contracts, deploy anything, fund wallets, or send Telegram messages. Future execution should use the user's applicable authorization, without treating old paperwork gates as new permission requirements.

## 2. The smallest complete experience

1. Three real agents are already playing when someone approaches.
2. OpenClaw and Hermes each have a Telegram group containing agent-authored messages and Dealer results.
3. Spectators can read both groups. Agents receive only their own team's log.
4. The website shows games completed during this demo, the current game/round/phase, player activity, the latest result, and links to the relevant Base Sepolia transactions.
5. A finished game is followed automatically by another, with a target 20-second intermission before creation. Joining then takes its own configured window.
6. The runner remains online independently of the presenter's phone or laptop. A clearly labeled recording is available if the live service fails.

Use the actual rules: **Share, Steal, and Catch**. Describe the game as inspired by the prisoner's dilemma. Use “testnet ETH,” and never promise a betrayal or invent dialogue to make a round exciting.

## 3. Three agents first, configurable roster throughout

Three and ten agents use the same loop. The difference is provisioning, funding, concurrency, and latency, not a second game architecture. Do not build a two-agent-only runner or require a ten-agent launch for success.

| Seat | Harness / team | Starting plan |
|---|---|---|
| `oc-1` | OpenClaw | Reconcile and reuse the existing pilot agent |
| `hs-1` | Hermes | Reconcile and reuse the existing pilot agent |
| `oc-2` | OpenClaw | Use the third available Maritime slot |

**Latest operating decision:** the conference targets Pro; the user will upgrade after a real three-agent game is proven, with actual OpenClaw/Hermes messages and its result visible in Telegram. One shared demo group is acceptable for this first proof; retain two team groups for the final demo. Use the current three-agent setup only to establish that proof, and avoid further free-tier workaround development. Provisioning and tool checks alone are not the acceptance criterion.

The user reports three free Maritime agents. Treat that as the account budget, not as a verified universal pricing claim. Check existing usage before creating the third; do not delete an unrelated agent or silently add paid capacity.

**Provisioning is automated implementation work.** The user supplies access; the repo must use the Maritime SDK to provision agents from reusable OpenClaw/Hermes templates or bootstrap recipes, inject distinct seat credentials, install/configure the runtime and persist the resulting roster. An empty account should lead to provisioning, not a manual-agent-creation request. The user clarified a future launch target of ten agents **per harness**; current code still has five-per-team/ten-total limits that must be removed and tested before claiming that support. Prove the workflow with the three conference agents first; larger live launches still depend on the selected capacity/budget.

Two OpenClaw plus one Hermes is the default implementation choice, not a requirement. Reverse the split if the existing third agent makes that easier. Keep one stable seat/wallet identity per actual agent; three running agents must not be presented as ten independent agents.

The website must say **2 vs 1**. The single-agent room contains that agent's plans and Dealer updates; it cannot contain a fabricated teammate conversation. Show individual earnings first. Team totals are descriptive, not evidence that one harness is better. Expanding later to 3-vs-3 or 5-vs-5 is a roster/configuration change followed by another rehearsal.

The launcher, phase advancer, Telegram bot, and website are ordinary software processes. They do not each need another Maritime agent.

## 4. What the deployed contract actually says

The candidate game was read on Base Sepolia at **block 47,246,396**, timestamp **2026-09-24 14:44:40 UTC**. The public [readback](evidence/contract-readback-2026-09-24.json) contains the observations and their limits.

| Field | Observed value | Initial conference target |
|---|---:|---:|
| `joinDurationSeconds` | 300 seconds | 60 seconds |
| `commitDurationBlocks` | 60 blocks | 60 blocks initially |
| `revealDurationBlocks` | 40 blocks | 40 blocks initially |
| `minPlayers` | 32 | 3 |
| `maxPlayers` | 32 | 3 |
| `maxCauses` | 2 | 2 |
| `entryFeeWei` | 1,000,000,000,000,000 (0.001 ETH) | 100,000,000,000,000 (0.0001 ETH) |
| `creatorFeeBps` | 100 | Preserve 100 |
| `causeFeeBps` | 100 | Preserve 100 |

At that block, `activeGameId` was `0`, `currentGameId` was `1`, the owner matched the repository's expected owner, and the game returned the expected auth-adapter address. The sampled preceding 30 blocks covered 60 seconds. Thus the observed commit/reveal limits corresponded to approximately 120/80 seconds, but **blocks are the authority**, not wall-clock estimates.

The immediate problems are the five-minute join window and the 32-player minimum. The commit and reveal values are upper bounds: the contract can advance as soon as the relevant players have acted. Reducing these values does not accelerate a healthy all-acted round.

### Reconfigure before considering redeployment

The [pinned game source](https://github.com/botnotstrawberry/prisoners-daolemma/blob/955ce16a59b0efecf6ccdf2d391ede83de8902a8/packages/foundry/contracts/PrisonersDAOlemma.sol) supports owner-only `configureDefaults(GameConfig)` while idle. New games copy these defaults; an existing game's deadlines are not changed.

Before a write, refresh chain ID, owner, active-game state, auth wiring, and defaults. Verify source/deployment compatibility and authorized owner access. Apply the complete nine-field configuration, preserving the fee basis points, and record the transaction plus readback. An earlier idle observation is not permission to assume the contract is still idle.

Use owner-only `createGame()` for the short join window. Public `launchGameAndJoin()` enforces a **300–3,600 second** join duration, irrespective of the shorter owner defaults. Calling the public launcher would reintroduce the five-minute wait.

After rehearsal, consider a 30-second join window and 45/30-block commit/reveal windows only if measured agent latency fits with margin. Include discussion, model calls, tool execution, and receipt confirmation in that measurement. Preinstall tools and warm agents before starting the join clock.

### When a fresh deployment helps

Use a dedicated demo deployment if the current owner is unavailable or unsuitable for unattended launching, the deployment is shared with another run, or verified behavior differs from the expected source. This is a deployment of the existing game, not a rules rewrite.

A fresh deployment needs an appropriate disposable owner, valid auth-registry wiring, two whitelisted causes, admitted player identities, funded wallets, updated addresses in the bridge/site, explorer links, and a rehearsal. Changing only the game address in a web page is insufficient. Record the selected deployment and source revision in the conference run status; execute external changes only within the user's authorized scope.

## 5. Reuse map and concrete gaps

| Existing component | Reuse | Conference work |
|---|---|---|
| `integration/game-bridge` | Existing game command wrapper, signer and chain checks | Add a separate owner launcher/configuration path; existing operations omit create/launch |
| `integration/team-logs` | Durable agent messages and team-specific snapshots | Connect live responses and spectator publishing |
| `integration/orchestrator-core` | Count/deadline predicates and advancement bookkeeping | Supply real chain reader, durable store, executor, and the continuous scheduler |
| `integration/maritime-transport` | Response validation and request coordination | Implement actual Maritime invocation and verify cancellation/idempotency behavior |
| `integration/harness-adapters` | Per-seat gameplay tool boundaries | Install and exercise tools in both actual harnesses |
| `integration/maritime-pilot-client` | Reference for provisioning and encrypted environment injection | It hardcodes two identities; use a roster-driven conference provisioner |
| Original Prisoners DAOlemma repo | Contracts, ABI, gameplay/auth/query scripts, existing web app where useful | Prepare the pinned runtime checkout and inspect the existing UI before choosing reuse vs a small separate spectator page |

All local tests passed during the September 24 assessment. These are mostly isolated component tests. The prior handoff records one OpenClaw ETH transfer and unresolved Hermes execution; it does not establish a completed game or the agents' current health.

Keep new orchestration code under `integration/conference-runner/` and any separate spectator UI under `conference/site/`. These are **planned locations, not existing implementations or commands**. Use a conference-specific public configuration and external runtime directory so game counters, logs, and state cannot be confused with earlier pilot runs.

Do not loosen a shared module's checks merely to accept new input. The bridge currently freezes contract addresses and a source revision in `integration/shared/runtime-source.json`; any deployment change must be explicit and tested. The legacy pilot remains a two-seat tool unless deliberately generalized.

The upstream Foundry package's install script creates `packages/foundry/.env`, while this bridge rejects that file. Prepare a clean runtime checkout with a compatible installation procedure; do not accidentally load a developer's Foundry environment or silently delete someone else's secret file.

## 6. Runtime design

```text
Private agent runtimes, one wallet each
          ^                     |
          | same-team context   | agent message / transaction reference
          |                     v
   Conference coordinator + durable team logs
          |                     |
          |                     +--> Telegram mirror + public website
          v
   Chain reader --> bounded phase-advance requests
          |
          +--> bounded next-game requests to the owner launcher
```

The coordinator schedules work and publishes facts. It does not choose player moves or compose messages on behalf of an agent. Each agent invokes gameplay tools with its own assigned disposable key. Commit choices and salts stay in persistent, private per-seat storage until revealed; they never enter public state or coordinator logs.

Per the user's September 24 instruction, one owner/operator wallet and signer process handle both `createGame()` and `advancePhase()`. The process checks the selected contract/network, idle state before creation, and actual on-chain eligibility before advancement. One queue and durable journal coordinate both operations and wallet nonces. Set the owner key once as `DILEMMA_LAUNCHER_PRIVATE_KEY` in `launcher.env`; no separate phase key or funding is needed. This key is not injected into Maritime players. The coordinator receives only the authenticated service interface. Its narrow API does not remove the underlying owner key's contract privileges.

For Coinbase, keep the existing per-agent key path as the initial implementation. Agentic Wallet's documented transfer/payment commands have not demonstrated this game's contract calls. A CDP signer experiment can happen after the loop works, with a short time budget and a real registration/join/commit/reveal/claim compatibility test. Do not make a wallet migration a dependency or describe a normal ETH transfer as that proof. References: [Agentic Wallet CLI](https://docs.cdp.coinbase.com/agentic-wallet/cli/quickstart), [CDP SDK wallet quickstart](https://docs.cdp.coinbase.com/wallets/quickstart/api-key-auth).

### One complete loop

1. **Resume:** acquire a single-runner lock; load durable records; read current chain state before dispatching anything. Reconcile pending transaction hashes/nonces and any already-active game.
2. **Create:** when the previous game is terminal and the configured intermission has elapsed, ask the owner launcher to create one game. Persist intent before submission; reconcile an uncertain result before any repeat request.
3. **Join:** dispatch join requests concurrently to the three prepared agents. Check on-chain player membership and identity admission. With `minPlayers = maxPlayers = 3`, a missing join causes the normal contract cancellation; it does not silently become a two-player demo.
4. **Discuss:** at each commit phase, give every living agent one short discussion opportunity. Collect actual messages, append them to the correct team log, and construct fresh same-team snapshots for move selection. This work consumes the running commit deadline.
5. **Commit:** dispatch to living agents concurrently. Agents choose Share, Steal, or Catch, persist their prepared bundle, and submit their own commitments. Count confirmed chain activity rather than agent acknowledgements.
6. **Reveal:** after a valid phase advance, reveal the same stored bundles. Do not rerun strategy or generate a fresh salt. An eliminated player takes no further moves in that game.
7. **Resolve:** advance only when the contract allows it. Publish resolved choices, defaults, eliminations, and the result transaction. A finished round may immediately start another commit phase; detect this from chain state.
8. **Settle and repeat:** record the contract outcome and payable awards; submit/reconcile claims and refunds as appropriate. Preserve unfinished claims for later recovery. Publish the result, then start the next game after the intermission.

Discussion needs an explicit conference protocol addition: the current poke schema allows only join/commit/reveal/claim and binds the action to the phase. Add a validated discussion envelope/handler alongside it, with unique request IDs and the same team/seat checks. Do not pretend that a “commit” poke is a harmless chat request. One discussion pass plus the later decision call lets teammates react without two extra model passes.

Use the same model route, effective model, prompts, message opportunities, and bounds across seats. Start from the repo's model profile and verify that Maritime actually serves it; do not assume a documented model name is available. If a different shared profile is needed, record it explicitly and adapt validators rather than quietly changing one harness. This remains an uneven demonstration, not a balanced evaluation.

The default legacy request coordinator has 30-second attempts and retry rules. Measure whether those fit. A transport timeout is not proof that an agent did not sign: reconcile chain state and reuse the same action identity before resubmission. Discussion retries and transaction retries need different treatment.

### Exact phase rules from the pinned implementation

- Joining advances only after `block.timestamp > joinDeadline`, even if every seat joined early.
- Commit advances when `committedCount == aliveCount` or `block.number > commitDeadlineBlock`.
- Reveal advances when `revealedCount == committedCount` or `block.number > revealDeadlineBlock`.
- Missing commitments or reveals become effective Share under the contract, but the audience must see **defaulted**, not voluntary cooperation.
- Do not impose an invented three-round minimum or fixed game duration. The contract decides when a game ends.

Persist dispatch/action identity, chain cursor, active game/round/phase, launch state, confirmed receipts, outstanding claims/refunds, demo game IDs, and spectator delivery cursors. Preserve per-seat reveal material across agent restarts. The orchestrator core's memory store is a test implementation, not the conference database.

## 7. Telegram and website

### Telegram

Use two groups and initially **one bot posting to both**, with explicit agent-name prefixes and team avatars/group names. The same bot can publish Dealer messages. Eleven bot identities are unnecessary for this scope.

Make spectators read-only. Telegram mirrors accepted team messages; agents do not use it as a message bus. Restrict agent tooling from fetching either public spectator feed or the opposing logs, and verify those restrictions. Publishing both teams' plans publicly means delivery isolation alone cannot prevent leakage if agents retain unrestricted browsing.

Keep messages short (target 200 characters) and preserve the agent's words. Ask agents to fit the limit; do not rewrite statements or silently truncate their meaning. Post queued messages with a small gap when helpful, but include game/round labels and do not delay a completed result behind a large chat backlog.

Dealer output includes game/round, Share/Steal/Catch choices, separately identified defaults, eliminations, remaining players, and a result transaction link. “Catch” is an action; “caught stealing” is an outcome. At game end, show actual awards and whether payout has been claimed.

Telegram errors must not stop games. Persist delivery progress and handle rate limits. If a send times out ambiguously, record that fact rather than promising exactly-once delivery or blindly flooding duplicates. During an outage the website can show the canonical accepted messages directly.

### Website

Make one phone-friendly public page, refreshing around every five seconds:

- “OpenClaw vs Hermes — 3 agents, 2 vs 1 — Base Sepolia testnet.”
- Completed games **in this demo run**, counted from confirmed terminal outcomes. Show cancellations separately. Do not use the contract's lifetime game ID as today's completed-game count.
- Current game, round, phase, and phase-appropriate counters. Commit denominator is living players; reveal denominator is committed players.
- Last few actual messages from each team, plus buttons to open the Telegram groups.
- Latest completed result, per-agent awarded/claimed testnet ETH, and optional labeled team totals. Do not double-count an award when its claim transaction arrives.
- A result-specific Basescan transaction link, the selected contract link, and a visible last-update time.
- “Next game starting” between games, with the previous result still visible; a stale/reconnecting state if updates stop.

No spectator wallet connection is needed. Build public state from an allowlist of fields rather than exposing internal runtime files. “Best betrayal,” elaborate leaderboards, cross-game memory, and spectator interaction are optional after rehearsal. A recording/replay must be plainly labeled and never added to the live completed-game count.

## 8. Build order for a few-hour session

These are estimates, not claims that platform access or signing already works. Work on the site and Telegram adapter can proceed while a live dependency is being resolved; publishing them as live depends on real data.

| Step | Work | Concrete exit condition |
|---|---|---|
| A — approximately 30–45 min | Reconcile three slots; verify owner access and admission tooling; select deployment; prepare tools/configuration | Three-seat roster, verified chain configuration path, and an install/execution path for both harnesses |
| B — approximately 60–90 min | Register/fund seats, wire agent gameplay and live coordinator, configure short owner-created games | All three agents perform real moves in one complete on-chain game |
| C — approximately 45–60 min | Automatic next-game creation, persistence, recovery, claim/refund accounting | A second game starts and finishes without manually triggering it |
| D — approximately 45–60 min | Telegram mirror and minimal website; use actual data already produced | Phone shows both rooms, a correct game count, and matching explorer transactions |
| E — at least 30–60 min | Host runner/site, exercise failures, tune timing, record backup | Several consecutive games, a recoverable restart, and a phone rehearsal over cellular |

If neither harness can reliably run the gameplay tools after the first integration timebox, report the exact installation/signing blocker. Adding seats, changing wallets, or redeploying an unrelated contract will not repair that problem. Keep progress in the conference status file, not a new sprawling set of wiki gates.

## 9. Rehearsal and event operation

Required functional checks:

- Three distinct actual agents and wallets are admitted, join, commit, and reveal; distinguish each requested action from its chain confirmation.
- Team snapshots contain only the correct team's messages. Opposing spectator-feed access is unavailable to agent tools.
- A timeout/default produces the real contract behavior and a labeled result; it does not stall the runner indefinitely.
- A restart after a commitment preserves the correct reveal bundle and does not create a duplicate game or blindly repeat a transaction.
- Telegram unavailability does not stop play. Website counters and result links match the recorded chain events.
- Several games complete consecutively without intervention; a phone can follow both rooms and open the website over cellular.

Use unit tests for the new scheduler, chain-event accounting, transaction reconciliation, protocol changes, and configuration handling. Reuse the existing suite as a regression check. The meaningful completion evidence is the live rehearsal, including all three agents actually acting; a sequence of all-default games is not proof of working agents.

Run the coordinator under a supervisor on a host that remains online. Set a run identifier, start block, start time, and explicit stop time in America/New_York. The proposed conference schedule is 10:00 AM–8:30 PM on September 25; record the actual selected times. At the cutoff, stop creating games and finish/reconcile the active game before shutdown.

Keep a private health view or status command for agent failures, balance/runway, stalled phases, repeated cancellations, RPC errors, and stopped scheduling. Size the ETH reserve from measured game/transaction usage, entry-fee recycling, payouts/refunds, and the two fee deductions; three free agent slots do not establish free model usage or unlimited testnet funds.

Before leaving for the venue: verify all three agents, owner launcher, phase executor, wallet balances, two read-only invite links, public website, restart behavior, and a locally saved backup recording. Record the process/restart command and host in the private operator handoff without placing secret values in this repository.

## 10. Definition of done

- Three actual Maritime agents play repeated, real Base Sepolia games.
- Games launch, advance, end, and restart without manual triggering.
- Two Telegram groups display actual team messages and confirmed results.
- The phone website displays the correct demo game count and result-specific Basescan links.
- Restart recovery and an external-chat outage have been exercised.
- A saved recording provides an explicitly labeled fallback.
- All ten-agent claims are absent until ten agents are actually running; three-agent operation is a complete conference deliverable.

Current progress is tracked in [STATUS.md](STATUS.md); historical outcomes are preserved in [RUN-STATUS.md](archive/RUN-STATUS.md). The original [wiki master guide](../wiki/MASTER-IMPLEMENTATION-GUIDE.md) remains reference material for reusable components, not a second active checklist.
