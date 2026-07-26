# DilemmaEval Two-Hour Parallel Implementation Plan

**Status:** Planning and work allocation  
**Working repository:** [`b0ggs/DilemmaEval`](https://github.com/b0ggs/DilemmaEval)  
**Writable mainline:** `origin/main`  
**Read-only documentation upstream:** [`botnotstrawberry/DilemmaEval`](https://github.com/botnotstrawberry/DilemmaEval)  
**Existing game implementation:** [`botnotstrawberry/prisoners-daolemma`](https://github.com/botnotstrawberry/prisoners-daolemma) at pinned commit `955ce16a59b0efecf6ccdf2d391ede83de8902a8`

This file allocates implementation work. It does not replace:

- the [MASTER implementation guide](wiki/MASTER-IMPLEMENTATION-GUIDE.md)
- the individual [wiki modules](wiki/README.md)
- the [tournament decision sheet](prisoners-daolemma-tournament-decisions-v1_0.md)
- the approved [Discord replacement](prisoners-daolemma-discord-replacement.md)

---

## 1. Outcome

Build the Maritime tournament integration around the already-live Prisoners DAOlemma game.

Do not rebuild:

- smart contracts
- game rules
- deployment scripts
- contract ABIs
- ERC-8004 contract support
- join, commit, reveal, advance, claim, query, or export CLIs
- existing scoring/export behavior
- the existing web application

Reuse the pinned game repository's existing command families:

```text
yarn auth:register
yarn auth:status
yarn query:auth
yarn query:summary
yarn query:export
yarn game:create
yarn game:advance
yarn game:join
yarn game:prepare-commit
yarn game:commit
yarn game:reveal
yarn game:claim
```

Build only:

1. a thin agent-facing executor/parser for those commands
2. equal OpenClaw and Hermes adapters
3. Maritime model-route configuration and poke transport
4. Maritime fleet and gameplay-wallet mapping
5. the external orchestrator
6. orchestrator-owned team-message logs
7. observer/evidence integration using existing exports
8. the two-agent pilot and five-versus-five run

See [decision sheet §5](prisoners-daolemma-tournament-decisions-v1_0.md#5-what-to-build-trimmed-to-this-design) and [§6](prisoners-daolemma-tournament-decisions-v1_0.md#6-build-order).

---

## 2. Locked tournament profile

The tournament uses:

- Base Sepolia only
- the historical verified Base Sepolia deployment identified in the decision sheet/addendum
- disposable testnet gameplay wallets only
- five OpenClaw agents versus five Hermes agents
- one complete game as the floor
- the same model, route, settings, prompt fields, game tools, retries, timeouts, and communication limits for both harnesses
- agent-owned transaction signing
- an external always-on orchestrator
- two isolated orchestrator-owned team-message logs

Model route from the approved final addendum:

```text
Primary model: gpt-5.4-mini
Fallback: gpt-4o
Endpoint: https://api.maritime.sh/api/llm/v1
```

Do not implement the older direct-OpenAI instructions still present in parts of the wiki.

### Game-repository safety boundary

The pinned game repository's current agent skill is oriented to Base mainnet. Reuse its CLI implementation, but do not install or copy mainnet configuration unchanged.

The integration must explicitly supply:

- Base Sepolia chain ID and RPC
- Base Sepolia tournament addresses
- disposable testnet wallets
- the selected tournament game/config

No mainnet private key or asset may enter this project.

---

## 3. Participants

### VS Code operator A

**Role:** Lead Codex/integration captain

- controls `origin/main`
- creates shared interfaces and directory skeletons
- launches and directs up to three Codex child agents
- reviews every child diff
- creates atomic commits
- runs integration tests
- coordinates live gates with the human operator
- pushes direct mainline updates

### VS Code operator B

**Role:** Second implementation operator

- owns the Maritime fleet, seat inventory, wallet mapping, and provisioning lane by default
- may use its own VS Code agents
- returns tested atomic commits or a branch/commit SHA to operator A
- does not push competing changes to `origin/main` while operator A is integrating

If operator B becomes unavailable, all unfinished non-live work returns to the Codex task queue.
Work that cannot fit in an already-full three-child wave waits for the next available child slot; it does not silently expand concurrency.

### OpenClaw

**Role:** Funding operator only

OpenClaw receives no implementation, documentation, audit, or PR-review tasks.

After the tournament operator approves a frozen public wallet manifest, OpenClaw may:

- send the approved amount of Base Sepolia ETH
- only to the approved ten public gameplay-wallet addresses
- record public transaction hashes

OpenClaw must not:

- receive private keys
- choose addresses or amounts
- modify code or documentation
- approve merges
- fund before the manifest, chain, amount, and cost ceiling are confirmed
- use mainnet assets

The Maritime billing/payment wallet and ten gameplay wallets remain separate.

### Human tournament operator

- approves live Maritime creation/configuration
- controls secrets
- approves wallet generation/storage policy
- approves ERC-8004 registration
- approves funding manifest and amount
- approves owner configuration
- approves game creation/launch and gameplay transactions
- chooses the orchestrator VM

---

## 4. Agent capacity, models, and auditing

### This Codex session

Capacity:

- one lead Codex
- up to three child sub-agents concurrently
- four active Codex agents total

All child agents have the same tool access and general Codex capability as the lead. They run in the same GPT-5-based Codex environment. The exact internal model identifier and reasoning-effort setting are not exposed or selectable in this session.

### Auditing strategy

To maximize two-hour throughput:

- use three child slots for implementation during build waves
- lead Codex audits continuously
- after each wave, rotate children into a cross-audit ring

Cross-audit ring:

```text
Agent A audits Agent C
Agent B audits Agent A
Agent C audits Agent B
Lead Codex reviews all three
```

The cross-audit uses the same three slots after implementation turns finish. It does not require a fourth child slot.

If a permanently concurrent child auditor is required, capacity becomes:

- two implementing children
- one auditing child
- one lead

That is safer but slower. The default two-hour mode is three implementers plus lead review, followed by cross-audit.

The second VS Code operator's agent capacity is separate and must be confirmed in that session.

---

## 5. Direct-main coordination rules

There are no required PRs and no OpenClaw approval gate.

`origin/main` is the project mainline. `upstream/main` is a read-only source of optional documentation changes and is not expected to remain equal to `origin/main`.

### Git ownership

- only operator A pushes `origin/main` during an integration window
- operator B coordinates before any push to `origin/main`
- child agents perform no Git operations
- child agents never edit root manifests, lockfiles, shared exports, or wiki files unless specifically assigned
- each child owns one exact non-overlapping leaf directory
- operator A integrates shared manifests and exports
- every commit is atomic and independently revertible
- never force-push

### Before every mainline push

- [ ] Fetch `origin`.
- [ ] Confirm local work is based on current `origin/main`.
- [ ] Confirm changed paths match the assigned task.
- [ ] Review the full diff.
- [ ] Run task tests.
- [ ] Run integrated tests affected by the change.
- [ ] Scan output and staged files for secrets/private keys.
- [ ] Record unsupported assumptions and live steps not executed.
- [ ] Push one atomic commit.

### Recovery

If a commit breaks main:

1. stop new integration
2. identify the single atomic commit
3. revert it with a new commit
4. preserve failure evidence
5. repair in an isolated child path
6. rerun audits before reintegration

---

## 6. Child-agent task contract

Each child receives:

1. one task ID
2. one owned directory
3. forbidden paths
4. linked wiki module/checklist IDs
5. pinned game-repository revision and exact consumed files
6. input interface
7. required output artifact
8. exact tests
9. explicit instruction not to invent missing behavior

Each child returns:

```text
Task:
Changed paths:
Acceptance IDs:
Tests run:
Results:
Evidence:
Unsupported assumptions:
Remaining blockers:
```

No child may:

- change product decisions
- recreate game rules or ABI calls already provided by the game CLI
- execute a live paid API call
- provision a Maritime agent
- create/register/fund a wallet
- send a transaction
- handle a secret
- commit, push, merge, or rebase

---

## 7. Module ownership

| Wiki module | Primary owner | Execution notes |
|---|---|---|
| [M00–M03](wiki/00-start-here/) | Lead Codex + human operator | Source, configuration, roles, and secret boundary |
| [S01 Model parity](wiki/10-first-hour-spikes/S01-MODEL-PARITY.md) | Codex transport/adapters lane | Build locally; live probe requires approval |
| [S02 Self-signing](wiki/10-first-hour-spikes/S02-SELF-SIGNING.md) | Codex game-bridge lane + operator | Use existing CLI; live transaction requires approval |
| [S03 Poke and act](wiki/10-first-hour-spikes/S03-POKE-AND-ACT.md) | Codex transport lane + lead | Serialized live gate |
| [S04 Owner config](wiki/10-first-hour-spikes/S04-OWNER-CONFIG.md) | Human operator | Existing game tooling; no new contract tooling |
| [S05 Persistence](wiki/10-first-hour-spikes/S05-PERSISTENCE.md) | Deferred | Not a one-game blocker |
| [M04 Agent game kit](wiki/20-build/M04-AGENT-GAME-KIT.md) | Codex game-bridge lane | Thin executor/parser over pinned game CLI |
| [M05 Harness adapters](wiki/20-build/M05-HARNESS-ADAPTERS.md) | Codex parity lane | Both adapters remain under one owner |
| [M06 Maritime fleet](wiki/20-build/M06-MARITIME-FLEET.md) | Operator B, fallback Codex | Pilot pair first |
| [M07 Wallet/auth/funding](wiki/20-build/M07-WALLETS-IDENTITY-FUNDING.md) | Operator B + human/OpenClaw | Code/dry-run separate from authorized live actions |
| [M08 Team logs](wiki/20-build/M08-TEAM-CHAT-LOGS.md) | Codex team-log lane | Pure local implementation first |
| [M09 Orchestrator](wiki/20-build/M09-ORCHESTRATOR-VM.md) | Lead Codex | Integrates three child outputs |
| [M10 Two-agent pilot](wiki/30-execute/M10-TWO-AGENT-PILOT.md) | Lead + human operator | Serialized live gate |
| [M11 Ten-agent tournament](wiki/30-execute/M11-TEN-AGENT-TOURNAMENT.md) | Human operator + lead | Only after M10 |
| [M12 Series/debrief](wiki/30-execute/M12-SERIES-SCORING-DEBRIEF.md) | Deferred | Outside one-game floor |
| [M13 Evidence export](wiki/40-observe/M13-EVIDENCE-EXPORT.md) | Codex evidence lane | Consume existing `query:export` |
| [M14 Observer/replay](wiki/40-observe/M14-OBSERVER-REPLAY.md) | Codex evidence lane | Minimal, after real evidence |

---

## 8. Two-hour sprint

The two-hour target is:

1. corrected canon and frozen interfaces
2. locally tested integration components
3. pilot Maritime fleet and wallets ready
4. hard live spikes attempted in order
5. M10 two-agent pilot attempted if hard gates pass
6. ten-agent launch only if M10 passes with time remaining

The plan does not fake a completed tournament when a hard gate or external dependency consumes the window.

### Minute 0–15 — Lead-only baseline

#### TASK-00 — Freeze canon and skeleton

**Owner:** Lead Codex  
**References:** [M00](wiki/00-start-here/M00-PROJECT-CANON.md), [M01](wiki/00-start-here/M01-RUN-CONFIGURATION.md)

- [x] Track the approved final addendum in this repository.
- [x] Link the pinned game implementation.
- [x] Correct the wiki's stale direct-OpenAI instructions.
- [x] Record Base Sepolia configuration and mainnet exclusions.
- [x] Freeze shared poke, response, seat-manifest, and game-command result schemas.
- [x] Freeze how the pinned game source is acquired at runtime: an exact pinned checkout, submodule, package artifact, or configured sibling path. An unpinned `main` checkout is not acceptable.
- [x] Create non-overlapping implementation directories.
- [ ] Commit the baseline atomically to `origin/main`.

No child implementation starts until shared schemas and paths exist.

### Minute 15–45 — Wave 1: three Codex children plus operator B

#### TASK-A1 — Existing-game CLI bridge

**Owner:** Child Agent A  
**Owned path:** game-bridge leaf directory  
**References:** [M04](wiki/20-build/M04-AGENT-GAME-KIT.md), [S02](wiki/10-first-hour-spikes/S02-SELF-SIGNING.md)

- [x] Execute and parse pinned existing game commands.
- [x] Cover state, wallet/auth status, join, prepare-commit, commit, reveal, advance, and claim.
- [x] Preserve stdout/stderr, exit status, and structured error information.
- [x] Add fixture tests without sending transactions.
- [x] Do not implement ABI/RPC/game rules independently.

#### TASK-B1 — Pure team-log library

**Owner:** Child Agent B  
**Owned path:** team-log leaf directory  
**References:** [M08](wiki/20-build/M08-TEAM-CHAT-LOGS.md)

- [x] Implement isolated append-only logs.
- [x] Implement validation, sequence, cursor, bounded snapshot, and verbatim text.
- [x] Implement duplicate/cross-team/malformed/stale/oversized rejection.
- [x] Implement restart and partial-line recovery fixtures.
- [x] Keep the library independent of chain and Maritime transport.

#### TASK-C1 — Maritime transport/config fixture harness

**Owner:** Child Agent C  
**Owned path:** Maritime transport leaf directory  
**References:** [S01](wiki/10-first-hour-spikes/S01-MODEL-PARITY.md), [S03](wiki/10-first-hour-spikes/S03-POKE-AND-ACT.md)

- [x] Represent the shared proxy/model/settings configuration.
- [x] Build poke/response request fixtures.
- [x] Implement timeout/retry/idempotency behavior against a fake transport.
- [x] Capture redacted parity evidence fields.
- [x] Make no paid or live Maritime call.

#### TASK-D1 — Pilot fleet and wallet manifest

**Owner:** VS Code operator B  
**References:** [M06](wiki/20-build/M06-MARITIME-FLEET.md), [M07](wiki/20-build/M07-WALLETS-IDENTITY-FUNDING.md)

- [ ] Define ten seats, but select only one OpenClaw and one Hermes pilot seat for provisioning.
- [ ] Build a public seat/agent/wallet/team/cause manifest.
- [ ] Build dry-run Maritime provisioning commands.
- [ ] Build secret-reference placeholders without values.
- [ ] Calculate pilot funding without sending funds.

### Minute 45–60 — Audit and integration checkpoint 1

- [x] Agent A audits Agent C.
- [x] Agent B audits Agent A.
- [x] Agent C audits Agent B.
- [x] Lead Codex reviews all diffs and audit findings.
- [x] Lead applies final shared-boundary and audit-regression fixes.
- [x] Lead runs combined local tests.
- [ ] Lead commits each accepted artifact atomically.
- [ ] Lead pushes `origin/main`.

Failed artifacts do not block unrelated accepted artifacts.

### Minute 60–90 — Wave 2

#### TASK-A2 — Both harness adapters

**Owner:** Child Agent A  
**References:** [M05](wiki/20-build/M05-HARNESS-ADAPTERS.md)

- [ ] Install the same game bridge in OpenClaw and Hermes.
- [ ] Use identical model, route, settings, tools, prompts, response schema, retries, and timeouts.
- [ ] Add paired fixture tests.
- [ ] Enumerate every unavoidable harness-specific difference.

Both adapters remain one task to prevent parity drift.

#### TASK-B2 — Orchestrator chain driver

**Owner:** Child Agent B  
**References:** [M09](wiki/20-build/M09-ORCHESTRATOR-VM.md)

- [ ] Consume game-bridge state output.
- [ ] Model join/commit/reveal/terminal transitions.
- [ ] Advance commit/reveal only on chain count equality or deadline.
- [ ] Never treat an agent acknowledgement as chain truth.
- [ ] Implement restart/idempotency fixtures.

#### TASK-C2 — Production Maritime transport adapter

**Owner:** Child Agent C  
**References:** [S03](wiki/10-first-hour-spikes/S03-POKE-AND-ACT.md), [M09](wiki/20-build/M09-ORCHESTRATOR-VM.md)

- [ ] Implement the verified current Maritime CLI or REST chat transport behind the C1 transport interface.
- [ ] Preserve request IDs, timeout/retry bounds, structured responses, and redacted evidence.
- [ ] Keep OpenClaw and Hermes transport behavior identical.
- [ ] Add mocked integration tests that exercise the production adapter without making a paid/live call.
- [ ] Keep actual live probes behind explicit authorization.

#### TASK-D2 — Authorized pilot preparation

**Owner:** VS Code operator B + human operator

- [ ] Verify live Maritime command surface.
- [ ] Provision only the approved pilot pair.
- [ ] Generate/inject two disposable wallet secrets under the approved policy.
- [ ] Prepare ERC-8004 registration and funding actions.
- [ ] Do not execute registration/funding without explicit approval.

### Minute 90–105 — Audit and integration checkpoint 2

- [ ] Repeat cross-audit ring.
- [ ] Lead reviews boundary, parity, restart, and secret handling.
- [ ] Lead wires shared exports/manifests.
- [ ] Run all local tests.
- [ ] Create atomic commits.
- [ ] Push `origin/main`.

### Minute 105–120 — Serialized live gates

Only the lead and human operator perform live actions, except that OpenClaw may execute the separately approved Base Sepolia funding manifest exactly as defined in §3 and §9.

Execute in order:

1. [S01 model parity](wiki/10-first-hour-spikes/S01-MODEL-PARITY.md)
2. [S02 self-signing](wiki/10-first-hour-spikes/S02-SELF-SIGNING.md)
3. [S03 poke and act](wiki/10-first-hour-spikes/S03-POKE-AND-ACT.md)
4. [S04 owner/config path](wiki/10-first-hour-spikes/S04-OWNER-CONFIG.md)
5. [M10 two-agent pilot](wiki/30-execute/M10-TWO-AGENT-PILOT.md), only if S01–S03 pass

Stop on a failed or indeterminate hard gate. Preserve evidence and continue no farther than the last valid state.

If M10 passes with time remaining:

- provision the remaining eight agents
- freeze the ten-wallet funding manifest
- have OpenClaw fund only the approved public addresses and amounts
- register identities
- run the ten-agent readiness checklist

Do not launch M11 merely to satisfy the clock.

### Next available child slot — Evidence and replay joiner

This task starts after the production transport is accepted or after a child slot becomes free. It is not required before the hard live spikes.

**Owner:** Next available Codex child  
**References:** [M13](wiki/40-observe/M13-EVIDENCE-EXPORT.md), [M14](wiki/40-observe/M14-OBSERVER-REPLAY.md)

- [ ] Consume existing `query:export` fixtures.
- [ ] Join team-log and orchestrator evidence without making it chain authority.
- [ ] Use `EffectiveChoiceMaterialized` default flags.
- [ ] Distinguish chosen Share from defaulted Share.
- [ ] Produce minimal observer/replay input.

---

## 9. Live-action authorization matrix

Child agents may build and locally test support, but may execute none of these:

| Live action | Required human confirmation |
|---|---|
| Paid model/API probe | provider, model, request count, cost ceiling |
| Maritime agent creation | account, templates, tiers, count, estimated cost |
| Maritime environment update | exact agent, secret name, reload effect |
| Gameplay-wallet creation/storage | count, chain, custody and backup policy |
| ERC-8004 registration | chain, identity registry, wallet list, gas ceiling |
| Funding | chain, sender, recipient manifest, per-wallet amount, total ceiling |
| Owner configuration | chain, game address, exact before/after config |
| Game create/launch | chain, game config, fee, causes, time windows |
| Join/commit/reveal/advance/claim | game ID, seat/wallet, phase, gas ceiling |
| VM provisioning/deployment | provider, owner, region, spend ceiling |

OpenClaw funding additionally requires the frozen public manifest digest and operator approval.

---

## 10. Completion gates

### Local build gate

- [ ] Pinned game CLI is reused, not recreated.
- [ ] Both harness adapters use the same game bridge.
- [ ] Model/route/settings fixtures match.
- [ ] Team-log isolation/recovery fixtures pass.
- [ ] Orchestrator restart/idempotency fixtures pass.
- [ ] Evidence distinguishes chosen/defaulted Share.
- [ ] No secret appears in code, fixtures, logs, or commits.

### Pilot gate

- [ ] S01–S03 pass.
- [ ] S04 confirms the intended live configuration path.
- [ ] One OpenClaw and one Hermes agent complete a real round.
- [ ] No orchestrator path chooses a move/message or signs for a player.
- [ ] Chain truth, team logs, and evidence reconcile.

### Scale gate

- [ ] M10 passes.
- [ ] Exactly ten stable seats exist.
- [ ] Exactly ten disposable Base Sepolia gameplay wallets map one-to-one.
- [ ] All registrations and balances pass.
- [ ] OpenClaw funding transactions match the approved manifest.
- [ ] Team-to-cause mapping is frozen.
- [ ] Orchestrator restart test passes.

### Floor deliverable

- [ ] One five-versus-five game completes.
- [ ] Winners/defaults are derived from chain truth.
- [ ] Evidence export reconciles.
- [ ] Replay fallback works from saved real evidence.

Multi-game learning and richer observer work remain optional after the floor deliverable.
