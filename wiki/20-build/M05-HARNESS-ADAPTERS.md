# M05 — OpenClaw and Hermes adapters

- **Status:** Not started
- **Purpose:** Install the same game kit in both harnesses while preserving the proven direct OpenAI parity path.
- **Accountable owner:** Adapter integration lead — unassigned
- **Evidence reviewer:** Fairness reviewer — unassigned
- **Classification:** LOCKED build scope / FAIRNESS CONTROL
- **Navigation:** Previous: [M04](M04-AGENT-GAME-KIT.md) · [Wiki home](../README.md) · [MASTER](../MASTER-IMPLEMENTATION-GUIDE.md) · Next: [M06](M06-MARITIME-FLEET.md)

## Read first

- [ ] [S01](../10-first-hour-spikes/S01-MODEL-PARITY.md) parity handoff and frozen [M01](../00-start-here/M01-RUN-CONFIGURATION.md) `CFG-MODEL*` rows.
- [ ] [M04](M04-AGENT-GAME-KIT.md) artifact/capability handoff and [M03](../00-start-here/M03-SECURITY-AND-SECRETS.md) secret boundary.
- [ ] Current OpenClaw, Hermes, and Maritime configuration sources/interfaces.
- [ ] Replacement [§7 fairness rules](../../prisoners-daolemma-discord-replacement.md#7-fairness-rules).

## Inputs and prerequisites

| Input | Classification | Requirement | Source/freshness |
|---|---|---|---|
| Game kit | LOCKED shared surface | Same accepted revision/digest in both harnesses | Verify at adapter build |
| OpenAI route | LOCKED / LIVE-VERIFY | Same direct route, model, and settings | Recheck effective runtime config |
| Harness contributors | Implementation responsibility | One named OpenClaw adapter contributor and one named Hermes adapter contributor work under the accountable lead | Confirm assignments before adapter work |
| Prompts/tools | Fairness control | Same tournament prompt and game capability semantics | Digest/freeze for run |
| Communication protocol | LOCKED fairness control | Same poke fields, response schema, opportunities, limits, timeouts, retries, and ordering; harness-specific glue only | Compare effective runtime behavior |
| Harness glue | Minimal implementation | Only enough difference to install/operate the same kit | Review divergence |

## Execution checklist

- [ ] `M05-00` Assign one OpenClaw adapter contributor and one Hermes adapter contributor under the single accountable integration lead.
- [ ] `M05-01` Install/reference the accepted M04 kit revision in the OpenClaw adapter.
- [ ] `M05-02` Install/reference the same kit revision in the Hermes adapter.
- [ ] `M05-03` Configure each to the S01-proven direct OpenAI route, exact model, and settings using secret references only.
- [ ] `M05-04` Compare effective prompts, tools, settings, retry/timeout behavior, poke fields, chat snapshots, response schemas, communication opportunities, and ordering.
- [ ] `M05-05` Document every unavoidable harness-specific difference and its fairness impact.
- [ ] `M05-06` Run equivalent non-secret smoke tests and rerun S01 if any parity-sensitive field changed.
- [ ] `M05-07` Run paired fixtures proving each adapter receives the same bounded own-team snapshot and can return the same optional `team_message` envelope.

## Acceptance and evidence

| Checklist | Objective pass condition | Evidence |
|---|---|---|
| M05-00 | Two harness-specific contributors and one accountable lead are named with non-overlapping accountability | Assignment record |
| M05-01–M05-02 | Both resolve to same kit revision/semantics | Artifact digests and install records |
| M05-03–M05-04 | Effective model path/settings and game surfaces match | Redacted comparison matrix |
| M05-05 | No unexplained fairness-sensitive divergence | Reviewed difference register |
| M05-06 | Equivalent smoke tests pass; S01 remains valid | Paired test report/parity reference |
| M05-07 | No material communication capability or limit differs between harnesses | Paired fixture output and fairness table |

## Stop and escalate

- Stop on different model routes/settings, unequal prompts/tool surfaces, unreviewed adapter divergence, or secret values in configuration/evidence.
- Escalate fairness issues to the fairness lead and platform gaps through the accountable adapter integration lead with the relevant harness contributor.
- Safe state: do not provision the fleet; restore the last reviewed config references and rerun parity.

## Handoff and next

Record the accountable lead, both harness contributors, adapter revisions, kit digest, effective parity snapshot, smoke tests, and divergences. Next: [M06 Maritime fleet](M06-MARITIME-FLEET.md). Minimum context: MASTER, M06, M05 handoff, seat rows, and M03.

## Source and canon

- [§1 Same model and prompt comparison](../../prisoners-daolemma-tournament-decisions-v1_0.md#1-what-this-demo-is)
- [§2.4 Model](../../prisoners-daolemma-tournament-decisions-v1_0.md#24-model)
- [§5 Harness adapters](../../prisoners-daolemma-tournament-decisions-v1_0.md#5-what-to-build-trimmed-to-this-design)
- [Replacement §7 Fairness rules](../../prisoners-daolemma-discord-replacement.md#7-fairness-rules)
