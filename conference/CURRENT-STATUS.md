# Canonical conference status

**As of:** October 2, 2026 authorized live diagnostic preflight

**Active target:** one independently audited 5v5 game using the five existing OpenClaw agents and five existing Hermes agents on Base Sepolia.

**Canonical checklist:** [TAKEOVER-IMPLEMENTATION-CHECKLIST.md](TAKEOVER-IMPLEMENTATION-CHECKLIST.md)

**Execution plan:** three remaining milestones—M1 all-ten live readiness, M2 operating-state reconciliation, M3 one audited game. Their exit criteria and scope limits are at the top of the canonical checklist. **New-session entry:** [NEXT-SESSION.md](NEXT-SESSION.md). A session change adds no live authorization.

This page is the current operating summary. [RUN-STATUS.md](RUN-STATUS.md) is a chronological evidence archive, and [IMPLEMENTATION-GUIDE.md](IMPLEMENTATION-GUIDE.md) records the original three-agent design. Where either conflicts with this page, treat the older text as historical rather than as current instructions.

## Proven baseline

Games **12, 13, and 14** are the proven three-agent baseline, not 5v5 evidence. Each passed an independent audit with three joins, three agent-authored Telegram strategy messages, three commits, three reveals, a confirmed terminal result, and zero defaults. Game 13 also passed a controlled runner/operator restart without duplicate dispatches.

## Failed 5v5 attempts

- **Game 15:** stopped after one join when `hs-2` reported `INVALID_REPOSITORY`; the newly added Hermes seats were missing their expected checkouts. The game was cancelled and the sole entry was refunded.
- **Game 16:** reached eight joins, then exposed incomplete OpenClaw installations that readiness had missed: `oc-5` lacked the executable game-command wrapper and `oc-4` had corrupt/zero-byte dependency artifacts. The game was cancelled and all eight entries were refunded.
- **Game 17:** reached nine joins; `oc-1` invoked the player CLI without supplying the staged request JSON on stdin, so it created no join journal and signed no transaction. The game was cancelled and all nine entries were refunded.

These attempts establish that agent inventory, model/tool probes, and isolated command checks are not sufficient launch gates.

## Safe checkpoint

- Latest implementation checkpoint: `2950f11` (`Record live diagnostic boundary and preserve runtime uncertainty`). Unknown runtime exec now blocks sleep certification and records only allowlisted failure metadata. Complete documented suites passed **520/520 runner + 199/199 site/shared = 719/719**, with zero failures, cancellations or skips. This correction has not been rerun against live agents.
- Previous continuity/execution implementation checkpoint: `641f4ee` (`Complete runtime continuity and guarded 5v5 proof execution`). All **717** documented default tests passed; all **32** intended files passed Gitleaks with zero findings, and the staged whitespace check passed.
- Previous diagnostic implementation checkpoint: `7d8e025` (`Implement durable ten-seat diagnostics and audited fixture coverage`), with all 577 documented default tests passing and all 36 intended files scanned before commit.
- Recoverable source checkpoint: commit `688f3b9` (`Checkpoint conference implementation before takeover hardening`), created after the intended tree passed the takeover secret scan.
- Takeover-hardening implementation: commit `8d0656f` (`Harden conference prelaunch diagnostics and proof evidence`), with the deterministic local baseline and no live mutations.
- Canonical status checkpoint `c54b8b0` was verified before this tranche; the branch and starting working tree matched the handoff.
- Latest read-only Base Sepolia observation (October 2, block `47594872`): `active_game_id` is `0`, defaults require 10/10 players, and all ten players are admitted with whitelisted causes.
- All ten existing Maritime agents were observed sleeping at `2026-10-02T16:35:30.272Z`. An uncertain diagnostic runtime request remains unresolved; this observation is not readiness or guaranteed lifecycle certainty. Do not replace or reprovision the agents.
- A completed 5v5 game remains unproven. No further game should be created from the historical launch instructions or expired execution windows.

## October 2 continuation

The durable all-ten diagnostic producer, repeated ten-seat assembly fixtures, guarded one-game execution CLI, and independent audit entrypoint are implemented locally. Final documented default suites passed **518/518 runner tests** and **199/199 site/shared tests**: **717 tests**, zero failures, cancellations or skips. Targeted regressions and independent source review also passed. None of these fixture results proves a live 5v5 game.

The producer runs both input modes through Maritime chat → native tool → staged JSON → player CLI stdin and independently verifies sanitized CLI receipts. It journals each operation, binds exact config/roster/runtime sources/artifacts/model/chain identity, respects account-wide capacity including unrelated agents, requires all ten sleeping, and atomically writes readiness-v2 evidence outside the repository. Diagnostics never create gameplay journals/bundles, sign, or submit.

The lifecycle question is now resolved as an explicit observed-continuity policy. `activation_generation` remains a local durable activation-intent sequence; provider attestation is still false. Maritime documents that [sleep/wake resumes the VM snapshot](https://maritime.sh/docs/how-it-works), while its [SDK Agent contract](https://github.com/maritime-sh/maritime-sdk/blob/main/typescript/src/types.ts) does not promise remote generation history. Producer version 2 therefore requires the same observed VM incarnation, exact artifact/model/wallet bindings, and both original diagnostic receipts after each resume. It rejects cold/replaced runtimes and missing or changed observations. It cannot distinguish an invisible restoration to byte-identical state and makes no claim to detect that or attest complete provider lifecycle history. No generation is invented from `updatedAt`.

The version 2 [operator CLI](../integration/conference-runner/README.md#current-controlled-operator-version-2) now exposes local `plan`/`status`, bounded `diagnose`, read-only `proof-plan`/`proof-status`, explicit wake/inspect/sleep `proof-prepare`, fused `proof-run`, and separate `proof-audit`. Preparation and immediate precreation verification retain the original evidence digest and ten-minute lifetime. Each writes its own durable verification record; creation rereads that record before the fuse and before remote creation. Certified gameplay never reloads or repairs a runtime. Immutable per-request permits recheck continuity inside the player lock before gameplay preparation/signing. Operator expiry and caller disconnect are checked before signing and broadcasting; uncertain work cannot be replayed into another game.

Only the separate independent chain and scoreboard audit can mark a proof complete. Repeated fixtures cover discussion, joins, commits, reveals, results, claims/refunds, capacity, failures, restart recovery, Telegram isolation/recovery, scoreboards, and deliberate audit corruption.

## October 2 live preflight

The user authorized the reviewed 30-minute existing-agent preflight. The fixed window began `16:18:47.149Z`, with an activation/chat cutoff at `16:43:47.149Z` and cleanup hard stop at `16:48:47.149Z`. External operations stopped early after failure; these deadlines must not be reused or extended.

All ten existing identities, roots, public settings, operations manifest, pinned mini model and provider route matched. The lead refreshed only declared public runtime artifacts, enabled execution permits, verified hashes and durable flushes, and confirmed each sleep. Independent local audit matched all ten deployed artifact digests to the repository CLI plan: 191 returned operations, zero uncertain refresh operations, and all ten sleeping. No installer, dependency reinstall, game checkout replacement, model change, private-state replacement, new agent, signing, game, or Telegram message was used.

The real repository diagnostic CLI then passed both `gameplay-input` and `commit-input` for **hs-1**, including independently validated CLI receipts. It stopped on **hs-2** at the first public-artifact hash exec after confirmed environment reload. That request became unknown after 530 ms; the provider cause was not retained. No hs-2 chat was sent. Total diagnostic chats: **2**, not 20. No readiness-v2 certificate was published.

Cleanup sleep/readbacks and a separate final read observed all ten sleeping. The original failed journal incorrectly labels sleep as confirmed despite the unknown `runtime-read`; it is preserved unchanged. The [sanitized observation](evidence/live-diagnostic-preflight-2026-10-02.json) explicitly retains that uncertainty. A narrow local correction retains only fixed allowlisted failure codes and prevents unknown runtime exec from establishing sleep certainty. Targeted regressions and independent review passed, followed by **520/520 runner and 199/199 site/shared default tests**. The seven intended files passed Gitleaks with zero findings and `git diff --check`. The correction is local only; no second live attempt was made. No uncertain request was replayed.

## Remaining live gate

**A correct live 5v5 game is still unproven.** The immediate blocker is the unresolved hs-2 runtime-integrity request. The proposed next operation is only the ten-minute hs-2 public-state inspection recorded in `NEXT-SESSION.md`; it allows no chats and is not authorized. Passing that start-only inspection would not reproduce the failed post-reload boundary or complete readiness. A later authorized scope must resolve that boundary and run fresh diagnostics for all ten seats; the stopped run cannot be resumed or promoted into readiness. The previous window is expired and its time/chat budget cannot be reused.

The complete timing is also unproven: the existing 600-second evidence lifetime starts at diagnostic-run start and covers diagnostics plus both all-ten precreation verification passes. hs-1's measured activation-to-sleep time was 68.934 seconds; no full sequence has been measured. This remains part of M1, with no lifetime extension or additional milestone.

A local read-only follow-up located the preserved owner journal: 47 records, with 46 in confirmed stage and one still in broadcast stage. Its receipts have not been refreshed, so that record is an additional creation blocker. Four outbox candidates were located; the required scoreboard/series bindings remain unresolved, and the historical temporary proof directory is absent. Before game authorization, reconcile those preserved records without resetting them. Refresh chain/code/defaults/admissions/causes/balances/nonces, process ownership, and Telegram rooms/pins/permissions/series identity. Run durable preparation and independent gate review against fresh all-ten readiness, then revalidate the same evidence digest and continuity immediately before creation. A game requires separate authorization and an independent audit afterward. No historical launch command or expired execution window is reusable.
