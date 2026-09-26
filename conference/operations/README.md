# Always-on host preparation

For the immediate supervised proof, use [the one-hour restart plan](../TOMORROW-ONE-HOUR.md). `saved-helpers/` preserves the already-used local bounded-run, audit, safe-chain-read and insufficient-player cancellation scripts. They retain explicit workstation/private-config paths and contain no credential values; they are not the Linux production services described below.

These are reviewable local service templates, not deployed services. They assume a Linux host with Node 22+, an unprivileged `dilemma` account, checkout `/opt/dilemmaeval`, config/evidence under `/etc/dilemma`, and private state under `/var/lib/dilemma`. Adjust paths to the selected host before installation. Keep private files `0600` and directories `0700`; give the operator process only `launcher.env` and the coordinator only `coordinator.env`. No key values belong in this directory or Git.

- `launcher.env`: `DILEMMA_LAUNCHER_PRIVATE_KEY`, `DILEMMA_SIGNER_TOKEN`. One owner wallet handles creation, configuration and phase advancement.
- `coordinator.env`: `MARITIME_API_KEY`, `TELEGRAM_BOT_TOKEN`, `DILEMMA_LAUNCHER_TOKEN`; this token matches `DILEMMA_SIGNER_TOKEN`, with no signing key.

`phase.env` and `DILEMMA_PHASE_TOKEN` from the earlier setup are unused. Do not duplicate the owner key or start a second signer process. The existing `dilemma-launcher.service` name now runs the combined `operator` command, sharing one nonce queue and journal.

Use the [chain CLI](../../integration/conference-runner/src/chain/README.md) for idle configuration first. Complete actual per-seat installation/model/storage/network checks and write `/etc/dilemma/verified-harnesses.json` as documented in the [runner README](../../integration/conference-runner/README.md). Set actual run ID/start block/stop time in `/etc/dilemma/conference.json`.

After approved host deployment, start `dilemma-launcher` and `dilemma-runner` and expose only `127.0.0.1:8787` through an HTTPS reverse proxy. Keep port 8791 private. Verify `GET /api/state` with a phone over cellular, each real transaction link, restart during an in-flight round, and a Telegram outage. Record selected host, restart commands and recovery paths in a private operator handoff. The process templates alone do not complete those checks.

Service status and logs use `systemctl status dilemma-runner` and `journalctl -u dilemma-runner`; runner logs expose only bounded error codes. Inspect private transaction journals for unresolved writes and use signer `reconcile-operator` command after stopping the corresponding service, never concurrently against its locked directory.

To view an already-saved projected proof state, run `PROOF_DIRECTORY=/absolute/proof-dir node conference/operations/saved-helpers/serve-proof.mjs` (optional `PROOF_SITE_PORT=8787`). This helper reads only `public-state.json`, binds localhost, and performs no runner, agent, or chain operations.

For the proven graceful restart rehearsal, run the bounded helper with `PROOF_PAUSE_AFTER_JOIN=1`. It stops only after three confirmed joins and completed dispatches. Restart the sole operator with its unchanged journal, then run `controlled-proof.mjs resume` with the same proof directory/evidence and actual `PROOF_GAME_ID`, omitting the pause flag. Preserve the original creation fuse. See [rehearsal evidence and limits](../RELIABILITY-REHEARSAL.md).
