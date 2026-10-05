# OAuth and M3 implementation guide — execution checklist

**Resumed October 4, 22:42 EDT (October 5, 02:42 UTC):** The user explicitly said Continue after the proposed fresh 60-minute window. New bounded continuation `/private/tmp/conference-oauth-resume-20261004-b/window.json`: start02:42:54UTC, stop new games03:17:54UTC, hard stop03:42:54UTC, at most one new game. Existing ten agents/five-awake/Base Sepolia and no-new-funding/capacity/hosting limits remain. The previous window and all old observer deadlines, certificates, failed requests and fuses remain immutable/expired. Rebind the independently reviewed V6 correction to fresh observer operations/deadlines; verify actual20/20 production diagnostics, settle Game20, refreshM2/finalM1, then one independently audited zero-default5v5 with correct Telegram/cleanup. Final609-test repository source remains unchanged; do not rerun unchanged suites. Live completion is still pending.


**Current October 5, 01:58 UTC — live mutations stopped:** Final read-only reconciliation at `2026-10-05T01:56:16.466Z` confirms Base Sepolia active game zero, all ten agents sleeping/account awake zero, all eleven owner/player nonces clear, the operator stopped/no signer lock, all 67 canonical owner receipts, and existing Telegram rooms/pins/scoreboard reconciled. All ten Game20 awards remain unpaid. Final runner validation is 609/609 with all 94 source hashes unchanged. Hermes production OAuth/Sol is verified in both diagnostic modes on five seats; OpenClaw production `/chat` is unverified. Independently audited temporary V6 correction passed 16 tests but was not run: the claim start bound closed before execution; the separate no-signing diagnostic draft also missed its start bound. Both V6 execution roots and the new-game root remain absent. No payout/new game/new fuse/Telegram send occurred. M1/M2/M3 remain incomplete. The recorded window's hard stop is 02:00 UTC; further live work requires a distinct bounded continuation with fresh observer/deadline bindings and gates. Preserve every failed/unknown operation and expired artifact; never rerun the expired invocations.


**Current October 5, 01:40 UTC:** Final runner validation passed 609/609 on unchanged source hashes. All five Hermes seats passed both diagnostic modes with actual production `/chat` OAuth and requested/returned `gpt-6.1-sol` evidence. OpenClaw remains unverified: the latest distinct claim scope stopped before any OC `/chat` or claim; independent reproduction confirms its old-folder digest rejects preserved empty activation markers, and OC1/2 lost their selected observer during refresh. Original failures/unknown requests remain immutable. Separate read-only reconciliation at 01:38:44 confirms all ten sleeping/account awake zero. Game20 payouts and M1/M2/M3 remain incomplete. The 01:15 new-game cutoff has expired; no new game/fuse was created. Remaining verification/payout work is bounded by 02:00 UTC; no window extension is implied. See latest [RUN-STATUS](RUN-STATUS.md).


**Current 00:47UTC:** Production Hermes OAuth/Sol calls observed, with original failed/unknown chat outcomes preserved. Independently reviewed terminal-observer correction deployed on allten; public artifacts match manifest2c82cbea…, privatejournals unchanged, allsleep/account0. V3suite607/607green; V4suite runs on minimal correction. Fresh20/20 production diagnostics, Game20 payouts, finalM1/M2 and M3 remain required within unchanged01:15creation/02:00hardstop. See latest RUN-STATUS.


**Prepared:** October 4, 2026. **Branch:** `codex/converge-demo-2026-09-25`. **HEAD:** `b45d29e44bf3c7c2f7c7707a1e1315b6265aec9b`.

**Resumed October 4, 2026, 19:15 EDT:** The user's explicit resume supersedes the stopped instruction below. Bounded window: creation cutoff `2026-10-05T01:15:00Z`, hard stop `2026-10-05T02:00:00Z`, one new game maximum. Fresh account/chain/nonces observed23:17UTC. Oc-5's original stage was inspected23:19UTC (grant/directory absent); its distinct independently reviewed oc-5-only import completed23:22UTC, preserving private journals/unrelated profiles with confirmed sleep/account0. Existing historical calls still do not certify production `/chat`; Game20 awards and M3 remain incomplete.

**Work is stopped at the user's request.** The current request authorizes this guide and two repository audits only. It does not authorize restarting live work. After an explicit resume, use this checklist to finish the same three milestones in the [canonical checklist](TAKEOVER-IMPLEMENTATION-CHECKLIST.md); its acceptance requirements remain authoritative. Earlier entries in [current status](CURRENT-STATUS.md), [session handoff](NEXT-SESSION.md) and [run status](RUN-STATUS.md) remain historical evidence.

The target remains one independently audited five-OpenClaw versus five-Hermes game on Base Sepolia, with correct Telegram results and cleanup. M1/M2 passed historically; their evidence is expired. M3 has not passed. There is substantial live work left; the implementation is not at final cleanup.

## Recorded state — completed facts, not fresh execution gates

- [x] Preserve the existing ten agents, harnesses, wallets, private journals and signing/commit material. No replacement agents, new funding, paid capacity or hosting was added.
- [x] Prepare saved OAuth/Sol configuration on all ten existing agents and remove their saved Maritime proxy credentials/routes. This is configuration evidence, not proof of every running gateway's route.
- [x] Complete one user-approved native ChatGPT sign-in on hs-1; install that approved grant into nine native credential stores while preserving unrelated profiles and private journal digests.
- [x] Record historical native OAuth/Sol transport evidence for hs-1, hs-2 and oc-1. Only hs-2's probe passed its aggregate success check. hs-1 needed separate source-bound reconciliation; oc-1 F still has its original failed marker and false overall verification flags. None completes M1 or gameplay.
- [x] Record the final stop observation at `2026-10-04T21:49:38.504Z`: all ten agents asleep, account-wide awake count zero. This observation is historical.
- [x] Preserve Game20's failed proof and consumed fuse. Its terminal cleanup had 30 defaults; it cannot satisfy M3. Ten awards were still unpaid at the last chain observation.
- [x] Prepare shared local OAuth/Sol source and test edits. They remain uncommitted and have not been verified as deployed public artifacts on all ten seats.
- [x] Finish the latest runner suite: 585 tests, 582 passed, three failed with local `listen EPERM` errors; zero cancellations/skips. The suite is not green.

| Existing seats | Saved configuration | Approved native grant installed | Historical actual-call evidence | Remaining |
|---|---|---|---|---|
| hs-1 | OAuth/Sol prepared | Yes | One OAuth/Sol call; reconciled separately, original probe failed | Production `/chat` route and fresh diagnostics |
| hs-2 | OAuth/Sol prepared | Yes | One OAuth/Sol call; probe passed | Production `/chat` route and fresh diagnostics |
| hs-3, hs-4, hs-5 | OAuth/Sol prepared | Yes | None | Production route and fresh diagnostics |
| oc-1 | OAuth/Sol prepared | Yes | F: one OAuth/Sol call, HTTP 200/completed; marker failed | Production gateway route and fresh diagnostics |
| oc-2, oc-3, oc-4 | OAuth/Sol prepared | Yes | None | Production gateway route and fresh diagnostics |
| oc-5 | OAuth/Sol prepared | **Unconfirmed; import stopped after start** | None | Observe original stage, finish missing grant, production route/diagnostics |

The last chain observation was `2026-10-04T18:03:11Z`: chain 84532, block 47684349, active game zero, Game20 terminal, ten awards of `98010000000000` wei each unpaid, and all eleven owner/player latest/pending nonces equal. The owner was stopped. The last Telegram reconciliation was at 18:15 UTC. Neither snapshot may authorize a new transaction.

## Resume and preservation gate

- [x] Obtain the user's explicit resume before any activation, remote configuration, model call, signature, claim, game or Telegram mutation. Reuse the existing OAuth/Sol authorization and scope after resume; do not request it again.
- [x] Define one bounded execution window, stop-new-games cutoff, hard stop, one-game limit and existing usage bounds before live work. One lead owns every external mutation.
- [x] Inspect the branch, HEAD and working tree; preserve every edit/untracked file, ignored `HANDOFF.md`, private journal, original receipt and consumed fuse. Do not reset, clean, stash, switch branches or rewrite failed evidence.
- [x] Confirm local importer, runner, signer and operator process ownership before restarting anything. The stop report's `import_processes_stopped:0` does **not** certify importer cleanup; a later exact-process SIGTERM command returned successfully, but resumed work still needs a current process check.
- [x] Refresh the existing Maritime account inventory and chain state. Count unrelated awake agents toward the five-awake maximum; confirm the ten original IDs and wallets. Sleep must be confirmed by response/readback.
- [x] Inspect the original oc-5 stage in the interrupted `_b` import report and native store metadata privately. Reconcile the already-issued start; do not rerun the four-seat batch or infer that the grant was installed.
- [x] Keep uncertain requests nonreplayable. Preserve oc-1 A's unknown physical outcome, the original failed probes, prior ambiguous setup requests and expired device flows. Any further operation requires a distinct bounded intent after inspection.

## M1 — finish the existing OAuth/Sol preparation

- [x] Privately confirm the approved grant's current usability and expiry before reuse. Recorded access expiry was `2026-10-14T19:34:08Z`; metadata alone does not prove continuing validity. Never print/copy credentials into the guide, Git, prompts, public state or logs.
- [x] Finish only oc-5's missing native import after reconciliation. Inspect the existing private importer source `/private/tmp/conference-native-oauth-import-20261004-b.mjs` and its current bindings; derive a distinct bounded oc-5-only operation using that native-store integration. This source pointer is not a command to replay the interrupted batch. The nine completed imports are not new work; do not add a new importer.
- [x] Preserve the native harnesses: Hermes `openai-codex`/`codex_responses`, default profile and existing seat-specific runtime patches; OpenClaw's native `openai-chatgpt-responses` provider and dedicated conference OAuth profile. Do not replace them with a Codex harness or recreate agents.
- [x] Reuse the single approved grant only through the existing native integrations while it is usable. Copied stores do not make concurrent refresh-token rotation safe. Stop and resolve an actual refresh requirement before conflicting refreshes; do not build a broker or add hosting. Ask the user for browser/device approval only if a genuinely new sign-in is required; the lead performs terminal work.
- [x] Review the existing seven shared source edits and two OAuth helpers listed below. Confirm exact `gpt-6.1-sol`, OAuth-only selection, no API-credit/proxy fallback, and unchanged private/player safety gates. Do not rebuild these helpers.
- [x] Build/hash the current public artifact plan and review the minimal deployment change for the existing seats. Preserve wallet/env fields, private state and unrelated auth profiles. Verify the deployed artifacts before certification.
- [ ] Refresh each production process using the existing preparation path. Maritime `reload-env` can reload or restart; its ordinary success response is not proof of the running gateway's auth/model snapshot. Inspect actual process/environment and native config privately; use existing native OpenClaw `secrets reload --json` if its surviving gateway needs the supported snapshot refresh.
- [ ] Establish actual OAuth and requested/returned Sol provenance on the production `/chat` path used by diagnostics/gameplay. Native CLI probes and `inspectModelRoute` configuration/environment checks alone cannot clear this gate. Reuse the existing diagnostic and supported observation paths; bind evidence to the actual call and prohibit API-credit fallback/replay.
- [ ] Collect missing call evidence as part of useful existing diagnostics where possible. Do not require seven extra generic probes before the canonical twenty diagnostics or create another execution framework.
- [ ] Record configured low reasoning and 2048-token policy accurately. Existing probes do not prove a 2048 wire cap, and oc-1 F omitted wire reasoning effort. Keep the existing finite operation/phase deadlines as actual execution bounds; do not claim enforcement absent from evidence.

**Implementation validation checkpoint, after resume:**

- [x] Review the affected source/tests and perform a secret scan of the intended review set, excluding private runtime/credential/session files.
- [x] Recheck the three existing loopback tests in `test/chain/deadline.test.mjs` at lines 232, 258 and 274 in an environment permitting loopback listeners. Preserve the failed full-suite log; do not change correct assertions merely to mask permissions.
- [x] Run targeted tests for any new demonstrated fix, then the documented full affected suite before its implementation checkpoint. Follow the canonical full-suite requirement; reuse unchanged shared/site results where permitted. Do not rerun suites for this documentation handoff.

## M2 — settle Game20 and reconcile current operation

- [ ] Refresh Game20 eligibility, canonical receipts/events, each award and claimed amount, owner/player latest/pending nonces, player journals and existing gas balances. Reconcile any uncertain signing from existing journals/chain; never repeat it blindly. No new funding.
- [ ] Prepare a new exclusive Game20 claim scope with current OAuth/Sol artifacts. Pass both native diagnostic modes for all ten seats (**20/20**) with independent no-signing CLI receipts in this distinct claim scope, then bind fresh claim permits and runtime continuity checks to it. Keep original proof C and its expired evidence/fuse immutable; final new-game certification still follows payouts/M2 below.
- [ ] Do not run the old October 2 claims helper unchanged: it rebuilds current artifacts and compares them to C's pre-migration hashes, so it rejects artifact drift before execution. Reuse the current native player `claim` path and existing safety helpers with new bindings; there is no standalone `conference-control` claim subcommand.
- [ ] Have an independent reviewer inspect the exact claim scope, artifact/permit bindings, eligibility, deadlines, nonce/journal handling and cleanup before signing.
- [ ] Execute bounded native claims only for awards freshly confirmed unpaid and eligible. Verify canonical receipts/events and final claimed amounts for all ten; reconcile interrupted/uncertain requests without replay. Confirm sleep/account capacity after each batch.
- [ ] Reconcile the preserved operator journal against canonical chain receipts. Its last observation contained 67 records; do not rebuild/reset it or assume the count is unchanged.
- [ ] Reconcile the existing team rooms, pinned messages, isolated outbox and scoreboard bindings. Keep Game19's two uncertain Telegram sends immutable; do not resend them or retroactively claim its outbox is green.
- [ ] Confirm idle chain, no pending owner/player nonce, correct contract/admission/default configuration, existing funds, no unresolved signer lock and exactly one intended operator. Preserve current rules; no contract reconfiguration to fit stale documents.

## M1 — final fresh certification, after M2

- [ ] Finish route/artifact preparation and M2 before starting the final certificate's unchanged 600-second lifetime. Do not extend the lifetime or reuse the October 2 certificate.
- [ ] Run both native diagnostic modes for all ten seats in one fresh bounded run: **20/20**, exact production chat→tool→stdin path, independent sanitized CLI receipts, no transaction/signature/claim/commit bundle and confirmed cleanup.
- [ ] Bind the certificate to the current config/roster/source/artifact/transport/model/chain digests and observed runtime continuity. Preserve the distinction between observed continuity and provider generation attestation; do not invent the latter.
- [ ] Verify actual native OAuth/Sol evidence for all ten production routes, no API-credit fallback, preserved journals and zero unresolved lifecycle/exec/model operations. An unknown request blocks certification.
- [ ] Independently review the fresh certificate, capacity, chain, owner, Telegram/scoreboard bindings, deadlines, cleanup and one-game fuse inputs.
- [ ] Run the existing preparation continuity check and final all-ten precreation continuity check against the unchanged fresh digest, within 600 seconds and the execution window. Refresh M2 chain/nonces/ownership immediately before creation.

## M3 — one bounded independently audited proof

- [ ] Allocate one new exclusive proof directory/run identity and one creation fuse; preserve all old scopes. Start only the intended existing owner/operator after the preceding gates pass.
- [ ] Use existing `proof-run` with explicit absolute paths, UTC cutoffs and existing scoreboard bindings. Create at most one game on Base Sepolia; never replay an uncertain creation.
- [ ] Verify the initial ten joins, both teams' native discussions, discussion barrier, ten commits and ten reveals. For later rounds require every eligible living seat's actions; eliminated seats do not receive inappropriate later actions. The coordinator does not invent choices or dialogue.
- [ ] Require **zero defaults across every round**. Preserve separate player signing and original private commit/reveal bundles; do not reconstruct choices, replay uncertain requests or launch another game after failure.
- [ ] Verify terminal chain outcome, results and awards; publish correct Dealer results to the existing team rooms through the existing isolated outbox, with correct pins and scoreboard accounting. Reconcile uncertain sends without duplicate delivery.
- [ ] Run a separate independent `proof-audit` over canonical chain receipts/events and Telegram/scoreboard/pin evidence. `candidate_proof_complete` alone is insufficient. Only this independent acceptance completes the proof.
- [ ] Complete this game's eligible native claims with fresh permits and canonical receipt/amount reconciliation; preserve every operation journal.
- [ ] Complete cleanup: all ten asleep, account-wide capacity reconciled, operator stopped, no unresolved local signer/model/lifecycle work, idle chain and no pending owner/player nonce. Record final sanitized evidence and M1/M2/M3 status.
- [ ] Stop after the accepted proof and cleanup. Continuous operation, new agents, funding, paid capacity, hosting, UI expansion and general hardening remain deferred.

## Existing code and command map

| Purpose | Reuse |
|---|---|
| Native auth configuration/login/status inspection | `src/maritime/hermes-oauth.mjs`, `openclaw-oauth.mjs`; these are not grant importers |
| Approved-grant native store import | Existing private `/private/tmp/conference-native-oauth-import-20261004-b.mjs` source and sanitized interrupted report; inspect/rebind for oc-5 only, never replay the batch |
| Seven shared OAuth/Sol edits | `src/maritime/{recipes,install-runtime,install,readiness-run,execution-permit,transport}.mjs`, `src/readiness.mjs` |
| Production diagnostic/gameplay dispatch | `src/maritime/transport.mjs` — existing `/chat` calls; route inspection is not inference evidence |
| Player claim/signing and receipts | Existing Maritime player runtime and execution-permit path |
| Control and independent audit | `src/conference-control.mjs` |

Paths above are relative to `integration/conference-runner/`. Legacy `launch-workflow.mjs` still contains the old mini profile; do not run legacy provisioning/launch paths. CLI availability is not permission to execute during the stop.

Supported integration references: [Maritime ChatGPT sign-in](https://maritime.sh/docs/frameworks/codex), [native OpenClaw](https://maritime.sh/docs/frameworks/openclaw), [native Hermes](https://maritime.sh/docs/frameworks/hermes), and [model IDs](https://learn.chatgpt.com/docs/models). Apply each harness's native integration; the Codex sign-in guide does not require replacing the ten existing harnesses.

| Existing command | Use after resume |
|---|---|
| `plan`, `status` | Local plan/status with config, runtime directory, artifact plan and operations manifest |
| `diagnose` | Same inputs plus absolute diagnostic/cleanup deadlines and private secrets-file reference; no signing |
| `proof-plan`, `proof-status`, `proof-prepare` | Fresh evidence/readiness/proof/operator/runner paths, UTC cutoffs, artifacts/manifest and verification root; preparation never signs |
| `proof-run` | Same proof inputs plus owned operator PID/loopback URL and scoreboard bindings; one creation fuse |
| `proof-audit` | Separate proof directory/game ID/bindings, private secrets-file reference and a new audit output |

Generate the exact reviewable absolute-path invocation from the existing CLI help and current bindings before each live step. Do not copy an expired historical command or make up a claim command.

## Evidence and independent review

These private local files contain sanitized reports, not grants. Retain them in place; do not attach raw sessions, credentials or provider payloads.

| Evidence | Location / meaning |
|---|---|
| Stop observation | `/private/tmp/conference-user-requested-stop-20261004.json` — asleep/account zero; importer cleanup caveat above |
| Completed grant imports | `/private/tmp/conference-native-oauth-import-hs-2-oc-1-20261004/report.json`; `/private/tmp/conference-native-oauth-import-hs-3-hs-4-hs-5-20261004/report.json` |
| Last interrupted import | `/private/tmp/conference-native-oauth-import-oc-2-oc-3-oc-4-oc-5-20261004-b/report.json` — oc-2–4 verified; oc-5 start only; no finished-run claim |
| Historical transport | hs-1 source reconciliation, hs-2 probe A, oc-1 probe F sanitized reports under their existing `/private/tmp/conference-*20261004*` directories; original failures retained |
| Latest runner suite | `/private/tmp/conference-oauth-runner-suite-20261004.log` — 582/585, three loopback permission failures |
| Original failed proofs/state | Existing October 2 files in `conference/evidence/` and preserved private proof/operator/scoreboard journals |

- [x] State/preservation auditor passed [OAUTH-M3-AUDIT-STATE.md](OAUTH-M3-AUDIT-STATE.md) against the guide and repository evidence.
- [x] Implementation auditor passed [OAUTH-M3-AUDIT-IMPLEMENTATION.md](OAUTH-M3-AUDIT-IMPLEMENTATION.md) against existing tooling, milestone acceptance and remaining blockers.
- [x] Lead incorporated both reviews; auditors verified the material corrections and four canonical stopped-state pointers. These passes accept the documentation, not implementation or live readiness. Documentation validation does not reopen live work or rerun implementation suites.
