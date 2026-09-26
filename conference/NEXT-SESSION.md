**START HERE — latest user request:** Set up five OpenClaw vs five Hermes on the user-upgraded Starter plan, using **GPT-5.4 mini**. The user wants a fresh cheaper development session. Read [FIVE-V-FIVE-MINI-HANDOFF.md](FIVE-V-FIVE-MINI-HANDOFF.md) and the top of [RUN-STATUS.md](RUN-STATUS.md); the text below is historical. Mini has not been applied yet and ten-seat setup has not started.

**September 25 reliability update:** Games 12, 13 and 14 all passed independent real-game audits, including Telegram strategies/results and zero defaults. The controlled runner/operator restart during Game 13 passed without duplicate requests. Runner/operator are stopped, contract idle, and `http://127.0.0.1:8787` shows the saved Game 14 proof. Next: verify a user-purchased paid plan, test the same three agents concurrently, then consider five; larger rosters, live multi-round play and unattended hosting remain unproven. Read [current run status](RUN-STATUS.md) and [combined evidence](evidence/reliability-summary-2026-09-25.json) before historical notes below.

# Resume the real three-agent proof

**Overnight stop:** no new game was launched. Start with [TOMORROW-ONE-HOUR.md](TOMORROW-ONE-HOUR.md) for the timed plan, preserved commands, economical worker assignments and failure decision tree. The prepared `/private/tmp/hermes-game11-2026-09-25` directory has no launch fuse/runtime and its schedule will expire. Do not reuse it or start work again until the user returns.

Keep the original scope: three real Maritime agents play Share/Steal/Catch on Base Sepolia, with real strategy messages and results in Telegram, followed by the website and continuous games. The user rejected a reduced tool-only demo. Use the existing Hermes and two OpenClaw machines. Do not provision, replace agents, buy capacity, or develop further free-tier workarounds. Iteration is authorized, but every live attempt must be bounded and stopped on an ambiguous failure.

Work on `codex/converge-demo-2026-09-25` in `/Users/wade/Documents/DilemmaEval`. Preserve all dirty and untracked work. Read `AGENTS.md` and the current top of `conference/RUN-STATUS.md`. Use lighter workers for bounded implementation/test tasks; the lead alone operates external mutations.

## Verified state

- Local pinned upstream contract/auth tests passed **72/72**, using verified temporary Forge 1.8.3 and revision `955ce16a59b0efecf6ccdf2d391ede83de8902a8`. Existing upstream checkout: `/private/tmp/dilemma-conference-game`. These are simulated contract tests, not Maritime gameplay proof.
- Game 10 cleanup is complete: active game **0**, dispatcher/operator stopped, operator port 8791 closed, and Telegram queue clear. The independent audit rejected all **9 defaulted actions** as expected; `proof_complete` remains false.
- Real **Game 10** achieved **three joins and three delivered strategy messages**: Telegram IDs 32, 33, 34. It failed before any commit. Its defaulted cleanup result must never be counted as successful agent play. See `conference/evidence/hermes-game10b-2026-09-25.json` for the final live state and independent audit.
- Exact new cause: Hermes placed its own valid `choice` inside `request`, while the CLI requires the two fields to be siblings. No Game 10 Hermes commit journal existed. The CLI's generic error wrapper became `MARITIME_AGENT_RESPONSE_INVALID`. Safe evidence: `conference/evidence/game10-commit-input-diagnostic-2026-09-25.json`.
- Fix: explicit sibling-choice prompt; `PLAYER_CHOICE_LOCATION_INVALID` before filesystem/bridge work; allowlisted CLI diagnostic preserved through transport and runner without changing ambiguity/no-replay behavior. **95/95** player CLI/runtime, transport, runner and integration tests passed.
- Actual Hermes uid 10000 reproduced the new specific error for the original malformed input. Corrected placement passed real runtime validation with signer absent and bridge execution disabled. Private choice remained inside Hermes; no transaction was submitted by that diagnostic.
- Latest deployed files are verified on all three machines before/after sleep: `conference/evidence/player-choice-location-durable-patch-2026-09-25.json`. This supersedes the older error-code deployment hashes. Prompt/runner edits live in the local coordinator code.
- All three agents were confirmed sleeping at 02:21 UTC in `conference/evidence/game10-final-maritime-state-2026-09-25.json`. No machine was reprovisioned or replaced.
- Existing oc-1 was already funded to roughly 0.015 testnet ETH by `0xa52e9a26054a528b5fc756458fd2b7f5b13f2008b978173d5781086afb27eefa`. **Do not repeat that transfer.** Funding preflight now uses the actual pinned player fee policy.

## Remaining live gate

A clean controlled game must still demonstrate three joins, actual strategy messages, real commits and reveals without defaults, and a confirmed Telegram result. Do not present fixture tests, defaulted choices, or a submitted response alone as success.

1. Check final Game 10 evidence and current chain state. Do not create anything while an active game or ambiguous owner/player submission remains. Do not replay its failed round-1 commit request.
2. Recheck the same Maritime roster and live chain/funding/nonces. A prior Maritime HTTP 500 service interruption recovered; it is separate from player input failures. No new agents are needed.
3. For a future bounded fresh attempt, use a new private directory and public evidence filename with `/private/tmp/hermes-resumable-controlled-game.mjs prepare`, setting `PROOF_DIRECTORY` and `PROOF_EVIDENCE`. Never remove/reuse an existing `launch-once.json` fuse or expired schedule. The helper now validates the latest choice-location patch evidence.
4. Start exactly one existing owner operator: `node --env-file=/Users/wade/.config/dilemmaeval-conference/launcher.env integration/conference-runner/src/chain/cli.mjs operator CONFIG /Users/wade/.local/state/dilemmaeval-conference/converge-rehearsal-2026-09-24-r8/operator 8791`. Run the bounded controller with the same proof environment.
5. Stop dispatch on failure, extract only fixed safe codes/shape flags, and reconcile actual chain state. Do not use another game to discover a known input/runtime defect. Never copy private choices, salts, complete commands, sessions or journals into coordinator evidence.
6. At terminal run `/private/tmp/dilemma-audit-controlled-proof.mjs` with the proof environment and actual `PROOF_GAME_ID`. Require `proof_complete: true`. Stop the bounded controller/operator after the attempt. Only then proceed to broader conference deployment.

Private credentials stay in the existing configuration paths. The owner key stays outside Maritime; each agent chooses its own move and keeps its own reveal material.
