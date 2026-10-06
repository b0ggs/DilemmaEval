# Conference status

Updated October 6, 2026. Branch: `codex/converge-demo-2026-09-25`.
The user approved `FAST-ITERATION-IMPLEMENTATION-v2.md`; its decisions are final.

## State and next action

- Steps 0–1: saved all work in 3fc2d2e after secret scanning; AGENTS.md rewritten,
  standing authorization retained and D5 docs archived.
- Complete: steps 0–5 (6/7). Step 6 follows the approved fix_issue.MD batch.
- Steps 2–4: named causes, one-seat diagnosis, debug admission/continuity,
  observer transitions and persistent quarantine implemented and tested.
  Historical full checkpoints: 625/625 and 631/631; debug fixtures passed.
- Step 5: Games 21–23 completed with defaults; Telegram and terminal cleanup
  confirmed. Initial disabled-observer diagnostics passed on oc-1/hs-1.
- Current: Game 26 stopped at the user's request and cleanup complete.
  Coordinator 57092 stopped at 15:00 UTC (PROOF_RUN_ABORTED, explicit stop);
  retained hs-4/hs-5 jobs stopped and later inactive reads resolved reservations.
  Contract terminal confirmed at 15:20 UTC after advancing expired phases;
  operator 57068 stopped and its 131-record journal reconciled. Fresh 15:23 UTC
  checks: active game 0, account awake 0, quarantine 0. No game is scheduled.
  Before stop: four MARITIME_REPLY_INVALID_JSON failures; hs-4 join/hs-5 round-1
  reveal recovery hit 180s and retained quarantine; hs-2 round-2 reveal/hs-3
  round-3 commit recovered their saved results with completed work and sleep,
  without signing replay. Rounds 1–2 had 1/2 defaults; rounds 3–4 had 9/9 from
  shutdown. Total 21: three before stop, eighteen from shutdown. No new failure
  type. Four rounds / 61m26s on-chain; coordinator stopped after 42m48s.
  All 49 existing DEBUG Telegram messages sent. This is a stopped debug attempt,
  not a passed proof; proof-run.json retains its stopped outcome.
  Uses d75edbd with unchanged timing. User-reported weekly usage before launch:
  53%, for comparison after the game. Inputs/reports: debug-game-6-inputs and
  debug-game-6 in the v2 private root; {cleanup,completion}.json record closure.
- Attempt 6 prepared at 14:10 UTC. Current timing retained: join 300 seconds,
  commit 300 blocks, reveal 180 blocks. Fresh active 0/awake 0/quarantine 0,
  all 11 latest/pending nonces equal, all seats admitted/funded, owner journal
  resolved (121 records) and Telegram room access verified. Owner balance
  0.14621 ETH; minimum seat balance 0.01807 ETH. hs-2/hs-3 were stopped by
  Game 25 cleanup; their non-signing checks passed in 55s/53s with confirmed sleep.
  Preparation/status validation passed, creation fuse unused; no game, signing
  call or operator started. Inputs: debug-game-6-inputs/{invocation,ready}.json;
  preparation: debug-game-6; smoke: debug-game-6-smoke.json in the v2 private root.
  Launch cutoff 2026-10-06T14:47:11.295Z (10:47 EDT), hard stop 23:03 UTC,
  derived from unchanged contract timing. Refresh live checks on approval;
  if preparation expires, preserve it and prepare fresh inputs before launch.
- Last game: requested Debug Game 25 complete and cleaned up. Four rounds,
  44m04s on-chain (45m27s coordinator run), all_seats_acted=true, six defaults
  (by round: 0, 2, 2, 2). All ten completed round 1. This is a degraded debug
  result, not a passed proof. All 55 Telegram messages sent with DEBUG prefixes;
  pending/inflight 0. Fresh terminal/active 0/awake 0/quarantine 0 confirmed;
  hs-2/hs-3 jobs explicitly stopped and later inactive reads resolved reservations.
  Coordinator/operator stopped; 121-record owner journal reconciled. No next
  game is scheduled. Reports: debug-game-5-refresh-1/{proof-run,cleanup,completion}.json
  and matching inputs in the v2 private root.
- Game 25 established the cause of two interruptions: phaseDispatch reused the
  discussion watcher's all-required-acted predicate, aborting hs-2/hs-3 chat after
  about 51s when all commits had landed. New records retain chat / AGENT_TIMEOUT /
  phase_abort; their six subsequent defaults came from quarantine. d75edbd fixes
  this: drain bounded replies after moves land, retain actual deadline/game/round/
  phase and pre-submit guards. Phase-abort metadata no longer claims an elapsed
  180s timer. Coordinator-only; no reinstall. The running game kept its original
  code. Game 26 loaded the correction and recorded no phase_abort failure;
  final proof remains outstanding.
- Guard verification: 33/33 runner tests, 4/4 actual controlled-wrapper checks,
  4/4 focused guard/timer checks. Initial new fixtures assumed acknowledged state;
  corrected for refresh promoting accepted records to chain-confirmed. Logs:
  /private/tmp/dilemma-phase-completion-runner-verified-20261006.log,
  /private/tmp/dilemma-phase-completion-wrappers-20261006.log and
  /private/tmp/dilemma-phase-abort-diagnostics-20261006.log.
- Other live checks: queue/action/cleanup split confirmed (oc-1 join: 54s/53s/7s).
  hs-1 round-3 malformed commit reply recovered its existing confirmed transaction
  once, with job completion/sleep (167s action, 7s cleanup); no signing replay or
  added quarantine. Earlier unsent startup hit readEvents HTTP 413 / -32614 on
  1,000 blocks. 50f62af uses verified 100-block pages and RPC_REQUEST_TOO_LARGE;
  27/27 chain regressions and the real 1,094-block backlog passed. Original
  startup/unused fuse preserved in debug-game-5; it consumed no game/wake/gas.
- October 5 shutdown checkpoint: Game 24 terminal; active game 0, account awake 0
  and quarantine 0 confirmed. Coordinator, tests and isolated operator stopped.
- Next: stopped at the user's request. Await an instruction to implement the
  proposed deterministic-operations plan; no implementation or next game started.
  Remaining V2 step 6 still requires
  current full suite, Game 20 claims, fresh proof diagnostics/continuity and
  normal proof-run/proof-audit. Six fix_issue.MD corrections are implemented/
  deployed; final proof remains. Deferred findings remain out of scope.
- User requested [DETERMINISTIC-AGENT-OPERATIONS-PLAN.md](DETERMINISTIC-AGENT-OPERATIONS-PLAN.md)
  during Game 26. Proposed only: code-owned JSON/metadata, direct mechanical
  handlers, native agent-local decision/message tools, explicit operation
  completion and saved-result recovery. No implementation changes or deployment;
  await an instruction to implement. Game 26 is stopped and cleaned up.
- October 6 prelaunch checkpoint, 11:45 UTC: active game 0, account awake 0,
  quarantine 0, all 11 latest/pending nonces equal, all seats admitted/funded,
  owner journal resolved and Telegram room access verified. Owner balance
  0.1462 ETH; minimum seat balance 0.01919 ETH against the existing 0.00161 ETH
  readiness floor. OpenClaw oc-1 and Hermes hs-1 passed all nine non-signing
  runtime checks in 58s/46s, with model/route/artifact checks and confirmed sleep.
  Existing targeted logging verification remains 183/183; no source changes.
  Fresh debug-game-5 preparation and metadata validation completed; creation
  fuse unused. No game creation, claim, transaction or running operator.
  Inputs/results: debug-game-5-inputs/{prelaunch-preflight,smoke,invocation,ready}.json
  in the v2 private root. Launch cutoff 2026-10-06T12:22:00.045Z (08:22 EDT),
  hard stop 20:38 UTC, derived from contract timing as before. Refresh live
  checks before launch; if preparation expires, preserve it and prepare a fresh
  directory. Starting the isolated operator remains part of the launch command.
- Approved fix_issue.MD batch implemented locally: completed-discussion cleanup/
  one re-ask/verified public hashes (#02), serialized UTF-8 context budget (#11),
  action clock after admission and separate bounded cleanup (#07), read-only
  lost-reply recovery with lifecycle uncertainty preserved (#10), definite-unsent
  reporting without action retries (#03), and complete canonical award-text
  comparison in the existing proof-audit (#05). Deferred findings remain deferred.
- Fix verification: revised regressions 86/86, runner/award regressions 87/87,
  integration checks 98/98. Logs: fix-verified-regressions.log,
  fix-final-runner-tests.log and fix-integration-targeted.log in the v2 private root.
  Fresh 00:40 UTC preflight: active game 0, awake 0, owner nonce 508; every seat
  admitted/funded. Committed as 4adfeca after a clean staged secret scan.
- All-ten reinstall complete: updated artifacts, OAuth-only routes and disabled
  observers verified on every seat; account awake 0.
  Corrected one old exception assertion for #03's fixed unsent response in
  acb02d4; permit regressions pass 10/10, with zero signing calls on both
  preparation and final-guard rejection. Both fix commits are pushed.
- First batch full suite: 650/654. Four old expectations/fixtures corrected
  (unsent guard response and confirmed sleep readback/failure reporting).
  Live assembly also needed to forward capacity admission/cleanup callbacks and
  validated completion/recovery metadata through proof-run's wrappers. Coordinator
  fixes pass 2/2 live-wrapper regressions; transport/capacity pass 55/55.
- Clean full-suite rerun passed 656/656 (exit 0, 15m37s). Log:
  fix-batch-full-suite-clean.log in the v2 private root. Wrapper fixes are
  committed/pushed as ef01ced; no new agent-side changes or reinstall needed.
- V2 failure reporting now labels pre-chat, chat and completed-cleanup timeouts,
  including the continuity timer, without changing retries or quarantine.
  Targeted checks pass 66/66 (fix-timeout-boundary-verified.log). This coordinator
  reporting change follows the full checkpoint. The final pre-proof full-suite
  run was interrupted at the user's stop request (fix-final-proof-full-suite.log);
  it has no completed result. Run it to completion before final proof.
- Compact logging: existing dispatch records now include exact stage/check,
  timeout source/budget, elapsed stage time and separate queue/action/cleanup
  durations. First failure survives wrappers and later cleanup failures; unknown
  remote work and confirmed sleep remain separate. Outer-timer evidence is retained
  even when an adapter has not returned. Chain/owner records retain fixed operation
  and reason codes; Telegram distinguishes timeout/network/invalid response and
  records failed HTTP status. No per-call log stream, bodies or additional RPCs.
- Logging verification: 179/179 targeted component tests and 4/4 actual controlled
  wrapper tests. Logs: /private/tmp/dilemma-logging-final-targeted-20261006.log and
  /private/tmp/dilemma-logging-wrappers-verified-20261006.log. Earlier runs exposed
  old schema assertions, a direct-error metadata gap and a fixture enqueue-order
  assumption; corrected. Coordinator-only; installed SOURCE_FILES are unchanged,
  so no all-ten reinstall is required. Full suite remains due before final proof.
- Local policy: JSON retained, no character cap, ASD-STE100 guidance; long Telegram
  deliveries preserve text in labeled parts. Covered by the clean 656-test suite.
- Updated JSON/ASD-STE100 protocol is deployed on all ten seats.
- Game 23 used the prior 140-character draft/count prompt and 200-character validator.
- Step 2d: OC1 production diagnosis names `OPENCLAW_RECEIPT_FILES` during
  activation; per-call provenance unresolved. Observer disabled again; OAuth-only
  route and awake 0 confirmed. Use D3 for final proof if still unresolved.
- Game 20: ten awards unpaid. Claims authorized while no game is running.

## Authorization and counters

Standing D1–D4 authorization in AGENTS.md persists until revoked. Caps:
10 creations/day, 30 total; 60 additional wakes/day; 0.07 ETH owner gas/day.

October 5 counters under this authorization: creations 4/10 (total 4/30),
additional wakes 36/60 (all-ten reinstall complete), owner/operator gas
0.000035722944/0.07 ETH through Game 24, reconciled from canonical receipts.
Games 21–24 cleaned up. Counted-draft fix to Game 23 creation: about 60 minutes.
October 6 logging work used zero creations, additional wakes or owner gas.
October 6: creations 2/10 (total 6/30), Games 25–26 confirmed; the earlier stopped
startup sent no creation. Additional wakes 4/60; owner gas through Game 26
0.000016170540/0.07 ETH, reconciled from canonical receipts;
Game 26 added 0.000008488776 ETH across ten owner transactions.
Four smoke wakes were counted
before waking and cleaned up; terminal job stops added no wakes. Attempt 6
preparation added two non-signing wakes, zero creations and zero owner gas.

## Run map

- Package: `integration/conference-runner/`; control entry:
  `node src/conference-control.mjs` (run from that package).
- Existing commands: `plan`, `status`, `diagnose`, `proof-plan`, `proof-status`,
  `proof-prepare`, `proof-run`, `proof-audit`. Debug uses `proof-prepare --debug`
  and `proof-run --debug`; one-seat provenance diagnostic uses `diagnose --seat`.
- Targeted tests: `node --test test/<changed-component>.test.mjs`.
  Integration checkpoint/full suite: `npm test` after steps 3–4 and before proof.
- Private coordinator secrets: `conference-secrets-local/coordinator.env`;
  owner secrets: `conference-secrets-local/launcher.env` (operator only).
  Never print or commit their values.
- Pinned game checkout is installed on each agent; use its manifest binding.
- Historical live artifacts: `/private/tmp/conference-oauth-resume-20261004-b/`;
  inspect their inputs, preserve every old request/fuse, never replay expired runs.
- Current input config/artifact plan/manifest:
  `/private/tmp/conference-game20-claims-oauth-20261004-v7/`.
- Current v2 private reports/counters: `/private/tmp/dilemma-fast-iteration-20261005/`.
  Attempts: `debug-game-N/`; inputs and deadlines: `debug-game-N-inputs/`.
- One-time source deploy/observer transition: `prepareDebugAgents` in
  `src/maritime/prepare-debug.mjs`; reuse existing installer, fresh private output.
- Operator entry: `node --env-file=PRIVATE_OWNER_ENV src/chain/cli.mjs operator`.
  Existing journal: `/Users/wade/.local/state/dilemmaeval-conference/`
  `converge-rehearsal-2026-09-24-r8/operator` (67-record baseline; one signer).
- Original implementation reference: [IMPLEMENTATION-GUIDE.md](IMPLEMENTATION-GUIDE.md).
- Historical evidence archive: [RUN-STATUS.md](archive/RUN-STATUS.md).

## Attempt log

A1 / Game 21: all ten acted; four defaults; hs-1/3/4 discussion protocol-invalid; 56/56 DEBUG messages sent; terminal/awake 0/active 0 confirmed.
A2 / Game 22: all ten joined; oc-4/5, hs-1/2/3 team-message invalid; 27 defaults; 50/50 DEBUG messages sent; terminal/awake 0/active 0 confirmed. First post-fix failure.
A3 / Game 23: all ten acted; three defaults in round 4; hs-4 reveal HTTP 502, hs-5 commit/hs-3 reveal timeouts; 64/64 DEBUG messages sent; terminal/awake 0/active 0/quarantine 0 confirmed; operator stopped. No team-message failures. User requested stop for a new-session audit.
A4 / Game 24: completed in five rounds / 68 minutes, nine chain defaults, all_seats_acted=false. All ten joined/discussed. Four MARITIME_TIMEOUT quarantines: oc-4 round-1 commit, oc-1 round-3 reveal, hs-4/5 round-4 reveal. The latter reveals landed but completion remained unknown; hs-1/2/3 continued. Telegram pending/inflight 0. Terminal/active 0/awake 0/quarantine 0 confirmed after explicit job stop and later inactive reads; operator stopped. Uses the six-fix deployment; live wrapper timing/metadata corrections (ef01ced, pushed) and timeout-stage labels apply to the next attempt. User requested stop before internet loss; no new attempt.
A5 / pre-creation startup stopped: user-authorized October 6; fresh launch preflight passed, operator/coordinator started 12:15 UTC. readEvents RPC_ERROR isolated to HTTP 413 on 1,000 blocks; 100 blocks succeeds. Fixed pagination and safe request-size cause; 27/27 chain regressions, no installed-source changes/reinstall. No game/fuse/wake/signing call; counters remain 0 today / 4 total. Old report and cleanup in debug-game-5; resume in a fresh directory. Prelaunch counter read also corrected for historical at/started_at date fields before launch.
A5 / Game 25 complete: four rounds / 44m04s on-chain, all ten acted, six defaults (0/2/2/2). Round-2 hs-2/hs-3 commits landed but all-committed watcher aborted late chat, retaining two quarantines; three healthy seats continued through round 4. hs-1 malformed round-3 reply recovered once without signing replay. 55/55 DEBUG messages sent, pending/inflight 0. Terminal/active 0/awake 0/quarantine 0 confirmed after explicit job stops and later inactive reads; coordinator/operator stopped, owner journal reconciled. Exact phase_abort cause corrected and pushed as d75edbd (33 runner + 4 wrapper + 4 timer checks); not loaded into this game, requires fresh verification. Reports in debug-game-5-refresh-1. Degraded debug result, not a passed proof.
A6 / Game 26 user-stopped and cleaned up: operator/coordinator started 14:17 UTC, all ten joined on-chain. Four invalid JSON replies: hs-4 join/hs-5 round-1 reveal recovery hit 180s; hs-2 round-2 reveal/hs-3 round-3 commit recovered saved results with completion/sleep, no signing replay. Rounds 1–2 had 1/2 defaults. User requested stop 15:00 UTC; coordinator stopped, retained jobs explicitly stopped and later inactive reads resolved quarantine. Terminal confirmed 15:20 UTC; four rounds / 61m26s on-chain, 42m48s coordinator run. Total defaults 21: three before stop, eighteen from shutdown. All 49 DEBUG messages sent. Fresh 15:23 UTC active 0/awake 0/quarantine 0; operator stopped, 131-record owner journal reconciled. Uses d75edbd, timing unchanged; no new failure category or phase_abort recorded. User weekly usage baseline 53%. Requested deterministic-operations plan written, not implemented. Inputs/results in debug-game-6-inputs and debug-game-6, including {cleanup,completion}.json. No next game scheduled; stopped debug result, not a passed proof.
