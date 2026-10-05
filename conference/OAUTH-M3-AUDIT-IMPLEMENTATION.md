# Implementation audit of the OAuth/M3 handoff checklist

**Auditor:** `/root/handoff_implementation_auditor` — independent documentation review, October 4, 2026.

**Review target:** [OAUTH-M3-IMPLEMENTATION-CHECKLIST.md](OAUTH-M3-IMPLEMENTATION-CHECKLIST.md).

**Boundary:** Repository and sanitized saved-report inspection only. No live account/agent/model/chain/Telegram calls, tests, Git mutations, credential/environment contents or raw provider/session logs. Only this audit document is written by this auditor. Findings concern the remaining implementation inside the same M1/M2/M3 scope.

## Repository findings that the guide must address

| Severity | Finding and evidence | Required checklist treatment |
|---|---|---|
| Blocker | Production diagnostics and gameplay still invoke Maritime `/chat`, in `src/maritime/transport.mjs` lines 718 and 895. `inspectModelRoute` checks configuration and the inspecting process environment only, and explicitly does not certify native inference. Historical standalone CLI calls therefore do not certify the gateway used by the runner. | Verify the current native gateway environment, selected OAuth store and an actual OAuth/Sol call through the existing non-signing `/chat` tool/stdin diagnostic before signing. Reuse supported reload/native mechanisms; fix only a demonstrated boundary. Do not build another execution framework merely to replace this path. |
| Blocker | The unexecuted old Game20 claims helper builds current artifacts and compares their hashes to the original, expired C readiness evidence before either `run` or `check`; OAuth source changes now make those hashes different. | Prepare and review a distinct fresh Game20 claim scope with current artifacts and fresh diagnostic evidence. Preserve original C evidence, request IDs, journals and fuses. Do not run the old helper unchanged or change historical hashes to make it pass. |
| Blocker | Latest runner log has 585 tests: 582 pass, three fail, zero cancellations/skips. The three failures are `listen EPERM` on `127.0.0.1` in existing `test/chain/deadline.test.mjs` tests at lines 232, 258 and 274. | Record a red full suite. Resolve the local socket permission environment, without weakening tests. Run the documented complete affected suite once after the final implementation fix and before its checkpoint. Reuse unchanged shared/site results; do not rerun tests for this documentation-only handoff. |
| High | Shared migration is already present in seven modified sources: recipes, installer, install-runtime, transport, readiness-run, execution-permit and readiness. Both OAuth helpers are included in installed public artifacts and the runtime source fingerprint. | Review and finish these uncommitted edits; do not instruct the next operator to recreate them. Public artifact refresh and corresponding fresh bindings remain necessary before migrated live diagnostics. |
| High | Nine native grants are installed, but only hs-1, hs-2 and oc-1 have historical OAuth/Sol transport observations. Hs-1 retains its original failed loop flag; oc-1-F retains failed marker/aggregate flags. Oc-5 was only started before the user stop; its later sleep was confirmed. | Keep stored credentials, historical compatibility calls, current gateway verification and M1 certification separate. Complete oc-5 without replaying the interrupted batch. Do not claim all ten native calls or full M1 passed. |
| High | The shared grant's saved expiry is October 14, 2026, 19:34:08 UTC, but independent native refresh stores do not establish safe concurrent token rotation. | Privately refresh grant-validity metadata before the bounded attempt and avoid concurrent refresh. Ask for a fresh browser approval only when a demonstrated native grant/sign-in requirement makes it necessary. Do not add ten mandatory logins, a credential broker or ongoing hosting. |
| Medium | Configured max output 2048 is not an observed wire cap. Hs-2's receipt explicitly records `wire_max_output_tokens_enforced:false`; oc-1-F records absent wire reasoning effort. | Describe configuration accurately. Use existing finite operation/phase/hard-stop boundaries; do not claim these historical calls enforced the configured token limit or oc-1-F sent low reasoning. |

## Minimum remaining sequence

- Preserve the stopped state and wait for a new instruction to resume live work. Earlier authorization supplies scope limits when resumed; this document does not resume operations.
- Inspect the working tree and finish the demonstrated migration/gateway gaps using the existing ten agents and native harnesses. Keep five-awake capacity account-wide, private signing state and no-replay safeguards.
- Complete the missing oc-5 import, then establish current OAuth/Sol native tool execution on the runner's actual `/chat` path with API-credit fallback absent.
- Resolve the claims helper's current-artifact binding gap, then use fresh claim readiness to pay Game20's ten native awards and independently reconcile receipts/events/nonces. Payouts do not turn Game20 into a successful proof.
- Finish operating-state reconciliation before producing the final M1 certificate. Run fresh 20/20 no-transaction diagnostics and both existing continuity gates inside the unchanged 600-second readiness lifetime.
- Run one fresh exclusive bounded 5v5 proof. Require ten initial joins/discussions/commits/reveals, every later eligible living seat's required actions, zero defaults, canonical awards, isolated Telegram results and verified pins. A separate independent chain/Telegram/scoreboard audit determines completion.
- Settle eligible new awards, reconcile pending/ambiguous outcomes without blind replay, stop signing/runner processes, confirm all ten asleep and refresh final idle/nonces/Telegram state. Preserve Game19's uncertain sends and Game20's original reveal uncertainty.

## Existing executable surfaces

- Documented runner test command: `npm test --prefix integration/conference-runner`.
- Existing control entrypoint: `integration/conference-runner/src/conference-control.mjs`, version 2.
- Existing commands: `plan`, `status`, `diagnose`, `proof-plan`, `proof-status`, `proof-prepare`, `proof-run`, `proof-audit`. Paths are absolute and diagnostic/proof operations use explicit deadlines. Local `plan`/`status` do not establish current live state; proof/readiness commands enforce their own reviewed input bindings.
- There is no generic claims command in that control CLI. The old private Game20 claims helper is an unexecuted migration template, not a ready-to-run current command.
- No new agent deployment, funding, model/harness replacement, continuous scheduling, hosting, UI or general hardening is required to complete this tranche.

## Checklist review

The first complete draft correctly records nine installed grants, three historical transport observations, the production gateway gap, the red current full suite, the immutable Game20 proof, the required M2-before-final-M1 ordering and one independently audited M3 attempt followed by cleanup. It keeps work stopped and does not add agents, spending, hosting or a new execution framework.

Two wording corrections were requested from the lead:

1. **High — make Game20 claim readiness explicit.** The original claim workflow requires both modes for all ten seats, 20/20 independent no-signing receipts. The draft says only “fresh claim readiness/permits”; state the existing full requirement for the new exclusive claim scope so the next operator cannot infer a shortcut before signing.
2. **Medium — identify the native import implementation accurately.** The code map labels the two repo OAuth modules “configuration/store integration,” but they provide configuration, status/metadata and login helpers rather than native grant-import functions. Label them accordingly and distinguish the existing private lead import helper from repository CLI commands.

**Initial verdict:** Suitable for handoff after these two clarifications. The listed execution blockers remain unfinished work; documentation acceptance does not certify OAuth/gameplay readiness, a green implementation suite or M3.

**Final recheck:** Both requested clarifications are resolved. The Game20 section now requires both native diagnostic modes for all ten seats, 20/20 independent no-signing CLI receipts in the distinct claim scope before binding permits. The code map now labels repository helpers configuration/login/status inspection and identifies the private importer as an inspect/rebind reference for one distinct oc-5 intent, without replaying the batch or adding an importer.

The current-status, next-session, canonical-checklist and run-status entry points now consistently link this guide, retain the same three milestones, state that live/implementation work is stopped, and describe earlier evidence as historical. Their latest summaries match the inspected nine-grant/three-transport-record state and 582/585 runner result.

**Final verdict: PASS for documentation handoff.** No unresolved checklist correction remains from this implementation audit. The operational blockers in the findings table remain open and are explicitly represented as unchecked work. This verdict does not certify a usable current grant, production gateway routing, fresh M1/M2, a passing full implementation suite or M3. No implementation tests or live operations were performed during this audit.
