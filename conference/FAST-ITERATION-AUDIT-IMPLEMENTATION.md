# Fast iteration plan — implementation audit

**Date:** October 5, 2026. **Reviewer:** independent implementation worker.

**Status: PASS — no remaining implementation blockers in the revised plan.** Reviewed [FAST-ITERATION-IMPLEMENTATION.md](FAST-ITERATION-IMPLEMENTATION.md), SHA-256 `e130c7d6091907aaac03ba27e4b18a0c56b34a1c1add972216596449169bdc10`. This is acceptance of the document, not implementation, live readiness or authorization. No source changes, tests, live calls, process changes or Git operations were performed for it. All existing edits, temporary scripts, failed scopes and private journals remain untouched.

The proposed direction is implementable with the current runner. Focused diagnostics, stable observer code and fewer repeated validations can remove substantial overhead. A `debug` flag by itself cannot provide that behavior: current proof execution and player permits require readiness-v2, and the existing CLI rejects the proposed arguments.

The final scope and ordering clarifications preserve the existing ten agents, five-awake account-wide maximum, Base Sepolia, no new funding/capacity/hosting, private material and player choices. They also separate useful local implementation from authorization for another signed attempt: relevant cleanup and reconciliation still precede that attempt.

## Corrections verified in the revised plan

1. **The proposed control branch and executor admission change are explicit.** The parser in [conference-control.mjs](../integration/conference-runner/src/conference-control.mjs) accepts only `plan`, `status`, `diagnose` and the five `proof-*` commands. It has no purpose, scope, seat or debug argument. [runControlledProof](../integration/conference-runner/src/proof-run.mjs) and [createGuardedLauncher](../integration/conference-runner/src/proof-control.mjs) always call `validatePreparedProof`. Revised section 3 labels the `attempt` parser branch and shared executor/admission seam as new implementation, retains proof entry points/defaults and requires debug admission instead of suppressing validation through a flag.

2. **Passive reporting is distinct from critical native enforcement.** Revised section 4 makes optional phases/counters/report delivery passive while keeping exact OAuth bearer selection, provider endpoint, requested and raw returned Sol/completion, authorized action identity, critical sources, no API fallback and durable physical-send no-replay fail-closed before signing tools. Missing required provenance still prevents proof certification. It does not propose removing all fetch interception or treating every receipt-format problem as an authentication failure. Configuration exclusions are limited to explicitly classified harmless metadata; unknown plugins and tool changes remain critical.

3. **Focused diagnostics retain durable zero-retry tracking.** `createMaritimeAdapter().diagnose` is the existing single-seat production `/chat` interface, but its request map is process-local and its default `diagnosticStageRetries` is 1. The canonical producer explicitly sets this to 0. Revised section 3 proposes optional seat/mode selectors, existing durable operation intents and `diagnosticStageRetries:0`; an unknown stage is not resent after restart. Its output is a debug diagnostic record, not a partial readiness-v2 certificate.

4. **Operator inspection is not presented as process startup.** `inspectProofOperator` verifies a caller-owned PID/lock; `createOperatorAdapters` connects to its HTTP API. Neither starts the operator. Revised section 3 initially retains the explicitly owned existing PID/URL and labels automatic process lifecycle management as a later adapter rather than a launch dependency. Its ownership capability remains private and in memory; the coordinator need not load signing keys.

## Verified reuse and concrete changes

| Area | Existing interface and behavior | Small implementation boundary |
|---|---|---|
| Local planning | `createReadinessRun().plan()/status()` and control `plan/status` construct no credential loader or network client. | Keep these cheap and read-only. A focused live diagnostic is a separate explicitly mutating command. |
| Focused diagnostic | `createMaritimeAdapter().diagnose({seat, request, deadline_at_ms, signal})`; `buildRuntimeDiagnosticArtifact`, prompt builder and diagnostic receipt validator already exist. | Expose one selected seat/mode through the maintained control module, using the producer's durable tracking, account-wide lease pool and cleanup. Avoid an all-ten certificate, operator, Telegram or signing setup for that diagnostic. |
| Proof validation | Read-only `validatePreparedProof` runs in control dispatch, `runControlledProof` and `createGuardedLauncher` construction. Each repeats chain/process/journal/nonces/readiness metadata checks. | Share a validated context within one invocation, bound to input identities/digests, ownership and deadline. Keep fresh mutable validation immediately before creation, fuse-before-submit and final unchanged-input checks. Do not describe the three metadata calls as three all-ten wake passes. |
| Continuity | `verifyReadinessCurrent` distinguishes read-only metadata validation from the all-ten wake/inspect/sleep pass; `createRuntimeContinuity` checks exact observed incarnation and deployed sources. | Make preparation local, version the changed preparation/audit record, and retain one fresh all-ten precreation pass plus per-seat action checks. Runtime repair belongs before capture/admission; a changed incarnation invalidates the old certificate. |
| Player permits | `execution-permit.mjs` requires producer-v2, complete diagnostics, readiness eligibility, observed continuity, exact artifact/wallet/action and current runtime/model checks. | Add the proposed distinct debug context/permit discriminator and shared action safeguards. Require bidirectional cross-purpose rejection; keep proof-v2 checks unchanged. Eligible claims need the same honest action-level admission, not fabricated all-ten readiness. |
| Native observer | OAuth helper builders produce inert staging/read commands. Native service performs admission and durable physical-send fusing; receipt reads are read-only. | Separate stable installed source from fresh scope/deadline metadata. Retain old source/hash history for preservation and current pins for execution. A receipt read does not authorize another inference or resolve an uncertain old request. |
| Final acceptance | Existing proof executor reports a candidate; independent chain/Telegram audit accepts the proof. | Debug outcomes remain `proof_complete:false`; changed proof record versions require consumer/audit updates and rejection of old or debug records. |

The proposed policy changes must update the canonical instructions before implementation uses them. In particular, one final precreation continuity pass and action-level claim admission change current documented requirements; they are planned replacements, not behavior currently implemented.

## Current failure evidence

The V7 failure review at `/private/tmp/conference-oauth-resume-20261004-b/oc-v7-failure-review.json` records ten verified Hermes diagnostic calls and five verified OC preparations/activations. OC1's actual `/chat` returned HTTP 200, followed by native receipt-reader exit 1 with no stdout. That rejection happened before the thin wrapper's receipt validation or activation/receipt join. Later fixed native observations reported one admitted OAuth/Sol request but `completed:false`, `returned_model_verified:false` and `blocked:true`. Those observations do not establish a successful returned model or explain the original refusal phase.

Real LF/CRLF fixtures refuted the suspected newline escaping cause. The prepared `refusal_phase` instrumentation is a diagnostic improvement with targeted fixture evidence; it is not a verified live fix. The next useful live step, only after a fresh authorization, is one distinct focused OC diagnostic that exposes the actual native rejection. Old unknown requests and blocked scopes remain nonreplayable. A new directory or ID alone is not reconciliation.

## Acceptance checks for the implementation

- The maintained command can run one selected seat/mode with at most one chat forward, legitimate same-turn tool continuations, durable intent before mutation, zero uncertain request replay, account-wide capacity accounting and bounded confirmed cleanup. It cannot sign or publish a final readiness certificate.
- Debug execution uses the existing gameplay engine and native player CLI with a distinct admission/permit type. Proof admission rejects debug context, and debug admission cannot consume expired or mismatched proof context.
- Wrong OAuth bearer/route, requested or returned model, incomplete response, changed runtime/source and unknown physical send block the affected signing action. Missing optional counters do not become an additional provider veto; missing proof provenance still refuses certification.
- An unchanged installed observer with a fresh scope/deadline requires no source upload. Upgrades preserve old receipts, consumed public IDs and uncertainty while checking fresh execution against current sources.
- Sharing read-only validation does not reuse a stale live chain/nonce/ownership snapshot at creation. The creation fuse remains exclusive and is never cleared or replayed after uncertainty.
- One final fresh 20/20 certificate, the unchanged 600-second lifetime, current M2/Game20 settlement, one immediate all-ten continuity pass, zero-default game, truthful Telegram/awards/cleanup and independent proof audit remain required for acceptance.

Relevant component checks and small shared-interface regressions govern each fix. A full affected suite belongs at the completed implementation checkpoint, not in each dispatch or documentation revision. No such checks were run by this audit.
