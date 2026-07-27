# Live Agent Transfer Dashboard

Pick a sender agent, a recipient agent, and an amount. Hit submit. The sender
agent is instructed live via Maritime, writes and signs its own Base Sepolia
transaction using its own wallet key, and a **live status feed updates in
real time** as the request actually progresses, before the final result
populates once it's confirmed on-chain.

This is the interactive companion to the static snapshot demo in `../demo/`
(which shows one already-completed transfer). This one triggers a *new* real
transfer on demand.

## How it works

```
Browser (live-dashboard.html)
   │  new EventSource("/api/transfer/stream?from=&to=&amountEth=")
   ▼
server.js (local only, holds no secrets itself)
   │  execFile("maritime", ["chat", from, instruction])
   │  emits SSE "stage" events as each step genuinely happens:
   │  sending → waiting → received → hash-found → verifying (per attempt) → confirmed
   ▼
Maritime agent container (has GAMEPLAY_WALLET_PRIVATE_KEY as its own env var)
   │  writes + runs its own Node/ethers script, signs, broadcasts
   ▼
Base Sepolia
   │
server.js polls the RPC for the receipt, emits an SSE "result" event
   ▼
Browser: live feed panel shows each stage as it arrives, then the
         Transaction details panel populates from the "result" event
```

The server never holds or sees a private key. It shells out to the already
`maritime login`-authenticated CLI to send the instruction, and reads public
RPC data to verify the result. The agent's own container is the only place
the signing key lives.

### Why the live feed shows request stages, not "agent thinking"

Two candidate sources for real per-request agent activity were checked and
ruled out before building this:

- **`maritime logs -f <agent>`** — only streams VM/kernel boot and gateway
  infrastructure logs, not activity tied to a specific chat request.
- **Maritime's chat API** — confirmed synchronous request/response only
  (`chat()` "send a message and wait for the reply"); no streaming, SSE, or
  token-by-token support anywhere in the platform.

So the live feed reports real telemetry about *this server's own* request
lifecycle (when the instruction was sent, when the reply arrived, each
real on-chain verification attempt) rather than simulating agent-internal
reasoning that isn't actually exposed anywhere.

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
4. **Submit transfer** — the button disables, and a **Live status** panel
   appears showing each real stage as it happens: instruction sent, waiting
   for a response (with a "still waiting…" nudge past 5s), response
   received, hash found, each on-chain verification attempt, then confirmed.
   Typically 10-60s total: LLM response time + tx broadcast + a few block
   confirmations.
5. On success, the **Transaction details** panel populates with the real
   hash, from/to addresses, value, block number, gas used, and timestamp,
   plus the agent's own raw reply and a **View on Basescan** link.
6. On failure (agent didn't report a hash, chat call failed, etc.) the status
   pill turns red, the live feed shows the error inline, and — where
   available — the agent's raw reply is still shown so you can see what it
   actually said.

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
- **The SSE endpoint (`/api/transfer/stream`) is `GET`, not `POST`**, because
  browser `EventSource` only supports `GET`. Sender/recipient/amount are
  passed as query params, not a JSON body — if you extend this, keep that in
  mind rather than trying to add a request body to the stream request.
- **One request per `EventSource`.** Submitting again while a previous
  transfer is still in flight closes the old connection first
  (`currentSource.close()`) rather than running two in parallel — the backend
  doesn't track multiple concurrent streams per client. Fine for a single-user
  demo, would need real session/request IDs to support concurrent transfers.
- **If the browser tab closes mid-request**, `server.js` detects it via the
  request's `close` event (`clientGone`) and stops emitting/polling rather
  than continuing to hammer the RPC for a client that's no longer listening —
  but the underlying `maritime chat` call itself can't be cancelled once
  started (the CLI doesn't expose a way to abort it), so the agent's
  transaction still completes even if you close the tab immediately after
  submitting.

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
