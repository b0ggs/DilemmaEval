# Conference fixes for the 5v5 demo

Audit/revision date: October 5, 2026. Branch: codex/converge-demo-2026-09-25.
Status: active code batch implemented; targeted checks and all-ten reinstall complete.
Live debug verification and final V2 proof remain. Outcomes are in conference/STATUS.md.

**[AGENTS.md](AGENTS.md) hard limits apply.** The approved
[v2 decisions](conference/FAST-ITERATION-IMPLEMENTATION-v2.md) govern conflicts.
Use the existing runner, agent runtimes, journals, and ten agents.

## Evidence and priority

The original audit examined the complete conference system and relevant
dependencies, ran 74 targeted tests successfully, and performed ten local
reproductions. Three independent sub-auditors checked this revision against
code, tests, and saved Game 21–23 records. Additional local reproductions
confirmed retry-cache restrictions, false pre-bridge submission uncertainty,
and completed-work cleanup being cut off by the action deadline.
These are defect checks, not validation of implemented fixes; the full suite
was not rerun during this documentation revision.

| Game | Defaults | Associated failed actions |
| --- | --- | --- |
| 21 | 4 | Four commits blocked by quarantine after invalid discussions |
| 22 | 27 | Eighteen quarantine-blocked commits; nine queued commits expired behind retained capacity |
| 23 | 3 | One commit blocked after a confirmed reveal with a lost reply; two transport timeouts |

Evidence is in the saved reports, normalized chain events, and sanitized
coordinator dispatch metadata under
/private/tmp/dilemma-fast-iteration-20261005/debug-game-{1,2,3}/.
Thirty-one of 34 defaults align with #02's amplification in Games 21–22.
The records do not prove every invalid discussion was too long.
Removing the message cap does not fix retained capacity, reply resource limits,
or downstream input size. Recorded cleanup reached active game zero and awake
zero; those are historical results, not fresh live checks.

Implement the following bounded batch. Severity describes potential impact;
priority below describes the next demo's work.

| Priority | ID | Severity | Correction |
| --- | --- | --- | --- |
| 1 | 02 | High | Completed-invalid discussion cleanup, one re-ask, public-hash false positives |
| 2 | 11 | Medium | Fit inference context to the serialized CLI byte budget |
| 3 | 07 | High | Start action allowance after capacity admission; bound cleanup of known-completed work |
| 4 | 10 | High | Recover confirmed actions after lost chat replies; retain uncertain jobs |
| 5 | 03 | High | Report definite preparation/guard failure as unsent; no automatic retry promise |
| Before proof acceptance | 05 | High | Compare complete delivered award text with chain awards |

## 02 — Completed invalid discussions retain awake capacity

**Impact and trigger:** A completed discussion reply fails JSON, identity,
content, secret, or size validation. Transport labels it ambiguous and skips
sleep. The seat stays quarantined and retains its awake lease; its later commits
are rejected, and five retained seats make healthy queued seats expire.
Discussion has no signing side effects. A completed invalid reply is different
from an unknown remote job after HTTP failure or timeout.

**Evidence:** Confirmed in
[dispatch and lease handling](integration/conference-runner/src/maritime/transport.mjs#L700),
[reply rejection](integration/conference-runner/src/maritime/transport.mjs#L777),
and the [generic error path](integration/conference-runner/src/maritime/transport.mjs#L827).
Games 21–22 show 22 quarantine-blocked commits and nine queue expirations,
matching 31 defaults.

Two confirmed validation triggers also need correction:

- [Secret validation](integration/maritime-transport/src/validation.mjs#L212)
  rejects 64-hex strings in dialogue even when they are public transaction hashes.
  The same value passes in transaction_hash and fails in team_message.
  The false positive is locally reproduced; its role in a particular saved
  default is unproven.
- [Transport reply validation](integration/conference-runner/src/maritime/transport.mjs#L777)
  rejects replies longer than 16,384 JavaScript characters and marks them
  ambiguous. Removing the team-message cap leaves this separate bound intact.
  Its occurrence in Games 21–23 is unproven.

**Smallest correction:**

- Handle completed-invalid discussion replies inside the original dispatch,
  before the generic catch turns post-start failures into ambiguity. Record a
  fixed failure code and completion evidence; do not retain rejected text.
- Re-ask at most once if action/phase time remains, keeping the lease and exact
  logical request envelope. Continue the same conversation for a format repair;
  use a fresh retry conversation after an oversized reply, with the original
  validated context and a bounded corrective instruction. Derive its ID from
  the original request ID plus a fixed retry suffix so it is stable across
  restarts; conversation identity does not make an uncertain chat replay safe.
  Do not copy rejected text into the retry prompt. This is the chosen retry
  policy, not a demonstrated
  cause of the recorded defaults.
- Accept and log a successful retry once. On retry exhaustion, sleep and confirm
  sleep after remote work has ended, then release quarantine and the lease.
  Retain the reservation if job completion or sleep remains unknown.
  A provider error or malformed outer envelope alone does not prove completion.
- In debug, a safely cleaned-up discussion failure must not block a safe commit.
  **Proof mode retains its acknowledged-discussion barrier**, as required by v2.
  Do not fabricate dialogue or accept a failed discussion as proof evidence.
- Allow verified public transaction references while retaining private-key,
  salt, bearer, and API-key rejection. Do not exempt every 64-hex string.
- Keep the finite reply resource bound; a completed oversized reply follows the
  retry/cleanup path rather than retaining capacity indefinitely.

**Verify:** Malformed JSON and oversized completed replies consume at most one
re-ask. Format repair retains conversation identity; oversize repair changes
conversation identity without changing the logical request/context, and derives
the same retry ID after restart without resending an uncertain call.
No retry repeats signing, wakes again, or publishes rejected text.
Five failed completed discussions followed by five healthy queued seats rotate
only after confirmed sleep. Debug commits remain eligible after safe cleanup;
proof still requires acknowledged discussions. Secret fixtures remain rejected.
Unknown chat completion, delayed wake, and ambiguous sleep retain quarantine.

## 11 — Accepted history exceeds the downstream input budget

**Impact and trigger:** Medium. Uncapped accepted text accumulates in a
twenty-message context window. A later gameplay request can exceed the player
CLI's 131,072-byte input limit before reaching execution.

**Evidence:** Confirmed by a schema-valid 170,721-byte request rejected with
PLAYER_INPUT_TOO_LARGE. See
[uncapped logs](integration/conference-runner/src/runner/index.mjs#L204),
[message-count validation](integration/maritime-transport/src/validation.mjs#L79),
and [CLI limit](integration/conference-runner/src/maritime/player-cli.mjs#L35).

**Smallest correction:** Select whole recent messages within the actual
serialized UTF-8 CLI input budget, reserving chain-state, envelope, and choice
overhead. Keep valid sequence metadata. Omit a message that cannot fit from
inference context without inventing a summary. Preserve complete accepted text
in durable logs and the existing Telegram delivery input.
If the required non-chat envelope alone exceeds the limit, return a fixed
input-budget failure before waking/signing. Do not truncate required identity
fields or restore an arbitrary dialogue cap.

**Verify:** Long Unicode, twenty individually valid messages, a large snapshot,
and one oversized message all produce schema-valid requests within the byte
limit, or a definite pre-dispatch budget failure. Original accepted text remains
available for delivery. A token estimate or JavaScript character count is not
a substitute for measuring serialized bytes.

## 07 — Queueing consumes the action allowance

**Impact and trigger:** High. All ten seats receive their action deadline at
enqueue, although only five can be awake. Second-wave seats lose execution time
while waiting. Final verification and sleep also share that action boundary.

**Evidence:** Confirmed in the
[runner's outer timer](integration/conference-runner/src/runner/index.mjs#L33),
[deadline creation](integration/conference-runner/src/runner/index.mjs#L385),
[transport boundary](integration/conference-runner/src/maritime/transport.mjs#L691),
and [sleep path](integration/conference-runner/src/maritime/transport.mjs#L640).

Game 22's nine queued expirations are consequences of #02, not isolated live
proof of this timing defect. Game 23's hs-2 round-four commit dispatch ran from
20:49:27.267 UTC to 20:52:26.497 UTC: 179.230 seconds, roughly one second short of
the 180-second local allowance. This is dispatch completion timing, **not**
a verified transaction landing one second before a contract deadline. Saved
records do not isolate its queue wait or establish timing as a default's cause.

Local adapter reproductions showed completed-work cleanup cut off twice: a
slow final verification prevented sleep; separately, verification and the sleep
POST succeeded but a delayed sleep-confirmation GET exceeded the action budget,
retaining quarantine although the synthetic agent was sleeping. Neither fixture
had an outstanding remote job. A live game is not required to establish this
deterministic failure.

**Smallest correction:**

- Start the 180-second allowance after acquiring capacity, when the admitted
  lifecycle/action begins. Change both the runner timer and transport deadline.
  Changing only one leaves the other cancellation path active.
- Bound queueing by the authoritative contract phase/cancellation and recheck
  phase before wake/signing. No new allowance permits signing after phase expiry.
- Give known-completed remote work a short separate cleanup deadline/signal,
  including the POST helper and subsequent sleep read. Do not reuse the captured
  aborted action signal. Completion must cover any started remote inspection
  job as well as chat. Unknown work remains reserved; the cleanup allowance
  does not bypass substantive identity, model, or route checks.

This is bounded cleanup needed by #02/#10, not a new cleanup scheduler.
Defer workload prediction, inspection caching, and lifecycle coalescing.

**Verify:** Exercise two waves through the real runner timer and transport:
long queue wait must not consume the admitted action allowance, while phase
expiry prevents stale wakes/signing. Completed work near the action deadline
still permits bounded confirmed sleep. Running/unknown jobs retain their slots;
maximum-five accounting stays intact.

## 10 — Lost chat replies bypass completed-action recovery

**Impact and trigger:** High. A player action succeeds, but chat returns HTTP
502 or times out. The existing recovery function is declared after the awaited
chat call, so a thrown transport error bypasses it and retains quarantine.
Canonical action reconciliation alone does not release that lifecycle state.

**Evidence:** Confirmed in
[chat and recovery](integration/conference-runner/src/maritime/transport.mjs#L753),
[quarantine-retaining errors](integration/conference-runner/src/maritime/transport.mjs#L827),
and [coordinator reconciliation](integration/conference-runner/src/runner/index.mjs#L277).
Game 23's hs-4 round-three reveal was recorded chain-confirmed with
MARITIME_HTTP_502; its next commit was blocked by quarantine, producing a
round-four default. The other two Game 23 defaults had transport timeouts;
their remote completion was not established by this evidence.

**Smallest correction:** Make the existing sanitized journal-result and
canonical receipt/event recovery reachable from chat transport exceptions,
as well as malformed successful replies. Verify exact chain, game, round,
wallet, and action; never rerun the signing command to repair a lost reply.
Record action success separately from remote job/lifecycle completion.
After the job ends, confirm a subsequent sleep before releasing quarantine.
A confirmed transaction or matching nonce does not prove that the remote job
has ended. If it remains running, keep its slot reserved and report that blocker.
Do not expose private journals/bundles.

**Verify:** A confirmed reveal followed by HTTP 502 or timeout is recognized
once with no second signing call. After separately confirmed job completion
and sleep, the next action is eligible. **If the agent's job is still running
when the next phase starts, even with a confirmed receipt, the seat remains
quarantined, counted toward capacity, and receives no further dispatch.**
Wrong identity, noncanonical receipts, delayed wake, and ambiguous sleep must
not release it. Preserve malformed-success recovery and secret filtering.

Removing model copying from every deterministic action, or redesigning
settlement recovery, remains deferred.

## 03 — Safe preparation/guard failure is recorded as submission uncertainty

**Impact and trigger:** High. A definite preparation error is cached forever.
The runtime writes submitting before its final guard, so a guard rejection
before the bridge runs can leave PLAYER_SUBMISSION_OUTCOME_UNKNOWN despite
zero signing calls.

**Evidence:** Locally reproduced in
[cached journal responses](integration/conference-runner/src/maritime/player-runtime.mjs#L360)
and the [submission boundary](integration/conference-runner/src/maritime/player-runtime.mjs#L411).
The follow-up also confirmed that a second adapter call returns its cached
failure for identical bytes, or MARITIME_REQUEST_ID_REUSED for a changed
snapshot under the same request ID:
[transport cache](integration/conference-runner/src/maritime/transport.mjs#L672),
[runner reconstruction](integration/conference-runner/src/runner/index.mjs#L351).

**Smallest correction — reporting only for this batch:** Record definite
preparation and pre-bridge guard failures as known unsent using fixed codes.
Preserve durable submission intent before invoking a bridge that could broadcast,
and preserve every genuinely uncertain record. This correction does not enable
automatic action retry through the runner or across restarts.

Defer cross-dispatch preparation recovery with #06, including its player-journal,
coordinator-state, and transport-cache constraints. A bounded retry inside one
active CLI invocation could avoid those caches, but is not required by this batch.
Atomic upstream bundle writing and earlier transaction-hash persistence also
remain deferred. Preserve the agent's choice, valid bundles, and private material.

**Verify:** A final guard failure before bridge invocation reports a definite
fixed unsent result with zero signing calls. Any bridge invocation with uncertain
outcome remains non-replayable across restart. Do not change cached-preparation
test expectations unless preparation retry behavior is actually implemented.

## 05 — Full delivered award text is not independently verified

**Impact and trigger:** High. The audit checks the result header and transaction
link, but can accept an incorrect award body with a recomputed digest.
It also does not independently establish complete payable claims and fresh
final account/game cleanup.

**Evidence:** A local ten-seat fixture with wrong award text and absent final
sleep evidence returned proof_complete true. See
[result validation](integration/conference-runner/src/proof-audit.mjs#L270)
and [claim validation](integration/conference-runner/src/proof-audit.mjs#L185).

**Smallest correction:** Either compare the complete delivered award body with
canonical historical awards in the existing audit, or record a manual comparison.
Check each seat's amount and totals. Prepare the comparison method before final
proof; compare that proof's actual delivered text after awards exist and before
acceptance. Record message identities and the outcome in STATUS.md.
Retain the existing proof-audit report and disclose the manual check's coverage.

Existing required payable claims, fresh active-game-zero/awake-zero reads,
canonical player receipts, zero defaults, and model-route requirements remain.
Defer broader discussion-to-log binding and independent settlement/cleanup
schema enforcement.

**Verify:** Wrong or omitted awards fail the selected full-body comparison.
For a code change, use a focused wrong-award fixture; for the manual option,
compare actual delivered text against chain-derived amounts.

## Deferred findings

These findings remain material; they are not prerequisites for this demo.
“Confirmed” describes the mechanism, not an unproven attribution to saved defaults.

| ID / severity | Trigger, impact, and evidence | Future correction and verification |
| --- | --- | --- |
| 01 / High | Different journal directories permit operator ownership for one wallet; concurrent stale player-lock recovery can unlink another owner. Both locally reproduced. [Operator lock](integration/conference-runner/src/chain/signer.mjs#L42), [player lock](integration/conference-runner/src/maritime/player-runtime.mjs#L107). | Bind ownership to chain/wallet, serialize stale recovery, and release only matching owner tokens. Race alternate directories and stale recoverers; exactly one owner survives. Maintain one signer per wallet now. |
| 04 / High | Proof dispatch/health/reporting errors abort sibling work; exit lacks integrated terminal cleanup and existing artifacts prevent resume. Confirmed code. [Proof stops](integration/conference-runner/src/proof-run.mjs#L272), [restart refusal](integration/conference-runner/src/proof-run.mjs#L95). | Separate failed proof evidence from safe recovery and add reconciled resume without another creation. Verify restart/Telegram failure paths. For this demo retain proof policy and existing authorized operator cleanup. |
| 06 / High | Same action ID with rebuilt snapshot/history fails digest checks; identical bytes reuse a failed promise; unsent owner expiry stays stale. Locally reproduced. [Transport](integration/conference-runner/src/maritime/transport.mjs#L672), [owner expiry](integration/conference-runner/src/chain/signer.mjs#L118). | Coordinate immutable attempt envelopes, bounded certified-unsent retries, and semantic deduplication across all caches/journals. Verify changed-block safe recovery and uncertain-operation non-replay. Includes cross-dispatch #03 recovery. |
| 08 / High | Full-snapshot discussion polling includes optional settlement reads; one read failure aborts discussions and redundant reads compete with signing. Code confirmed; saved-game throttling unproven. [Reader](integration/conference-runner/src/chain/reader.mjs#L52), [watcher](integration/conference-runner/src/runner/index.mjs#L512). | Use minimal phase reads and bounded transient recovery; fetch settlement data when needed. Inject optional-read failure and real chain mismatch; only the latter blocks unsafe submissions. |
| 09 / High | CLI/config evidence does not fully attest long-lived native-process credentials/routing. Gap confirmed; wrong model, metered use, or fallback unproven. [Inspection](integration/conference-runner/src/maritime/install-runtime.mjs#L450). | Verify sanitized effective routing per runtime generation; test conflicting native environment without exposing it. Keep current route checks and D3's configuration-level OpenClaw disclosure. |
| 12 / Medium | Pinned source installation uses npm install without the relevant immutable lock; installed dependency integrity is incompletely attested. Confirmed gap, live drift unproven. [Installer](integration/conference-runner/src/maritime/install-runtime.mjs#L501), [runtime check](integration/conference-runner/src/maritime/player-runtime.mjs#L321). | Pin minimal runtime resolution and attest versions/integrity. Repeat local installs and reject altered dependencies. Preserve existing checkouts/journals. |
| 13 / Medium | Equivalent Hermes quoting fails byte-equality certification; a fixed ten-minute readiness envelope rejects slow healthy preparation. Quoting reproduced; duration gate confirmed. [YAML check](integration/conference-runner/src/maritime/hermes-oauth.mjs#L147), [readiness](integration/conference-runner/src/maritime/readiness-run.mjs#L315). | Validate effective configuration and separate operation bounds from evidence freshness. Test equivalent YAML, wrong routes, and slow preparation without weakening model checks. |
| 14 / Medium | External awake occupancy clears but the blocked lease pump does not refresh inventory; queued work expires. Locally reproduced. [Lease pump](integration/conference-runner/src/maritime/transport.mjs#L204). | Refresh blocked external capacity with bounded backoff and cancellation. Verify external sleep frees work while quarantine remains reserved. Continue fresh account checks before wakes now. |
| 15 / Medium | Telegram publication input shares the latest-twenty context window and outbox draining follows ticks. Old accepted messages can miss enqueue; saved outboxes were delivered. [Publication](integration/conference-runner/src/runner/index.mjs#L217), [drain](integration/conference-runner/src/telegram/index.mjs#L249). | Read durable logs with independent delivery cursors and bounded draining. Test delayed publication beyond twenty messages and restart, retaining uncertain-send protection. #11 must not further trim delivery input. |
| 16 / Medium | Dormant per-call observers restrict refresh/lifecycle and OpenClaw buffers SSE before native execution. Code confirmed; not a cause while disabled. [OpenClaw](integration/conference-runner/src/maritime/openclaw-oauth.mjs#L358), [Hermes](integration/conference-runner/src/maritime/hermes-oauth.mjs#L470). | If selected later, preserve native streaming and verified OAuth refresh with scoped operation state. Test refresh/continuations/failed calls without replay. Leave disabled under D3 for this demo. |
| 17 / Medium | Funding floor covers an initial action sequence, not arbitrary full-game/cleanup runway; authorization counters are manual and manifest gas ceiling is not enforced. Gap confirmed; no cap violation established. [Funding](integration/conference-runner/src/player-funding.mjs#L1), [manifest](integration/conference-runner/src/maritime/player-runtime.mjs#L27). | Add conservative runway/reservation accounting in existing private state; test uncertainty, restart, and day rollover. Continue manual counters, balance checks, and existing cap/runway stop rules now. |

## Verification and implementation sequence

Run targeted tests per fix and update tests that encode the old behavior.

1. Implement the bounded batch, run its targeted checks, scan the complete staged
   diff with gitleaks, and commit. Follow AGENTS.md's existing full-suite integration
   checkpoint; deferred scenarios are not a test program for this batch.
2. Batch agent-side edits and reinstall all ten before another game. The pending
   protocol changes already require that reinstall.
3. Run debug attempts under D1. After each attempt, reach terminal and confirm
   fresh awake-zero/active-game-zero reads; record the attempt and counters.
   Preserve the two-consecutive-same-cause-after-fix stop rule and existing caps.
4. Run the full suite before final proof. Claim Game 20 awards only after a fresh
   read confirms no game is running; claims count toward authorized additional
   wakes. Refresh balances and live state before final configuration.
5. Prepare #05's full award comparison. Run the approved final proof and existing
   proof-audit, compare the actual delivered awards, and give the report to the
   user for review. Use D3's disclosure if OpenClaw provenance is configuration-level;
   defaults require the explicit degraded-demo label and never pass proof.
6. After the active fixes and demo are complete, archive this working file as
   housekeeping and retain outcomes in STATUS.md.
