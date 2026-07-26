# M04 — Shared agent game kit

- **Status:** Not started
- **Purpose:** Provide both harnesses the same reviewed wallet, auth, gameplay, state-read, and structured response capabilities.
- **Accountable owner:** Agent-kit lead — unassigned
- **Evidence reviewer:** Contract/security reviewer — unassigned
- **Classification:** LOCKED build scope / CONTRACT-AUTHORITY
- **Navigation:** Previous: [S05](../10-first-hour-spikes/S05-PERSISTENCE.md) · [Wiki home](../README.md) · [MASTER](../MASTER-IMPLEMENTATION-GUIDE.md) · Next: [M05](M05-HARNESS-ADAPTERS.md)

## Read first

- [ ] [S01](../10-first-hour-spikes/S01-MODEL-PARITY.md), [S02](../10-first-hour-spikes/S02-SELF-SIGNING.md), and [S03](../10-first-hour-spikes/S03-POKE-AND-ACT.md) are `Passed`; [S04](../10-first-hour-spikes/S04-OWNER-CONFIG.md) provides a usable contract path. Record the [S05](../10-first-hour-spikes/S05-PERSISTENCE.md) verdict if available, but do not block the one-game floor on it.
- [ ] [M01](../00-start-here/M01-RUN-CONFIGURATION.md) verified game/auth/RPC rows and [M03](../00-start-here/M03-SECURITY-AND-SECRETS.md) secret boundaries.
- [ ] Actual contract/interface and existing implementation commands at recorded revisions.
- [ ] Replacement [§5 poke schema](../../prisoners-daolemma-discord-replacement.md#5-maritime-poke), [§6 response schema](../../prisoners-daolemma-discord-replacement.md#6-agent-response), and [§8 gameplay boundary](../../prisoners-daolemma-discord-replacement.md#8-relationship-to-gameplay).

## Inputs and prerequisites

| Input | Classification | Requirement | Source/freshness |
|---|---|---|---|
| Gameplay operations | LOCKED scope / CONTRACT-AUTHORITY | Join, commit, reveal, claim, and state read | Derive exact behavior only from verified contract/tooling |
| Wallet/auth | LOCKED scope | Agent-owned signing and auth/identity support | Preserve M03 isolation |
| Structured response | LOCKED scope | Agent returns attributable status/transaction metadata and an optional `team_message`; missing/empty message is valid | M08/M09 own validation and append |
| Shared surface | Fairness control | Same kit semantics available to both adapters | Compare built artifact/revision |

## Execution checklist

- [ ] `M04-01` Inventory current supported wallet, auth, join, commit, reveal, claim, state-read, poke-input, and structured-response surfaces at exact revisions.
- [ ] `M04-02` Resolve gaps through reviewed implementation work outside this documentation deliverable; do not invent commands or contract semantics in the runbook.
- [ ] `M04-03` Keep move choice, commit/reveal material, private key, signing, and submission inside the player boundary.
- [ ] `M04-04` Make state output sufficient to identify live phase/deadlines and voluntary action versus observed default without claiming observer authority.
- [ ] `M04-05` Expose the same reviewed kit revision and behavior to OpenClaw and Hermes adapters.
- [ ] `M04-06` Exercise each capability on Base Sepolia within authorized bounded tests and capture sanitized results.
- [ ] `M04-07` Add the same optional `team_message` response field to both harness surfaces; prove text reaches the orchestrator verbatim and empty/missing text never blocks gameplay.

## Acceptance and evidence

| Checklist | Objective pass condition | Evidence |
|---|---|---|
| M04-01–M04-02 | Capability matrix cites supported source/tooling for every required operation | Revisioned inventory and gap-resolution references |
| M04-03 | Security review finds no key/choice/signing path outside player | Data-flow review |
| M04-04 | State reader is reconciled with verified contract truth | Readback fixtures/review |
| M04-05 | Both harnesses consume the same kit artifact/semantics | Artifact digest and adapter matrix |
| M04-06 | Authorized tests cover all required operations without leaked secrets | Sanitized receipts/test report |
| M04-07 | Both harnesses pass the same response-schema and verbatim round-trip fixtures | Paired schema test report and response fixtures |

## Stop and escalate

- Stop on unknown contract behavior, unsupported/invented command syntax, harness-specific gameplay semantics, secret leakage, or delegated player signing.
- Escalate contract questions to the contract owner, implementation gaps to the kit lead, and fairness divergence to the fairness reviewer.
- Safe state: ship no unreviewed capability; block dependent adapters/pilot.

## Handoff and next

Record capability matrix, exact revisions/digests, tests, gaps, and security review. Next: [M05 Harness adapters](M05-HARNESS-ADAPTERS.md). Minimum context: MASTER, M05, M04 handoff, S01, relevant M01 rows.

## Source and canon

- [§2.3 Agents and signing](../../prisoners-daolemma-tournament-decisions-v1_0.md#23-agents-and-signing)
- [§5 Agent game kit](../../prisoners-daolemma-tournament-decisions-v1_0.md#5-what-to-build-trimmed-to-this-design)
- [Replacement §6 Agent response](../../prisoners-daolemma-discord-replacement.md#6-agent-response)
- [Replacement §8 Relationship to gameplay](../../prisoners-daolemma-discord-replacement.md#8-relationship-to-gameplay)
- The decision-sheet preamble makes game-contract behavior authoritative.
