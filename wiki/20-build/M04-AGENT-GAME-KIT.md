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
| Gameplay operations | LOCKED scope / CONTRACT-AUTHORITY | Player-local auth registration, join, prepare-commit, commit, reveal, claim, and read-only state/auth operations | Derive exact behavior only from verified contract/tooling |
| Wallet/auth | LOCKED scope | Agent-owned signing and auth/identity support | Preserve M03 isolation |
| Phase advancement | LOCKED exclusion | Not a player-kit signer operation; M09 owns a separate non-player phase-advancer boundary | No player key may reach `advance` |
| Structured response | LOCKED scope | Agent returns attributable status/transaction metadata and an optional `team_message`; missing/empty message is valid | M08/M09 own validation and append |
| Shared surface | Fairness control | Same kit semantics available to both adapters | Compare built artifact/revision |

## Execution checklist

- [ ] `M04-01` Inventory current supported wallet, player-local bridge operation `register`/pinned `auth:register`, auth status, join, prepare-commit, commit, reveal, claim, state-read, poke-input, and structured-response surfaces at exact revisions.
- [ ] `M04-02` Resolve gaps through reviewed implementation work outside this documentation deliverable; do not invent commands or contract semantics in the runbook.
- [ ] `M04-03` Keep move choice, commit/reveal material, private key, signing, and submission inside the player boundary. Pass `GAMEPLAY_WALLET_PRIVATE_KEY` only through the player environment to the pinned CLI child for bridge operation `register`, `join`, `prepare_commit`, `commit`, `reveal`, and `claim`; keep it out of arguments, Git verification, read-only operations, output, logs, and evidence. The coordinator schedules registration and verifies public evidence but never receives the key.
- [ ] `M04-04` Make state output sufficient to identify live phase/deadlines and voluntary action versus observed default without claiming observer authority.
- [ ] `M04-05` Expose the same reviewed kit revision and behavior to OpenClaw and Hermes adapters.
- [ ] `M04-06` Exercise each capability on Base Sepolia within authorized bounded tests and capture sanitized results.
- [ ] `M04-07` Add the same optional `team_message` response field to both harness surfaces; prove text reaches the orchestrator verbatim and empty/missing text never blocks gameplay.
- [ ] `M04-08` Exclude `advance` from the player signer surface and prove no player key can reach it; hand phase advancement to M09's separate `PHASE_ADVANCER_PRIVATE_KEY` boundary.
- [ ] `M04-09` Reject complete and incomplete legacy keystore/signer alternatives for every signed operation; Wave 1.5 supports only the operation-appropriate role-specific environment key.
- [ ] `M04-10` Immediately before every signed CLI child, query the configured RPC's actual `eth_chainId` and require `84532`.
- [ ] `M04-11` Construct separate `player`, `phase-advancer`, and `read-only` bridge instances with disjoint operation allowlists and reject cross-role or co-resident signer variables before Git/Yarn.
- [ ] `M04-12` Require exact-schema public seat and operations manifests for signed calls; bind the player to a unique seat wallet and the phase signer to the distinct non-seat operations wallet plus reviewed privileged-address exclusions.
- [ ] `M04-13` Reject `packages/foundry/.env` before checkout verification and recheck it before Yarn so the pinned CLI cannot repopulate a removed signer through dotenv.
- [ ] `M04-14` Remove bridge `register --out`; require `prepare_commit.out` and `commit`/`reveal.input` to be normalized absolute files inside a prepared player-local artifact directory that is disjoint from the pinned checkout.

## Acceptance and evidence

| Checklist | Objective pass condition | Evidence |
|---|---|---|
| M04-01–M04-02 | Capability matrix cites supported source/tooling for every required operation | Revisioned inventory and gap-resolution references |
| M04-03 | Security review finds no key/choice/signing path outside player | Data-flow review |
| M04-04 | State reader is reconciled with verified contract truth | Readback fixtures/review |
| M04-05 | Both harnesses consume the same kit artifact/semantics | Artifact digest and adapter matrix |
| M04-06 | Authorized tests cover all required operations without leaked secrets | Sanitized receipts/test report |
| M04-07 | Both harnesses pass the same response-schema and verbatim round-trip fixtures | Paired schema test report and response fixtures |
| M04-08 | Player operations and phase advancement have disjoint signer sources and command allowlists | Cross-role isolation fixtures/review |
| M04-09 | No signed operation can select or fall back to a legacy keystore/signer | Alternative-rejection fixtures |
| M04-10 | All signed operations fail closed unless a fresh RPC response reports Base Sepolia | RPC preflight fixtures and sanitized live evidence |
| M04-11–M04-14 | Execution roles, public manifests, dotenv exclusion, and player-local bundle paths match the reviewed bridge contract | Role/manifest/env-file/artifact test report and bridge configuration handoff |

## Stop and escalate

- Stop on unknown contract behavior, unsupported/invented command syntax, harness-specific gameplay semantics, secret leakage, delegated player signing, co-resident role keys, an invalid public manifest, a legacy signer path, a pinned-checkout `.env`, an unsafe bundle path, missing/failing actual-RPC chain preflight, or any player key reaching `advance`.
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
