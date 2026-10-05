# OAuth/M3 checklist audit — state and operating boundaries

**Reviewer:** independent sub-auditor `/root/handoff_state_auditor`, October 4, 2026.  
**Scope:** documentation and local read-only evidence review. No account, agent, model, chain or Telegram requests; no credentials, raw sessions or provider payloads read; no tests or Git mutations.

**Disposition:** PASS for state, preservation and operating boundaries; the minor handoff correction below is resolved. This audit authorizes no implementation or live work.

## Evidence checked

- [AGENTS.md](../AGENTS.md), the existing canonical status, handoff and three-milestone checklist, plus current Git status and affected model/configuration code.
- Sanitized stop record `/private/tmp/conference-user-requested-stop-20261004.json`: stop at `2026-10-04T21:49:38.504Z`, account awake zero, OC5 last importer operation `start-oc-5` confirmed. Its `import_processes_stopped:0` does not prove process cleanup; the lead reports a separate exact-command SIGTERM after the matcher failed. Recheck process absence locally before any later live session.
- Sanitized native import reports: HS2/OC1 at 20:48 UTC, HS3–5 at 20:53 UTC, and OC2–4 in the interrupted 21:46 UTC batch. With HS1's native sign-in, nine stored grants are verified. OC5 import is unverified. Journal preservation flags are positive for completed imports.
- HS2's 20:50 UTC native probe passed its one-call checks. HS1's original aggregate failure is preserved while its immutable transport facts have an independently reviewed derivative. OC1 probe F at 21:33 UTC has one physical request, native OAuth bearer, exact requested and returned Sol model, HTTP 200 and completed raw response, but retains failed aggregate flags because its marker check failed. These are three seats with historical native transport evidence, not all-ten readiness.
- `/private/tmp/conference-oauth-native-review-20261004.md` preserves the OC1 probe A instrumentation gap: its zero recorded sends do not establish zero physical sends. No replay is justified. Original unknown/failed probes and imports remain immutable.
- Sanitized source-grant report gives access-token expiry `2026-10-14T19:34:08.000Z`. Copied refresh tokens across independent native stores have an unresolved rotation/concurrency limitation; one successful import or bounded call is not a supported continuous multi-client refresh guarantee.
- Current runner test log `/private/tmp/conference-oauth-runner-suite-20261004.log`: 585 tests, 582 passed, three failed, no cancellations. All three failures are `listen EPERM` for loopback fixtures in `test/chain/deadline.test.mjs`. This is not a green full-suite result or evidence of a production defect. Preserve it and validate in an environment with permitted local sockets when implementation resumes.
- Current working tree contains shared OAuth model/configuration edits and untracked native helpers; it is later than the 20:29 UTC status prose. `launch-workflow.mjs` still contains mini environment/profile bindings. Current installed production OAuth/Sol execution and tool/stdin provenance remain unproved.
- The nine original October 2 evidence files and `HANDOFF.md` match the original SHA manifest. The four canonical documents changed additively; their whole-file hashes are not expected to match that manifest.

## Required checklist distinctions

- [x] The user's stop remains effective. Writing/auditing the handoff is the current authorized work; a new guide does not resume live implementation.
- [x] Label every state and probe as historical; refresh agents, chain, nonces, operator ownership and Telegram before later live actions. Preserve M1/M2 historical passes while explicitly rejecting their expired certificates for new execution.
- [x] Separate configured model, stored grant, observed native transport, native gameplay/tool readiness, payout completion and independently accepted M3 proof.
- [x] Finish fresh Game20 native payouts and operating reconciliation before the final M1 certificate, then perform 20/20 exact-path diagnostics and both continuity gates within the unchanged ten-minute lifetime.
- [x] Bind actual OAuth/Sol calls with API-credit fallback disabled; configuration/status fields alone are insufficient. Do not claim the configured 2048 limit is a wire-enforced token cap, or OC1 F sent low reasoning: its receipt says low effort absent.
- [x] Keep five-awake account-wide capacity, existing IDs/harnesses/wallets/private state, one designated operator, finite deadlines, one fresh game scope, immutable old requests/fuses and no new spending/hosting/agents.
- [x] No new helper framework, broker, harness replacement or broader hardening. Fix only demonstrated migration blockers inside the same M1/M2/M3 acceptance requirements.
- [x] M3 requires zero defaults, independent chain and Telegram acceptance, canonical native awards, correct room results/pins, and cleanup. Game20's thirty defaults cannot be relabeled into a passing proof.

## Draft findings

Reviewed the complete first draft of [OAUTH-M3-IMPLEMENTATION-CHECKLIST.md](OAUTH-M3-IMPLEMENTATION-CHECKLIST.md).

No P0/P1 findings. The guide correctly keeps work stopped, states nine imports versus three historical transport seats, preserves the HS1/OC1 aggregate failures, calls out OC1 A's unknown physical outcome and OC5's incomplete stage, rejects expired readiness, describes the importer-cleanup caveat, and reports the red runner suite accurately. It keeps the existing milestone order and scope and avoids a new helper framework or seven redundant generic probes.

**P2 — distinguish native-store import source from repository config helpers.** The existing code map labels `src/maritime/{hermes,openclaw}-oauth.mjs` as configuration/store integration. Those exports cover configuration, login and status inspection; they do not implement the copied-grant native-store import. The OC5 checklist step references an existing helper without identifying it. A successor could unnecessarily rebuild an importer or run the wrong helper.

**Minimal correction:** label the repository helpers configuration/login/inspection; identify `/private/tmp/conference-native-oauth-import-20261004-b.mjs` as the private native-store importer source to inspect and reuse. State that the interrupted four-seat invocation is not replayable and that any permitted OC5 continuation needs an inspected, distinct OC5-only operation. Do not create another importer or copy credentials into repository documentation.

**Correction recheck:** PASS. The guide now identifies the private importer source as an inspect/rebind reference, labels repository helpers as configuration/login/status inspection, and requires a distinct OC5-only continuation after reconciliation without replay or a new importer. Its fresh Game20 claim scope explicitly requires both native diagnostic modes for all ten seats with independent no-signing receipts; this preserves existing claim readiness requirements and leaves final new-game certification after M2.

Also reviewed the new stopped-state pointers at the top of `CURRENT-STATUS.md`, `NEXT-SESSION.md`, `TAKEOVER-IMPLEMENTATION-CHECKLIST.md` and `RUN-STATUS.md`. They consistently retain the user's stop, current nine-grant/three-transport distinction, original aggregate failures and uncertainty, incomplete Game20/M3, red runner suite and historical snapshots. The older entries remain historical, not executable permissions. No material contradiction found.

**Final verdict:** PASS. The corrected checklist is usable and factually aligned with the checked evidence, with no unresolved state/preservation findings. No live work or implementation tests were resumed for this review.
