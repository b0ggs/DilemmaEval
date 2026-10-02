# Conference runner

The September 25 demo combines the existing game bridge, team logs, and orchestrator core with real chain/Maritime/Telegram adapters and a static phone website. The roster is configurable; the example is OpenClaw 2 vs Hermes 1. **Implemented and locally tested does not mean live-proven.** See [run status](../../conference/RUN-STATUS.md) for current evidence and blockers.

Requires Node 22+, `npm ci`, and the pinned runtime described in [Maritime installation](src/maritime/README.md). All chain writes use Base Sepolia. The coordinator holds API credentials but no player or owner signing keys. Each player executes its own tool in its own Maritime runtime and keeps its private reveal bundles on persistent storage.

## Current controlled operator (version 2)

The active target is the existing five OpenClaw and five Hermes agents. Follow [the canonical checklist](../../conference/TAKEOVER-IMPLEMENTATION-CHECKLIST.md). `src/conference-control.mjs` replaces workstation-specific preparation and execution. Historical `run`, `rehearse`, and saved controlled-proof entrypoints refuse execution with `PROOF_VERSIONED_CLI_REQUIRED`. None of these commands grants authorization for a live operation.

`plan` and `status` are local and read-only: no credentials, providers, or directory creation. Supply the exact public config, operations manifest, and an artifact plan containing `{ "schema_version": 1, "seats": [{ "seat_id": "oc-1", "persistent_root": "/actual/installed/volume" }] }` with one row per seat. Use existing installed roots. Artifact reconstruction uses repository sources; deployed differences require a reviewed source refresh before diagnostics. New live artifacts require player-side execution permits.

```sh
node integration/conference-runner/src/conference-control.mjs --version
node integration/conference-runner/src/conference-control.mjs plan \
  --config /absolute/public/conference.json \
  --runtime-dir /absolute/outside-repository/new-readiness-run \
  --artifact-plan /absolute/public/artifact-plan.json \
  --operations-manifest /absolute/public/operations-manifest.json
```

After explicit authorization, `diagnose` accepts those four paths plus `--deadline UTC_ISO`, `--cleanup-deadline UTC_ISO`, and `--secrets-env /absolute/private/coordinator.env`. It wakes/reloads/configures the existing agents, runs both native diagnostic inputs within one activation per seat, and confirms sleep. These operations consume model/service usage but never create a game, journal a gameplay request, prepare a bundle, or sign. Never supply an owner/player signing key to the coordinator.

Use canonical external paths, for example `/private/tmp` rather than its `/tmp` alias. A fresh directory holds the sanitized diagnostic journal, lifecycle state, and atomic `readiness-v2.json`. Both native CLI receipts are verified independently of model replies. Receipts contain only public diagnostic identity/results, never choice-bearing stdin. Failed/interrupted directories remain inspectable and cannot be replayed or overwritten. Evidence age starts at the beginning of the diagnostic run; the ten-minute maximum includes the oldest seat result.

Producer version 2 uses `observed-runtime-continuity-v1`. `activation_generation` identifies a local durable diagnostic activation intent; `remote_generation_attested` remains false. Readiness permits subsequent verification under this observed-continuity policy; it is not remote/provider attestation or unconditional launch permission. Every resumed seat must retain its observed VM incarnation, exact source/model/wallet bindings, and both original CLI receipts. Ordinary snapshot resume may pass; a cold runtime, missing receipt, altered artifact, or ambiguous lifecycle fails. An invisible restore to byte-identical state cannot be distinguished and is not claimed as provider lifecycle history. Gameplay does not reload, reconfigure, or repair agents. A repair requires fresh all-ten diagnostics.

Proof commands require all of these explicit arguments:

- `--config`, `--evidence`, `--readiness-dir`, `--proof-dir`, `--operator-dir`, `--runner-dirs` (JSON array of absolute runtime directories).
- `--artifact-plan`, `--operations-manifest`, `--verification-root` (existing canonical private directory outside the repository, mode 0700).
- `--stop-new-games-at`, `--hard-stop-at` (absolute UTC timestamps), and `--secrets-env`.

`proof-plan` and `proof-status` read chain/account metadata, load no signing key, never wake agents, and report that runtime verification is still required. `proof-prepare` explicitly wakes, inspects, and sleeps all ten serially before writing a fresh preparation; it never signs. Preparation requires stopped processes and a fresh durable verification directory. Both preparation and creation validate the same original evidence digest, source/prepared config, artifacts, confirmed chain/defaults, owner/player nonces, journals, and process locks. Expired evidence or unresolved state blocks execution. Each verification writes a separate journal under the verification root; it never refreshes the original diagnostic timestamp or digest.

After separate game authorization, `proof-run` additionally requires `--operator-pid PID`, `--operator-url http://127.0.0.1:PORT`, and `--scoreboard-bindings FILE`. Start the existing isolated operator using the prepared config and preserved operator journal; do not replace its state. The command checks exact process ownership and existing Telegram rooms/pins/permissions/outbox/scoreboard identity, then initializes one guarded runner. It performs another durable all-ten continuity verification immediately before creation. The fsynced one-game fuse includes that verification digest; uncertainty permanently consumes it. Player-side immutable request permits recheck continuity inside the seat lock before gameplay preparation/signing. Operator deadlines and caller disconnects prevent late signing/broadcast. SIGINT/SIGTERM stops new work and preserves uncertain outcomes; it does not silently reset or relaunch a proof.

`proof-run` writes a candidate-only report. `proof-audit --proof-dir DIR --game-id ID --scoreboard-bindings FILE --secrets-env FILE --output NEW_FILE` independently reads canonical chain receipts/events, dispatches, room delivery, awards, scoreboard ledger and actual pins, then writes a separate atomic sanitized audit. Output must be new and outside the repository. Both chain and scoreboard auditors must agree before `proof_complete:true`; rejected audits exit 2. No command overwrites a prior proof or repairs unresolved live state automatically.

## Local preview and tests

```sh
npm ci --prefix integration/conference-runner
npm test --prefix integration/conference-runner
npm test --prefix conference/site
node integration/conference-runner/src/cli.mjs fixture \
  --runtime-dir /tmp/dilemma-conference-preview-1 --port 8787
```

Open `http://127.0.0.1:8787`. This explicitly labeled fixture uses synthetic actions/messages, no RPC, no wallet, and no external service. It exercises scheduling, persistence, team logs and public projection; it is not a game-rules simulation. Use a new directory for a fresh fixture chain. Integration tests restart the coordinator against the same retained fixture chain. Fixture data must never be used as conference evidence.

## Read-only live preflight

```sh
node integration/conference-runner/src/cli.mjs preflight \
  --config conference/config.example.json \
  --secrets-env /absolute/private/path/coordinator.env \
  --output /absolute/path/new-public-preflight.json
```

The example's third agent ID and Telegram settings intentionally remain unset; start block and schedule must be selected for the actual run. Preflight permits the missing agent ID so inventory and chain checks can run. Exit `2` means readiness is incomplete. The output is an allowlisted public report; errors contain codes, not provider responses. The env loader reads only `MARITIME_API_KEY`, `TELEGRAM_BOT_TOKEN`, and `DILEMMA_LAUNCHER_TOKEN`. Do not put signing keys in the coordinator environment or its configuration.

Preflight verifies the expected network, code presence/hash, owner/auth/identity wiring, seat admission, distinct identities, causes and balances. A wallet balance above entry fee is only an immediate sanity check; measure gas and payouts to establish operating runway. A code hash alone is not proof of source equivalence.

## Historical live operation (disabled entrypoints)

1. Reconcile account agents within the three-slot budget, complete the public config, install the same tools/model profile in each real harness, verify wallet identity and persistent bundles, and restrict spectator/opponent feed access in actual tool/network policy. [Installation tools](src/maritime/README.md) produce artifacts but never label them live-proven automatically.
2. Use the [isolated signer CLI](src/chain/README.md) to configure all nine defaults while idle and read back the receipt. One owner/operator process handles both creation and phase advancement with one key, queue and journal. Put `DILEMMA_LAUNCHER_PRIVATE_KEY` only in `launcher.env`; `phase.env` is unused. The coordinator uses the matching service token and receives no signing key.
3. Configure two read-only spectator groups with one bot and verify permissions using the [Telegram adapter](src/telegram/README.md). No spectator messages become agent inputs.
4. Record real harness verification in a private evidence JSON file with the format below. This is required because model/tool execution, persistent storage and browsing restrictions cannot be established by successful HTTP chat alone.
5. Start the runner, then verify real join/commit/reveal/result transactions for every seat before checking off any live completion item.

```sh
node integration/conference-runner/src/cli.mjs run \
  --config /absolute/private/path/conference-config.json \
  --runtime-dir /absolute/private/path/run-state \
  --secrets-env /absolute/private/path/coordinator.env \
  --readiness /absolute/private/path/verified-harnesses.json \
  --host 127.0.0.1 --port 8787
```

`DILEMMA_LAUNCHER_URL` defaults to `http://127.0.0.1:8791` for both creation and phase advancement. Both use `DILEMMA_LAUNCHER_TOKEN`; no separate phase URL, token or key is needed. Remote signer endpoints require HTTPS and authentication. The public server exposes only static site assets and `GET /api/state`; never serve the private runtime directory. Bind behind an HTTPS reverse proxy on the always-on host. Supervisor examples are in [conference/operations](../../conference/operations/README.md).

Private harness evidence shape (fill from actual checks; do not set booleans merely to bypass readiness):

```json
{
  "schema_version": 1,
  "run_id": "the-selected-run-id",
  "roster_fingerprint": "sha256 returned by rosterFingerprint(config)",
  "verified_at": "the-actual-UTC-verification-time",
  "game_code_hash": "the-verified-deployment-code-hash",
  "seats": [
    {
      "seat_id": "oc-1",
      "agent_id": "the-real-agent-id",
      "tool_execution_verified": true,
      "persistent_bundles_verified": true,
      "spectator_access_blocked": true,
      "wallet_identity_verified": true,
      "model_endpoint": "https://api.maritime.sh/api/llm/v1",
      "model": "gpt-5.4-mini"
    }
  ]
}
```

Include one row per actual roster seat. `rosterFingerprint` is exported by `src/readiness.mjs`. The model profile is the existing pinned profile; changing it needs an explicit shared profile update and verification across both harnesses.

## Recovery and operating limits

The runner takes an exclusive process lock, atomically persists state and stable action IDs, then reads chain state before dispatch. Confirmed creation/terminal events scoped to the configured start block determine game counts; historical game IDs are not counts. Claims and refunds remain separate from awards. Joining uses a strict timestamp deadline, commit/reveal use strict block deadlines, and requests run concurrently across seats. After terminal state, the default intermission is 20 seconds. At `stop_time`, no new game is launched; the active game and outstanding claims continue to reconcile.

Agent/provider timeouts are uncertain execution, not proof of cancellation. The coordinator and per-player journals stop automatic retransmission of uncertain transactions. Signer services persist nonce/hash before broadcasting and can reconcile receipts; operator intervention may still be required when no receipt/chain progress can establish the outcome. No automatic account or nonce reset is offered. A confirmed-chain fork stops scheduling for reconciliation instead of silently changing counters.

Telegram outages do not stop chain scheduling. Its outbox persists delivery state, observes retry-after and records ambiguous sends without blind duplicate retries. The website displays canonical accepted team messages during a chat outage and visibly marks stale/degraded data. Restart recovery, Telegram outage and real-game continuity still need live rehearsal.

Missing Telegram credentials/groups also leave the mirror disconnected without preventing a real-game rehearsal. Both live groups and verified read-only invitations remain required for the complete conference deliverable.

`SIGTERM` waits for the current tick, closes the public server and releases the lock. A supervisor restart resumes from the same private directory. Run stop time is independent of process shutdown; inspect outstanding settlement before taking the host offline. Save an explicitly labeled backup recording after the real rehearsal; never mix replay counts with live state.

The default regression commands for this tranche are `npm test --prefix integration/conference-runner`, `npm test --prefix conference/site`, and `npm test --prefix integration/PACKAGE` for `game-bridge`, `harness-adapters`, `maritime-transport`, `orchestrator-core`, and `team-logs`. The runner default executes tests sequentially. No live diagnostic or game is part of these suites.
