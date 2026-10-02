# Conference takeover implementation checklist

**Created:** September 25, 2026
**Branch:** `codex/converge-demo-2026-09-25`
**Working target:** five existing OpenClaw agents versus five existing Hermes agents on Base Sepolia.
**Fallback:** the independently proven three-agent configuration remains available, but must not be substituted silently for 5v5 acceptance.
**Canonical status:** [CURRENT-STATUS.md](CURRENT-STATUS.md)

This checklist replaces launch-first debugging. Do not create another game until the prelaunch gate below passes for all ten seats during the same bounded preparation run. Local fixtures, direct runtime inspection, and cached transactions are useful evidence, but none alone proves readiness for a fresh game.

## Operating rules

- [ ] One lead owns all Maritime, Telegram, contract, wallet, and signer mutations.
- [ ] Do not provision or replace agents, change models, add funding, reconfigure the contract, launch a game, or send public messages unless the active checklist step requires it and the authorization is current.
- [ ] Never replay an uncertain signing request. Reconcile it from the player journal, wallet nonce, receipt, and chain events.
- [ ] After a failure, identify the exact failed boundary, make one narrow change, and pass its prelaunch reproduction before considering another game.
- [ ] Keep the ten existing agent IDs, wallets, team assignments, private state, scoreboards, and operator journal stable.
- [ ] Treat chain state as authoritative. Agent replies and helper summaries are not completion evidence.
- [ ] Keep private keys, commit choices, salts, raw sessions, provider payloads, and secret-bearing paths out of Git and public evidence.

## Phase 0 — preserve the implementation

- [x] Confirm the current branch and working tree before any Git operation. Verified on `codex/converge-demo-2026-09-25` before checkpoint commit `688f3b9`.
- [x] Inventory all modified and untracked files. The checkpoint set was classified before `688f3b9`; this hardening tranche contains only source, tests, documentation, and `.gitignore` changes.
- [x] Secret-scan the complete intended commit set. The intended checkpoint tree passed the takeover scan before commit `688f3b9`; transaction hashes and public addresses were treated as public data, while private keys, API tokens, raw environment files, sessions, and commit bundles remained forbidden.
- [x] Confirm `node_modules`, private configuration links, runtime databases, journals, logs, and temporary proof directories are ignored. Runtime patterns were added to `.gitignore`; canonical state remains outside the repository.
- [x] Preserve the private operator, provisioning, player, Telegram, and scoreboard state in place. The existing `conference-secrets-local` link, `/Users/wade/.local/state/dilemmaeval-conference`, and `/private/tmp/dilemma-*` directories were left untouched; their contents were not copied or printed.
- [x] Create a recoverable checkpoint commit containing the intended conference source, tests, documentation, and sanitized evidence. Commit `688f3b9` is the takeover checkpoint.
- [x] Verify the checkpoint with `git status`, `git diff --check`, and a clean secret scan of the committed tree. The verification applies to `688f3b9`; subsequent implementation edits must be verified separately before their next checkpoint.

**Exit condition:** the current implementation can be recovered from Git without including secrets or private runtime state.

## Phase 1 — establish one truthful scope and status

- [x] Make 5v5 the explicit active implementation target in one short current-status section.
- [x] Label the original three-agent guide and older handoffs as historical where they conflict with the active target.
- [x] Preserve the three-agent Games 12–14 as proven baseline evidence; do not relabel them as 5v5 evidence.
- [x] Record Games 15–17 as failed 5v5 attempts, including their exact pre-signing/runtime failure and cleanup status.
- [x] Remove or correct stale completion boxes that claim no real game has completed. Historical unchecked boxes remain only inside the explicitly labeled chronological archive.
- [x] Name one canonical checklist and one canonical current-status section. Older chronological evidence may remain, but must not function as competing instructions.

**Exit condition:** a new operator can identify the active target, current safe state, proven baseline, and next gate without interpreting contradictory documents.

## Phase 2 — restore a trustworthy local test baseline

- [x] Reproduce the deterministic failing test: `ambiguous lifecycle refresh is inspected and never blindly replayed`.
- [x] Determine whether the third Hermes configuration write is required for a new activation generation or is an unintended replay. It is required after the confirmed sleep/reload generation boundary can rematerialize configuration.
- [x] Correct the implementation or the invariant—not merely the assertion—and add a test proving ambiguous repair is inspected before any repeat mutation. The test also proves a stable rerun performs no fourth write.
- [x] Make the conference-runner default test command deterministic. The package default now uses `--test-concurrency=1`.
- [x] Run the conference-runner suite to zero failures and zero cancellations. Inherited 255/255 reproduced; October 2 final continuity/default suite: **518/518** (earlier diagnostic tranche 378/378).
- [x] Run the site suite and the changed shared package suites: game bridge, harness adapters, Maritime transport, orchestrator core, and team logs. October 2 default suites: **199/199**, zero failures or cancellations.
- [x] Run `git diff --check`.

**Exit condition:** all affected local suites pass using the documented default commands. A targeted pass cannot override a red full suite.

## Phase 3 — build a no-transaction, exact-path readiness gate

### 3.1 Diagnostic protocol

- [x] Add a dedicated diagnostic request/response type. Do not disguise diagnostics as `join`, `commit`, or another gameplay action.
- [x] Make the diagnostic consume staged JSON through the same stdin redirect or pipe mechanism used by live gameplay.
- [x] Add a commit-shaped diagnostic in which the agent selects `share`, `steal`, or `catch`, while the player runtime validates the sibling `choice` location without preparing a bundle, signing, submitting, or returning the selected choice.
- [x] Ensure diagnostic execution cannot create a gameplay operation journal, transaction, commit bundle, claim, refund, or phase action.
- [x] Return only fixed public readiness fields and allowlisted error codes.

### 3.2 Per-seat checks

- [x] Verify exact seat, harness, agent ID, team, wallet address, chain ID, game address, and runtime paths in the diagnostic implementation and local tests.
- [x] Derive the injected wallet address locally inside the agent and match it to the roster without returning the key.
- [x] Verify the pinned clean checkout, source revision, absence of a Foundry `.env`, required game CLI, dependencies, and executable wrapper.
- [x] Verify private state directory access and lock acquisition/release without reading bundles or request journals.
- [x] Perform bounded read-only `eth_chainId`, contract-state, admission, and cause checks through the same player bridge prerequisites used before signing.
- [x] Verify the configured `gpt-5.4-mini` model profile and native tool execution path in local adapter tests. Actual all-ten live verification remains a Phase 6 item.
- [x] Exercise wake, environment reload, harness configuration, model configuration, staged request write, native chat/tool invocation, CLI stdin, response validation, and confirmed sleep in local adapter tests.
- [x] Run within the five-awake scheduler and fail if an unrelated awake agent consumes a required slot in local tests. The live account check remains a Phase 6 item.

### 3.3 Fresh evidence

- [x] Implement the durable all-ten readiness-v2 producer with run/config/roster/source/artifact/chain/model/lifecycle bindings, independent sanitized CLI receipts, exclusive external state, and atomic evidence publication. Repeated fixture runs pass; no live readiness record has been collected.
- [x] Enforce a short maximum evidence age, initially ten minutes, at game preparation and again immediately before creation.
- [x] Reject changed roster/config/artifacts/runtime/transport/model/chain/defaults and observed mixed generations in local tests. `activation_generation` identifies a durable diagnostic-run activation intent. Producer v2 uses observed-runtime-continuity-v1: fresh VM-incarnation/source/model/wallet checks and both original diagnostic receipts after every resume. Provider generation attestation remains false; timestamps are never substituted for generation.
- [x] Require all ten seats and both diagnostic modes in one bounded run; missing seats, stale results, private fields, model-only replies, timeouts and incomplete publication fail local fixtures.
- [x] Require final sleeping inventory plus per-seat sleep response/readback. Unresolved lifecycle operations or abort-ignoring late work prevent readiness; interrupted runs are inspectable without replay. These are local fixture results; fresh live sleep evidence remains required.

**Live exit condition remains unmet:** no live diagnostic run has occurred. Producer v2 fixture evidence is explicitly `diagnostics_complete:true`, `remote_generation_attested:false`, and ready only under the observed-runtime continuity policy. Preparation and final creation perform separate durable all-ten wake/inspect/sleep checks against the unchanged original digest. Read-only status cannot establish runtime continuity. An invisible restore to identical state is not distinguishable and is not claimed as provider attestation.

**Exit condition:** all ten agents pass the exact chat-to-tool-to-stdin path without a transaction, and the creation path refuses missing, stale, mixed-generation, or mismatched evidence.

## Phase 4 — harden proof control and evidence

- [x] Persist every dispatch attempt before remote work begins.
- [x] Persist success, explicit rejection, pre-submit expiry, timeout, ambiguity, cancellation, and late completion through the durable proof journal.
- [x] Ensure the first seat failure does not erase the outcomes of other already-running seat dispatches.
- [x] Reconcile every reported transaction against the expected wallet, contract, game, round, operation event, confirmed canonical receipt, and current chain snapshot through the independent proof auditor.
- [x] Add a regression for the Game 17 shape: one transport failure, nine late successful outcomes, and complete evidence for all ten attempted seats.
- [x] Bind the one-game creation fuse to the exact config digest and fresh readiness-evidence digest.
- [x] Refuse preparation/creation for unresolved operator transactions, any pending owner/player nonce, an active game, or unrelated live locks. The creation guard accepts only exact in-memory ownership descriptors for the intended runner/operator and rechecks them before submission.
- [x] Add versioned `conference-control.mjs` diagnostic/plan/status/proof-preparation commands with explicit paths and absolute deadlines. Historical launch entrypoints are disabled; no game-creation CLI is exposed while remote generation remains unverifiable.
- [x] Require a fresh exclusive external directory and refuse to overwrite existing fuses, journals, evidence or runtime state; partial writes remain for inspection.
- [x] Add local read-only `plan`/`status` with no credentials/network/writes, plus read-only proof checks. Only allowlisted error codes cross the CLI; signing keys are never loaded.
- [x] Keep `candidate_proof_complete` non-authoritative. Only the independent chain/Telegram audit may mark a proof complete.
- [x] Add version 2 `proof-run` wiring for existing operator ownership, readonly spectator preflight, certified Maritime resumes, a single creation fuse, absolute cutoffs, signal propagation, and durable candidate-only reports. Local execution fixtures pass; live operation remains Phase 7.
- [x] Recheck immutable request permits inside the player lock before preparation/signing; cold boots, artifact/model/receipt drift, mixed generation and expired permits fail closed.
- [x] Preserve the earliest operator deadline across queued requests/replays; disconnect, abort or expiry prevents subsequent signing/broadcast. Loopback HTTP regressions exercise the actual client/server/signer boundary.
- [x] Add separate atomic `proof-audit` output requiring both independent canonical chain and scoreboard/pin audits, unchanged preparation/verification/report inputs, and exact ten-seat identity.


**Exit condition:** a failed or interrupted proof leaves enough durable, sanitized evidence to reconcile every seat and transaction without guessing or blindly retrying.

## Phase 5 — local and fixture assembly gate

- [x] Run repeated ten-seat fixture games through all-ten joins/discussion/commits/reveals/results/claims, an all-ten cancellation/refund, scoreboards and restart recovery.
- [x] Exercise five-awake scheduling with ten actual fixture seats, unrelated active/restoring consumers, slow chat, delayed sleep, rejection, timeout, abort-ignoring calls and poisoned permits. HTTP-success sleep responses must explicitly confirm sleeping.
- [x] Verify a phase change aborts pending discussion and cannot dispatch stale commits.
- [x] Verify an incomplete discussion blocks all commits.
- [x] Verify a Telegram outage does not stop gameplay and that recovery does not duplicate uncertain sends.
- [x] Verify scoreboards exclude funding, refunds, claims, cancellations, duplicate events, and historical unequal-roster games.
- [x] Verify both team rooms receive only their own agent strategy while Dealer status/results reach both.
- [x] Exercise graceful restart after ten joins and actual fixture-subprocess termination during ten pending non-signing discussions; recovery cannot redispatch uncertain calls or commit before the discussion barrier.
- [x] Run the independent proof auditor against valid and deliberately corrupted fixtures.

**Exit condition:** the assembled local system passes all acceptance and failure-path tests without live agents or chain writes.

## Phase 6 — fresh live prelaunch gate

This phase is read-only except for waking/configuring agents as required by the no-transaction readiness diagnostic. It requires a new explicit execution window before beginning.

- [ ] Record the authorized start time, stop-new-games cutoff, hard stop, game limit, and spending/model-usage limits.
- [ ] Confirm exactly one designated live operator and no stale local runner, signer, proof helper, or spectator process.
- [ ] Refresh Base Sepolia chain ID, contract code hash, owner, auth/registry wiring, active game, current game ID, defaults, admissions, causes, balances, and confirmed block.
- [ ] Confirm 10/10 defaults and the reviewed entry fee/timing values. Do not reconfigure them merely because old documentation differs.
- [ ] Confirm latest and pending nonces match for the owner and all ten players.
- [ ] Confirm the ten expected Maritime agents exist with no unknown replacement or unrelated awake capacity consumer.
- [ ] Review/update the exact deployed artifacts without replacing agents or private state, then run the complete Phase 3 readiness gate for all ten seats in an authorized diagnostic window.
- [ ] Verify both Telegram destinations, existing pinned message IDs, spectator permissions, fresh outbox identity, and scoreboard series identity.
- [ ] Have an independent reviewer inspect the gate results, creation fuse inputs, deadlines, cleanup path, and absence of unresolved ambiguity.
- [ ] Start the single owner/operator only after every preceding item passes.
- [ ] Recheck chain idle state, all owner/player pending nonces, unchanged readiness digest/age, durable all-ten continuity verification, process ownership, and cutoff immediately before allowing `createGame()`.

**Exit condition:** one reviewed command can create at most one game, and that command remains unable to run if any prerequisite changes.

## Phase 7 — one controlled 5v5 proof

- [ ] Create exactly one game through the fused owner path.
- [ ] Confirm the creation receipt and canonical `created` event before dispatching joins.
- [ ] Require ten distinct confirmed joins from the ten expected wallets.
- [ ] Require one substantive agent-authored strategy message per living seat, delivered only to its team room.
- [ ] Require every commit to receive the completed same-team discussion snapshot.
- [ ] Require ten confirmed commits with no coordinator-selected choices.
- [ ] Require ten confirmed reveals using the original private bundles.
- [ ] Label any actual default as a default and fail zero-default acceptance; never relabel it as voluntary Share.
- [ ] Confirm the terminal result, effective choices, eliminations, awards, and result transaction from chain events.
- [ ] Confirm both rooms receive the canonical result and both existing pins update exactly once.
- [ ] Run the independent auditor across chain events, receipts, dispatch records, team logs, Telegram delivery, scoreboard ledger, and pin readbacks.
- [ ] Record measured model cost and gas for the exact game interval separately from setup and diagnostics.

**Proof acceptance:** ten joins, ten discussions, ten commits, ten reveals, zero defaults, one confirmed completed result, correct awards, correct room isolation, two result deliveries, and two verified pin updates.

## Phase 8 — cleanup after the proof attempt

- [ ] Stop the runner from creating another game regardless of proof outcome.
- [ ] Reconcile every pending or ambiguous player/operator transaction.
- [ ] Finish eligible claims or refunds without counting them as awards.
- [ ] Drain definitely-unsent Telegram work; do not resend uncertain deliveries blindly.
- [ ] Stop runner and owner/operator processes.
- [ ] Return all ten agents to confirmed sleeping state.
- [ ] Capture a final confirmed chain snapshot and process check.
- [ ] Update the canonical current-status section with exact evidence, costs, failures, cleanup, and the next permitted action.

**Exit condition:** no active game, no untracked pending transaction, no live signing process, no poisoned agent lifecycle state, and no falsely claimed proof.

## Phase 9 — bounded continuation only after proof

- [ ] Do not enable automatic continuation until Phase 7 passes and Phase 8 cleanup is verified.
- [ ] Configure one active game maximum, finite retries/backoff, hard stop, stop-new-games cutoff, wallet reserve floor, model-cost ceiling, and a manual kill switch.
- [ ] Stop on readiness drift, roster/model change, repeated cancellation, unresolved transaction, chain disagreement, scoreboard disagreement, or budget exhaustion.
- [ ] Re-run the no-transaction readiness gate after any runtime/code/model/lifecycle change and periodically during a long event.
- [ ] Verify several consecutive games, restart recovery, Telegram outage behavior, public website state, and phone-over-cellular access before calling the continuous demo complete.

## Deferred until one 5v5 proof succeeds

- [ ] SDK upgrade or harness replacement without evidence that the current pinned integration is the blocker.
- [ ] New agents, wallets, funding, models, contracts, or game rules.
- [ ] General architecture refactoring or historical-document cleanup beyond removing operational ambiguity.
- [ ] Production hosting, website redesign, additional spectator features, leaderboards, or cross-game agent memory.
- [ ] More live games intended only to discover the next prelaunch defect.

## Definition of ready for another real game

All of the following must be true at once:

- [x] Conference source and existing evidence are recoverably committed and secret-scanned: implementation checkpoint `7d8e025`. No fresh live diagnostic evidence has been produced.
- [x] Every affected local suite is green under the documented default command: October 2 final continuity tranche, **717/717 tests total**, zero failures, cancellations or skips.
- [x] The deterministic Hermes lifecycle ambiguity is resolved. This local regression fix does not establish remote lifecycle attestation.
- [ ] All ten seats pass fresh exact-path, no-transaction diagnostics.
- [ ] Readiness evidence matches the exact config, roster, artifacts, activation generations, transport, and current chain.
- [ ] Contract is idle, defaults are correct, balances are sufficient, and all relevant pending nonces equal latest nonces.
- [ ] No unresolved operator, player, Maritime, or Telegram ambiguity exists.
- [ ] The one-game fuse, deadlines, cleanup path, and independent audit have been reviewed.
- [ ] A new explicit live execution window authorizes the attempt.

If any box is false, do not create a game.
