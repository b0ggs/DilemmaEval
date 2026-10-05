# Conference status

Updated October 5, 2026. Branch: `codex/converge-demo-2026-09-25`.
The user approved `FAST-ITERATION-IMPLEMENTATION-v2.md`; its decisions are final.

## State and next action

- Step 0: full working diff and all untracked files scanned with `gitleaks`; no leaks.
  OAuth targeted tests passed 46/46. Saved every existing modified/untracked file in commit `3fc2d2e`.
- Step 1: AGENTS.md now points here and records persistent D1 authorization.
- Complete: steps 0, 1, 3 and 4 (4/7). Current: step 5; remaining: 2d, 5, 6.
- Steps 2–4: named receipt causes, `diagnose --seat`, coordinator debug admission,
  observer disable/restore and persistent seat quarantine implemented locally.
  Integration checkpoint passed 625/625; supplemental chain 25/25, transport
  46/46 and installer 8/8. Debug fixtures complete past an uncertain seat,
  with chain defaults, no claims or pin edits. Proof rejects debug evidence.
- All-ten public sources deployed; OAuth-only credentials, model and no-fallback
  route checks passed. Hermes observer disable now survives refresh: directory
  flush plus unique temporary files fix the confirmed `FileExistsError` (3/3 tests).
- Live debug diagnostics passed on oc-1 and hs-1, with observers disabled and
  account awake 0. hs-1 needed a fresh conversation after protocol-invalid replies;
  failed jobs were stopped and later stopped reads resolved quarantine. No replay.
- Step 5: first debug 5v5 prepared; single operator and runner now executing.
- Next: observe all-ten gameplay and confirm terminal/account cleanup.
- Next-attempt fix: isolate native conversations per request; name JSON parse
  failures. Transport tests 47/47; coordinator only, no agent-source changes.
  OC1's named per-call diagnosis is still pending (step 2d).
- Preflight October 5 18:13 UTC: active game 0, awake 0, quarantine empty;
  owner nonce 476 clear, all players admitted/funded, owner balance 0.14625 ETH.
- Game 20: ten awards unpaid. Claims authorized while no game is running.
- Hermes actual OAuth/Sol diagnostics passed historically; OpenClaw production
  receipt verification remains unresolved. Debug disables per-call observers once;
  configuration, OAuth/Sol, no-metered-key and no-fallback checks remain required.

## Authorization and counters

Standing D1 authorization persists across sessions/compaction until revoked:
10 creations/day, 30 total; 60 additional non-game wakes/day; owner/operator
gas at most 0.07 ETH/day; existing balances, ten agents and existing Telegram rooms.
Ask if a wallet cannot cover another game plus cleanup. Claims include Game 20.

October 5 counters under this authorization: creations 1/10 (total 1/30),
additional wakes 24/60, owner/operator gas 0.00000095/0.07 ETH.
Game 21 executing; no additional creation until cleanup.

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
- Pinned local game checkout: `/private/tmp/dilemma-conference-game`.
- Historical live artifacts: `/private/tmp/conference-oauth-resume-20261004-b/`;
  inspect their inputs, preserve every old request/fuse, never replay expired runs.
- Current input config/artifact plan/manifest:
  `/private/tmp/conference-game20-claims-oauth-20261004-v7/`.
- Current v2 private reports/counters: `/private/tmp/dilemma-fast-iteration-20261005/`.
  First debug: `debug-game-1/`; inputs and deadlines: `debug-game-1-inputs/`.
- One-time source deploy/observer transition: `prepareDebugAgents` in
  `src/maritime/prepare-debug.mjs`; reuse existing installer, fresh private output.
- Operator entry: `node --env-file=PRIVATE_OWNER_ENV src/chain/cli.mjs operator`.
  Existing journal: `/Users/wade/.local/state/dilemmaeval-conference/`
  `converge-rehearsal-2026-09-24-r8/operator` (67 confirmed records, stopped).
- Original implementation reference: [IMPLEMENTATION-GUIDE.md](IMPLEMENTATION-GUIDE.md).
- Historical evidence archive: [RUN-STATUS.md](RUN-STATUS.md).

## Attempt log

A1 / Game 21: all ten acted; R1–2 zero defaults; hs-1 R3 discussion protocol-invalid, quarantined; game/cleanup pending.
