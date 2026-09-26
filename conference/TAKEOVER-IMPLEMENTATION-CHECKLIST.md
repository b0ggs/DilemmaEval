# Conference takeover implementation checklist

**Created:** September 25, 2026
**Branch:** `codex/converge-demo-2026-09-25`
**Working target:** five existing OpenClaw agents versus five existing Hermes agents on Base Sepolia.
**Fallback:** the independently proven three-agent configuration remains available, but must not be substituted silently for 5v5 acceptance.

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

- [ ] Confirm the current branch and working tree before any Git operation.
- [ ] Inventory all modified and untracked files. Classify each as source, test, documentation, public evidence, private runtime state, dependency output, or temporary artifact.
- [ ] Secret-scan the complete intended commit set. Inspect suspicious matches manually; transaction hashes and public addresses are not secrets, but private keys, API tokens, raw environment files, sessions, and commit bundles are forbidden.
- [ ] Confirm `node_modules`, private configuration links, runtime databases, journals, logs, and temporary proof directories are ignored.
- [ ] Preserve the private operator, provisioning, player, Telegram, and scoreboard state in place. Record their locations without copying their contents into the repository.
- [ ] Create a recoverable checkpoint commit containing the intended conference source, tests, documentation, and sanitized evidence. Do not leave the entire conference implementation dependent on one untracked checkout.
- [ ] Verify the checkpoint with `git status`, `git diff --check`, and a clean secret scan of the committed tree.

**Exit condition:** the current implementation can be recovered from Git without including secrets or private runtime state.

## Phase 1 — establish one truthful scope and status

- [ ] Make 5v5 the explicit active implementation target in one short current-status section.
- [ ] Label the original three-agent guide and older handoffs as historical where they conflict with the active target.
- [ ] Preserve the three-agent Games 12–14 as proven baseline evidence; do not relabel them as 5v5 evidence.
- [ ] Record Games 15–17 as failed 5v5 attempts, including their exact pre-signing/runtime failure and cleanup status.
- [ ] Remove or correct stale completion boxes that claim no real game has completed.
- [ ] Name one canonical checklist and one canonical current-status section. Older chronological evidence may remain, but must not function as competing instructions.

**Exit condition:** a new operator can identify the active target, current safe state, proven baseline, and next gate without interpreting contradictory documents.

## Phase 2 — restore a trustworthy local test baseline

- [ ] Reproduce the deterministic failing test: `ambiguous lifecycle refresh is inspected and never blindly replayed`.
- [ ] Determine whether the third Hermes configuration write is required for a new activation generation or is an unintended replay.
- [ ] Correct the implementation or the invariant—not merely the assertion—and add a test proving ambiguous repair is inspected before any repeat mutation.
- [ ] Make the conference-runner default test command deterministic. Either remove wall-clock-sensitive assumptions under parallel load or run this suite with an explicit safe test concurrency.
- [ ] Run the conference-runner suite to zero failures and zero cancellations.
- [ ] Run the site suite and the changed shared package suites: game bridge, harness adapters, Maritime transport, orchestrator core, and team logs.
- [ ] Run `git diff --check`.

**Exit condition:** all affected local suites pass using the documented default commands. A targeted pass cannot override a red full suite.

## Phase 3 — build a no-transaction, exact-path readiness gate

### 3.1 Diagnostic protocol

- [ ] Add a dedicated diagnostic request/response type. Do not disguise diagnostics as `join`, `commit`, or another gameplay action.
- [ ] Make the diagnostic consume staged JSON through the same stdin redirect or pipe mechanism used by live gameplay.
- [ ] Add a commit-shaped diagnostic in which the agent selects `share`, `steal`, or `catch`, while the player runtime validates the sibling `choice` location without preparing a bundle, signing, submitting, or returning the selected choice.
- [ ] Ensure diagnostic execution cannot create a gameplay operation journal, transaction, commit bundle, claim, refund, or phase action.
- [ ] Return only fixed public readiness fields and allowlisted error codes.

### 3.2 Per-seat checks

- [ ] Verify exact seat, harness, agent ID, team, wallet address, chain ID, game address, and runtime paths.
- [ ] Derive the injected wallet address locally inside the agent and match it to the roster without returning the key.
- [ ] Verify the pinned clean checkout, source revision, absence of a Foundry `.env`, required game CLI, dependencies, and executable wrapper.
- [ ] Verify private state directory access and lock acquisition/release without reading bundles or request journals.
- [ ] Perform bounded read-only `eth_chainId`, contract-state, admission, and cause checks through the same player bridge prerequisites used before signing.
- [ ] Verify the effective `gpt-5.4-mini` model profile and native tool execution for both harnesses.
- [ ] Exercise wake, environment reload, harness configuration, model configuration, staged request write, native chat/tool invocation, CLI stdin, response validation, and confirmed sleep.
- [ ] Run within the verified five-awake capacity and fail if an unrelated awake agent consumes a required slot.

### 3.3 Fresh evidence

- [ ] Produce one durable readiness record containing run ID, roster fingerprint, agent IDs, artifact hashes, transport/protocol version, activation generation, model profile, timestamps, and per-seat diagnostic results.
- [ ] Enforce a short maximum evidence age, initially ten minutes, at game preparation and again immediately before creation.
- [ ] Invalidate evidence when roster identity, runtime artifact, transport code, player CLI, model configuration, activation generation, chain ID, game address, or relevant defaults change.
- [ ] Require all ten seats to pass in the same bounded readiness run.
- [ ] Require all agents to be confirmed sleeping at the end of readiness, with no poisoned awake lease or ambiguous lifecycle operation.

**Exit condition:** all ten agents pass the exact chat-to-tool-to-stdin path without a transaction, and the creation path refuses missing, stale, mixed-generation, or mismatched evidence.

## Phase 4 — harden proof control and evidence

- [ ] Persist every dispatch attempt before remote work begins.
- [ ] Persist success, explicit rejection, pre-submit expiry, timeout, ambiguity, cancellation, and late completion in a `finally`-safe path.
- [ ] Ensure the first seat failure does not erase the outcomes of other already-running seat dispatches.
- [ ] Reconcile every reported transaction against the expected wallet, contract, game, round, operation event, confirmed canonical receipt, and current chain snapshot.
- [ ] Add a regression for the Game 17 shape: one transport failure, nine confirmed joins, and complete evidence for all ten attempted seats.
- [ ] Bind the one-game creation fuse to the exact config digest and fresh readiness-evidence digest.
- [ ] Refuse creation if the operator journal has an unresolved transaction, any owner or player nonce is pending, another runner/operator is active, or a game is already active.
- [ ] Replace expired, workstation-specific proof preparation with a versioned repository command that accepts explicit paths and deadlines.
- [ ] Make preparation safe to rerun into a new directory while refusing to overwrite an existing fuse, journal, evidence record, or runtime.
- [ ] Add a read-only `plan`/`status` command that shows gates and fixed error codes without loading a signing key or printing secrets.
- [ ] Keep `candidate_proof_complete` non-authoritative. Only the independent chain/Telegram audit may mark a proof complete.

**Exit condition:** a failed or interrupted proof leaves enough durable, sanitized evidence to reconcile every seat and transaction without guessing or blindly retrying.

## Phase 5 — local and fixture assembly gate

- [ ] Run repeated ten-seat fixture games through discussion, commit, reveal, result, claims/refunds, scoreboards, and restart recovery.
- [ ] Exercise five-awake scheduling with slow, rejected, timed-out, and abort-ignoring adapters.
- [ ] Verify a phase change aborts pending discussion and cannot dispatch stale commits.
- [ ] Verify an incomplete discussion blocks all commits.
- [ ] Verify a Telegram outage does not stop gameplay and that recovery does not duplicate uncertain sends.
- [ ] Verify scoreboards exclude funding, refunds, claims, cancellations, duplicate events, and historical unequal-roster games.
- [ ] Verify both team rooms receive only their own agent strategy while Dealer status/results reach both.
- [ ] Exercise graceful restart after completed joins and a simulated crash around a pending non-signing adapter call.
- [ ] Run the independent proof auditor against valid and deliberately corrupted fixtures.

**Exit condition:** the assembled local system passes all acceptance and failure-path tests without live agents or chain writes.

## Phase 6 — fresh live prelaunch gate

This phase is read-only except for waking/configuring agents as required by the no-transaction readiness diagnostic. It requires a new explicit execution window before beginning.

- [ ] Record the authorized start time, stop-new-games cutoff, hard stop, game limit, and spending/model-usage limits.
- [ ] Confirm exactly one designated live operator and no stale local runner, signer, proof helper, or spectator process.
- [ ] Refresh Base Sepolia chain ID, contract code hash, owner, auth/registry wiring, active game, current game ID, defaults, admissions, causes, balances, and confirmed block.
- [ ] Confirm 10/10 defaults and the reviewed entry fee/timing values. Do not reconfigure them merely because old documentation differs.
- [ ] Confirm latest and pending nonces match for the owner and all ten players.
- [ ] Confirm the ten expected Maritime agents exist with no unknown replacement or unrelated awake capacity consumer.
- [ ] Run the complete Phase 3 readiness gate for all ten seats.
- [ ] Verify both Telegram destinations, existing pinned message IDs, spectator permissions, fresh outbox identity, and scoreboard series identity.
- [ ] Have an independent reviewer inspect the gate results, creation fuse inputs, deadlines, cleanup path, and absence of unresolved ambiguity.
- [ ] Start the single owner/operator only after every preceding item passes.
- [ ] Recheck chain idle state, pending owner nonce, readiness evidence age, and execution cutoff immediately before allowing `createGame()`.

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

- [ ] Conference source and evidence are recoverably committed and secret-safe.
- [ ] Every affected local suite is green under the documented default command.
- [ ] The deterministic Hermes lifecycle ambiguity is resolved.
- [ ] All ten seats pass fresh exact-path, no-transaction diagnostics.
- [ ] Readiness evidence matches the exact config, roster, artifacts, activation generations, transport, and current chain.
- [ ] Contract is idle, defaults are correct, balances are sufficient, and all relevant pending nonces equal latest nonces.
- [ ] No unresolved operator, player, Maritime, or Telegram ambiguity exists.
- [ ] The one-game fuse, deadlines, cleanup path, and independent audit have been reviewed.
- [ ] A new explicit live execution window authorizes the attempt.

If any box is false, do not create a game.
