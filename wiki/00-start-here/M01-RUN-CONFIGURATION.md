# M01 — Run configuration

- **Status:** Not started
- **Purpose:** Maintain one reviewed register for unresolved decisions, run-frozen parity inputs, and mutable live values.
- **Accountable owner:** Tournament lead — unassigned
- **Evidence reviewer:** Fairness/operations reviewer — unassigned
- **Classification:** OPEN / LIVE-VERIFY / OPTIONAL / STRETCH
- **Navigation:** Previous: [M00](M00-PROJECT-CANON.md) · [Wiki home](../README.md) · [MASTER](../MASTER-IMPLEMENTATION-GUIDE.md) · Next: [M02](M02-ROLES-AND-HANDOFFS.md)

## Read first

- [ ] [M00](M00-PROJECT-CANON.md) handoff is `Passed`.
- [ ] Read decision sheet [§2.4 and §2.7–§2.9](../../prisoners-daolemma-tournament-decisions-v1_0.md#24-model) and all six [§3 open items](../../prisoners-daolemma-tournament-decisions-v1_0.md#3-open-items-still-to-decide).
- [ ] Read replacement [§§4–7](../../prisoners-daolemma-discord-replacement.md#4-team-message-logs), [§9](../../prisoners-daolemma-discord-replacement.md#9-restart-and-duplicate-handling), and [§10](../../prisoners-daolemma-discord-replacement.md#10-observer-and-evidence).
- [ ] Prepare a secret-free copy of the [run record](../90-reference/RUN-EVIDENCE-RECORD.md).

## Inputs and prerequisites

The six rows marked **OPEN** are exactly the decision sheet's unresolved items. Do not silently resolve them. **RUN-FROZEN** values implement locked equality requirements but are not claimed as additional sheet decisions.

| ID | Classification | Required value/status before dependent work |
|---|---|---|
| `CFG-MODEL` | OPEN | Exact cheap, fast OpenAI model selected before S01 |
| `CFG-GAME-COUNT` | OPEN; floor/optional/stretch | Select 1, 3, or 5; one remains the floor, five remains stretch |
| `CFG-STATS-PAGE` | OPEN / OPTIONAL | Build or skip; no build before M11 + M13 pass |
| `CFG-VM` | OPEN | VM location and accountable owner |
| `CFG-DEBRIEF` | OPEN; conditional | Equal factual-summary delivery for both harnesses if more than one game |
| `CFG-WINDOWS` | OPEN / LIVE-VERIFY | Final commit/reveal block windows selected at launch after live read |
| `CFG-MODEL-ROUTE` | LOCKED / RUN-FROZEN / LIVE-VERIFY | Same direct-to-OpenAI route for both harnesses |
| `CFG-MODEL-SETTINGS` | LOCKED / RUN-FROZEN / LIVE-VERIFY | Exact same effective settings for both harnesses |
| `CFG-GAME-ADDRESS` | LIVE-VERIFY | Candidate `0x42892BEc3d1d926Db25FfB6A144ee363AaE40A1a` |
| `CFG-GAMECHAT-ADDRESS` | LIVE-VERIFY; not used for demo chat | Candidate `0xc2604D5C87663efE959342F23c3DC9E4D9Db3e99` |
| `CFG-AUTH-ADAPTER` | LIVE-VERIFY | Candidate `0xc893Ca037b796e7710a4948Bbb6fBfb94539b806` |
| `CFG-OWNER` | LOCKED source value / LIVE-VERIFY | Expected owner/coordinator `0xDb463b29c82138188d5e425EDe5E0Fcbb09f1408`; verify current chain state and authorized control |
| `CFG-FEE` | LOCKED starting source value / LIVE-VERIFY | 0.001 ETH per agent per game; configurable and may be lowered if testnet ETH is scarce |
| `CFG-JOIN-WINDOW` | LIVE-VERIFY | Current/selected seconds value; join alone uses seconds |
| `CFG-BLOCK-CADENCE` | Public source estimate / LIVE-VERIFY | Source estimates Base Sepolia at about two seconds per block; measure current cadence and never use seconds as commit/reveal authority |
| `CFG-ROUND-CEILING` | LOCKED planning guidance / LIVE-VERIFY | Select modest windows so a slow agent fits; target roughly 200 seconds at the ceiling and usually less |
| `CFG-PLAYER-CONFIG` | LOCKED target / LIVE-VERIFY | Existing deployment supports the intended ten-player configuration |
| `CFG-SEATS` | RUN-FROZEN | Five stable OpenClaw and five stable Hermes seat mappings |
| `CFG-CHAT-PATHS` | LOCKED | `runtime/chat/<game-id>/openclaw.jsonl` and `runtime/chat/<game-id>/hermes.jsonl` |
| `CFG-CHAT-LIMITS` | RUN-FROZEN fairness control | Identical per-message/total character limits and history selection for both teams; recommended start is latest 20 eligible messages |
| `CFG-CHAT-ORDER` | RUN-FROZEN fairness control | Deterministic or recorded poke ordering, serialized acceptance sequence, same opportunities/timeouts/retries for both teams |
| `CFG-CHAT-DISPLAY` | RUN-FROZEN | Live, end-of-round, or end-of-game public display; choose a delay that prevents strategy leakage and does not alter agent inputs |
| `CFG-CHAT-SCHEMA` | LOCKED | Message, poke, response, accepted/rejected, request-log, and recovery records use the replacement schemas/fields |
| `CFG-RPC` | LIVE-VERIFY | Approved Base Sepolia RPC environment reference; no credential value |
| `CFG-EVIDENCE` | RUN-FROZEN | Approved evidence location and retention owner |

## Execution checklist

- [ ] `M01-01` Copy every row into the current run record with owner, status, source, UTC verification time, reviewer, and dependents.
- [ ] `M01-02` Obtain explicit human answers only for **OPEN** rows needed by the next phase.
- [ ] `M01-03` Read current chain/platform state for every **LIVE-VERIFY** row needed by the next phase.
- [ ] `M01-04` Freeze the exact route/settings and operational mappings before each fairness/run gate.
- [ ] `M01-05` Confirm all secret-bearing entries are environment/resource references or placeholders only.
- [ ] `M01-06` Mark unresolved, stale, contradictory, or unreviewed required rows `Blocked`.
- [ ] `M01-07` Freeze identical chat limits/order/transport/retry/display settings before a game and record that external chat configuration is absent.

## Acceptance and evidence

| Checklist | Objective pass condition | Evidence |
|---|---|---|
| M01-01 | No required row lacks metadata | Reviewed configuration table |
| M01-02 | Selections identify human decider and UTC time | Decision references |
| M01-03 | Mutable facts have timestamped, reproducible readbacks | Sanitized read-only evidence |
| M01-04 | Both harness/run consumers reference one frozen value | Config digests or reviewed snapshots |
| M01-05 | No secret value appears | Secret-scan/reviewer result |
| M01-06 | No dependency consumes a blocked row | Dependency review |
| M01-07 | Both harnesses reference one communication configuration and the run starts without external chat credentials | Config digest and redacted startup inventory |

## Stop and escalate

- Stop when a dependent value is open, stale, contradictory, unreviewed, or secret-bearing.
- Escalate OPEN choices to the tournament lead, live contract discrepancies to the contract owner, and secret exposure to the security owner.
- Safe state: preserve sanitized readbacks, revoke no resource without human direction, and block dependents.

## Handoff and next

Provide only relevant row IDs and evidence references, not the entire record or any secrets. Next: [M02 Roles and handoffs](M02-ROLES-AND-HANDOFFS.md). Minimum next context: MASTER, M02, M03, and required M01 rows.

## Source and canon

- [§2.4 Model](../../prisoners-daolemma-tournament-decisions-v1_0.md#24-model)
- [§2.7 Contract and funding](../../prisoners-daolemma-tournament-decisions-v1_0.md#27-contract-and-funding)
- [§2.8 Timing](../../prisoners-daolemma-tournament-decisions-v1_0.md#28-timing)
- [§2.9 Observer](../../prisoners-daolemma-tournament-decisions-v1_0.md#29-observer)
- [§3 Open items](../../prisoners-daolemma-tournament-decisions-v1_0.md#3-open-items-still-to-decide)
- [Replacement §4 Team message logs](../../prisoners-daolemma-discord-replacement.md#4-team-message-logs)
- [Replacement §7 Fairness rules](../../prisoners-daolemma-discord-replacement.md#7-fairness-rules)
- [Replacement §10 Observer and evidence](../../prisoners-daolemma-discord-replacement.md#10-observer-and-evidence)
