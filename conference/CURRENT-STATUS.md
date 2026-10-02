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

- Previous diagnostic implementation checkpoint: `7d8e025` (`Implement durable ten-seat diagnostics and audited fixture coverage`), with all 577 documented default tests passing and all 36 intended files scanned before commit.
- Recoverable source checkpoint: commit `688f3b9` (`Checkpoint conference implementation before takeover hardening`), created after the intended tree passed the takeover secret scan.
- Takeover-hardening implementation: commit `8d0656f` (`Harden conference prelaunch diagnostics and proof evidence`), with the deterministic local baseline and no live mutations.
- Canonical status checkpoint `c54b8b0` was verified before this tranche; the branch and starting working tree matched the handoff.
- Latest historical read-only Base Sepolia observation (September 25): Game 17 is terminal and `active_game_id` is `0`.
- All ten existing Maritime agents were observed sleeping at that historical checkpoint. Do not replace or reprovision them.
- A completed 5v5 game remains unproven. No further game should be created from the historical launch instructions or expired execution windows.

## October 2 continuation

The durable all-ten diagnostic producer, repeated ten-seat assembly fixtures, guarded one-game execution CLI, and independent audit entrypoint are implemented locally. Final documented default suites passed **518/518 runner tests** and **199/199 site/shared tests**: **717 tests**, zero failures, cancellations or skips. Targeted regressions and independent source review also passed. None of these fixture results proves a live 5v5 game.

The producer runs both input modes through Maritime chat → native tool → staged JSON → player CLI stdin and independently verifies sanitized CLI receipts. It journals each operation, binds exact config/roster/runtime sources/artifacts/model/chain identity, respects account-wide capacity including unrelated agents, requires all ten sleeping, and atomically writes readiness-v2 evidence outside the repository. Diagnostics never create gameplay journals/bundles, sign, or submit.

The lifecycle question is now resolved as an explicit observed-continuity policy. `activation_generation` remains a local durable activation-intent sequence; provider attestation is still false. Maritime documents that [sleep/wake resumes the VM snapshot](https://maritime.sh/docs/how-it-works), while its [SDK Agent contract](https://github.com/maritime-sh/maritime-sdk/blob/main/typescript/src/types.ts) does not promise remote generation history. Producer version 2 therefore requires the same observed VM incarnation, exact artifact/model/wallet bindings, and both original diagnostic receipts after each resume. It rejects cold/replaced runtimes and missing or changed observations. It cannot distinguish an invisible restoration to byte-identical state and makes no claim to detect that or attest complete provider lifecycle history. No generation is invented from `updatedAt`.

The version 2 [operator CLI](../integration/conference-runner/README.md#current-controlled-operator-version-2) now exposes local `plan`/`status`, bounded `diagnose`, read-only `proof-plan`/`proof-status`, explicit wake/inspect/sleep `proof-prepare`, fused `proof-run`, and separate `proof-audit`. Preparation and immediate precreation verification retain the original evidence digest and ten-minute lifetime. Each writes its own durable verification record; creation rereads that record before the fuse and before remote creation. Certified gameplay never reloads or repairs a runtime. Immutable per-request permits recheck continuity inside the player lock before gameplay preparation/signing. Operator expiry and caller disconnect are checked before signing and broadcasting; uncertain work cannot be replayed into another game.

Only the separate independent chain and scoreboard audit can mark a proof complete. Repeated fixtures cover discussion, joins, commits, reveals, results, claims/refunds, capacity, failures, restart recovery, Telegram isolation/recovery, scoreboards, and deliberate audit corruption.

## Remaining live gate

**A correct live 5v5 game is still unproven.** No agent wake, model call, install, transaction, game, Telegram message, or live-state observation has occurred during this continuation. The historical sleeping/idle observations above remain historical.

Local read-only input review matched all ten identities in the committed 5v5 config to the preserved canonical launch records and recovered all ten recorded installation roots. The historical temporary prepared-proof directory is absent. Its execution window is expired; operator journal and scoreboard/outbox locations still need to be located or explicitly reconciled. No private state was changed.

Before a live diagnostic window, review the exact public config and artifact plan against the existing ten installed roots and refresh the changed player source/settings only under explicit authorization, preserving private state. Run one bounded all-ten no-transaction diagnostic and confirm sleep. Then, within fresh evidence lifetime, refresh chain/code/defaults/admissions/causes/balances/nonces, process ownership/operator journal, and Telegram rooms/pins/permissions/outbox/scoreboard identity; run durable preparation and obtain an independent gate review. A separately authorized bounded one-game window may then use `proof-run`, followed by `proof-audit` and cleanup. No existing authorization permits these live mutations, and no historical launch command/window is reusable.
