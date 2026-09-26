# Fresh-session takeover — 2026-09-25, 23:48 UTC

Use this checkout: `/Users/wade/Documents/DilemmaEval`, branch `codex/converge-demo-2026-09-25`. Read `AGENTS.md`, the opening scope/design of `IMPLEMENTATION-GUIDE.md`, this file, then the latest entries in `RUN-STATUS.md`. Older guide/status entries describe superseded stages; do not repeat them as new work.

## Scope and stop state

Target: five existing Hermes and five existing OpenClaw agents on `gpt-5.4-mini`, genuine team strategy in the two Telegram rooms, zero-default commits/reveals, confirmed result and correct pinned scores. A completed 5v5 game is still unproven. Earlier three-agent games are a working baseline, not 5v5 acceptance.

The previous three-hour window ended **2026-09-25T19:46:14Z**. Do not reset it implicitly. Automatic approval review also rejected Game18 twice because it requires an explicit override of the earlier one-game restriction. That override remains unanswered. A new session does not remove either limit. Obtain an explicit new execution window and override before another launch; do not change commands to evade the rejection.

Last verified live checkpoint, approximately 17:54 UTC: Game17 cancelled, active game 0, all nine Game17 and eight Game16 refunds confirmed, ten agents sleeping, runner/operator stopped, both message-3 pins showing 0–0 and one cancellation. These are saved observations, not fresh reads at handoff time. This handoff made no remote mutations.

## What failed, and what is already fixed

- Installation completeness: missing checkouts/wrappers and corrupt dependency manifests. Existing runtimes repaired; all ten actual read-only game commands passed. No replacement agents needed.
- Hermes/mini compatibility: existing harness configuration/provider fixes installed. Do not repeat model migration or reinstall everything.
- Intermittent chain-ID verification: one bounded retry of a thrown read-only failure added; no signing retry. Exact original network subtype was not recovered.
- Latest blocker: Game17 reached **9/10 joins**. `oc-1` invoked the player CLI without its required stdin. This failed before signing; the native tool call was malformed, not a contract rejection.
- Latest fix is coordinator-side `src/maritime/transport.mjs`: stage the exact public request, then supply an exact shell command with stdin already wired. For commits the agent still chooses its own move. No remote runtime reinstall required. **29 transport tests passed** plus independent review. Cached completed-action probes passed on both `oc-1` and `hs-1`, returning the original transaction with unchanged nonce. This proves input delivery, not a fresh complete game.

Evidence: `evidence/game17-oc1-stdin-diagnosis-2026-09-25.json`, `evidence/staged-stdin-delivery-proof-2026-09-25.json`, `evidence/ten-seat-command-readiness-2026-09-25.json`, `evidence/game17-refunds-reconciled-2026-09-25.json`, `evidence/telegram-cancelled-scoreboard-readback-2026-09-25.json`.

## Small execution checklist

1. Preserve the working tree and all private state. No provisioning, funding, model upgrade, rules change or broad cleanup. There are 22 modified tracked files; **the entire `integration/conference-runner/` and `conference/` are untracked**, so a branch-only checkout will omit essential work. Do not reset/clean/stash/switch branches.
2. Resolve the new window/launch override before live execution. Then refresh chain idle state, current game ID, pending nonces, balances, admissions, defaults and actual runtime readiness where evidence is stale. Do not blindly repeat successful paid probes.
3. Use existing controlled-proof tools. Game18 was prepared only; no launch fuse was present. Its local window and absolute deadlines are now expired. Confirm no fuse/runtime and preserve preparation before refreshing it under the newly authorized window. `prepare` cannot simply be rerun into the existing directory. Do not assume Game18 is still the next chain ID without reading it.
4. One lead operates remotely; use a bounded independent local reviewer for a demonstrated change. One active game at a time. On failure, retain the allowlisted error, reconcile transaction state, fix only that cause, run a targeted check, then retry only within the new authorization. Never replay uncertain signing.
5. Require ten joins, real messages from all ten in the correct rooms, zero defaults, confirmed result, canonical awards and both actual pin readbacks. Run the independent audit; a helper's `candidate_proof_complete` is not acceptance. Record actual interval cost separately from setup.
6. Close out by the authorized deadline: stop launches, reconcile terminal play/refunds/outbox, stop runner/operator and sleep agents. Update the latest status. Defer general cleanup until after a complete proof.

## Existing operational entry points

- Master config: `/private/tmp/dilemma-conference-live-20260925/config.json`; public copy `evidence/conference-live-five-v-five-20260925.config.json`.
- Prepared attempt: `/private/tmp/dilemma-proof-five-v-five-mini-20260925d`; control script `/private/tmp/dilemma-game18-control-20260925.sh` (`status`, `prepare`, `run`, `audit`, `cancel`). **Expired; review before use.**
- Proof implementations: `conference/operations/saved-helpers/controlled-proof-ten.mjs`, `controlled-proof.mjs`, `audit-controlled-proof.mjs`.
- Runtime evidence: `/private/tmp/dilemma-takeover-20260925/runtime-evidence.json`. Diagnostic helper `/private/tmp/dilemma-takeover.mjs`; `diagnose` restarts the selected agent, so never use it during play. Never print raw private journals/sessions.
- Existing owner operator: `node --env-file=/Users/wade/.config/dilemmaeval-conference/launcher.env integration/conference-runner/src/chain/cli.mjs operator <fresh-proof-config> /Users/wade/.local/state/dilemmaeval-conference/converge-rehearsal-2026-09-24-r8/operator 8791`. One instance only; preserve that journal.
- Coordinator credentials: `/Users/wade/.config/dilemmaeval-conference/coordinator.env`. Existing ten-agent provisioning journal: `/Users/wade/.local/state/dilemmaeval-conference/converge-five-v-five-mini-2026-09-25-r1/maritime-launch/records.json`. Read only safe fields; never dump these files.
- Scoreboard bindings: `/private/tmp/dilemma-conference-live-20260925/scoreboard-bindings.json`; durable series ledger under the sibling `series/telegram/` directory. Hermes chat `-1004202252236`, OpenClaw `-1004378812354`, pinned message **3** each. Edit those pins; do not create duplicates or repoint old outboxes.
- Base Sepolia only (`84532`), contract `0x42892BEc3d1d926Db25FfB6A144ee363AaE40A1a`. Historical defaults: 10/10, entry 0.0001 test ETH, join 300 seconds, commit 300 blocks, reveal 180 blocks. Refresh before use.

## Architecture and cleanup boundary

There are two reusable harness recipes, five instances each, sharing game code but with distinct wallets, identities and private state. Maritime supplies hosting/lifecycle/chat/exec. This repository supplies game installation, player tools, chain scheduling, team logs and Telegram accounting. The runner currently mixes SDK calls and direct REST calls through a custom adapter; it is not simply ten SDK chat calls. Installed SDK is pinned to 0.6.0, while current online file/exec examples require 0.8.0+. That difference alone is not evidence that an upgrade fixes the recorded failures.

Relevant code: `integration/conference-runner/src/maritime/{recipes,install-runtime,player-cli,player-runtime,transport}.mjs`, `integration/game-bridge/src/index.js`, and runner/chain/telegram directories. Historical diagnostics and overlapping docs are cleanup candidates, not grounds to delete unreconciled state or working code. Keep cleanup out of the next gameplay proof.

Official SDK reference checked at handoff: https://maritime.sh/docs/sdk/agents . The SDK documents both provisioning and chat errors; provisioning a framework does not install this game's application-specific runtime.
