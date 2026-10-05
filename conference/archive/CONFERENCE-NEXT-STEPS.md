# Conference execution checklist

**Objective:** verified five-Hermes vs five-OpenClaw play, genuine team strategy in the two new Telegram groups, and automatically updated pinned scoreboards. Use the existing ten agents on `gpt-5.4-mini`. Root is the sole live operator. Preserve the dirty working tree, identities and private journals.

**Status at 23:48 UTC:** the original execution window has expired. Use [FRESH-SESSION-HANDOFF.md](FRESH-SESSION-HANDOFF.md) for takeover. A new execution window and explicit override of the original one-game restriction remain necessary; automatic approval review rejected Game18 twice. Execution started **2026-09-25T16:46:14Z**; hard deadline was **2026-09-25T19:46:14Z**, close-out began **19:16:14Z**. Preserve this historical clock; no automatic extensions. Older stage descriptions below include tasks subsequently completed in the evidence-backed checklist and must not trigger duplicate work.

## Time and ownership checklist

- [x] Start/deadline recorded in `RUN-STATUS.md`: 16:46:14Z / 19:46:14Z. Preserve that deadline across retries, workers, restarts and compaction; never reset it.
- [x] Give capable workers exact, non-overlapping file allowlists, inputs/outputs, an acceptance check and the same deadline. Use at most two implementation workers concurrently: Telegram scoreboard and team instructions. Root owns all remote mutations and live operations.
- [x] Assign one independent auditor at integration points to check the narrow changes and actual evidence. No live mutations, unrelated repository audit or broad refactor.
- [x] Carry the deadline into existing runner creation/stop controls. Check time before each live action or worker assignment. Reserve the final 30 minutes for close-out; do not launch a game that cannot reasonably fit with cleanup margin.
- [ ] Stop development/model calls and automatic new-game creation at the three-hour limit; stop earlier if the objective is satisfied. A duration limit is not a guaranteed token-spend cap.

## Mandatory repeated scope check

**Repeat before every new task/live retry, at each stage boundary, every 15 minutes, and immediately after compaction.** Record one short checkpoint in `RUN-STATUS.md`: time remaining, current checklist item, evidence, blocker and next action. Keep regular user updates concise; do not create another planning project.

- [ ] Does this directly finish an unchecked item below or fix a demonstrated blocker? If not, defer it.
- [ ] State the exact failure or missing evidence, the smallest justified change, and the meaningful check that will establish success.
- [ ] Reuse existing agents, pinned game, runtime, team logs, mirror and proof tools. No new agents, harness replacement, model migration, subscription, rules/contract rewrite, hosting project, website redesign or general cleanup.
- [ ] Do not repeat a paid probe or successful check without changed inputs or contrary evidence. After failure, change the hypothesis/fix or establish transient recovery before retrying; use bounded backoff.
- [ ] Preserve secrets, agent-authored choices/dialogue and transaction identity. Never weaken validation to obtain a pass, replay an uncertain signing request, expose private sessions or repeat the completed funding.
- [ ] Confirm the next step fits the remaining time and current authorization. Continue independent checklist work when one lane is blocked; do not expand scope to avoid the blocker.

## Ordered execution checklist

Only mark a box complete with an evidence path, targeted test result or confirmed live readback. Fixtures and model/tool probes do not prove real gameplay. Scoreboard checks: 31 Telegram tests, live cancellation and refund exclusion, and both actual pins verified in `evidence/telegram-cancelled-scoreboard-readback-2026-09-25.json`. A healthy completed 5v5 game and real strategy delivery remain unchecked.

- [x] Additional `0.015` test ETH delivered to all ten wallets; [confirmed receipts](evidence/ten-wallet-additional-funding-2026-09-25.json). Do not repeat.
- [x] Two new groups created and bot admin/pin access verified; initial pins recorded in [scoreboard evidence](evidence/telegram-scoreboards-2026-09-25.json).
- [x] **FIRST:** bind Hermes `-1004202252236` and OpenClaw `-1004378812354` in the next run, with a fresh outbox. Preserve old destinations. Verify spectator permissions/invite links and promptly publish an accurate Dealer WIP status in both rooms.
- [ ] Show real team strategy only in its own room; show confirmed game status/results in both. Do not wait for full game repair to connect the rooms and show honest progress.
- [x] Deploy explicit team-payout instructions to agent MDs and every native harness call prompt. Preserve existing harness personas; loading of separate persona files is unverified and unnecessary for the per-call instruction path. Verify each commit receives completed same-team discussion, with opponent/spectator inputs excluded and discussion bounded by the phase deadline.
- [x] Automatically edit the existing message `3` in each group after confirmed results. Persist processed game/result IDs to prevent duplicate wins/awards after restart.
- [x] Test wins/ties, summed team awards, funding/refund/claim exclusions, duplicate events and correct team routing. Verify actual Telegram pin readback. Do not mix old unequal-roster rehearsals into the new 5v5 series.
- [x] Diagnose the exact safe `oc-4` command failure; apply its narrow root-cause fix and pass the same actual read-only command afterward.
- [x] Run the missing latest expanded actual-command check on `hs-5` (17:08:05Z read success).
- [x] Establish recent actual bounded game-command success for all ten seats after wake: pinned clean checkout, executable wrapper, dependencies, wallet binding and effective mini settings. Reuse valid evidence; repeat after relevant changes/failures, not ritualistically. Respect verified awake capacity.
- [x] Reconcile Game 16 refunds while idle, outside a new join window. Handle its old cancellation outbox separately; do not replay uncertain messages into the new rooms.
- [ ] Refresh chain/network, admissions, balances, owner nonce, defaults and idle state before creation. Base Sepolia `84532` only. Independent auditor checks narrow changes/readiness; resolve concrete blocking findings.
- [ ] Run one controlled game at a time with fresh evidence and a one-game creation fuse. Verify ten joins, genuine strategy from all ten players in the correct rooms, real commits/reveals, zero defaults and a confirmed completed result.
- [ ] Independently audit that same game across chain/actions/team logs/Telegram and verify both pins updated correctly exactly once. Measure LLM usage for the game interval separately from setup and record gas; no speculative pricing research before play.
- [ ] After proof, use existing scheduling for bounded continued games within the remaining window, one active game, finite retries and preserved wallet reserves. Do not silently continue beyond the deadline.
- [ ] Close-out: stop new launches, finish/cancel current play when the contract permits, reconcile evidence, stop runner/operator/workers and sleep agents. If a contract deadline prevents terminal cleanup, record the exact unresolved state and next legal action; never falsely claim cancellation or extend development indefinitely.
- [ ] Save final checked items, changed files, meaningful tests, game/result links, measured costs, blockers and one concrete next action in `RUN-STATUS.md`.

## Retry rule — repeat the scope check first

A failure does not end the whole effort. Preserve sanitized evidence, reconcile uncertain transactions and active-chain state, fix/test the demonstrated fault, then retry within an authorized execution window. Never overlap active games or replay unresolved signing. The original three-hour window has expired, and automatic approval review requires an explicit override of the old one-attempt restriction before Game18. This checklist does not bypass that rejection. No fresh attempt without a justified fix or evidence of transient recovery.

## Deferred work

New agents/models, additional funding without a new instruction, website redesign, production hosting, rules changes, architecture cleanup, unrelated benchmarks, perfecting every recovery edge case and replaying historical games into the new series. A newly discovered issue enters active scope only if it directly blocks an unchecked item above.

The stages below provide implementation detail for this checklist; they do not add scope or reset the clock.

## Stage 0 — operator prerequisites

1. **Done:** root transferred an additional `0.015` Base Sepolia ETH to each of the ten player wallets, `0.15` total, all confirmed. [Receipts and balances](evidence/ten-wallet-additional-funding-2026-09-25.json). Controller retains about `0.04627` ETH. Do not repeat these transfers.
2. **Done:** user created **DilemmaEval — Hermes** and **DilemmaEval — OpenClaw** and added **@DilemmaDealer2026Bot** as admin with pin permission. Use the verified supergroup IDs above, not obsolete basic-group IDs. Spectator posting permissions and phone invite checks remain to verify.
3. Bind both groups in configuration and create a fresh outbox. Preserve the old outbox and never mutate its destinations.
4. Before leaving: in the desktop app, Settings → Connections → Control this Mac → Set up; scan the QR code with the phone and open Remote in ChatGPT mobile on the same account/workspace. Test access over cellular. Leave the Mac powered, online, awake and the app open (lid open unless a supported external-display arrangement keeps it awake). Remote setup is not yet verified.

## Stage 1 — team protocol and scoreboard

Initial scoreboard messages are now posted, pinned and verified: Hermes `-1004202252236` / message `3`; OpenClaw `-1004378812354` / message `3`. [Evidence](evidence/telegram-scoreboards-2026-09-25.json). Edit these existing messages when implementing updates; do not create another pair. Automatic updates and runner group bindings remain outstanding.

1. Add an explicit shared objective to each installed PLAYER-INSTRUCTIONS.md, harness instructions, and every agent call prompt: maximize the combined payout of the agent’s team. Verify that commits receive the completed same-team discussion log. Keep discussion bounded within the phase deadline and keep opposing messages inaccessible. Use the same ten existing agents, five per team.
2. Define the pinned, editable scoreboard for a new 5v5 series: `OpenClaw 0 — Hermes 0`, `ties 0`, team totals `0`. A win means higher summed confirmed player awards in that game; equal awards mean a tie. Persist each pinned message ID and edit that message only when the confirmed score or WIP status changes. Do not combine earlier unequal-roster rehearsals with this series.
3. Each team total is the sum of confirmed player awards for that team. Exclude funding, refunds, claims, duplicate accounting, and cancelled games (cancelled games are not wins). Include proof links or transaction identifiers for every applied result.

## Stage 2 — readiness evidence

1. Capture the exact underlying `oc-4` command failure and remediation evidence; a generic health check is insufficient.
2. Run the latest actual-command read-only check for `hs-5` and record its output.
3. Run the same bounded actual-command, read-only check for all ten seats, with timestamps and model identity. The check must exercise the game command path, not only native mini tools.
4. Workers may handle local, disjoint implementation and tests under the approved ownership table. Root reviews and performs all live mutations.

## Stage 3 — controlled proof and justified retries

After Stage 2 passes and execution is resumed, run one controlled 5v5 Base Sepolia game at a time. Require ten joins, real Telegram discussion messages, real commits and reveals without defaults, chain/audit evidence, and measured LLM and gas usage for that game's actual time interval. Reconcile awards against confirmed chain results and update both pinned scoreboards only after reconciliation. Keep the eight pending Game 16 entry refunds visible as pending cleanup; reclaim them while idle, outside a new game's join window, and do not count them as awards.

If any seat, message, commit, reveal, audit, or accounting proof fails, stop further unsafe dispatch, preserve evidence and return to the relevant stage. Reconcile the active game and the failure before retrying. Continue justified repair/test work within the same three-hour window; do not stop the whole effort merely because an attempt failed.

## Stage 4 — bounded continuation

Only after the proof game passes, enable ongoing games with explicit limits: one active game per series, finite retry/backoff, wallet and cost ceilings, stale-game cancellation, and a manual stop switch. Stop on missing seat readiness, failed delivery, chain disagreement, unexpected model/roster changes, or budget exhaustion. Publish phone-visible WIP status with stage, last confirmed event, pending refunds, next action, and measured costs.

Completion requires actual controlled proof, genuine team messages in the new groups and automatically updated, verified scoreboard results. Bounded continued operation must fit the remaining three-hour window. Do not claim the demo works from setup checks or a defaulted result.

For fast execution, use capable workers for Telegram scoreboard code/tests and team-prompt code/tests with exact disjoint file ownership, plus an independent auditor at integration points. Root alone handles the oc-4 diagnostic, remote installation and game operations. No worker provisions agents or sends messages independently. After compaction or a handoff, read the existing deadline and repeat the scope check before continuing.
