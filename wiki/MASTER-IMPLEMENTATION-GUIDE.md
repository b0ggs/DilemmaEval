# MASTER implementation guide

Use this page to sequence work and record project gates. Execute details in the linked module, and attach evidence in a copy of the [run record](90-reference/RUN-EVIDENCE-RECORD.md).

**Canon:** historical [decision sheet sections 1–6](../prisoners-daolemma-tournament-decisions-v1_0.md), modified by the higher-authority approved [communication replacement](../prisoners-daolemma-discord-replacement.md) for team chat, observer, replay, and evidence.

**Navigation:** [Wiki home](README.md) · [Decision coverage](90-reference/DECISION-COVERAGE.md)

## Non-negotiable gates

> **FAIRNESS GATE:** [S01](10-first-hour-spikes/S01-MODEL-PARITY.md) must prove both harnesses reach OpenAI through the same route with the exact same selected model and settings. A model-name match alone is not enough. If parity fails, there is no tournament.

> **FIRST-THREE-SPIKES STOP GATE:** if S01, S02, or S03 fails or is indeterminate, stop. Fix and rerun before building or scaling to ten agents.

Also:

- **CONTRACT-AUTHORITY:** verified game-contract behavior and live chain state control gameplay facts. The scoring layer derives team results; it never changes contract truth.
- Base Sepolia and disposable testnet wallets only. No mainnet assets.
- Team chat is off-chain, informational, and not a separate wake trigger. The orchestrator may wake, observe, construct bounded same-team snapshots, validate responses, append agent-authored text verbatim, advance phases from chain truth, and write observer state. It may not choose moves/messages, rewrite text, hold a player key, or sign/send player transactions.
- Player signing is limited to each seat's own `GAMEPLAY_WALLET_PRIVATE_KEY` for player-local bridge operation `register`/pinned `auth:register`, `join`, `prepare_commit`, `commit`, `reveal`, and `claim`. The coordinator may schedule registration and verify public evidence but never receives the key. Complete and incomplete legacy keystore/signer alternatives are rejected for signed operations.
- `advance` uses an eleventh disposable non-player Base Sepolia operations wallet, exposed only to the separate advancement-executor process as `PHASE_ADVANCER_PRIVATE_KEY` through a VM secret manager/systemd credential or equivalent, then internally mapped for the pinned CLI. It is never in shell history, Git, `.env`, the general orchestrator environment, the ten-seat manifest, ERC-8004, a game join, or an entry-fee payment; it is not an owner/configuration, funding, or Maritime billing key.
- Every signed bridge operation requires a fresh actual-RPC `eth_chainId == 84532` result. At the pinned contract revision, the advancement executor may act from join only when `block.timestamp > joinDeadline`; from commit only when `committedCount == aliveCount` or `block.number > commitDeadlineBlock`; and from reveal only when `revealedCount == committedCount` or `block.number > revealDeadlineBlock`. It rereads phase/count/deadline immediately before submitting and, on race/revert, rereads and reevaluates rather than blind-retrying. Agent acknowledgements and orchestrator policy never grant authority; anyone-can-advance contract behavior is authoritative.
- Both harnesses receive identical message opportunities, fields, bounds, timeouts, retries, and recorded/deterministic ordering. Team logs are strictly isolated.
- A missing commit/reveal is contract-scored as Share, but observers must label it `defaulted`, not voluntary Share.
- Do not rewrite contracts. Redeploy is a human-selected fallback only.
- Do not build the optional stats page—or any fancy dashboard—before one real game and its evidence export succeed.

## Critical path and parallel work

The chat path is local and deterministic: no external chat credentials, bots, channels, APIs, pricing checks, or service provisioning. M08 can be fixture-tested as soon as the pilot seat/team map exists; live service setup is gone.

```text
M00 → M01 → M02 → M03 → S01
                         ├─ S02 → S03 ─┐
                         ├─ S04 ───────┼→ all spikes assessed → M04 → M05 → M06 pilot
                         └─ S05 ───────┘                                  ├─ M07 pilot ─────────┐
                                                                          └─ M08 pilot → M09 ─┴→ M10

M10 → M06 full → M07 full ─┐
                 M08 full ─┴→ M11 → M13 → M14 → M12 + more games (optional)
```

Preparation-only work may overlap where it does not claim completion or consume an unfinished handoff. Completion gates do not overlap: M01 must pass before M02, and M02 before M03, because their Read-first contracts consume those handoffs. After S01 passes, S04 and S05 may run alongside the sequential S02 → S03 path. After all spikes are assessed, build completion follows M04 → M05 → M06 pilot; M07 pilot and M08 pilot may then complete in parallel, while M09 waits for the M08 pilot input. M10 waits for every pilot input. After M10, M06 full must pass before M07 full and M08 full may complete in parallel; M11 waits for both. M10, full-fleet scale, M11, M13, and M14 remain source-ordered gates.

## Phase 0 — Orient and freeze the run

- [ ] `MASTER-00` — [M00 Project canon](00-start-here/M00-PROJECT-CANON.md) passed.
- [ ] `MASTER-01` — [M01 Run configuration](00-start-here/M01-RUN-CONFIGURATION.md) has every immediately required **OPEN** item selected and every required **LIVE-VERIFY** value current.
- [ ] `MASTER-02` — [M02 Roles and handoffs](00-start-here/M02-ROLES-AND-HANDOFFS.md) assigned accountable owners and reviewers.
- [ ] `MASTER-03` — [M03 Security and secrets](00-start-here/M03-SECURITY-AND-SECRETS.md) passed.

**Gate 0:** stop if a needed choice, live value, owner, secret boundary, or authorization is missing.

## Phase 1 — Run all first-hour spikes

- [ ] `MASTER-04` — [S01 Model parity](10-first-hour-spikes/S01-MODEL-PARITY.md) passed first.
- [ ] `MASTER-05` — [S02 Self-signing](10-first-hour-spikes/S02-SELF-SIGNING.md) passed.
- [ ] `MASTER-06` — [S03 Poke and act](10-first-hour-spikes/S03-POKE-AND-ACT.md) passed.
- [ ] `MASTER-07` — [S04 Owner config](10-first-hour-spikes/S04-OWNER-CONFIG.md) passed, or reuse is blocked pending a human redeploy decision.
- [ ] `MASTER-08` — [S05 Persistence](10-first-hour-spikes/S05-PERSISTENCE.md) passed for any multi-game learning claim.

**Gate 1:** S01–S03 must pass. S04 must prove a usable live contract path before live play. S05 failure removes the multi-game learning claim and blocks equal debrief-dependent games, but not the one-game floor.

## Phase 2 — Build only the pilot-ready system

- [x] `MASTER-08A` — local tests prove player/phase-advancer command and key isolation, player-local bridge operation `register`, legacy signer rejection, and fresh actual-RPC chain-ID preflight before dependent Wave 2 work; this local gate does not pass S02 or authorize a live transaction.
- [ ] `MASTER-09` — [M04 Agent game kit](20-build/M04-AGENT-GAME-KIT.md) accepted.
- [ ] `MASTER-10` — [M05 Harness adapters](20-build/M05-HARNESS-ADAPTERS.md) accepted for OpenClaw and Hermes.
- [ ] `MASTER-11` — [M06 Maritime fleet pilot checkpoint](20-build/M06-MARITIME-FLEET.md#pilot-checkpoint) has one persistent OpenClaw seat and one persistent Hermes seat.
- [ ] `MASTER-12` — [M07 wallet/identity/funding pilot checkpoint](20-build/M07-WALLETS-IDENTITY-FUNDING.md#pilot-checkpoint) has the two pilot seats registered and funded.
- [ ] `MASTER-13` — [M08 team-log pilot checkpoint](20-build/M08-TEAM-CHAT-LOGS.md#pilot-checkpoint) passes local schema, isolation, idempotency, ordering, restart, and recovery fixtures; M07 pilot and M08 pilot may complete in parallel after M06 pilot.
- [ ] `MASTER-13A` — before M09 is deployed/operated or M10 starts, the eleventh non-seat operations wallet is generated, its derived public address is bound in a separate operations manifest, and its Base Sepolia gas balance is funded under the approved ceiling; it is absent from ERC-8004, joins, entry fees, and the ten-seat manifest.
- [ ] `MASTER-14` — [M09 Orchestrator and VM](20-build/M09-ORCHESTRATOR-VM.md) started only after M08 pilot and passed restart, player-key/legacy-signer exclusion, process-local phase-secret loading, phase-advancer isolation, fresh actual-RPC chain verification, immediate advancement reread/race handling, and boundary review.

**Gate 2:** the shared system and one seat per harness require reviewable evidence before the pilot. Do not provision the remaining eight as a substitute for passing M10.

## Phase 3 — Prove minimum integration

- [ ] `MASTER-15` — [M10 Two-agent pilot](30-execute/M10-TWO-AGENT-PILOT.md) took one OpenClaw and one Hermes agent through a complete live round.

**Gate 3:** do not scale while parity, timing margin, self-signing, state reading, chat delivery, or authority boundaries are unexplained.

## Phase 4 — Scale to ten, then deliver the floor game

- [ ] `MASTER-16` — after M10, [M06 full-fleet checkpoint](20-build/M06-MARITIME-FLEET.md#full-fleet-checkpoint) has ten persistent, stable seat identities.
- [ ] `MASTER-17` — after M06 full, [M07 full-fleet checkpoint](20-build/M07-WALLETS-IDENTITY-FUNDING.md#full-fleet-checkpoint) has all ten seats registered and funded.
- [ ] `MASTER-18` — after M06 full, [M08 full-fleet checkpoint](20-build/M08-TEAM-CHAT-LOGS.md#full-fleet-checkpoint) maps all ten seats to exactly one isolated team log under one frozen communication configuration; M07 full and M08 full may complete in parallel.
- [ ] `MASTER-19` — [M11 Ten-agent tournament](30-execute/M11-TEN-AGENT-TOURNAMENT.md) readiness gate passed.
- [ ] `MASTER-20` — one complete five-versus-five game reached its contract-defined end.
- [ ] `MASTER-21` — [M13 Evidence export](40-observe/M13-EVIDENCE-EXPORT.md) reconciled the run with chain truth.

**Gate 4:** one real complete game plus reviewable evidence is the floor deliverable.

## Phase 5 — Observe and preserve fallback

- [ ] `MASTER-22` — raw team logs, accepted/rejected records, request/response logs, config/limits, every poke's `through_sequence`, and hashes are preserved for observer/replay.
- [ ] `MASTER-23` — [M14 Observer and replay](40-observe/M14-OBSERVER-REPLAY.md) reads orchestrator/evidence output, applies the frozen anti-leakage display delay, shows `defaulted` separately, and labels replay unmistakably.
- [ ] `MASTER-24` — the **OPEN/OPTIONAL** stats-page choice is recorded as built or skipped; any build started only after Gate 4.

## Phase 6 — Optional series

- [ ] `MASTER-25` — [M12 Series scoring and debrief](30-execute/M12-SERIES-SCORING-DEBRIEF.md) derives results only from verified contract winners.
- [ ] `MASTER-26` — if more than one game is selected, both harnesses receive the same factual debrief through verified persistent delivery.
- [ ] `MASTER-27` — **OPTIONAL:** games two and three complete if timing holds.
- [ ] `MASTER-28` — **STRETCH:** games four and five run only if explicitly selected and earlier evidence remains valid.

## Closeout

- [ ] `MASTER-29` — every checked item points to evidence, UTC time, owner, and reviewer.
- [ ] `MASTER-30` — every failure, default, draw, deviation, and replay is labeled.
- [ ] `MASTER-31` — all six historical source sections and all twelve replacement sections are covered in the [coverage map](90-reference/DECISION-COVERAGE.md).
- [ ] `MASTER-32` — no secret value entered Git/docs/pokes/logs/evidence/raw bridge arguments/shell history/`.env`/the general orchestrator environment; no mainnet asset, legacy signer alternative, invented contract behavior, contract rewrite, or dashboard-first work entered scope. The only accepted secret paths are the explicitly approved Maritime encrypted-environment injection of an assigned disposable player key and process-local VM secret-manager/systemd-credential-equivalent injection of the phase-advancer key.
- [ ] `MASTER-33` — handoff records completed scope, blockers, residual risks, and the next module's minimum context.
- [ ] `MASTER-34` — a full game can start and finish with no external chat account, application, bot, webhook, token, channel, API, or package.
