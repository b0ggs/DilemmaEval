# Conference adapter contract v1

This is the shared implementation contract. ESM, Node >=22; decimal strings for chain integers/wei; UTC ISO strings for times. No signing keys, commit choices/salts, raw provider errors or SDK replies in coordinator state. Workers own only their assigned directories; request shared changes from lead.

## Configuration (lead)

`config`: `{schema_version:1, run_id, mode:'live'|'fixture', chain_id:84532, rpc_url, game_address, auth_adapter_address, identity_registry_address, expected_owner, start_block, start_time, stop_time, intermission_ms:20000, poll_interval_ms:5000, confirmations:2, roster:[{seat_id,team,harness,agent_id,maritime_agent,wallet_address,cause_id}], telegram:{openclaw:{chat_id,invite_url},hermes:{chat_id,invite_url}}}`. Roster 2–20 with unique seat, wallet and agent IDs; each harness supports numbered seats 1–10 and team/harness and oc-/hs- prefix agree. Configuration capacity is not provisioning authority: the five-vs-five launch command passes an explicit ten-agent ceiling so it can create exactly the seven missing game agents while the account-capacity read path uses the verified Starter limit of 20 total machines. `runtimeDir` is absolute and outside the repository. Secrets are injected into role-local adapters, never configuration. `start_block` scopes counters. Example config may have missing agent IDs and must fail live validation until bound.

## Chain (`src/chain/index.mjs`)

Recovery addition: reader also exposes `readBlockHash({blockNumber})`. Live runner persists the last confirmed cursor hash and checks it before moving its cursor or dispatching; a confirmed-chain fork blocks scheduling for explicit reconciliation.

Export `createChainReader({config, provider?})` returning `{readSnapshot({gameId?}={}), readEvents({fromBlock,toBlock?}), preflight()}`. `provider` is an ethers v6 provider when injected; lead supplies dependency. Reads use confirmed block tags. Snapshot is `{schema_version:1, chain_id:84532, game_address, game_id, active_game_id, round, phase:'idle'|'join'|'commit'|'reveal'|'terminal', outcome:null|'completed'|'cancelled', block_number, block_hash, block_timestamp, alive_count, committed_count, revealed_count, clock:null|{unit:'timestamp'|'block',current,deadline}, players:[{wallet_address,joined,alive,committed,revealed,award_wei,claimed_wei,refunded_wei}], config:{...}, transaction_hash:null|string}`. `game_id` is '0' only when no game exists. Terminal outcome must follow actual contract semantics.

Normalized event: `{id,game_id,round,kind:'created'|'joined'|'round-resolved'|'completed'|'cancelled'|'claimed'|'refunded',block_number,transaction_hash,log_index,data}`; `id` is tx hash + log index. `data` contains only publicly resolved outcomes/addresses/wei, never unrevealed moves. Completed/cancelled derive only from confirmed logs. Round-resolved data: `{choices:[{wallet_address,choice:'Share'|'Steal'|'Catch',defaulted,eliminated}],remaining_players}` where available from authoritative events. Completed data: `{awards:[{wallet_address,award_wei}]}`. Claims/refunds use `{wallet_address,amount_wei}`. Reader may return additional public preflight fields.

Export `createLauncherClient({url,token,fetchImpl?})` and `createPhaseExecutorClient(...)`; their methods are `create({action_id,source_block_number})` and `advance(intent)` respectively. The conference uses one `operator` server/CLI role for both methods on port 8791, backed by the owner wallet (`DILEMMA_LAUNCHER_PRIVATE_KEY`) and one authentication token. `createOperatorAdapters({url,token,fetchImpl?})` wires both clients to that endpoint. One queue and journal coordinate nonces across creation and advancement; journal records bind each action ID to its operation. No signers in coordinator. Return `{status:'accepted'|'confirmed-revert'|'race-or-revert'|'rejected-before-submit',reference?:{kind:'transaction-hash',value}}`. Persist intent/nonces/hash in operator-local storage before sending; reconcile uncertain submissions, never blind retry. Exact core advancement request accepted. Owner defaults configuration must refresh chain/owner/auth/idle, write all nine fields, preserve fees, read back. No live writes by worker.

## Maritime (`src/maritime/index.mjs`)

Export `createMaritimeAdapter({config,apiKey,runtimeEvidence?,fetchImpl?,timeoutMs?,oneAwake?,maxAwake?,maxAgents?})` returning `{dispatch(request),preflight()}`. `dispatch` receives `{seat,request,deadline_at_ms?,signal?}`; gameplay request is existing shared poke unchanged. `deadline_at_ms` is one wall-clock deadline for the entire queued wake/configure/chat/sleep operation, not a fresh timeout per stage, and `signal` is aborted by the runner at that boundary. Work that expires while still queued must reject before any remote mutation with a non-ambiguous `MARITIME_DISPATCH_EXPIRED` outcome and may be retried later with the same stable request ID. Once a remote POST has begun, a timeout or abort is ambiguous: cache that attempt, poison its awake permit, never replay it, and let the runner reconcile authoritative chain state. Return existing shared agent-response. Use existing validators/coordinator where appropriate, but no automatic transaction retry when remote cancellation is unknown. Stable request IDs across recovery. `oneAwake:true` retains the legacy serial rotation; `maxAwake:5` uses the bounded account-wide pool, counts unrelated awake machines, and releases a permit only after confirmed sleep.

Provisioning uses the official `maritime-sdk` client, injected as `maritime`, with `maxRetries:0`. Export versioned `OPENCLAW_RECIPE` and `HERMES_RECIPE` values plus `createConferenceLaunchWorkflow({config,runtimeDir,maritime,apiKey,secretProvider,maxAgents,oneAwake?,...})`. The workflow returns `{plan(),launch()}`. `plan()` is read-only and includes exact reuse/create/install/verify actions. `launch()` must: provision by stable `externalId`; validate returned ID/template/name; inject only the seat's `GAMEPLAY_WALLET_PRIVATE_KEY` via `agents.setEnv(...,{secret:true})`; persist the Hermes mini route as non-secret environment; reload and verify values; discover the persistent volume; upload/install the harness-neutral player artifact; configure both harnesses for `gpt-5.4-mini` with low reasoning, 2048 output tokens and no fallback; run public wallet/storage/model/tool/access checks; and atomically write a sanitized bound config plus runtime-evidence JSON outside the repository. Provision, environment mutation, upload/install, model configuration, verification, and any one-awake sleep transitions are journaled independently so uncertain mutations are never blindly repeated. Shared recipes contain no agent ID, wallet key, service token, or other secret. The five-vs-five command passes `maxAgents:10`; library defaults do not independently authorize expansion.

Discussion is a separate envelope: `{schema_version:1,type:'discussion',request_id,game_id,round,phase:'commit',seat_id,team,chain_state,team_chat,max_message_chars:200}`. Return `{schema_version:1,type:'discussion-response',request_id,game_id,round,phase:'commit',seat_id,team,status:'observed'|'skipped'|'error',team_message?}`; no transaction field. Export `validateDiscussionRequest`, `validateDiscussionResponse`, `discussionToLogResponse` (validates then maps to legacy agent response solely for TeamLogStore ingestion; never dispatches as a commit). Export roster reconciliation and install-artifact helpers; any scripts/docs stay in maritime directory. Preserve private per-seat bundles. No agent provisioning/chat/live mutations by worker.

## Runner (`src/runner/index.mjs`)

Export `createDurableStore({directory})`: async `get`, `putIfAbsent`, `set`, `compareAndSet`, `entries` matching orchestrator-core; atomic fsync/rename persistence. Export `createConferenceRunner({config,runtimeDir,chain,agents,launcher,phaseExecutor,spectator,now?})` returning `{initialize(),tick(),getState(),close()}`. `now` defaults to Date.now. Single-process lock acquired on initialize; stale lock recovery must check process existence. Tick non-overlapping. Read chain before all scheduling and resume. Persist launch intent before remote call, and reconcile rather than repeat unknown results. Reuse orchestrator-core advancement and TeamLogStore. Requests concurrent across seats. Once-per-round discussion completes before fresh same-team commit snapshots. Dispatch identity survives restart. The runner passes one end-to-end `deadline_at_ms` and abort signal to each adapter dispatch. A non-ambiguous `MARITIME_DISPATCH_EXPIRED` is persisted as `rejected-before-submit` and can retry with the same request ID while the phase remains current; reserved/unknown or other ambiguous attempts remain blocked until chain reconciliation and are never replayed. Agent ACKs never advance chain. Claims can be processed against previous terminal games while a new game runs. Cutoff stops new launches and reconciles current game. Continue through agent/Telegram outages with health flags. No choice generation.

`getState()` returns internal sanitized `{snapshot,events,game_ids,completed_game_ids,cancelled_game_ids,messages:{openclaw:[],hermes:[]},health:[],scheduling,updated_at}`. `events` durable normalized run events; counters are unique terminal game IDs created at/after start block (preexisting game excluded). Scheduling: `{status:'playing'|'intermission'|'stopped'|'blocked',next_game_at:null|ISO}`. Message records use existing team-message schema. `spectator.publish({messages,events,snapshot})` is awaited/caught but cannot block indefinitely; implementation must be bounded.

## Telegram (`src/telegram/index.mjs`)

Export `createTelegramMirror({config,runtimeDir,token,fetchImpl?,now?})` returning `{publish({messages,events,snapshot}),flush(),health()}`. Input messages are `{openclaw:[],hermes:[]}`. Durable dedup/outbox, bounded timeouts, 429 retry-after, ambiguous sends marked uncertain without blind resending. Dealer results prioritized and sent to both teams; accepted text preserved verbatim, names/game/round labels. `formatDealerEvent(event,config)` export. The controlled first-game proof may configure both teams to one shared chat: preserve both teams' labeled messages, serialize delivery per physical chat, and enqueue each Dealer event only once there. Distinct team chats remain the final conference target. Never reads spectator chat into agent inputs. Setup/read-only permission checklist in owned README, actual verification explicit.

## Public spectator API (lead projection, site consumption)

`GET /api/state`: `{schema_version:1,run_id,mode:'live'|'fixture',network:'Base Sepolia',chain_id:84532,updated_at,status:'starting'|'playing'|'intermission'|'stopped'|'degraded',next_game_at:null|ISO,roster:[{seat_id,team,harness,wallet_address}],counts:{completed,cancelled},current_game:null|{game_id,round,phase,alive_count,committed_count,revealed_count,clock},messages:{openclaw:[{seat_id,game_id,round,message,received_at}],hermes:[]},earnings:[{seat_id,wallet_address,awarded_wei,claimed_wei,refunded_wei}],latest_result:null|{game_id,outcome,transaction_hash,transaction_url,choices:[],awards:[]},links:{contract,telegram:{openclaw:null|string,hermes:null|string}},health:{ok,issues:[]}}`. Only allowlisted public fields, no raw runtime files or errors.

Site owns `conference/site/` exclusively. Prefer static HTML/CSS/JS served by runner with no dependencies; polls every 5s, visible fixture/stale states, roster-derived 2 vs 1, individual earnings first, live-only counters, terminal result-specific tx links. Own separate tests/package if useful. No wallet connection. Escape untrusted agent text with textContent.

## Ownership and acceptance

- Runner: `src/runner/**`, `test/runner/**`: restart/lock/idempotency, chain-only counters, strict deadline boundary, 3-seat concurrency, cutoff/claim recovery fixtures.
- Chain: `src/chain/**`, `test/chain/**`: pinned ABI reads/events, wrong-chain rejection, exact advancement/launcher isolation and uncertain tx reconciliation fixtures.
- Maritime: `src/maritime/**`, `test/maritime/**`: 3-seat roster identity, discussion validation, same-team context, no retry on ambiguous execution, persistent tool install/bundle design fixtures.
- Telegram: `src/telegram/**`, `test/telegram/**`: durable dedup, rate limits/outage/uncertainty, real text preservation, complete Dealer formatting fixtures.
- Site: `conference/site/**`: phone layout, dynamic roster/counters, correct denominator/links, stale/fixture/error handling.
- Lead: all other paths, dependencies, config/public API/entry point, integration tests, existing shared modules, live actions and status.

## Takeover hardening additions

These additions are the precondition for another live creation. They do not change the gameplay request or response schemas.

### Non-signing runtime diagnostic

Maritime exports a separate diagnostic boundary; it must never be routed through gameplay `dispatch`:

`createMaritimeAdapter(...)` additionally returns `diagnose({seat,request,deadline_at_ms?,signal?})`.

Diagnostic request:

```json
{
  "schema_version": 1,
  "type": "runtime-diagnostic",
  "request_id": "stable public identity",
  "seat_id": "oc-1",
  "team": "openclaw",
  "mode": "gameplay-input or commit-input",
  "chain_state": {
    "chain_id": 84532,
    "game_address": "0x...",
    "confirmed_block_number": "decimal string",
    "confirmed_block_hash": "0x..."
  }
}
```

The request is staged as public JSON and supplied through the same shell stdin mechanism as gameplay. `commit-input` requires the agent to select `share`, `steal`, or `catch` as a sibling of `request`; the runtime validates the location/value but never returns or persists the choice. `gameplay-input` has no choice. Both modes run wallet-identity, pinned-checkout, dependency/wrapper, private-state/lock, read-only chain-ID, and read-only contract checks. They must not invoke a player signer operation, create a gameplay request journal or bundle, or mutate chain state.

Diagnostic response:

```json
{
  "schema_version": 1,
  "type": "runtime-diagnostic-response",
  "request_id": "same identity",
  "seat_id": "oc-1",
  "team": "openclaw",
  "mode": "gameplay-input or commit-input",
  "status": "ready",
  "checks": {
    "stdin": true,
    "wallet_identity": true,
    "checkout": true,
    "dependencies": true,
    "wrapper": true,
    "private_state": true,
    "seat_lock": true,
    "chain_id": true,
    "contract_read": true
  }
}
```

Only this exact successful response shape is accepted. Fixed diagnostic error codes may be returned through the existing safe CLI error wrapper. The diagnostic uses the existing max-awake lifecycle and the same one-deadline/ambiguity rules as dispatch, including confirmed sleep before releasing a permit.

### Fresh readiness evidence

The lead composes diagnostic results into readiness evidence. Version 2 evidence adds:

- `schema_version:2`, `verified_at`, `expires_at`, `roster_fingerprint`, `config_fingerprint`, `transport_fingerprint`, and `confirmed_block_number/hash`;
- one row per seat with exact agent ID, harness, wallet, artifact digest, activation generation, model profile, both diagnostic modes, and confirmed final sleeping state;
- no choices, salts, prompts, sessions, raw replies, environment values, or private paths.

Validation uses an injected clock in tests and a maximum age of ten minutes. Evidence is invalid if it is expired or from the future, any fingerprint/identity differs, both diagnostic modes did not pass in one bounded run, activation generation differs, a lifecycle outcome is ambiguous, or final sleep is unconfirmed. Preparation and creation each validate the same evidence digest; a creation fuse binds that digest and the exact config digest.

### Durable proof dispatch outcomes

The controlled proof helper persists a sanitized dispatch record before invoking an adapter and terminally updates it for `submitted`, `observed`, `skipped`, `agent-error`, `rejected-before-submit`, `ambiguous`, or `cancelled-after-submit`. Every started dispatch remains represented even when another seat triggers the proof stop signal. Concurrent late completions are awaited or explicitly left `ambiguous`; they are never dropped. No raw exception, provider response, prompt, choice, salt, or private journal content enters proof evidence.
