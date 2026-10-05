# Conference status

Updated October 5, 2026. Branch: `codex/converge-demo-2026-09-25`.
The user approved `FAST-ITERATION-IMPLEMENTATION-v2.md`; its decisions are final.

## State and next action

- Step 0: full working diff and all untracked files scanned with `gitleaks`; no leaks.
  OAuth targeted tests passed 46/46. Saved every existing modified/untracked file in commit `3fc2d2e`.
- Step 1: AGENTS.md now points here and records persistent D1 authorization.
- Steps 2–4: named receipt causes, `diagnose --seat`, coordinator debug admission,
  observer disable/restore and persistent seat quarantine implemented locally.
  Latest targeted checks passed 50/50; debug fixtures complete past an uncertain
  seat, with chain defaults, no claims or pin edits. Proof rejects debug evidence.
- Next: commit; full suite at the steps 3–4 checkpoint; deploy the batched sources
  and disable observers on all ten; live Sol diagnostics; then a debug 5v5.
- Live read October 5 16:38 UTC: active game 0, account awake 0, all eleven
  nonces clear, all players funded/admitted. Refresh before mutation.
- Game 20: ten awards unpaid. Claims authorized while no game is running.
- Hermes actual OAuth/Sol diagnostics passed historically; OpenClaw production
  receipt verification remains unresolved. Debug disables per-call observers once;
  configuration, OAuth/Sol, no-metered-key and no-fallback checks remain required.

## Authorization and counters

Standing D1 authorization persists across sessions/compaction until revoked:
10 creations/day, 30 total; 60 additional non-game wakes/day; owner/operator
gas at most 0.07 ETH/day; existing balances, ten agents and existing Telegram rooms.
Ask if a wallet cannot cover another game plus cleanup. Claims include Game 20.

October 5 counters under this authorization: creations 0/10 (total 0/30),
additional wakes 0/60, owner/operator gas 0/0.07 ETH.
No new live operations in this implementation yet.

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
- One-time source deploy/observer transition: `prepareDebugAgents` in
  `src/maritime/prepare-debug.mjs`; reuse existing installer, fresh private output.
- Operator entry: `integration/conference-runner/src/cli.mjs operator`.
  Preserve its existing journal and use one signer process.
- Original implementation reference: [IMPLEMENTATION-GUIDE.md](IMPLEMENTATION-GUIDE.md).
- Historical evidence archive: [RUN-STATUS.md](RUN-STATUS.md).

## Attempt log

No attempts under D1 yet. Record game, first failure cause, defaults, Telegram,
terminal chain read and account-awake read after each attempt.
