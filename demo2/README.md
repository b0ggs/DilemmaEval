# Live Agent Transfer Dashboard

Pick a sender agent, a recipient agent, and an amount. Hit submit. The sender
agent is instructed live via Maritime, writes and signs its own Base Sepolia
transaction using its own wallet key, and the result populates in the page
once it's confirmed on-chain.

This is the interactive companion to a static snapshot demo (not included in
this branch) that shows one already-completed transfer. This one triggers a
*new* real transfer on demand.

## Placement — this depends on a checkout of the game repo

This folder is **not self-contained**. `server.js` reads the live roster and
per-seat secrets from a sibling `packages/harness/` tree that belongs to
[`botnotstrawberry/prisoners-daolemma`](https://github.com/botnotstrawberry/prisoners-daolemma)
(the pinned game repo this project's `integration/shared/runtime-source.json`
already references via `DILEMMA_GAME_REPO`), specifically:

- `../packages/harness/roster.json` — seat names, teams, wallet addresses
- `../packages/harness/.secrets/*.pass` — keystore passwords (gitignored in
  that repo, not present here)

To actually run this, drop (or symlink) this `demo2/` folder at the root of
a `prisoners-daolemma` checkout, alongside its `packages/` directory — same
pattern as this repo's own `game-bridge` integration already assumes. It
will not find agents/wallets if run standalone inside `DilemmaEval`.

## How it works

```
Browser (live-dashboard.html)
   │  fetch("/api/transfer", { from, to, amountEth })
   ▼
server.js (local only, holds no secrets itself)
   │  execFile("maritime", ["chat", from, instruction])
   ▼
Maritime agent container (has GAMEPLAY_WALLET_PRIVATE_KEY as its own env var)
   │  writes + runs its own Node/ethers script, signs, broadcasts
   ▼
Base Sepolia
   │
server.js polls the RPC for the receipt, returns the verified result
   ▼
Browser renders tx hash, addresses, block, gas, timestamp + Basescan link
```

The server never holds or sees a private key. It shells out to the already
`maritime login`-authenticated CLI to send the instruction, and reads public
RPC data to verify the result. The agent's own container is the only place
the signing key lives.

## Running it

```bash
cd demo2
npm install      # first time only - installs ethers
npm start        # or: node server.js
```

Open **http://localhost:8787**.

### Important: run this with `node`/`npm` directly, not via a sandboxed dev-server launcher

The backend needs real network access to reach `https://api.maritime.sh` (via
the `maritime` CLI) and `https://sepolia.base.org`. Some sandboxed preview/dev
environments isolate a launched process's network egress, which breaks the
`maritime chat` call with `fetch failed` even though the CLI works fine from
a normal terminal. If you hit that error, run `node server.js` from a plain
shell instead.

## Using the dashboard

1. **From** — the agent that will sign and send (any of the 10 seats:
   `openclaw-1`..`openclaw-5`, `hermes-1`..`hermes-5`).
2. **To** — the recipient agent (must differ from the sender).
3. **Amount (ETH)** — capped at **0.01 ETH** as a demo safety limit
   (`server.js`'s `handleTransfer` rejects anything above that, or `<= 0`).
4. **Submit transfer** — the button disables and shows a spinner while
   waiting on the agent's response and on-chain confirmation (typically
   10-60s total: LLM response time + tx broadcast + a few block
   confirmations).
5. On success, the **Transaction details** panel populates with the real
   hash, from/to addresses, value, block number, gas used, and timestamp,
   plus the agent's own raw reply and a **View on Basescan** link.
6. On failure (agent didn't report a hash, chat call failed, etc.) the status
   pill turns red and, where available, the agent's raw reply is still shown
   so you can see what it actually said.

## Known fragile bits

- **`step`/`min` mismatch on the amount input will silently block submit.**
  The amount field uses `step="any"` deliberately — an earlier version used
  `step="0.0001"` with `min="0.00001"`, which fails HTML5's strict step
  validation for the default value and blocks the native `submit` event from
  ever firing (no error shown, the button just does nothing). If you add
  stricter step validation back, make sure the default value is an exact
  multiple of both `step` and `min`.
- **Agent response format isn't guaranteed.** The transfer instruction asks
  the agent to "report back only the resulting transaction hash," and
  `extractTxHash()` regex-matches the first `0x` + 64 hex chars in the reply.
  If a framework's response wraps the hash in unexpected formatting, this
  still works (regex doesn't care about surrounding text), but if an agent
  fails to actually execute the transfer, there will be no hash to find and
  the request reports "Agent did not report a transaction hash" with the raw
  reply attached for debugging.
- **`maritime env set` needs `--reload` to actually reach a running
  container.** If you spin up new agents or change `GAMEPLAY_WALLET_PRIVATE_KEY`
  later, remember to run `maritime env reload <agent>` — otherwise the agent's
  live session won't see the new value even though `maritime env list` shows
  it as set. (Already applied to all 10 existing agents as of this writing.)

## Safety notes

- **Testnet only.** All amounts are Base Sepolia ETH, which has no real
  monetary value. The 0.01 ETH cap exists to keep demo runs from accidentally
  draining a wallet, not because the funds are worth anything.
- **No secrets in this directory.** Wallet keys live only inside each
  Maritime agent's own environment and in `../packages/harness/.secrets/`
  (gitignored). This server process authenticates to Maritime via the
  machine's existing `maritime login` session — nothing is stored or read
  from disk here.
- **Roster source of truth**: agent names/addresses are read live from
  `../packages/harness/roster.json` on every `/api/agents` call, so the
  dropdown always reflects the current roster.
