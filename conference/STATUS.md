# Conference status

Updated October 5, 2026. Branch: `codex/converge-demo-2026-09-25`.
The user approved `FAST-ITERATION-IMPLEMENTATION-v2.md`; its decisions are final.

## State and next action

- Step 0: full working diff and all untracked files scanned with `gitleaks`; no leaks.
  OAuth targeted tests passed 46/46. Saved every existing modified/untracked file in commit `3fc2d2e`.
- Step 1: AGENTS.md points here with persistent D1 authorization; D5 docs archived.
- Complete: steps 0–5 (6/7). Step 6 deferred while the user reviews brittleness.
- Steps 2–4: named receipt causes, `diagnose --seat`, coordinator debug admission,
  observer disable/restore and persistent seat quarantine implemented locally.
  Integration checkpoint 625/625; pre-proof full suite 631/631 (October 5).
  Supplemental chain 25/25, transport 48/48, installer 8/8. Debug fixtures complete past an uncertain seat,
  with chain defaults, no claims or pin edits. Proof rejects debug evidence.
- Prior V2 all-ten sources deployed; OAuth-only credentials, model and no-fallback
  route checks passed. Hermes observer disable now survives refresh: directory
  flush plus unique temporary files fix the confirmed `FileExistsError` (3/3 tests).
- Live debug diagnostics passed on oc-1 and hs-1, with observers disabled and
  account awake 0. hs-1 needed a fresh conversation after protocol-invalid replies;
  failed jobs were stopped and later stopped reads resolved quarantine. No replay.
- Step 5: Game 21 completed; all ten acted, four defaults, Telegram correct.
- Cleanup 20:15 UTC: active game 0, awake 0, quarantine empty, operator stopped.
- Current: Game 23 running. User requests terminal cleanup, then stop live work.
- User stopped broader investigation; provide a broad audit prompt for a new session.
- Local policy: JSON retained, no character cap, ASD-STE100 guidance; long Telegram
  deliveries preserve text in labeled parts. Targeted tests 198/198; full suite predates this change.
- New agent-side protocol is not deployed: reinstall all ten before another game.
- Current-attempt fix: 140-character discussion draft with terminal length check;
  retain strict 200-character validation and name overflow. Transport 48/48.
- Step 2d: OC1 production diagnosis names `OPENCLAW_RECEIPT_FILES` during
  activation; per-call provenance unresolved. Observer disabled again; OAuth-only
  route and awake 0 confirmed. Use D3 for final proof if still unresolved.
- Preflight October 5 20:17 UTC: active game 0, awake 0, quarantine empty;
  owner nonce 498 clear, all players admitted/funded. Third creation confirmed.
- Game 20: ten awards unpaid. Claims authorized while no game is running.
- Hermes actual OAuth/Sol diagnostics passed historically; OpenClaw production
  receipt verification remains unresolved. Debug disables per-call observers once;
  configuration, OAuth/Sol, no-metered-key and no-fallback checks remain required.

## Authorization and counters

Standing D1 authorization persists across sessions/compaction until revoked:
10 creations/day, 30 total; 60 additional non-game wakes/day; owner/operator
gas at most 0.07 ETH/day; existing balances, ten agents and existing Telegram rooms.
Ask if a wallet cannot cover another game plus cleanup. Claims include Game 20.

October 5 counters under this authorization: creations 3/10 (total 3/30),
additional wakes 26/60, owner/operator gas 0.00001761/0.07 ETH.
Games 21–22 cleaned up. Counted-draft fix to Game 23 creation: about 60 minutes.

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
A3 / Game 23: creation confirmed 20:21 UTC; counted short discussion draft; joins executing. Same-cause failure requires section 7 fallback question after cleanup.
