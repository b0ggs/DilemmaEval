# S02 — Self-signing inside Maritime

- **Status:** Not started
- **Purpose:** Prove a Maritime player can use its own disposable wallet environment to sign and send a real Base Sepolia transaction.
- **Accountable owner:** Wallet operator — unassigned
- **Evidence reviewer:** Security/chain reviewer — unassigned
- **Classification:** FIRST-THREE-SPIKES HARD GATE / LOCKED
- **Navigation:** Previous: [S01](S01-MODEL-PARITY.md) · [Wiki home](../README.md) · [MASTER](../MASTER-IMPLEMENTATION-GUIDE.md) · Next: [S03](S03-POKE-AND-ACT.md)

## Read first

- [ ] [S01](S01-MODEL-PARITY.md) is `Passed`; read its handoff.
- [ ] [M03](../00-start-here/M03-SECURITY-AND-SECRETS.md) security handoff and [M01](../00-start-here/M01-RUN-CONFIGURATION.md) Base Sepolia/resource references.
- [ ] Decision sheet [§2.3](../../prisoners-daolemma-tournament-decisions-v1_0.md#23-agents-and-signing), [§2.7](../../prisoners-daolemma-tournament-decisions-v1_0.md#27-contract-and-funding), and [§4.2](../../prisoners-daolemma-tournament-decisions-v1_0.md#4-first-hour-spikes).

## Inputs and prerequisites

| Input | Classification | Requirement | Source/freshness |
|---|---|---|---|
| Player key | Secret / LOCKED boundary | Disposable testnet private key referenced through the assigned agent environment only | Verify isolation; never capture value |
| Signing path | LIVE-VERIFY | The bridge passes `GAMEPLAY_WALLET_PRIVATE_KEY` only to the pinned CLI child for player operations `register`, `join`, `prepare_commit`, `commit`, `reveal`, and `claim` | Inspect current implementation source; do not invent syntax |
| Legacy signer exclusion | LOCKED | Signed operations reject complete and incomplete keystore/signer alternatives; role-specific environment keys are the only Wave 1.5 signer source | Negative-test every alternative |
| Signing-site boundary | LOCKED exclusion | The agent environment and supported CLI perform signing; there is no separate signing site | Verify architecture/data flow |
| Phase advancement | LOCKED exclusion | Not part of player self-signing; `advance` uses a separate non-player `PHASE_ADVANCER_PRIVATE_KEY` boundary | Verify no player key can reach `advance` |
| Network/funds | LIVE-VERIFY | Base Sepolia and enough test ETH for the bounded proof | Read immediately before send |
| Transaction scope | Human authorization | Exact permitted proof transaction and cost limit | Current approval required |

## Execution checklist

- [ ] `S02-01` Verify the test wallet is disposable, Base-Sepolia-only, and isolated to the selected Maritime agent.
- [ ] `S02-02` Derive/compare its public address without exposing the private key.
- [ ] `S02-03` Inspect the available implementation and verify the reviewed environment-to-bridge-to-pinned-CLI path for player signing without inventing a command; confirm the key is absent from bridge arguments, Git verification, output, logs, and evidence.
- [ ] `S02-04` Confirm current chain, balance, exact authorized action, and cost ceiling.
- [ ] `S02-05` Have the Maritime agent itself sign and send the approved Base Sepolia transaction.
- [ ] `S02-06` Capture public sender, transaction reference, chain, receipt/status, and timestamps with secret values redacted.
- [ ] `S02-07` Verify architecture, runtime flow, and evidence contain no separate signing site or delegated signing service.
- [ ] `S02-08` Verify `advance` cannot receive a player key and is outside this self-signing verdict; its separate phase-advancer boundary is reviewed under M09.
- [ ] `S02-09` Query the configured RPC's actual `eth_chainId` immediately before the approved signed operation and require `84532`; do not accept only configuration, hostname, or cached evidence.
- [ ] `S02-10` Prove bridge operation `register` is player-local: the selected agent invokes pinned `auth:register` and signs with its own gameplay key while the coordinator schedules the action and verifies public registration evidence without receiving the key.

## Acceptance and evidence

| Checklist | Objective pass condition | Evidence |
|---|---|---|
| S02-01–S02-02 | Expected public address matches and no other component receives the key | Boundary review/public-address record |
| S02-03 | Supported current tooling path is cited at an exact revision | Source/tooling reference |
| S02-04 | Preflight proves Base Sepolia, funds, and authorization | Sanitized preflight/approval reference |
| S02-05–S02-06 | Successful receipt sender is the agent wallet | Public transaction/receipt evidence |
| S02-07 | Data-flow review shows the agent environment invokes supported signing directly and no separate site/service receives signing authority | Reviewed architecture/runtime trace |
| S02-08 | Player-key paths cannot reach `advance`, and no phase-advancer result is counted as player self-signing evidence | Role-isolation test/review |
| S02-09 | Fresh RPC response is Base Sepolia immediately before signing | Sanitized `eth_chainId == 84532` preflight evidence |
| S02-10 | Registration sender matches the seat wallet and coordinator evidence contains public fields only | Public registration transaction/identity evidence and boundary review |

## Stop and escalate

- **Failure or indeterminate proof triggers the first-three-spikes stop gate: do not continue toward ten agents.**
- Stop on secret output, wrong actual-RPC chain ID, sender mismatch, unavailable/unreviewed tooling, a legacy or separate signing site/service, player-key use for `advance`, inadequate funds, or missing authorization.
- Escalate tooling to the agent-kit owner, live transaction issues to the chain owner, and any exposure to the security owner.
- Safe state: send nothing else, pause the wallet/agent, and preserve public metadata only.

## Handoff and next

Record verdict, supported tooling reference, public transaction evidence, redactions, and blockers. Only on `Passed`, continue to [S03 Poke and act](S03-POKE-AND-ACT.md). Minimum context: MASTER, S03, S01/S02 handoffs, timing rows, and M03.

## Source and canon

- [§2.3 Agents and signing](../../prisoners-daolemma-tournament-decisions-v1_0.md#23-agents-and-signing)
- [§2.7 Testnet/funding](../../prisoners-daolemma-tournament-decisions-v1_0.md#27-contract-and-funding)
- [§4.2 Self-signing spike](../../prisoners-daolemma-tournament-decisions-v1_0.md#4-first-hour-spikes)
