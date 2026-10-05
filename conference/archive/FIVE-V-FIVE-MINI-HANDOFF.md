# Execute next: five OpenClaw vs five Hermes, GPT-5.4 mini

## Current user authorization

The user reports upgrading Maritime to **Starter ($20/month)** and explicitly requested **5-vs-5 with `gpt-5.4-mini` ASAP**. They want a cheaper development model and minimal tokens. This authorizes preparing the ten-seat roster, reusing the existing three agents, adding the seven missing agents, and the necessary testnet setup/rehearsal. It supersedes the historical three-agent/no-new-provisioning restriction for this ten-agent target. It does not authorize another subscription upgrade or paid add-ons. No reconfirmation is needed for work already within this scope.

Use this handoff plus the top of `RUN-STATUS.md`; do not reread the entire debugging history. Read root `AGENTS.md` and the active implementation guide as required, but distinguish their historical snapshots from the latest user instruction. Preserve the dirty/untracked working tree, including `HANDOFF.md`. Work in `/Users/wade/Documents/DilemmaEval`, branch `codex/converge-demo-2026-09-25`. Do not reset, clean, stash, switch branches or commit someone else's work.

## Proven starting point

- Games **12, 13, 14** independently passed: three actual joins/commits/reveals, genuine strategy and results in Telegram, zero defaults. All ended in round one. Game 13 also passed a graceful runner/operator restart after confirmed joins, without duplicate requests.
- Evidence: `conference/evidence/reliability-summary-2026-09-25.json` and `reliability-restart-2026-09-25.json`. Larger rosters, live multi-round play and unattended continuous operation remain unproven.
- Last confirmed chain state: idle, active game 0. Runner/operator stopped, port 8791 closed. Port 8787 serves only the saved Game 14 proof through `serve-proof.mjs`; stop that exact viewer before binding a live runner there. Refresh live state before any mutation.
- Existing Forge tests passed 72/72 on the exact pinned upstream source. Do not reclone, upgrade contracts or repeat that suite for scheduling/model changes.
- Keep all solved fixes: exact Git ownership exception, fsynced public installs and hash readback across sleep/wake, runtime UID/private permissions, stale-process-safe locks, real ethers fee reserve, prior-game settlement before launch, strict sibling `choice` input, safe error-code persistence, completed-response recovery verified against canonical chain events, and no replay after uncertain submission.

## Critical cost finding: mini is NOT deployed yet

Read-only checks found **all three agents configured for full `gpt-5.4`**. Hermes YAML and inference environment agree; both OpenClaw primary models are `openai/gpt-5.4`, without fallback/agent overrides. `recipes.mjs` declares mini, but merely writing `HARNESS-RECIPE.json` did not apply it to the actual harness. See `conference/evidence/model-cost-readback-2026-09-25.json`.

1. Implement actual persistent model configuration for both harnesses: **`gpt-5.4-mini`**, low reasoning, bounded output, same settings on both teams. Avoid an automatic expensive fallback; the recipe currently declares `gpt-4o`.
2. Verify effective model IDs from runtime config AND a tiny actual tool/model response's usage metadata. Never mark verification true from the recipe alone. Verify settings survive sleep/wake and reload; preserve keys, wallet state and private bundles.
3. Maritime's proxy model-list endpoint returned 404, which does not prove mini is unsupported. Test mini with a small non-signing terminal/protocol task first. Do not silently fall back to full GPT-5.4 if unavailable. Direct provider credentials are an alternative only if already available or supplied securely.
4. Report actual model/token usage where exposed, and clearly separate estimated token cost from invoiced spend. Never dump prompts, full private sessions, keys, choices or salts. Keep test calls minimal.

OpenAI published standard text rates checked this session: full GPT-5.4 $2.50/$15, mini $0.75/$4.50 per million input/output tokens. Mini is the user's selected model; do not reopen nano/Gemini research.

## Starter capacity: implement five awake slots, ten total players

Starter documents **20 total machines but only 5 awake simultaneously**. Verify account entitlement/inventory; do not confuse provisioned count with awake capacity. Current adapter supports `oneAwake:true` (serial) or false (unrestricted), not a five-slot pool. Merely setting false for ten agents will overrun capacity.

- Add a bounded five-awake lifecycle scheduler around the existing adapter. A slot includes wake/configuration/chat/read-only reconciliation/sleep. Reserve capacity for unrelated awake account machines. Release only after sleep is confirmed; unresolved execution or sleep must not permit a sixth wake or replay.
- Keep each seat serial and request identities stable. Preserve abort/deadline semantics, definite-never-posted classification, and completed-journal recovery. Test five concurrent calls, sixth queued, timeout/uncertain sleep, expired queued work and restart/no-replay behavior.
- Preserve the runner's same-team discussion barrier before commits. Rotate in bounded batches; do not let one team receive opponent messages. Measure real deadlines with ten seats instead of assuming concurrency solves every delay.
- Update callers: `src/cli.mjs:51` and the bounded proof helper hardcode `oneAwake:true`. `reconcileRoster` defaults `maxAgents=3`; pass an explicit verified account budget. Provisioning workflow also has budget/capacity options. Do not provision more than the seven missing game agents.

## Exact roster and testnet setup

| Existing seat | Agent ID | Wallet |
|---|---|---|
| hs-1 | a0977c67-268a-4859-b88b-8df556ce9910 | 0x6d241e69650c08c505ee19668cc251052e23056f |
| oc-1 | d56a1993-feb6-44a1-9f98-3a38ec16d78d | 0xb9dab46bcd953eb2a3ab4d49a11f800e6be5f356 |
| oc-2 | b9f4a333-b665-4802-8e3d-a69fa097e835 | 0x421bbbc3cc480147b2586f91b1d25b8bc817916b |

Add **hs-2..hs-5 and oc-3..oc-5**, each with its own private player key and persistent state. Reuse the resumable SDK provisioning/install workflow; never recreate the three working agents. Reconcile inventory and ambiguous provisioning intents before retrying.

Base Sepolia only: chain 84532; game `0x42892BEc3d1d926Db25FfB6A144ee363AaE40A1a`; owner `0xDb463b29c82138188d5e425EDe5E0Fcbb09f1408`. Pinned upstream revision `955ce16a59b0efecf6ccdf2d391ede83de8902a8`, checkout `/private/tmp/dilemma-conference-game`.

Current defaults are **3/3 players**, 300-second join, 180-block commit, 120-block reveal, entry 0.0001 testnet ETH, fees 100/100 bps, two causes. Refresh defaults/owner/auth/idle state before changing min/max to 10. Admit and fund new wallets from the existing testnet setup using the actual player fee reserve, preserving distinct signer boundaries. Never use real mainnet funds or alter game rules.

## Existing paths and implementation boundaries

- Private coordinator and launcher env: `/Users/wade/.config/dilemmaeval-conference/{coordinator,launcher}.env`. Never print them. Owner key belongs only to launcher.
- Existing player keys: `/Users/wade/.config/dilemmaeval-pilot/wallets` (discover filenames without printing values).
- Existing private runtime evidence: `/Users/wade/.local/state/dilemmaeval-conference/converge-rehearsal-2026-09-24-r8/maritime-launch/runtime-evidence.json`. Keep it historical; produce fresh ten-seat evidence/fingerprint.
- Existing sole operator journal: `/Users/wade/.local/state/dilemmaeval-conference/converge-rehearsal-2026-09-24-r8/operator`. Never run competing signer processes or reset its nonce journal.
- Current public three-seat config: `conference/evidence/live-proof-r8-attempt-4.config.json`. Create a fresh ten-seat run config and runtime directory; preserve all old evidence/fuses.
- Shared Telegram proof group `-1004364922269`, bot `@DilemmaDealer2026Bot`, remains usable for rehearsal. Two final groups/public hosting are outstanding, not prerequisites for testing mini/ten seats. Keep agent inputs team-isolated.
- Main files: `src/maritime/{recipes,install,install-runtime,launch-workflow,roster,transport,reconcile}.mjs`, `src/{config,readiness,cli,proof-audit}.mjs`, their tests, all under `integration/conference-runner/`.
- `proof-audit.mjs` explicitly hardcodes THREE in input uniqueness, joins, initial living count and reported counts. Generalize to the validated roster, preserving per-round actual-action/no-default/receipt/Telegram checks. Add a meaningful ten-seat test; never lower acceptance to make it pass.
- `conference/operations/saved-helpers/controlled-proof.mjs` also hardcodes three-seat patch evidence, roster source, one-awake transport and success/pause counts. Adapt a bounded ten-seat helper; do not directly run the old three-seat helper for 5-vs-5. Preserve its durable one-creation fuse.

## Efficient execution and acceptance

Use one inexpensive coding lead, with at most two short-brief independent workers if helpful. Existing tool-supported lighter worker: `gpt-5.6-luna`, low reasoning. One worker can own model installation/tests; another the bounded capacity scheduler/tests. Lead owns shared config, proof audit, integration and ALL external operations. Give disjoint file allowlists; workers never operate wallets/Maritime/Telegram.

Do local changes/tests once, then verify mini on existing Hermes and OpenClaw without signing, then a controlled game on the existing three with parallel dispatch if needed to establish model correctness. Expand through the resumable workflow and run one supervised 5-vs-5 game only after readiness passes. Stop dispatch on failure, diagnose fixed safe codes, reconcile uncertain chain actions, fix narrowly and retest; do not launch repeated games to search for a cause.

Ten-seat acceptance: ten unique real agents/wallets, five per harness; effective mini verified on all; at most five awake; ten confirmed joins; genuine team strategies in Telegram; actual required commits/reveals with zero defaults; independently audited result; measured model usage/cost; accurate spectator state. Preserve the user-selected models, rules and agents. Update `RUN-STATUS.md` with evidence and remaining limitations.

No implementation or external setup for this expansion has been performed by the handoff-writing turn. This is the next executable task, not a claim that 5-vs-5 is ready.
