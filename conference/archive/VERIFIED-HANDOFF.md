# Verified handoff — September 24, 2026

Independent audit at **20:37 UTC**. Work in `/Users/wade/Documents/DilemmaEval`, branch `codex/converge-demo-2026-09-25`. Preserve the dirty checkout and untracked files. This checkpoint supersedes conflicting older sections of RUN-STATUS.md.

## Confirmed position

- Exactly three existing Maritime agents match r8; all are sleeping. Do not reprovision or repeat the Hermes ownership repair. SDK launch automation and version `.7` recipes exist. Current locally rebuilt install artifacts match all three r8 journal hashes; each install, verification and final sleep is recorded complete.
- r8 passes `validateControlledRuntimeEvidence`; it **does not** pass the normal live gate. Model profile, spectator restrictions, bundle recovery and real gameplay remain unproven. Audit did not wake agents or repeat their recorded model/tool checks.
- Fresh Base Sepolia read: block `47256972`, active game `0`, lifetime game ID still `1`, old 32-player defaults unchanged. Owner/player pending nonces equal latest; no matching local operator/runner/provisioner process was found. No conference game has started.
- **83 targeted tests passed**: `node --test test/maritime/*.test.mjs test/integration.test.mjs test/live-secrets.test.mjs` from `integration/conference-runner`. `git diff --check` passed. No live mutation during audit.

## User priority: prove three bots, then Pro

The user will upgrade to **Pro after three bots are proven**. Target Pro for the conference; do not build more free-tier infrastructure or spend another session tuning around its limits. The immediate proof is **one real game in which all three agents join, commit, reveal and reach a confirmed result, with real OpenClaw and Hermes messages and the result visible in Telegram**. One shared demo group is sufficient for this first proof; two team spectator groups remain the final conference scope. Provisioning/tool checks or a console-only game do not meet acceptance. Use the existing setup for that bounded proof; make only narrow correctness fixes needed to execute it. Treat Pro concurrency as the operating target, not permanent one-awake rotation.

## Fix before the first game

The runner times out each dispatch while the one-awake adapter queues/wakes it. Timed-out requests remain executable. A fixture using the actual runner and adapter confirmed **all three chat calls started after their outer timeout**, leaving `AGENT_ACTION_UNCERTAIN`.

Reproduce: `node conference/evidence/queue-timeout-repro-2026-09-24.mjs`. See [result](evidence/queue-timeout-audit-2026-09-24.json), `src/runner/index.mjs:323` and `src/maritime/transport.mjs:154–195` within the conference package. Fix queue-aware timeout/deadline handling; prove expired unsent work never executes, while uncertain submitted work is reconciled without replay. Do not solve this merely by increasing timeouts. Reuse the existing agents; retain the current rotation only as needed for this supervised proof. Do not redesign the lifecycle/provisioning system.

## Resume from these artifacts

`R8=/Users/wade/.local/state/dilemmaeval-conference/converge-rehearsal-2026-09-24-r8`

Use `$R8/maritime-launch/conference.bound.json`, `runtime-evidence.json`, and `records.json`. Credentials: `/Users/wade/.config/dilemmaeval-conference/coordinator.env` and `launcher.env`; player wallets: `/Users/wade/.config/dilemmaeval-pilot/wallets/`.

After the fix, refresh chain state, apply/read back `conference/defaults.rehearsal.json` through the sole owner/operator, and use **`cli.mjs rehearse --accept-initial-readiness-gaps true`**, not `run`. Ordinary preflight uses stricter conference timing; use `assessControlledChainReadiness` for rehearsal. Rehearsal is continuous, not a one-game command. Select an explicit first-game stopping mechanism and valid schedule; r8 stops creating games after **2026-09-25 00:00 UTC**. Keep evidence/run identity consistent.

Stop the first proof after one confirmed three-seat game, visible Telegram messages/results, and report receipts plus the Telegram destination. The user then handles the Pro upgrade. Repeat/restart verification, the final two-group arrangement and hosting follow. The verified token belongs to `@DilemmaDealer2026Bot`; both chat IDs are still unset. A request for an existing demo group link/chat ID and bot membership is pending; do not post to an arbitrary destination. Preserve agent-authored text with clear seat/harness labels. [Fresh live audit](evidence/handoff-audit-2026-09-24T20-37-14-232Z.json).
