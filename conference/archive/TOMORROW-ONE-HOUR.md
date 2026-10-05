# One-hour restart plan

**Completed morning proof:** On September 25, Game 12 passed the independent live audit: three joins, strategy messages, commits and reveals, zero defaults, confirmed result and claimed award. Read the current [run status](RUN-STATUS.md) first; the overnight state and restart text below are historical. No further game is needed to establish this first proof. Remaining work is production hosting, two final rooms and continuous-operation verification.

**Target:** one clean, real three-agent game with Telegram strategy, commits, reveals and a confirmed result; then connect the existing spectator page and assess continuous operation. This is a target, not a guarantee. Public hosting, two final Telegram rooms and several consecutive games still require live verification. Do not claim the full conference demo ready after one game.

## Start here without repeating the investigation

- Work in `/Users/wade/Documents/DilemmaEval`, branch `codex/converge-demo-2026-09-25`. Preserve every existing edit/untracked file. Read `AGENTS.md`, the top of `RUN-STATUS.md`, and this file.
- The user requested an overnight stop. **No Game 11 was launched.** `/private/tmp/hermes-game11-2026-09-25` contains only a prepared config/preflight, no launch fuse or runtime. Its schedule expires; keep it as evidence and prepare a new directory tomorrow. No operator or runner was started.
- Last confirmed contract state: **idle**, after Game 10 cleanup. Existing Hermes and two OpenClaw agents remain intact; all were last confirmed sleeping. Fresh read-only chain/funding/nonce checks and Maritime roster readiness passed before the overnight stop. Recheck tomorrow.
- Game 10 proved **three joins and three real strategy messages**. It did not prove commits/reveals: Hermes nested its own `choice` inside `request`. The prompt now explicitly requires sibling fields; runtime and transport preserve `PLAYER_CHOICE_LOCATION_INVALID` safely. The deployed fix survived sleep/wake on all three machines.
- **95 local integration/runtime tests and 72 pinned upstream Forge tests already pass.** Do not rerun everything, reclone the contract or investigate solved Git ownership, storage durability, locks or fee-policy defects unless new evidence points there.
- The lighter worker reviewed the actual pinned prepare/commit/reveal argv, bundle schema, private paths and output identities before the stop: **no additional deterministic blocker found**. No edits or live commands were made by that worker.
- Latest deployment evidence: `evidence/player-choice-location-durable-patch-2026-09-25.json`. Exact cause and validation: `evidence/game10-commit-input-diagnostic-2026-09-25.json`. Stop evidence: `evidence/overnight-stop-2026-09-25.json`.

## Budget the hour

| Time | Work | Required result |
|---|---|---|
| 0–8 min | Refresh idle state, pending nonces, actual-player fee reserve, roster and deployed hashes. Prepare a fresh bounded attempt. | Existing three agents ready; no unresolved transaction; no provisioning. |
| 8–40 min | Start one operator and one bounded controller. Monitor the actual game. Prior-game claims may run before creation. | Three joins, real strategy, commits and reveals; inspect fixed codes immediately on failure. |
| 40–50 min | Independently audit chain receipts/events and Telegram delivery; stop the bounded processes. | `proof_complete: true`; no defaulted actions. |
| 50–60 min, only if proof passed | Connect the already-built spectator page to confirmed live state; validate phone view and links. Check host/group/capacity prerequisites for continuous mode. | Honest live display and a concrete remaining deployment checklist. |

Do not spend the hour adding features or redesigning agents. A service outage or another live failure can exhaust the hour. If that happens, leave the exact safe code, a local reproduction and a tested narrow fix; do not substitute a defaulted game or fixture as success.

## Keep model cost bounded

- Use a lighter main model if desired. For independent worker tasks, use the available `gpt-5.6-luna` with low reasoning and a short brief (`fork_turns: none`). Do not send the entire conversation to every worker.
- At most one or two workers: one owns a concrete failing component plus its tests; a second may independently review proof/UI. Give exact file allowlists. Avoid two workers investigating the same issue.
- Lead owns all external mutations and the single operator. Workers use local fixtures/read-only source review. No worker provisioning, wallet funding, game creation or Telegram sends.
- Run only tests affected by a new change, then one integration check. Existing green suites and unchanged Forge tests need no repeated execution.
- During live waits, use bounded tool polling; do not repeatedly reread the repository or rerun diagnostics without new evidence.

## Exact bounded-run commands

Already-used helpers are preserved in `conference/operations/saved-helpers/` so the handoff does not depend on those scripts surviving in `/private/tmp`. They retain this workstation's explicit paths and existing private config locations; they contain no credential values. They are supervised proof helpers, not production services.

First check required existing files: the private coordinator/launcher env files, r8 runtime evidence, latest patch evidence and local dependencies. Do not print env files. The pinned local source is `/private/tmp/dilemma-conference-game`; its expected revision is `955ce16a59b0efecf6ccdf2d391ede83de8902a8`. Restore that exact revision only if the local checkout disappeared; do not upgrade it or provision agents.

Prepare in the lead shell:

```sh
cd /Users/wade/Documents/DilemmaEval
export DILEMMA_PROOF_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
export PROOF_DIRECTORY="/private/tmp/dilemma-proof-${DILEMMA_PROOF_STAMP}"
export PROOF_EVIDENCE="$PWD/conference/evidence/proof-${DILEMMA_PROOF_STAMP}.json"
node conference/operations/saved-helpers/controlled-proof.mjs prepare
```

Preparation must succeed. It refreshes confirmed chain/funding/nonces, checks the latest deployed patch evidence, and creates a **new** config with a ten-minute creation window. If debugging consumes that window before launch, prepare another fresh directory; never edit an old launch fuse or reuse an expired schedule.

Start the operator in its own managed terminal/tool session, using the same `PROOF_DIRECTORY`:

```sh
node --env-file=/Users/wade/.config/dilemmaeval-conference/launcher.env \
  integration/conference-runner/src/chain/cli.mjs operator \
  "$PROOF_DIRECTORY/config.json" \
  /Users/wade/.local/state/dilemmaeval-conference/converge-rehearsal-2026-09-24-r8/operator \
  8791
```

Then run the controller from the lead shell:

```sh
PROOF_SITE_PORT=8787 node conference/operations/saved-helpers/controlled-proof.mjs run
```

The controller checks Maritime inventory before mutation, writes a durable single-creation fuse, permits only one fresh game, and aborts dispatch on gameplay error. Do not start another controller against the same machines/runtime. Do not wake a different agent with ad hoc diagnostics while the controller is rotating the one-awake slot. Keep all choices and reveal material inside each player.

At terminal, use the **actual** game ID printed by the controller, not an assumed next number:

```sh
export PROOF_GAME_ID='REPLACE_WITH_ACTUAL_GAME_ID'
node conference/operations/saved-helpers/audit-controlled-proof.mjs
```

Require `proof_complete: true`. The audit validates actual game-scoped chain logs/receipts, all three joins, real commits/reveals without defaults, and delivered strategy/result messages. `candidate_proof_complete`, agent-reported `submitted`, a defaulted result, and Forge tests are insufficient. Stop the operator after the bounded attempt and verify port 8791 has no listener.

## Iterate by evidence, not repeated games

1. **Preflight fails:** no game. Fix only the demonstrated readiness defect. A Maritime HTTP 500/timeout is a service problem, not a reason to replace agents. Keep credentials and response bodies out of output.
2. **CLI/input error:** inspect only fixed status/code and structural flags inside the affected machine. Reproduce locally or with signing/bridge execution disabled. Patch the exact interface and run its tests before another live attempt.
3. **Post-submit timeout or malformed response:** treat as ambiguous. Check confirmed chain state and the player's saved safe journal fields; never replay an uncertain commit/reveal or invent a new choice for it.
4. **Failed game remains active:** handle that exact game before preparing another. `cancel-insufficient-game.mjs` is only for an expired join with fewer than the required players. A three-player game must use eligible phase advances; it cannot be cancelled through that helper. Keep defaults labeled and excluded from proof. Do not reuse the old hardcoded Game 10 cleanup script for a new game.
5. **Iteration limit for the hour:** target one clean live attempt. A second attempt only makes sense after a concrete failure is reproduced, narrowly fixed, locally verified, and the chain is idle with enough time remaining. Do not launch repeated games to search for a diagnosis. Preserve the user's current run limit if the next session specifies one.

## After a clean proof

The static spectator page and server already exist (`conference/site/`, `integration/conference-runner/src/server.mjs`); reuse them. The bounded helper now accepts `PROOF_SITE_PORT=8787` and serves the existing spectator page from that same runner on `127.0.0.1`. It saves only projected public state to the attempt directory on normal shutdown and closes its server. **Never start a second normal runner merely to display the first runner's state.** Use a spectator-only saved projection or make the next designated runner the sole owner.

Before claiming the full demo: verify the page's live counts/phase/earnings/explorer links, then continuous games, one always-on host, two actual spectator groups and phone-over-cellular access. Host deployment and final group setup remain outstanding. The user planned a Maritime upgrade only after clean gameplay proof; do not silently purchase capacity or build more free-tier workarounds. Surface missing host/group/capacity inputs early once the user is awake, while independent local work continues.

## Paste into tomorrow's session

> Resume in `/Users/wade/Documents/DilemmaEval` on `codex/converge-demo-2026-09-25`. Read `AGENTS.md`, the top of `conference/RUN-STATUS.md`, and `conference/TOMORROW-ONE-HOUR.md`. Use lighter-model workers with short briefs for independent fixes; keep one lead for live operations. Target a clean three-agent Maritime game and the existing spectator UI within about an hour. Preserve Hermes and the existing roster. Do not repeat solved investigations, provision agents, silently buy capacity, or count defaulted/fixture games as proof. The overnight Game 11 directory was prepared only and must not be reused with its expired schedule. Follow the documented bounded run and independent audit, then stop and report actual evidence.
