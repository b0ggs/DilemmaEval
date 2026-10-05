# Implementation: remove ceremony from the conference debugging loop

**Date:** October 5, 2026. **Branch:** `codex/converge-demo-2026-09-25`.

**Purpose:** implement the user's direction to make small fixes, run bounded games, inspect failures and iterate. Full suites, repeated human reviews and final-proof certification must stop being prerequisites for every debugging attempt.

**Status:** implementation plan; code changes and live execution described below are not implemented or authorized by this documentation task. The previous live window expired at October 4, 11:42:54 p.m. EDT (`2026-10-05T03:42:54Z`). This document does not reopen it or permit additional games. Preserve all existing edits, untracked files, private journals, failed requests and consumed fuses.

The delivery target remains one independently accepted, zero-default 5v5 with the existing five OpenClaw and five Hermes agents on Base Sepolia, correct Telegram results, awards and cleanup. Debugging games are development attempts, never substitutes for that acceptance.

Every proposed debug or proof scope retains Base Sepolia (`84532`), the ten existing native agents and the account-wide five-awake maximum, including unrelated awake agents. It prohibits new agents, funding, paid capacity and hosting. Keep player keys, salts, choices, credentials and private journals out of public state, prompts and logs; the coordinator never invents player dialogue or choices.

## 1. What actually went wrong

The current launch path combines development checks, transaction safeguards and final certification. Temporary scripts add more artifact pins, repeated reviews, observer scopes and hard-coded deadline bindings around that path. A new session or small fix can therefore consume most of its window before any gameplay.

There is also a real unresolved runtime failure. In the recorded V7 attempt, all ten Hermes diagnostic calls passed and all five OpenClaw gateways passed activation checks. OC1's `/chat` returned HTTP 200, but its native receipt reader exited 1. A later fixed-field inspection found one matching provider request with approved OAuth admission and requested Sol, but no verified completion or returned model. The original observer was blocked. The other four OpenClaw responses were unknown after abort. No Game20 claim was sent.

The newline-parser hypothesis was independently refuted using real LF/CRLF SSE responses. Do not patch the decoder on that hypothesis. The prepared observer change records bounded failure phases without exposing bodies or credentials; it has targeted test evidence, not a demonstrated live fix. Use that information to find the actual rejected condition. Disabling the observer cannot establish actual OAuth/model provenance.

## 2. Replace these requirements

| Current ceremony | Required replacement |
|---|---|
| Full runner suite after small fixes | Run relevant component checks and a regression for the demonstrated failure. Run the full affected suite once at the completed implementation checkpoint; reuse unchanged package results. |
| Full test/source manifest checked before each live dispatch | Keep validation results in the development record. Live admission checks deployed execution sources and operational state; unrelated test-file changes do not block a game. |
| Separate reviewers for each wrapper, deadline and invocation | Review changed implementation at integration. Within an authorized scope, the lead runs attempts without per-invocation human approval. Keep the independent final proof audit. |
| New `/private/tmp` execution wrapper for each continuation | Maintain the operational entry point in `src/conference-control.mjs`. Pass scope/deadlines as data. Preserve old temporary files as historical evidence; stop using them as required dependencies. |
| Observer source regenerated for each deadline/run path | Install stable observer code when that code changes. Store operation identity, deadline and request journal separately; a new window must not itself change plugin source hashes. |
| Reconfigure/restart all gateways whenever a process is woken | Inspect the current native route/process. Reconfigure only an affected configuration and restart only when the native framework requires it. A changed incarnation requires fresh admission, not an automatic reinstall. |
| Hash every historical source/config against today's installation | Preserve old evidence against its recorded hashes. Check current critical source/config separately. A legitimate upgrade must not rewrite old evidence or require old code to equal new code. |
| Twenty diagnostics before claims and another twenty before launch | For debugging, check the affected seat/path. For claims, admit each freshly eligible player action. Run the complete 20/20 diagnostic certification once for the final proof. |
| Two complete all-ten wake/inspect/sleep continuity passes | For the final proof, prepare local inputs first and do one fresh all-ten continuity pass immediately before creation. Continue checking each executing seat at activation/action boundaries. |
| Audit the complete operator history and Telegram ledger on every launch | Reconcile history once, then validate its immutable anchored prefix and reconcile the new tail. Check current ownership, nonces and relevant room/pin/outbox state each attempt. Detect reorgs or changed history and reopen only the affected reconciliation. |
| Pay every historical award before any development game | Keep Game20 settlement before the final proof. A separately authorized debugging scope may launch despite a confirmed terminal historical unpaid award when balances, nonces and journals are safe; unpaid does not mean uncertain. |
| One creation fuse interpreted as one game for all development | Keep one immutable creation fuse per attempt. A future scope may authorize several distinct attempts with an explicit maximum and existing-balance spend bounds. Never clear or reuse a fuse. |
| Repeated arbitrary 12–30 minute invocation bounds | Use actual request/phase deadlines and the authorized cutoff. Size the scope and cleanup reserve from pinned contract timing; do not extend deadlines, reuse expired evidence or issue impossible late launches. |

## 3. Two execution purposes, one existing runner

Add an explicit `debug` versus `proof` purpose to the existing control entry point. These are **proposed interfaces**, not commands available today. Do not introduce a second game engine, scheduler, authentication harness or operator service.

`debug` runs the existing ten-seat gameplay, native player CLI, chain/operator adapters and Telegram mirror. It requires current authorization, identity/auth/model checks, transaction safeguards and cleanup. It does not require a full test suite, all 20 diagnostic chats, a preparation wake/sleep cycle or an independent proof audit before launching. Its report is explicitly `purpose: debug`, `proof_complete: false`; defaults and failures remain truthful development evidence.

`proof` runs the final acceptance path: Game20 paid/reconciled, one fresh all-ten 20/20 certificate, one immediate precreation continuity check, the game, correct Telegram/awards/cleanup, then an independent canonical proof audit. Keep the original maximum 600-second certificate age and current checks. Never relabel debug evidence as a passed proof or fabricate `diagnostics_complete`.

The intended operator flow is one maintained invocation for one attempt: load authorized scope → inspect current blockers → start the owned existing operator when needed → launch/play → reconcile outcome → cleanup → report the concrete next fix. It allocates a fresh private attempt directory automatically. Repeating it is allowed only while the explicit attempt budget and time/spend bounds remain, after the prior attempt is terminal and reconciled.

Implement a proposed `attempt` branch in `parseControlArguments` with explicit `--purpose`, `--scope`, `--config`, `--artifact-plan`, `--operations-manifest`, `--state-root`, `--operator-dir`, `--operator-pid`, `--operator-url`, `--scoreboard-bindings` and `--secrets-env` inputs. It derives deadlines from the authorized scope and creates the attempt directory under the private state root. These inputs are illustrative new CLI requirements, not an executable command today. The first version can use the explicitly owned operator already started through the existing chain CLI; this is one setup operation for a bounded session, not a new service. `inspectProofOperator` and `createOperatorAdapters` inspect/connect; they do not start an operator. Automatic start/stop therefore needs an explicit owned-process lifecycle adapter, and must not delay the first debug game if externally owned operation already works.

`runControlledProof` and `createGuardedLauncher` currently require proof readiness-v2. Introduce a small admission adapter shared by the existing execution loop and guarded launcher: the proof adapter retains their present strict validation; the debug adapter validates the distinct context described below. Keep existing proof exports/default behavior for compatibility. A purpose flag must not suppress validation inside an otherwise unchanged proof function. Reuse the runner and chain effects through this seam; do not fork their implementation. Within one invocation, pass an immutable validated local context instead of repeating the same read-only validation in `conference-control.mjs`, `runControlledProof` and `createGuardedLauncher`; current chain/nonce/runtime reads still happen immediately before the effect they authorize.

For focused diagnosis, extend the existing `diagnose` parser with proposed optional `--seat` and `--mode` selectors. That branch uses `createMaritimeAdapter().diagnose`, `diagnosticStageRetries: 0`, existing durable operation-intent journaling and native receipt readers. An unknown staging `/exec` is not resent, including after process restart. Its output is a debug diagnostic record, never a partial readiness-v2 certificate. The unchanged all-ten producer remains available for final certification.

## 4. Small shared interfaces

Define these interfaces before parallel changes; reuse existing validators and journals rather than creating a new framework.

- **Scope data:** private scope identity, `purpose`, Base Sepolia ID, pinned ten-agent roster, explicit maximum attempts, existing-balance spend/gas bounds, creation cutoff and execution/cleanup deadlines. Keep secrets outside this data. No defaults that silently grant more games or longer time.
- **Admission result:** current chain anchor, owner/operator identity, nonces, capacity, artifact/model/auth/process bindings, attempt identity and eligible actions. Keep final readiness-v2 evidence separate. Debug admission has an explicit distinct type/version and cannot claim a diagnostic certificate.
- **Outcome:** attempt/game identity, confirmed versus uncertain operations, first failure stage, terminal/default counts, awards, Telegram delivery status and cleanup. A debug outcome cannot set final-proof acceptance or increment the accepted-proof count.

Existing permits require a complete readiness-v2 context in `execution-permit.mjs`; adding a CLI flag alone cannot remove that requirement. Implement an explicitly distinct debug admission/permit discriminator. Share wallet, artifact, action identity, private-state, chain, expiry and nonce checks with existing permits, while keeping proof permits strict. Debug permits must reject stale/mixed runtime, changed sources, wrong auth/model and unauthorized actions. Cross-purpose rejection is an acceptance requirement.

The debug path still verifies the real production OAuth credential/route and requested/returned `gpt-6.1-sol`. Enforce those facts inside the native provider boundary before model-directed signing tools can execute; configuration-only checks are insufficient. Do not accept a permit merely because an outer `/chat` returned 200. If the existing native boundary cannot provide that guarantee, fix and verify it before a signed debug game.

Separate optional diagnostic telemetry from that critical boundary. Phase labels, counters and ancillary report delivery are passive; failure to write or read them must not independently brick an otherwise admitted native turn. Durable request admission/fuses, current critical-source checks, OAuth bearer/endpoint identity, requested/raw-returned Sol, response completion, authorized action identity and no-fallback/no-replay remain fail-closed. Their failure cannot be relabeled a telemetry warning. Missing required provenance still prevents final proof certification even when an independently enforced critical boundary permitted a debug action; it never manufactures a passed receipt.

Critical configuration includes provider/auth selection, fallback routes, loaded enforcement code, tool permissions, wallet/private CLI settings and gameplay instructions. Only explicitly classified harmless metadata, such as a diagnostic counter, may be excluded from operational fingerprints. An unknown plugin or tool/config change is not an “unrelated configuration change.”

## 5. Implementation order and ownership

The lead owns shared interfaces, integration and every external mutation. Workers use exact disjoint file allowlists and report only their changes, relevant checks and concrete blockers. Reuse existing agents; do not open additional lanes for every failure.

| Step | Existing files to change | Result and acceptance check |
|---|---|---|
| 1. Clarify the operational policy | Root `AGENTS.md`; `CURRENT-STATUS.md`, `NEXT-SESSION.md`, `TAKEOVER-IMPLEMENTATION-CHECKLIST.md`, `OAUTH-M3-IMPLEMENTATION-CHECKLIST.md` | Preserve the existing targeted-check/once-per-tranche policy; stop applying it as a full-suite rule for every fix. Amend actual conflicting launch requirements to distinguish debug admission from proof certification and remove invocation review as a launch prerequisite. Preserve history and the live authorization boundary. Documentation-only checks; no runtime suite. |
| 2. Expose and fix the current native failure | `src/maritime/openclaw-oauth.mjs`, its existing test, `src/maritime/transport.mjs` only if error propagation needs changing | Deploy the already prepared bounded failure-phase change only to affected installed public code within an authorized diagnostic scope. Reuse `createMaritimeAdapter().diagnose` for one fresh, distinct useful OC1 diagnostic and the existing native receipt reader. Fix the observed failing condition; do not change auth/model/fuse rules. Repeat focused checks and verify both affected native diagnostic shapes before broader gameplay. |
| 3. Stabilize observer installation | Existing OAuth helpers, `install.mjs`, `install-runtime.mjs`, `recipes.mjs` and relevant tests | Separate stable plugin code from scope metadata; refresh only changed artifacts/config. Preserve consumed public IDs and unknown operations across restarts. A new deadline with unchanged execution code causes zero public source rewrites; a new incarnation still requires current admission. |
| 4. Add honest debug admission | `readiness.mjs`, `maritime/readiness-run.mjs`, `maritime/continuity.mjs`, `maritime/execution-permit.mjs`, existing associated tests | Use affected-seat diagnostics while debugging and current per-seat activation/action checks for a ten-seat game. Add the distinct debug permit/context type. Proof v2 evidence remains unchanged and strict. An unknown auth/model result blocks signing; a valid debug permit is rejected by proof admission. |
| 5. Consolidate the attempt command | `conference-control.mjs`, `proof-control.mjs`, `proof-run.mjs`, `proof-live-preflight.mjs`; existing operator/runner interfaces | Add the proposed parser branch and shared admission adapter, retaining proof exports. Reuse gameplay, launch fuses, dispatch records and cleanup; eliminate repeated read-only proof validation within one invocation. Allocate the attempt directory; initially connect to the already owned operator. Add automatic owned start/stop only when needed. No temporary wrappers, full-test gate or manual reviewer token is required for debug admission. |
| 6. Remove redundant proof activation | `proof-control.mjs`, `maritime/readiness-run.mjs`, `proof-run-audit.mjs` and relevant tests | Preparation becomes local planning; one fresh all-ten continuity pass guards creation. Version any changed preparation/audit contract and preserve historical v1 evidence. Reject expired certificates, changed runtime/artifacts and debug records; validate proof freshness at original creation. |
| 7. Integrate settlement and reporting | Control entry point, existing player claim/permit path, `runner/`, `telegram/` only where a demonstrated integration change is needed | Settle each freshly eligible unpaid award without twenty unrelated diagnostic chats. Canonically reconcile amounts/receipts and never replay uncertainty. Debug messages identify the attempt and actual failures/defaults; accepted-proof accounting remains reserved for independent acceptance. |

Paths in steps 2–7 are relative to `integration/conference-runner/`. This is a finite migration of the existing conference path; continuous operation, UI expansion, hosting and general hardening remain deferred.

Do steps 1–2 first. The first useful live result is the exact OC1 failure condition and its verified fix, not another all-ten wrapper. Steps 3–5 produce the first admitted debug game. Independent local implementation may proceed while historical settlement is pending; another signed attempt still requires the relevant cleanup and reconciliation in section 7. Do not turn the affected fix into a broad refactor. Integrate steps 6–7 for final acceptance after the debug loop works.

## 6. Validation policy

During a fix, run the changed component and a meaningful regression for the observed failure. Add a small integration check when shared admission/permit/runner contracts change. A documentation change or deadline-only scope change requires no runtime suite. Native source/config changes require an affected live verification; coordinator-only changes do not automatically require reinstalling all agents.

Reuse results for unchanged source. Do not make unrelated test-file hashes a live authorization credential. Known relevant failures remain blockers; do not describe an old green suite as validation of newly changed code. Record exactly what was checked and what remains unvalidated.

Run the documented full affected suite once when the combined implementation is ready for its final checkpoint. Repeat it only for a relevant failure or material change after that checkpoint. Reuse unchanged shared/site results. There is no full-suite prerequisite before each authorized debug game or small live diagnostic.

For example, an OAuth observer fix uses its targeted test and the affected native production diagnostic; a CLI routing change uses control/admission integration checks; a Telegram formatting change uses Telegram component checks. Nothing automatically invokes `npm test` as part of game launch.

## 7. Operational checks that remain

Before a signed attempt, automatically check the authorized scope is current, roster/harness/wallet identities match, Base Sepolia and pinned contract rules are correct, the prior active game is terminal/reconciled, owner/player nonces and signing journals are resolved, existing balances cover entry/gas/cleanup, and the operator is exclusively owned. Count unrelated awake agents toward five. Per-seat activation and action checks enforce current runtime/source/model/auth bindings.

Use the existing isolated Telegram outbox and existing rooms/pins. Check their current identity and relevant uncertain records without rebuilding the entire historical ledger. Unknown creation, signing, model/lifecycle or Telegram requests are never retried blindly. Reconcile their exact journals/chain/process state; preserve the original uncertainty. A distinct request is permitted only after admission shows the old work cannot still mutate or conflict with it. Changing an ID or directory alone is not reconciliation.

At failure, stop new player work, report the first sanitized failure phase and classify whether it occurred before provider send, before signing, after submission or during delivery. Use existing bounded terminal cleanup/advancement and eligible claims. Confirm all ten sleeping, reconcile account-wide capacity, stop only owned processes and verify idle chain/nonces before another game. If cleanup cannot complete within its authorized bound, report that state and stop; a new attempt must not hide the active game.

Size the next authorized window once from actual pinned phase/round timing and cleanup needs. Deadlines are data, never source edits. Keep real request timeouts and an explicit cleanup reserve; remove invented minimum-duration checks that reject otherwise valid local invocation setup. No file creation, new session or later user status question silently extends authorization.

## 8. How to know the ceremony is removed

The implementation is ready for rapid iteration when these checks pass:

1. One small fix needs relevant checks and integration where affected; it does not trigger a full suite, all-ten reinstall or a new temporary execution wrapper.
2. One maintained debug command admits and runs an authorized ten-seat attempt without a human review between each phase. Actual OAuth/Sol and player signing safeguards still enforce every executing action.
3. A fresh deadline with unchanged installed execution code does not regenerate/deploy plugins. Incidental test-file or unrelated configuration changes do not falsely invalidate operational bindings.
4. An authorized scope allowing two attempts can run two distinct games sequentially, with two immutable creation fuses and complete cleanup between them. Ambiguous creation or dispatch is never repeated. This acceptance exercise is not live authorization for those games.
5. Debug games cannot produce proof acceptance, use expired proof evidence, misreport defaults/results or duplicate uncertain Telegram sends. Final proof requires current M1/M2 and independent canonical acceptance.
6. A failure report gives the first fixed failure stage and needed next action without exposing provider payloads, credentials or private choices. Time to launch, diagnostic chats, source uploads, gateway restarts and full-suite invocations are measured so the next session can identify delay rather than add another checklist.

## 9. Final delivery and handoff

After the runtime fix and simpler debug loop work, settle Game20, finish the combined implementation checkpoint once, run one fresh final M1 certificate and near-creation continuity pass, then the zero-default 5v5. Verify canonical terminal results/awards, correct Telegram delivery and pins, independent proof audit, native payouts and complete cleanup. Stop after that accepted proof.

Update the canonical current status with one factual next action, relevant validation and the first unresolved blocker. Keep historical entries below it rather than layering conflicting new “resumed” instructions. Preserve existing failed evidence and pending source edits, including the prepared failure-phase change; a documentation audit does not certify or deploy them.

## 10. Independent document audits

Two separate auditors review this plan: [implementation audit](FAST-ITERATION-AUDIT-IMPLEMENTATION.md) and [safety/scope audit](FAST-ITERATION-AUDIT-SAFETY.md). They must check the final revision, actual repository interfaces, removal of unnecessary gates, and preservation of real auth/transaction/evidence boundaries. Their acceptance is acceptance of this plan only, not live readiness or the completed demo.
