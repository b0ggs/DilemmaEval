# Canonical conference status

**As of:** October 2, 2026 local takeover implementation

**Active target:** one independently audited 5v5 game using the five existing OpenClaw agents and five existing Hermes agents on Base Sepolia.

**Canonical checklist:** [TAKEOVER-IMPLEMENTATION-CHECKLIST.md](TAKEOVER-IMPLEMENTATION-CHECKLIST.md)

This page is the current operating summary. [RUN-STATUS.md](RUN-STATUS.md) is a chronological evidence archive, and [IMPLEMENTATION-GUIDE.md](IMPLEMENTATION-GUIDE.md) records the original three-agent design. Where either conflicts with this page, treat the older text as historical rather than as current instructions.

## Proven baseline

Games **12, 13, and 14** are the proven three-agent baseline, not 5v5 evidence. Each passed an independent audit with three joins, three agent-authored Telegram strategy messages, three commits, three reveals, a confirmed terminal result, and zero defaults. Game 13 also passed a controlled runner/operator restart without duplicate dispatches.

## Failed 5v5 attempts

- **Game 15:** stopped after one join when `hs-2` reported `INVALID_REPOSITORY`; the newly added Hermes seats were missing their expected checkouts. The game was cancelled and the sole entry was refunded.
- **Game 16:** reached eight joins, then exposed incomplete OpenClaw installations that readiness had missed: `oc-5` lacked the executable game-command wrapper and `oc-4` had corrupt/zero-byte dependency artifacts. The game was cancelled and all eight entries were refunded.
- **Game 17:** reached nine joins; `oc-1` invoked the player CLI without supplying the staged request JSON on stdin, so it created no join journal and signed no transaction. The game was cancelled and all nine entries were refunded.

These attempts establish that agent inventory, model/tool probes, and isolated command checks are not sufficient launch gates.

## Safe checkpoint

- Recoverable source checkpoint: commit `688f3b9` (`Checkpoint conference implementation before takeover hardening`), created after the intended tree passed the takeover secret scan.
- Takeover-hardening implementation: commit `8d0656f` (`Harden conference prelaunch diagnostics and proof evidence`), with the deterministic local baseline and no live mutations.
- Canonical status checkpoint `c54b8b0` was verified before this tranche; the branch and starting working tree matched the handoff.
- Latest historical read-only Base Sepolia observation (September 25): Game 17 is terminal and `active_game_id` is `0`.
- All ten existing Maritime agents were observed sleeping at that historical checkpoint. Do not replace or reprovision them.
- A completed 5v5 game remains unproven. No further game should be created from the historical launch instructions or expired execution windows.

## October 2 local verification

The inherited 255 runner tests and 199 site/shared-package tests were reproduced before implementation. After integration, the documented default suites passed **378/378 conference-runner tests** and **199/199 site/shared-package tests** (site 9, game bridge 68, harness adapters 19, Maritime transport 40, orchestrator core 41, team logs 22), with zero failures or cancellations. Targeted development tests and independent source review also completed. The intended-change credential-pattern scan and `git diff --check` passed. These are local fixture results, not live 5v5 or all-ten diagnostic evidence.

## Next gate

The durable all-ten diagnostic producer is implemented. It runs both input modes through Maritime chat → native tool → staged JSON → player CLI stdin, checks independent sanitized CLI receipts, and atomically publishes diagnostics-only readiness-v2 evidence outside the repository. It serializes seats while respecting the account-wide five-awake limit, journals intents, verifies deployed source/model-route/runtime identity, and requires confirmed sleep. Failed or interrupted runs cannot be replayed or overwritten. No gameplay journal, bundle, signing operation, or transaction is part of this path.

The versioned entrypoint is [conference-control.mjs](../integration/conference-runner/src/conference-control.mjs); [operator instructions](../integration/conference-runner/README.md#current-controlled-operator-version-1) describe explicit paths and deadlines. Local `plan`/`status` do not load credentials or contact services. Proof preparation and the creation-guard library bind the same evidence digest, recheck chain/nonces/journals/process ownership, and preserve the one-game fuse after uncertainty. Historical unfused launch entrypoints are disabled. Repeated ten-seat fixtures now cover full games, cancellation/refunds, restart/crash recovery, account capacity, Telegram isolation/recovery, scoreboards, and independent canonical audits.

**Creation remains blocked.** The historical `activation_generation` is a local journal counter. The pinned Maritime SDK's [Agent contract](https://github.com/maritime-sh/maritime-sdk/blob/main/typescript/src/types.ts) does not document a remote generation token. New evidence records the durable diagnostic activation intent and observed runtime identity, but explicitly sets `remote_generation_attested:false` and `ready_for_controlled_gameplay:false`. An unseen restore after final sleep cannot be ruled out; current-generation verification returns `READINESS_REMOTE_GENERATION_UNATTESTED`. Do not invent a generation from `updatedAt`, copy historical counters, or set readiness booleans manually.

Remaining live preflight: establish a trustworthy remote lifecycle revalidation mechanism; review exact config, artifacts and existing installed paths; authorize any required source refresh and one bounded all-ten diagnostic window; then refresh chain/code/defaults/admissions/causes/balances/nonces, process and journal state, Telegram destinations/pins/permissions/outbox and scoreboard identity. A separate reviewed game window and independent gate audit remain required. This tranche made no agent wake, model call, chain transaction, game, or Telegram message and made no fresh live-state observation. Historical stopped/sleeping observations above are unchanged evidence, not a new live readback.
