# Conference status

Updated October 5, 2026. Branch: `codex/converge-demo-2026-09-25`.
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
- Current: stopped at the user's request before internet loss. Game 24 is terminal;
  fresh active game 0, account awake 0 and quarantine 0 confirmed. Coordinator,
  tests and isolated operator are stopped. No further game launched.
- Next: verify the coordinator wrapper corrections in a fresh debug attempt, then
  continue V2 step 6. Six fix_issue.MD corrections are implemented/deployed;
  live verification and final proof remain. Deferred findings remain out of scope.
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
additional wakes 36/60 (all-ten reinstall complete), owner/operator gas 0.00002619/0.07 ETH
through Game 23; Game 24 gas will be reconciled at cleanup.
Games 21–24 cleaned up. Counted-draft fix to Game 23 creation: about 60 minutes.

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
