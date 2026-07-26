# M03 — Security and secrets

- **Status:** Not started
- **Purpose:** Enforce disposable-testnet wallet, least-exposure, and secret-free evidence boundaries.
- **Accountable owner:** Security owner — unassigned
- **Evidence reviewer:** Independent security reviewer — unassigned
- **Classification:** LOCKED / LIVE-VERIFY
- **Navigation:** Previous: [M02](M02-ROLES-AND-HANDOFFS.md) · [Wiki home](../README.md) · [MASTER](../MASTER-IMPLEMENTATION-GUIDE.md) · Next: [S01](../10-first-hour-spikes/S01-MODEL-PARITY.md)

## Read first

- [ ] [M00](M00-PROJECT-CANON.md), [M01](M01-RUN-CONFIGURATION.md), and [M02](M02-ROLES-AND-HANDOFFS.md) handoffs, including secret-bearing M01 resource rows.
- [ ] Decision sheet [§2.3](../../prisoners-daolemma-tournament-decisions-v1_0.md#23-agents-and-signing) and [§2.7](../../prisoners-daolemma-tournament-decisions-v1_0.md#27-contract-and-funding).
- [ ] Replacement [§4 log rules](../../prisoners-daolemma-discord-replacement.md#4-team-message-logs) and [§10 evidence rules](../../prisoners-daolemma-discord-replacement.md#10-observer-and-evidence).

## Inputs and prerequisites

| Input | Classification | Requirement | Source/freshness |
|---|---|---|---|
| Player wallets | LOCKED | Ten disposable Base Sepolia wallets; never mainnet assets | §2.3 |
| Private keys | Secret | Plaintext testnet key is available only inside its assigned agent environment | Verify boundary before use |
| Phase-advancer wallet | Secret / LOCKED role boundary | One eleventh disposable Base Sepolia operations wallet, available only to the narrowly scoped advancement executor as `PHASE_ADVANCER_PRIVATE_KEY`; never a seat/player, ERC-8004 identity, owner/configuration, funding, or Maritime billing wallet | Derive and bind its public address in a separate operations manifest |
| Coordinator signer | Secret | Approved owner/coordinator custody reference only | Verify expected public address and current authority |
| RPC/model/API credentials | Secret | Environment/resource references only | Verify access without recording values |
| Team isolation | LOCKED security/fairness control | An agent receives only its own team's eligible log records; no cross-team read/write path | Negative-test every path |
| Evidence/logging | Implementation control | Redact keys, tokens, prompts containing secrets, raw environment dumps, unrevealed move material, and credential-bearing config | Review every export |

## Execution checklist

- [ ] `M03-01` Define one environment-secret placeholder/reference per player wallet and one separate phase-advancer reference. Never put a secret value in Git, docs, pokes, team chat/logs, evidence, handoffs, raw bridge arguments, or recorded command history.
- [ ] `M03-02` Confirm player keys are isolated by agent and unavailable to the orchestrator and other players.
- [ ] `M03-03` Confirm coordinator credentials are unavailable to player agents and the orchestrator; owner configuration and funding stay in their separately authorized operator boundary.
- [ ] `M03-04` Verify chain ID/network checks prevent mainnet use and all wallets are disposable/testnet-only.
- [ ] `M03-05` Define redaction and access rules for RPC, OpenAI, Maritime, wallet, team logs, request/response records, and commit/reveal material.
- [ ] `M03-06` Review a sample log/evidence export and incident escalation path.
- [ ] `M03-07` Prove wrong-team reads, wrong-team writes, seat/request mismatches, and rejected messages cannot alter either valid team log.
- [ ] `M03-08` Record the narrow risk acceptance for a human-authorized `maritime env set <agent> GAMEPLAY_WALLET_PRIVATE_KEY=<secret> --reload` operation: only a disposable Base Sepolia player key may be injected into its assigned agent through Maritime's encrypted environment handling; terminal/history exposure is minimized under the operator's approved procedure, and no value is copied into project artifacts.
- [ ] `M03-09` Prove the phase-advancer key is isolated from all ten player environments and is mapped internally to the pinned CLI's canonical signer variable only for `advance`; prove no player key can reach `advance`.
- [ ] `M03-10` Reject every complete or incomplete legacy keystore/signer alternative for signed bridge operations. Only role-specific environment keys are supported; public wallet-address inputs remain allowed for read-only status checks.
- [ ] `M03-11` Approve the second narrow secret path: a VM secret manager, systemd credential, or equivalent injects `PHASE_ADVANCER_PRIVATE_KEY` only into a separate advancement-executor process, never shell history, Git, `.env`, or the general orchestrator environment.
- [ ] `M03-12` Generate the eleventh non-seat operations wallet, derive and bind its public address in a separate operations manifest, approve/fund only its gas ceiling before M09/M10, and prove it is never ERC-8004 registered, joined, charged an entry fee, or placed in the ten-seat manifest.
- [ ] `M03-13` Require a fresh actual-RPC `eth_chainId` result of `84532` immediately before every signed bridge operation; configured/cached chain identifiers are not evidence.
- [ ] `M03-14` Run three separate bridge roles: `player` exposes only the six player signer operations, `phase-advancer` exposes only `advance`, and `read-only` exposes only state/auth reads. Reject a process containing both role keys or any key not belonging to its role.
- [ ] `M03-15` Validate the exact public seat- and operations-manifest shapes before signing; reject duplicate seat IDs, Maritime agents, or wallet addresses and reject any phase address matching a seat, expected owner, or reviewed privileged funding address.
- [ ] `M03-16` Require the pinned checkout to have no file or symlink at `packages/foundry/.env`, checking both before Git verification and immediately before Yarn, because the pinned CLI explicitly loads that path.
- [ ] `M03-17` Store prepared commit bundles only in a prepared, real, player-local absolute artifact directory outside the pinned checkout. Reject relative, traversal, symlink, cross-seat, existing-output, or out-of-bound input paths.

## Acceptance and evidence

| Checklist | Objective pass condition | Evidence |
|---|---|---|
| M03-01–M03-03 | Data-flow review shows no cross-seat/orchestrator key access | Sanitized boundary diagram or review |
| M03-04 | Public network/address evidence identifies Base Sepolia only | Read-only check record |
| M03-05 | Every secret class has storage, redaction, and owner controls | Secret inventory containing references only |
| M03-06 | Sample output contains no secret or unrevealed move material | Reviewer/scan result |
| M03-07 | Negative tests preserve strict team isolation and valid-log hashes | Isolation test report and before/after hashes |
| M03-08 | Approved encrypted-environment injection is the only accepted secret-bearing operator command; project artifacts and recorded bridge inputs remain secret-free | Risk-acceptance/operation record containing references only |
| M03-09 | Player and phase-advancer keys are isolated by role, command, and environment | Paired-player/advancer isolation fixtures and boundary review |
| M03-10 | Signed operations have no legacy keystore/signer path | Complete/incomplete alternative-rejection tests |
| M03-11 | The phase key exists only in the dedicated executor process | Secret-loading configuration review without values |
| M03-12 | Exactly ten seat wallets plus one separately manifested, gas-only operations wallet exist | Public manifests, uniqueness check, balance evidence, and negative registration/join evidence |
| M03-13 | Every signed path fails closed unless the current RPC reports Base Sepolia chain ID | Actual-RPC preflight fixtures/live evidence |
| M03-14–M03-17 | Process roles, exact public manifests, ignored-env exclusion, and player-local bundle storage fail closed before a key-bearing child | Role/manifest/env-file/artifact negative fixtures and boundary review |

## Stop and escalate

- Stop immediately on secret output, cross-seat/cross-role key access or co-resident role keys, an invalid/duplicate public manifest, player-key use for `advance`, a legacy signer path, any `packages/foundry/.env`, an unsafe commit-bundle path, phase-key exposure to the general orchestrator/shell history/repo/`.env`, non-disposable wallet selection, wrong chain, or missing authorization.
- Escalate to the security owner; if exposure occurred, preserve only non-secret public metadata and follow the human-owned rotation/replacement process.
- Safe state: send no further transactions or pokes, stop log publication, and pause affected agents.

## Handoff and next

Provide boundary evidence, scan result, open incidents, and approved placeholder names/references only. Next: [S01 Model parity](../10-first-hour-spikes/S01-MODEL-PARITY.md). Minimum next context: MASTER, S01, required model rows, and this handoff.

## Source and canon

- [§2.3 Agents and signing](../../prisoners-daolemma-tournament-decisions-v1_0.md#23-agents-and-signing)
- [§2.7 Contract and funding](../../prisoners-daolemma-tournament-decisions-v1_0.md#27-contract-and-funding)
- [Replacement §4 Team message log rules](../../prisoners-daolemma-discord-replacement.md#4-team-message-logs)
- [Replacement §10 Observer and evidence](../../prisoners-daolemma-discord-replacement.md#10-observer-and-evidence)
