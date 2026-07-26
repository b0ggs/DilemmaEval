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

## Inputs and prerequisites

| Input | Classification | Requirement | Source/freshness |
|---|---|---|---|
| Player wallets | LOCKED | Ten disposable Base Sepolia wallets; never mainnet assets | §2.3 |
| Private keys | Secret | Plaintext testnet key is available only inside its assigned agent environment | Verify boundary before use |
| Coordinator signer | Secret | Approved owner/coordinator custody reference only | Verify expected public address and current authority |
| RPC/webhooks/API credentials | Secret | Environment/resource references only | Verify access without recording values |
| Evidence/logging | Implementation control | Redact keys, webhook URLs, tokens, unrevealed move material, and credential-bearing config | Review every export |

## Execution checklist

- [ ] `M03-01` Define one environment-secret placeholder/reference per player wallet; never put a value in docs, chat, commands, evidence, or handoffs.
- [ ] `M03-02` Confirm player keys are isolated by agent and unavailable to the orchestrator and other players.
- [ ] `M03-03` Confirm coordinator credentials are unavailable to player agents and the orchestrator; owner configuration and funding stay in their separately authorized operator boundary.
- [ ] `M03-04` Verify chain ID/network checks prevent mainnet use and all wallets are disposable/testnet-only.
- [ ] `M03-05` Define redaction and access rules for RPC, OpenAI, Discord, Maritime, wallet, and commit/reveal material.
- [ ] `M03-06` Review a sample log/evidence export and incident escalation path.

## Acceptance and evidence

| Checklist | Objective pass condition | Evidence |
|---|---|---|
| M03-01–M03-03 | Data-flow review shows no cross-seat/orchestrator key access | Sanitized boundary diagram or review |
| M03-04 | Public network/address evidence identifies Base Sepolia only | Read-only check record |
| M03-05 | Every secret class has storage, redaction, and owner controls | Secret inventory containing references only |
| M03-06 | Sample output contains no secret or unrevealed move material | Reviewer/scan result |

## Stop and escalate

- Stop immediately on secret output, cross-seat key access, non-disposable wallet selection, wrong chain, or missing authorization.
- Escalate to the security owner; if exposure occurred, preserve only non-secret public metadata and follow the human-owned rotation/replacement process.
- Safe state: send no further transactions or webhooks and pause affected agents.

## Handoff and next

Provide boundary evidence, scan result, open incidents, and approved placeholder names/references only. Next: [S01 Model parity](../10-first-hour-spikes/S01-MODEL-PARITY.md). Minimum next context: MASTER, S01, required model rows, and this handoff.

## Source and canon

- [§2.3 Agents and signing](../../prisoners-daolemma-tournament-decisions-v1_0.md#23-agents-and-signing)
- [§2.7 Contract and funding](../../prisoners-daolemma-tournament-decisions-v1_0.md#27-contract-and-funding)
