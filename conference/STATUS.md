# Conference status

Updated October 5, 2026. Branch: `codex/converge-demo-2026-09-25`.
The user approved `FAST-ITERATION-IMPLEMENTATION-v2.md`; its decisions are final.

## State and next action

- Step 0: full working diff and all untracked files scanned with `gitleaks`; no leaks.
  OAuth targeted tests passed 46/46. Saved every existing modified/untracked file in commit `3fc2d2e`.
- Step 1: AGENTS.md points here with persistent D1 authorization; D5 docs archived.
- Complete: steps 0–5 (6/7). Step 6 follows the approved fix_issue.MD batch.
- Steps 2–4: named receipt causes, `diagnose --seat`, coordinator debug admission,
  observer disable/restore and persistent seat quarantine implemented locally.
  Integration checkpoint 625/625; pre-proof full suite 631/631 (October 5).
  Supplemental chain 25/25, transport 48/48, installer 8/8. Debug fixtures complete past an uncertain seat,
  with chain defaults, no claims or pin edits. Proof rejects debug evidence.
- Prior V2 all-ten sources deployed; OAuth-only credentials, model and no-fallback
  route checks passed. Hermes observer disable now survives refresh: directory
  flush plus unique temporary files fix the confirmed `FileExistsError` (3/3 tests).
- Initial live diagnostics passed on oc-1/hs-1 with observers disabled and awake 0.
- Step 5: Games 21/23 completed; all ten acted; four/three defaults; Telegram correct.
- Cleanup 21:06 UTC: active game 0, awake 0, quarantine empty, operator stopped.
- Current: verify fix_issue.MD's six implemented corrections in debug, then
  continue V2 step 6. Deferred findings remain out of scope.
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
  fixes pass 2/2 live-wrapper regressions; transport/capacity pass 55/55. Clean
  full-suite rerun starts with these corrections; no new agent-side changes.
- Local policy: JSON retained, no character cap, ASD-STE100 guidance; long Telegram
  deliveries preserve text in labeled parts. Targeted tests 198/198; full suite predates this change.
- Updated JSON/ASD-STE100 protocol is deployed on all ten seats.
- Game 23 used the prior 140-character draft/count prompt and 200-character validator.
- Step 2d: OC1 production diagnosis names `OPENCLAW_RECEIPT_FILES` during
  activation; per-call provenance unresolved. Observer disabled again; OAuth-only
  route and awake 0 confirmed. Use D3 for final proof if still unresolved.
- Game 20: ten awards unpaid. Claims authorized while no game is running.

## Authorization and counters

Standing D1 authorization persists across sessions/compaction until revoked:
10 creations/day, 30 total; 60 additional non-game wakes/day; owner/operator
gas at most 0.07 ETH/day; existing balances, ten agents and existing Telegram rooms.
Ask if a wallet cannot cover another game plus cleanup. Claims include Game 20.

October 5 counters under this authorization: creations 4/10 (total 4/30),
additional wakes 36/60 (all-ten reinstall complete), owner/operator gas 0.00002619/0.07 ETH.
Games 21–23 cleaned up. Counted-draft fix to Game 23 creation: about 60 minutes.

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
A4 / Game 24: running; all ten joins confirmed, no health issues. Uses the six-fix deployment; live wrapper timing/metadata corrections were found after creation and apply to the next attempt. Cleanup pending.
