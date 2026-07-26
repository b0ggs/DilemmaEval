# Prisoners DAOlemma Maritime Tournament
## Locked Decisions and Open Items (Decision Sheet v1.0)

**Date:** July 26, 2026
**Purpose:** Turn the planning handoff into a set of frozen decisions for an 8-hour demo build.
**Feeds:** the implementation plan.
**Companion doc:** `prisoners-daolemma-maritime-tournament-planning-handoff-v1_0.md`

This sheet records what is decided. It replaces the open items in the handoff where they conflict. The game contract behavior remains authoritative for the game itself.

---

## 1. What this demo is

Two agent harnesses play the same on-chain elimination game with the same model. OpenClaw on one side, Hermes on the other. Every move, elimination, and payout is on-chain and auditable. Chat is off-chain on Discord. The point is to compare how two full harnesses coordinate, communicate, and survive under the same model and prompt.

Starting size is small on purpose. We can add players later.

---

## 2. Locked decisions

### 2.1 Tournament shape

- Teams are 5 versus 5. Ten players total to start.
- Scaling to 16 or 32 later is just adding agents.
- Game count: one complete game is the floor. Run three if timing holds. Five is a stretch goal, not a promise.
- Series winner is the team with more game wins. A single game wins the match by having more surviving contract winners on its side. Equal counts or no winners is a draw.
- The contract does not name a team winner. The scoring layer derives it from contract truth.

### 2.2 Chat

- Chat is off-chain. We do not use the on-chain `GameChat` contract for the demo.
- Platform is Discord. It is free, it keeps full history, and it posts under custom names through webhooks.
- Each team gets its own channel. An optional global channel can carry cross-team messages.
- Tradeoff accepted: we lose the "messages are auditable on-chain" claim. Moves, eliminations, and payouts stay on-chain, so game truth is unchanged.

### 2.3 Agents and signing

- Each of the ten players is a separate Maritime agent running its own harness.
- Each agent signs its own transactions. The wallet skill puts a plaintext testnet private key in the agent's environment and the CLI signs with it. No separate signing site.
- Each agent posts to Discord directly through a shared webhook per team channel, overriding the username to its own seat label.
- Wallets are disposable, funded up front, and reused across games. No mainnet assets ever touch them.
- Default-to-Share is accepted. If an agent fails to commit or reveal, the contract scores it as Share. A crashed or slow agent plays the cooperative move and is not eliminated for silence. This is fine for the demo. It should still be shown as a distinct "defaulted" state in the observer so a dead agent is not mistaken for a cooperating one.

### 2.4 Model

- Provider is OpenAI. Exact model is still to pick, something cheap and fast.
- Both harnesses must reach OpenAI the same way. Hermes defaults to an OpenRouter-style config, so point it straight at OpenAI to match OpenClaw. Same model, same route, same settings.
- This parity check is the first spike. If the two harnesses do not reach the same model the same way, the fairness claim fails and there is no tournament.

### 2.5 Orchestrator

- The orchestrator is a plain always-on script. It is not a Maritime agent. Maritime agents sleep, and the clock cannot sleep.
- It runs on a small cloud VM, not a laptop.
- It does little. It watches the chain, it pokes each agent when it is time to act, it advances phases, and it writes game state to a file for the observer.
- It never picks a move, never writes a message for an agent, and never submits a transaction for a player.
- It is resumable. On restart it reads game state from the chain and picks up mid-game. Wrap it to auto-restart on crash.

### 2.6 How agents are driven

- Push model. The orchestrator pokes each agent through Maritime when a phase starts. The Maritime poke is what wakes a sleeping agent. This is the reliable trigger.
- Discord is chat only. A Discord message does not wake a Maritime agent, so it is never used as the trigger.
- Agents are not instant. After a poke, an agent reads state, decides, signs, and sends. That is seconds to tens of seconds of model latency per agent. Block windows that advance early keep this acceptable.
- Recommended reading path: the orchestrator includes recent chat text inside the poke, so the agent always has fresh messages when it acts. The agent still posts to Discord itself. Confirm this reads cleanly in the first spike.

### 2.7 Contract and funding

- Owner access is confirmed. Owner and coordinator address: `0xDb463b29c82138188d5e425EDe5E0Fcbb09f1408`.
- Because we have owner access, we reconfigure the existing deployment for ten players, set the fee, and set timing. Redeploy is a fallback only.
- Reuse the successful Base Sepolia deployment if it passes preflight. Candidate addresses to verify live, not to trust from memory:
  - PrisonersDAOlemma: `0x42892BEc3d1d926Db25FfB6A144ee363AaE40A1a`
  - GameChat: `0xc2604D5C87663efE959342F23c3DC9E4D9Db3e99`
  - ERC-8004 auth adapter: `0xc893Ca037b796e7710a4948Bbb6fBfb94539b806`
- Entry fee is 0.001 ETH per game per agent, confirmed from the contract config and configurable before each game. If testnet ETH is scarce, lower the fee rather than cut players.
- Fund every wallet generously up front from the coordinator wallet. Verify balances before launch.
- Winners claim their prizes. Redistribution is skipped for the demo. Fund enough that we do not run dry across the planned games.

### 2.8 Timing

- Commit and reveal windows are counted in blocks, not seconds. Only the join window is in seconds. Base Sepolia makes a block about every two seconds.
- Windows are a maximum, not a fixed wait. Once every alive agent has acted, anyone can advance the phase immediately. Fast agents mean fast rounds.
- With five versus five, windows can be modest. Set them at launch so a slow agent still fits inside one. A round should sit around two hundred seconds at the ceiling and usually less.
- Read the live config during preflight. Do not trust window values from memory.

### 2.9 Observer

- The live chat feed is Discord itself. That is free and real.
- A small stats page is optional. The chain has no live push, so the page pulls. The orchestrator already reads chain state each phase, so it writes a small state file and the page refreshes from that every few seconds.
- Replay is the fallback if live timing fails. It reads a saved evidence package and shows the same thing, clearly labeled as replay, using real captured data.

---

## 3. Open items still to decide

Each of these needs one answer before or during the build.

1. Exact OpenAI model. Something cheap and fast. Pick before the parity spike.
2. Number of scored games for the demo: one, three, or five. One is the floor.
3. Whether to build the optional stats page or run the demo on Discord plus replay alone.
4. Where the small cloud VM lives and who owns it.
5. Debrief delivery for multi-game learning. After each game every agent should get the same factual summary in a way that lands in its memory. The exact channel per harness is unresolved and only matters once we run more than one game.
6. Final commit and reveal window sizes for ten players, set at launch.

---

## 4. First-hour spikes

These are the checks that can kill the design. Run them before building anything polished.

1. **Model parity.** Prove one OpenClaw agent and one Hermes agent both reach the same OpenAI model the same way, with the same settings. This is the hard gate.
2. **Self-signing inside Maritime.** Prove a Maritime agent can run the Node CLI with a private key in its environment and send a real Base Sepolia transaction.
3. **Poke and act.** Prove the orchestrator can wake a sleeping Maritime agent, hand it recent chat, and get it to commit and reveal on time.
4. **Owner config.** Prove the owner address can set player count, fee, and timing on the live deployment, so we do not have to redeploy.
5. **Persistence.** Prove the same agent returns after a gap with its memory intact, and that both harnesses do this the same way. This underpins the learning claim.

If any of the first three fail, stop and fix before scaling to ten agents.

---

## 5. What to build, trimmed to this design

- **Agent game kit**, shared by both harnesses: wallet skill, auth skill, play commands for join, commit, reveal, and claim, a state reader, and a Discord post tool.
- **OpenClaw adapter and Hermes adapter**, each just enough to install the same kit and reach the same model.
- **Maritime fleet setup** for ten persistent agents with stable identities.
- **Wallet and funding coordinator**, run from the owner address, to collect addresses, fund, and register ERC-8004 identities.
- **Orchestrator** on a VM: watch the chain, poke agents, advance phases, relay recent chat into pokes, write the state file.
- **Evidence export** from the existing repo commands after each game.
- **Observer**: Discord for live, an optional stats page from the state file, and replay from saved evidence.

---

## 6. Build order

1. Run the five first-hour spikes.
2. Get one OpenClaw agent and one Hermes agent through a full round on the live contract.
3. Scale to ten agents, fund and register all of them.
4. Play one complete five versus five game end to end with evidence export.
5. Add the observer and the replay fallback.
6. If time holds, run a second and third game and show behavior across games.

Do not rewrite the contracts. Do not build a fancy dashboard before one real game runs.
