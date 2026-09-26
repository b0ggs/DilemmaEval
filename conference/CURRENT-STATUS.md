# Canonical conference status

**As of:** September 25, 2026 takeover hardening implementation checkpoint

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
- Latest read-only Base Sepolia observation from this takeover: Game 17 is terminal and `active_game_id` is `0`.
- All ten existing Maritime agents were observed sleeping. Do not replace or reprovision them.
- A completed 5v5 game remains unproven. No further game should be created from the historical launch instructions or expired execution windows.

## Next gate

The deterministic local baseline is restored: the conference runner passes 255/255 under its default sequential command, and the site plus changed shared packages pass 199/199. A separate non-signing diagnostic now exercises the Maritime chat → native tool → staged request → CLI stdin path for gameplay-shaped and commit-shaped input, while the player runtime checks wallet authorization, checkout/dependencies, lock/private state, chain, idle game, and cause eligibility without constructing a signer operation.

The remaining pre-live implementation gap is the durable all-ten diagnostic operator: it must collect both modes for every seat in one bounded run, bind them to the deployed artifact and activation generation, verify all ten agents finish sleeping, and atomically write readiness-v2 evidence. No live diagnostic run has occurred, and no live game is authorized by this checkpoint. After that producer and the remaining fixture/proof-control gates pass, refresh chain/nonces and seek a new explicit execution window before any creation.
