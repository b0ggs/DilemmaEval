# Prisoners DAOlemma Tournament
## Implementation Plan Review Addendum (Final)

**Date:** July 26, 2026
**Purpose:** Corrections, verified command detail, and the model-route recipe for the DilemmaEval implementation plan.
**How to use:** Apply these on top of that plan. Everything here was checked against the repo or the live Maritime docs, or flagged where it could not be.

The plan is strong. It keeps the one thing that mattered most, the difference between a defaulted Share and a chosen Share, and it adds good operational safeguards. This final version corrects three claims, locks the model route, adds a preflight runbook, and folds in the verified Maritime command surface.

---

## 1. Must fix

### 1.1 The `maxPlayers: 256` figure is mis-sourced
The plan states the live default is `maxPlayers: 256`. That number is not from the live chain. It comes from `packages/foundry/scripts-js/loadHarness.js`, a local load-testing script. The reuse-candidate game actually ran at `minPlayers: 32` and `maxPlayers: 32`.

The worry behind it is valid. A permissionless public launch could accept outside joins if the max is higher than intended.

Fix: read the real default on-chain during preflight with `getDefaultConfig()`, whose ABI is already in `gameTooling.js`. Then set the game to exactly 10 players. Do not trust the 256.

### 1.2 The Maritime CLI and REST syntax is now verified
This was flagged as unverified. It has now been checked against the live docs. Most of it was right.

Confirmed exactly as the plan had it:
- `maritime chat <agent> "msg" --json` returns `{ response }`.
- `maritime env set <agent> KEY=value` stores an encrypted secret by default.
- REST is `POST https://api.maritime.sh/api/agents/{id}/chat` with `Authorization: Bearer mk_...` and body `{"message":"..."}`, returning `{ response }`.

One real error to correct: the logs flag is `-n` or `--lines`, not `--limit`. Use `maritime logs <agent> -n 100 --level error`, or REST `GET /api/agents/{id}/logs?lines=100&level=error`.

### 1.3 The join window is not "10 minutes fixed"
The join duration is configurable, and the reuse-candidate run used 300 seconds, which is 5 minutes.

The catch is still correct and worth keeping: the join phase has no early
exit. It advances only when `block.timestamp > joinDeadline`, regardless of
headcount. Commit advances early when every alive player committed. Reveal
advances early when every player who committed has revealed; players who
defaulted at commit have nothing to reveal. Deadline equality remains inside
the active window. Join does not gain an early exit.

Fix: read the live join duration during preflight. Since we hold owner access, set it deliberately for a 10-player game.

### 1.4 Minor: the cited line numbers are unreliable
The behavior descriptions are right, but the line references are off. For example, `canAdvancePhase` is near line 715, not 1324. Do not navigate by the cited numbers.

---

## 2. Model and route parity

**Model locked: `gpt-5.4-mini`. Fallback: `gpt-4o`.** Both are fast and cheap, and `gpt-4o` is Hermes's own default on Maritime, so it is the safest fallback if the proxy does not serve the mini cleanly.

The important finding: Hermes does not hit OpenAI directly by default. On Maritime its container runs with `HERMES_INFERENCE_PROVIDER=openrouter`, `HERMES_INFERENCE_MODEL=gpt-4o`, and `OPENROUTER_BASE_URL=https://api.maritime.sh/api/llm/v1`. That base URL is Maritime's own LLM proxy. So Hermes routes through the proxy, not `api.openai.com`. "OpenAI as the route" is not automatic.

### 2.1 The decision: route both harnesses through the Maritime proxy
Point both OpenClaw and Hermes at the same endpoint, `https://api.maritime.sh/api/llm/v1`, with the same model id and the same settings. Maritime becomes the single shared provider for both, which is the cleanest possible parity.

Do not route both direct to OpenAI instead. OpenClaw's native OpenAI path adds Responses store, prompt-cache hints, reasoning-compat payload shaping, and attribution headers. The docs are explicit that these apply only on native `api.openai.com` traffic, not on generic OpenAI-compatible endpoints. So a both-direct setup would quietly give OpenClaw behaviors Hermes lacks. That asymmetry is exactly what the fairness gate exists to prevent.

### 2.2 The recipe
- Hermes: keep the default base URL, set `HERMES_INFERENCE_MODEL=gpt-5.4-mini`.
- OpenClaw: configure a custom OpenAI-compatible provider pointed at `https://api.maritime.sh/api/llm/v1`, same model id, using `openclaw onboard --auth-choice custom-api-key --custom-base-url https://api.maritime.sh/api/llm/v1 --custom-model-id gpt-5.4-mini --custom-compatibility openai`.
- Match sampling on both: same temperature, same max tokens, same reasoning setting. Same route is not enough on its own.
- Confirm the proxy actually serves the model before locking: `curl https://api.maritime.sh/api/llm/v1/models -H "Authorization: Bearer $MARITIME_TOKEN"`.

### 2.3 Why this is spike 1
This is existential. If the two harnesses do not reach the same model the same way with the same settings, there is no fair tournament. Prove it before anything else is built.

---

## 3. Do this better: read the defaulted flags from the event

The plan proposes deriving a defaulted Share from whether a commit or reveal transaction is present. There is a cleaner source. The contract emits `EffectiveChoiceMaterialized` for each player each round, carrying `defaultedCommit` and `defaultedReveal` flags directly.

Fix: read these flags from the event. Confirm `query:export` surfaces them in `rounds.json`. If it does not, read the event log directly rather than inferring from a missing transaction.

---

## 4. Fill this gap: state the orchestrator's advance rule

The plan never says how the orchestrator decides a phase is finished. This matters because of default-to-Share. If the orchestrator advances too early, or trusts an agent's own "I committed" message, a slow agent gets silently defaulted to Share. That is the exact corruption the defaulted-Share fix is meant to prevent.

Fix: make the rule explicit. At pinned contract revision
`955ce16a59b0efecf6ccdf2d391ede83de8902a8`, join advances only when
`block.timestamp > joinDeadline`; there is no early join exit. Commit advances
when `committedCount == aliveCount` or
`block.number > commitDeadlineBlock`. Reveal advances when
`revealedCount == committedCount` or
`block.number > revealDeadlineBlock`. Reread the phase and predicate
immediately before submitting an advance transaction; after a race or revert,
reread chain state instead of blindly resubmitting. Never advance on an
agent's self-reported acknowledgement. Chain state is the trigger. Agent acks
are only for logging.

---

## 5. Reweight: persistence is not a blocker for one game

Spike 5, agent persistence across a sleep and wake cycle, is weighted heavily. For a single game it does not matter. Cross-game memory only becomes meaningful once more than one game runs.

Fix: keep spike 5, but treat it as a de-risk for future multi-game work, not a gate that blocks tonight's one game.

---

## 6. Preflight runbook

Run this before building on the reused deployment. A mismatch here should stop the build, not surface mid-demo. Addresses: game `0x42892BEc3d1d926Db25FfB6A144ee363AaE40A1a`, chat `0xc2604D5C87663efE959342F23c3DC9E4D9Db3e99`, adapter `0xc893Ca037b796e7710a4948Bbb6fBfb94539b806`, identity registry `0x7177a6867296406881E20d6647232314736Dd09A`.

On-chain checks, using `cast` plus the repo's `yarn` aliases:

- Owner is you: `cast call <game> "owner()(address)"` returns `0xDb463b29...c1408`.
- Contract is idle: `cast call <game> "activeGameId()(uint256)"` returns `0`.
- Real default config: `cast call <game> "getDefaultConfig()"` shows the true `minPlayers`, `maxPlayers`, `entryFeeWei`, and the join, commit, and reveal durations. This kills the 256 guess and shows exactly what to reset for 10 players.
- Bytecode exists at all three addresses: `cast code <addr>` is non-empty.
- Wiring holds: game points at the auth adapter, chat points at the game, adapter points at the identity registry above.
- Two usable causes are whitelisted.
- Live snapshot: `yarn query:summary`.

Readiness gate, run right before the join window that counts:

- All 10 agents report active: `maritime list --json`.
- All 10 wallets funded above threshold: `cast balance <wallet>` each.
- All 10 wallets ERC-8004 registered: `yarn query:auth` or `yarn auth:status` each.
- Model parity recorded for the real run.

---

## 7. Verified Maritime operating notes

Useful facts confirmed from the live docs. Fold these into the orchestrator and provisioning code.

- Orchestrator auth: mint a key with `maritime keys create --name orchestrator --json`, export it as `MARITIME_TOKEN`, and use the same token for CLI and REST. Pass `--json` on every command and branch on exit codes: 0 ok, 2 auth, 3 not found, 4 usage.
- Keep-awake is solved. Create agents with `--always-on` so they never sleep for the demo hour, or `--idle <seconds>` set above the phase gap. Even a sleeping agent wakes from snapshot in under a second, so a poke that wakes a sleeper is cheap.
- Provisioning is two fleet calls, one per team. `maritime create oc --template openclaw --count 5 --always-on --json`, and `maritime create hs --template hermes --tier extended --count 5 --always-on --json`. Hermes needs Extended tier, not the default, because it loads memory and a dashboard at boot. Names become `oc-1..oc-5` and `hs-1..hs-5`. Confirm `--tier`, `--count`, and `--always-on` combine in one call.
- The poke is a chat call. `maritime chat <agent> "..." --json` from CLI, or the REST chat endpoint. It wakes a sleeping agent and waits for the reply.
- Wallet key injection: `maritime env set <agent> GAMEPLAY_WALLET_PRIVATE_KEY=0x... --reload`. Secret and encrypted by default.
- Drift-proof syntax: `maritime guide --json` prints the full live command manifest. Point the orchestrator at it rather than trusting any doc snapshot.
- Three wallet classes. The Maritime account wallet pays for compute; ten separate gameplay wallets hold Base Sepolia ETH for player entry fees/gas; and an eleventh non-seat Base Sepolia operations wallet pays only phase-advancement gas. Do not conflate them.

---

## 8. Keep these, they are right

So they survive editing:

- The default-to-Share behavior is stated correctly, and distinguishing it from a chosen Share is central to the demo.
- Staggered Maritime pokes and a reviewed RPC provider instead of an unreliable free public endpoint.
- The pre-game readiness gate before the join window that counts.
- The orchestrator idempotency guard against double-poking on restart.
- Treating API tokens and all other credentials as secrets.
- Validating the scoring layer against the known 32-player canary numbers before trusting it.
- Verifying team-to-cause mapping at join time for every seat.
- The external-harness design kept as a fallback if self-signing fails.

---

## 9. Verify before build, in order

Prove each before building on it.

1. Model parity. Both harnesses reach `gpt-5.4-mini` through the Maritime proxy, same settings. If this fails, stop.
2. Self-signing inside a Maritime container, one real Base Sepolia transaction.
3. Poke and act. The orchestrator wakes an agent, hands it recent chat, and gets a commit and reveal on time.
4. Owner access, plus the live default config from `getDefaultConfig()`, plus the ability to set players to 10.
5. That `query:export` surfaces the defaulted flags, or that the event log does.
