# Implementation v2: remove ceremony from the conference debugging loop

**Date:** October 5, 2026. **Branch:** `codex/converge-demo-2026-09-25`.
**Builds on:** [FAST-ITERATION-IMPLEMENTATION.md](archive/FAST-ITERATION-IMPLEMENTATION.md) (v1). v1 is unchanged. This revision keeps v1's diagnosis and debug/proof split. It incorporates two audits of v2's first draft and a separate four-auditor investigation (October 5).

**Status:** this is a plan, nothing more. It authorizes no live action and no code or document changes. Nothing below is implemented. The decisions in section 9 are made. Work starts when the user approves the plan.

**Goal (unchanged):** one complete 5v5 game with the five existing OpenClaw and five existing Hermes agents on Base Sepolia, correct Telegram results, and cleanup.

## 1. Why nothing is getting done

The core problem is an **expensive, low-information iteration loop**. Each defect turns into another preparation project. The evidence:

- **Iteration speed collapsed.** Sep 24–25 produced about 14 games in two days, with concrete fixes between them. Sep 25 to Oct 2 produced zero games. Oct 2 produced three games, all aborted. Oct 3 to Oct 5 produced zero games and zero commits.
- **Every game is a full certification.** There is no cheap gameplay path. Even `cli.mjs run` and `npm start` throw `PROOF_VERSIONED_CLI_REQUIRED` (`cli.mjs:25`). Game 18 completed 776 preparation operations and then failed before any player acted (`evidence/all-ten-readiness-and-game18-2026-10-02.json`).
- **The certification tooling creates its own failures.** Observer configuration, process identities and deadline bindings break repeatedly. Reviewed, tested helpers expired before they ran: the V6 correction hit `START_CUTOFF_CLOSED`.
- **Failures carry too little information.** The OpenClaw receipt reader turns every failed check into an empty `exit 1` (`throw 0`, `src/maritime/openclaw-oauth.mjs:535`). Games 19 and 20 lost their underlying causes (`original_cause_determined: false`). Sessions then build new inspectors to reconstruct what happened.
- **One uncertain agent operation aborts the whole game.** Game 19 stopped in round 3 (oc-2 to oc-5; 18 defaults). Game 20 had one ambiguous hs-1 reveal; the stop then cancelled or rejected the other nine (30 defaults). Several layers enforce this (section 5, step 4). **v1 does not address it.**
- **Authorization is per session.** AGENTS.md:6 says a new session does not renew authorization, and AGENTS.md:41 says the file "does not independently authorize spending". Each resume needs a fresh window of about 60 minutes, and preparation outlasts it. **v1 repeats this** (v1 section 7).
- **The instruction file forces ceremony.**
  - Concurrent sub-agents with interface passes and allowlists (AGENTS.md:10–34).
  - An "independently audited" proof (AGENTS.md:7).
  - Full suites before checkpoints (AGENTS.md:43), roughly 13–14 minutes per narrow fix.
  - v1 step 1 says to "clarify" AGENTS.md but does not say what to remove.
- **Documents replace engineering.** There are 18 overlapping docs in `conference/`. The three required entry docs total 632 lines. CURRENT-STATUS.md opens with eight stacked "Current/Resumed" banners. `/private/tmp` holds 348 `conference*` entries, about 180 of them one-off wrappers. Every plan, v1 included, gets its own self-audits.
- **Work is uncommitted.** There are 24 modified and 25 untracked files. Four of the untracked files are code: `src/maritime/hermes-oauth.mjs`, `openclaw-oauth.mjs` and their tests. Committing protects that work. It does not by itself stabilize content hashes.
- **There is also a real external blocker.** Maritime metered billing returned HTTP 402 (Oct 3–4), which forced the OAuth migration. Game 20's hs-1 activation also returned 402. Faster iteration helps only if the accounts work.

## 2. What v1 got right (kept)

- Debug versus proof purposes on the existing runner. No second engine.
- The OC1 diagnosis. `/chat` returned 200, then the receipt reader exited 1. SSE newline parsing was ruled out, so do not patch the decoder on that theory. The prepared failure-phase instrumentation (`refusal_phase` in the untracked `openclaw-oauth.mjs`) is the next diagnostic.
- Critical checks are separate from optional telemetry (v1 section 4). Telemetry failures must not block a turn.
- v1 section 2's replacement table, with the changes in section 4 below.
- Targeted tests per fix. Nothing runs `npm test` as part of a launch.
- Uncertain creation, signing or Telegram requests are never resent blindly.

## 3. What v1 got wrong or missed

| v1 | Problem | v2 |
|---|---|---|
| A new `attempt` command with 11 flags, a shared admission adapter, a new agent-side permit type and observer stabilization, all before the first debug game | The next multi-day project lands before any game | A `--debug` flag on the existing `proof-prepare`/`proof-run`, implemented on the coordinator only (step 3) |
| Debug keeps the per-call native OAuth observer | The observer embeds operation IDs and deadlines in installed plugin code, so every attempt causes config churn and refreshes. Observers already installed on the agents reject all inference once their deadline passes | Debug uses the existing config-level OAuth/Sol check that gameplay already runs before signing. A one-time step disables the installed per-call observers for debug (step 3); the final proof restores them only if OC1 is fixed (D3). The per-call observer and receipt are final-proof evidence only (section 6) |
| Silent on Game 19/20 aborts | The second blocker is untouched | In debug, the game continues past an uncertain seat. All stop points are removed (step 4) |
| Failure detail treated as an OC1 incident | Every layer discards the cause | New requirement: the first failure cause survives end to end (step 2) |
| Keeps per-session expiring windows | The main reason sessions burn their time | Standing, capped live authorization set by the user in AGENTS.md (step 1, D1) |
| "Clarify" AGENTS.md; leaves the delegation mandate, audit language and 18 docs | The forcing rules survive | Specific AGENTS.md rewrites; one STATUS.md (step 1) |
| Gates itself on two new audits; the final proof needs an "independent canonical proof audit" | Audit loops | Future plans need no audits. The final proof runs the existing `proof-audit` script, and the user reviews it |
| Lead plus workers with file allowlists | Coordination overhead | One session does the work; sub-agents are optional |
| No time-box | Unbounded effort | Time-box and fallback (section 7) |
| Says nothing about the uncommitted work | Real risk of losing the OAuth code | Commit it first; drop nothing (step 0) |
| No run map | Each session rediscovers paths and flags | STATUS.md carries the run map |
| (v1 got this right; v2's first draft dropped it) Debug may launch with Game 20 awards unpaid | — | Kept: the unpaid-awards gate is skipped in debug |

## 4. Changes to v1's replacement table

Keep v1 section 2 except:

- **"Separate reviewers…" row:** drop "Keep the independent final proof audit." The final proof runs the existing `proof-audit` script, and the user reviews it.
- **"One creation fuse…" row:** standing authorization allows a capped number of attempts (D1). There is one fuse and a fresh proof-dir per attempt, with no per-attempt user approval.
- **"Repeated arbitrary 12–30 minute invocation bounds" row:** deadlines come only from contract phase timing plus a cleanup reserve. There are no session windows.
- **"Pay every historical award" row:** as v1. Debug skips it; the final proof requires it.
- **Observer row:** debug needs only the disable/restore transition in step 3. A stable observer with deadlines held as data is a proof-path optimization; do it only if per-proof reinstalls actually slow the final proof.
- **History-reconciliation and two-continuity-pass rows:** proof-path optimizations; do them only if they actually slow the final proof.

## 5. Implementation order

Paths in steps 2–5 are relative to `integration/conference-runner/`.

**Testing:** run targeted tests per change and commit freely after them. Run the full suite only at an integration checkpoint (after steps 3–4 work together, and before the final proof). A documentation commit needs no tests.

**Agent-side files:** files in `install.mjs` `SOURCE_FILES` are shipped to and checked on all ten agents. They include `execution-permit.mjs`, `player-runtime.mjs`, `openclaw-oauth.mjs` and `hermes-oauth.mjs`. Any edit to one means reinstalling all ten seats before the next game. Prefer coordinator-side changes, and batch the unavoidable agent-side edits.

| Step | Change | Done when |
|---|---|---|
| 0. Save the work | Run `gitleaks` over the full diff, evidence JSONs included. Commit all modified and untracked files as work in progress. Run targeted tests for the 4 untracked code files; a failing test doesn't block saving the work, it is recorded in STATUS.md. Delete nothing. | OAuth source is in Git |
| 1. Cut the process (short; runs alongside steps 2–4) | **AGENTS.md:** remove the concurrent-delegation section (lines 10–34). Replace "independently audited" (line 7) with "the user reviews the `proof-audit` report". Rewrite lines 6 and 41 to say the standing authorization in this file persists across sessions and compaction until the user revokes it (D1). Testing as above. No new plan, handoff or audit docs; audit reports go in chat. Keep the hard limits in section 6. Remove links to superseded docs. **STATUS.md:** create `conference/STATUS.md` with state, blockers, next actions, run map and attempt log, and point AGENTS.md at it. Archiving the old docs (D5) and adding `CLAUDE.md` can happen any time; they do not gate other steps. | A fresh session reads AGENTS.md and STATUS.md (under about 150 lines combined) and knows the next action and how to run it |
| 2. Failures carry their cause | **(a)** Replace the receipt reader's bare `throw 0` with named failing conditions (no bodies or credentials). **(b)** Carry the first failure cause through the native command, transport and the recorded outcome (`withFailureMetadata` already exists in `transport.mjs`), so an uncertain operation records why. **(c)** Add `--seat` to `diagnose`, calling `createMaritimeAdapter().diagnose` (`transport.mjs:809`) directly. A one-seat config is impossible (`CONTROL_TEN_SEATS_REQUIRED`). `diagnose()` checks only the chat response (`transport.mjs:895`) and never calls the native receipt reader, so the `--seat` path must also run the existing production observer activation and receipt read (`buildOpenClawProductionReceiptReadCommand`) for that call. **(d)** Use it on OC1 to name its failing condition. Part (a) is an agent-side edit; batch it with any other agent-side change. | A failed operation's record names the failed check or boundary. OC1's failure is named. Fixing OC1 is needed only for the final proof |
| 3. Debug admission (coordinator side, plus one observer transition) | **Observer transition (first).** The per-call OAuth observers already installed on the agents enforce a deadline and reject all inference after it (`hermes-oauth.mjs:260`, `live()`; the OpenClaw observer behaves the same way). Add one narrow step that removes or deactivates the installed per-call observer on each seat, leaving the config-level OAuth/Sol settings and fallback-disabled checks intact. Add a matching restore step, used for the final proof only if OC1's per-call provenance has been fixed (D3). This is an agent-side change: do it once, for all ten seats, batched with step 2(a).<br><br>**Debug validation and continuity branch.** Add `--debug` to `proof-prepare`/`proof-run` in `conference-control.mjs`, with a complete debug branch, not scattered bypasses. Under `--debug`:<br>• debug-specific config and evidence validation, because full coordinator validation rejects an added `purpose` field and requires diagnostic evidence;<br>• no `refresh()` `validateReadinessCurrent`/`checkVerification` in `proof-control.mjs` (run in `prepareControlledProof` and again at creation in `createGuardedLauncher`, where they wake all ten agents);<br>• no `validateControlledRuntimeEvidence` expiry;<br>• a debug continuity object replacing `createRuntimeContinuity` as a whole: its `verify()` (called by `start()` after every wake, `transport.mjs:601–604`, and after gameplay) and its `prepareAction()` read the live fingerprint and run the existing inspect/model/route checks instead of readiness-v2 receipts;<br>• no unpaid-historical-awards gate;<br>• **no automatic settlement:** `tick()` calls `settle()` every cycle (`runner/index.mjs:630`), so debug disables it; claims run later as a deliberate action (D2);<br>• **no pinned scoreboard:** pass no `scoreboard` option to `createTelegramMirror` (`telegram/index.mjs:151`), so the pinned-scoreboard writer is never created. If a spectator gate requires bindings, give debug its own room/access check without them.<br><br>The debug context satisfies the existing agent-side `contextSeat` check. **Do not edit `execution-permit.mjs`.** Proof admission rejects any debug-marked evidence.<br><br>Keep:<br>• the nonce check on all 11 wallets;<br>• the owner-journal check;<br>• the operator process;<br>• a fresh fuse and proof-dir per attempt;<br>• Telegram room access checks.<br><br>Estimate: about 2–3 days including tests. | Fixture or local run: debug admits without a certificate, wakes agents without readiness-v2 receipts, sends no claims and makes no pin edits. Proof rejects debug context, and proof tests still pass. After the observer transition, one live diagnostic on one Hermes and one OpenClaw seat returns a Sol response |
| 4. Continue past an uncertain seat (debug only) | Remove every game-wide stop point under `--debug`:<br>**(a)** the dispatch journal's `stopFor` in `conference/operations/saved-helpers/proof-dispatch-journal.mjs` does not abort;<br>**(b)** `proof-run.mjs:271/316` doesn't stop on `BAD_DISPATCH`;<br>**(c)** the health stop at `proof-run.mjs:273–275` tolerates every seat-scoped health code (any issue carrying a `seat_id`, including `AGENT_ACTION_UNCERTAIN`, `AGENT_REPORTED_ERROR` and `AGENT_DISPATCH_EXPIRED`), and stops only on chain-, owner- or launch-level codes;<br>**(d)** `runner/index.mjs:558` (`if (discussionStates.some(s => s !== 'acknowledged')) return;`) stops blocking the whole table, which is why Game 19 sent zero round-3 commits;<br>**(e)** the transport's `rotationBlocked` (`transport.mjs:791`) blocks only the affected seat, not all later dispatches;<br>**(f)** don't wait for all claims to be paid before the debug run exits.<br><br>Keep the uncertain operation's status as **unknown**; it may still succeed. **Quarantine the seat:** send it no further dispatches until that specific operation is resolved, meaning it reported completion or can no longer act (its job ended and a read after that shows the agent asleep). Matching nonces are not enough, because the job may still be computing before it broadcasts. A sleeping snapshot taken before a delayed wake completes is not enough either. In practice the seat usually sits out the rest of the game. Quarantine is persisted in private state, not adapter memory, so an unresolved seat stays quarantined across a new attempt directory, adapter instance or process restart until its operation resolves. Keep counting it toward the five-awake limit while quarantined. Defaults come only from the contract and chain events, never from the coordinator. An uncertain owner phase advance (`PROOF_PHASE_UNCERTAIN`) still stops the game. Proof mode is unchanged. | Fixture: one uncertain seat; the game completes; that seat's outcome comes from chain events; its cause is logged; it receives no dispatch until its operation resolves; a seat-scoped `AGENT_DISPATCH_EXPIRED` does not stop the table (adapt the existing regression at `test/readiness-run.test.mjs:578`) |
| 5. Debug games | Run 5v5 debug attempts under the standing authorization. Fix what breaks with targeted tests. One line per attempt in STATUS.md. | One debug 5v5 completes with all ten seats acting, Telegram correct, cleanup confirmed |
| 6. Final proof | If OC1's per-call provenance is fixed (step 2), restore the per-call observers on all ten seats. Otherwise, per D3, leave them disabled and run with config-level verification, disclosed in the result. Reinstall if agent-side files changed, and run the full suite. Claim Game 20's awards. Run the existing proof path without `--debug`: one fresh 20/20 diagnostic set, the existing continuity check, the game, `proof-audit`. The user reviews the report. | An accepted 5v5 per D4 |

Practice games can start once steps 0, 3 and 4 are done, with step 2(b) wanted for useful failure reports. The OC1 fix (2d) is off that path. Do not start any v1 step outside this table until a debug game has completed.

## 6. Limits that stay

- Base Sepolia only.
- Only the ten existing agents. No more than five awake across the whole account, counting unrelated agents and any quarantined seat or seat with an uncertain lifecycle operation. Check before each wake.
- Each agent signs its own moves and keeps its own commit/reveal secrets. The coordinator never invents a choice, dialogue or default.
- One process signs for any wallet at a time. If a transaction or operation is uncertain, read the chain and nonce before acting and never blindly resend.
- **Debug model check:**
  - Debug keeps the existing config-level OAuth/`gpt-6.1-sol` check that every agent runs before signing (`verifyExecutionPermit`, then `inspectModel`/`inspectModelRoute`).
  - Before the first debug game, confirm no metered API key or fallback provider is reachable from any seat. An unverified route could bill or hit the exhausted credits.
  - Debug results are not evidence that per-call OAuth/Sol works.
- No secrets in Git, prompts, logs, Telegram or public state. Scan with `gitleaks` before each commit.
- **Telegram:** every debug message starts with `[DEBUG]`. Debug games run without scoreboard bindings, so the pinned scoreboard and accepted-proof count are never touched.
- **Cleanup after every attempt:**
  - If the game is mid-play, advance it to terminal through the operator's phase executor as contract deadlines expire. `cancel-insufficient-game.mjs` only handles an under-filled join phase.
  - Then confirm two things: one read showing the account awake count is 0, and one chain read showing no active game.
  - If the game cannot reach terminal, stop and report it; never start a new game.
  - Add one line in STATUS.md.
  - Award claims, Telegram reconciliation and process audits are not required after a debug attempt.

## 7. Time-box and fallback

If two consecutive debug attempts fail for the same cause after a fix, stop and ask the user. The options are:

- demo the three-agent configuration proven in Games 12–14;
- run a Hermes-only game;
- accept a 5v5 with defaults (D4).

If OC1's per-call provenance is still unverified when the final proof is due, follow D3; no user decision is needed. The demo never silently substitutes a fallback for the 5v5.

## 8. How to tell it worked

Measure these in STATUS.md, not in new docs:

1. A one-line fix to a game played needs under an hour, with targeted tests only.
2. A new session can start a debug game without asking the user for a window.
3. No new `/private/tmp` wrappers or plan/audit docs appear.
4. A failed attempt's record names its first failed check. No new inspector script is needed to find it.
5. Games are being played. Expect several debug attempts in the first working day after steps 0, 3 and 4.

## 9. Decisions (decided October 5, 2026)

The user delegated these decisions to Claude on October 5, 2026. They are recorded here so later sessions do not reopen them. D3 and D4 are scope choices, not fixes for runtime defects.

| ID | Decision |
|---|---|
| D1 | **Standing live authorization: yes.** It persists across sessions and compaction until the user revokes it. Limits:<br>• one attempt = one game creation; at most 10 per day and 30 total, after which the session asks the user again;<br>• at most 60 additional agent wakes per day for diagnostics, the observer transition and claims;<br>• at most 0.07 ETH per day of owner/operator gas (Game 19's roughly 0.0067 ETH covered all 58 of its transactions, players included, so this is a generous ceiling for about 10 games), not counting player entry fees, which return as awards;<br>• existing balances and the ten existing agents only;<br>• existing Telegram rooms only.<br>Halt and ask the user if any wallet can't cover one more game plus cleanup. |
| D2 | **Claiming owed awards is covered, including Game 20,** when no game is running. Claims count toward D1's wake limit. |
| D3 | **If OC1's per-call provenance isn't fixed when the final proof is ready, run the proof with config-level OAuth/Sol verification for OpenClaw.** Disclose it in the result: "OpenClaw model verified by configuration, not per-call receipt". Do not delay the demo for this. The no-metered-key/no-fallback check in section 6 is required in either case. |
| D4 | **Aim for zero defaults.** If the section 7 time-box is reached, a complete 5v5 with defaults is acceptable as the demo only when it is labeled "degraded demo" with defaults counted. It is never reported as a passed proof. |
| D5 | **Archive the old docs** to `conference/archive/`, including RUN-STATUS.md (linked from STATUS.md). Keep IMPLEMENTATION-GUIDE.md in place. This is not a prerequisite for any other step. |

## 10. Considered and not adopted

The audits suggested these; they are left out because they recreate the loop this plan removes:

- **A reusable observer-binding mechanism before debug games.** Debug needs only the disable/restore transition in step 3, not a general binding mechanism. (An earlier draft said debug needed nothing here. That was wrong: installed observers block inference after their deadline.)
- **Full reconciliation (payouts, Telegram, owned processes) after every debug attempt.** Section 6's terminal-advance plus two reads is enough for debug. Full reconciliation is for the final proof.
- **Keeping an independent final review and dropping the two-attempt stop.** These are judgment calls. Kept as written: the user reviews the `proof-audit` script output, and the time-box stays.

## 11. Audits

This plan has been through three audit rounds. The last round found only implementation-level details, which change no part of the plan's direction. **No further plan audits.** Remaining gaps of this kind are found and fixed while building, with targeted tests. Future plans and status changes need no audits (step 1). Approving the plan does not authorize live action.
