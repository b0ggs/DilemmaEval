# Existing-game CLI bridge

This leaf is a zero-runtime-dependency Node.js ESM wrapper around the command
surface already present in
[`botnotstrawberry/prisoners-daolemma`](https://github.com/botnotstrawberry/prisoners-daolemma)
at revision `955ce16a59b0efecf6ccdf2d391ede83de8902a8`.

It does not contain contract calls, an ABI, game rules, or transaction-signing
logic. Its only RPC logic is the fail-closed `eth_chainId` safety check. The
pinned game checkout remains the gameplay implementation authority.

## Runtime contract

1. Supply the root of an exact checkout through `DILEMMA_GAME_REPO`.
2. Install that checkout exactly as its own pinned package metadata requires.
3. Configure one explicit HTTPS Base Sepolia RPC URL as `allowedRpcUrl`.
4. Set exactly one `executionRole`: `player`, `phase-advancer`, or
   `read-only`. Their operation sets are disjoint.
5. Give each player process exactly one disposable Base Sepolia key as
   `GAMEPLAY_WALLET_PRIVATE_KEY`. Only `join`, `prepare_commit`, `commit`,
   `reveal`, `claim`, and player-local `register` receive that value.
6. Give the non-player phase-advancer process a separate disposable Base
   Sepolia key as `PHASE_ADVANCER_PRIVATE_KEY`. Only `advance` receives its
   value, mapped to the pinned CLI's `GAMEPLAY_WALLET_PRIVATE_KEY` child
   variable. Never reuse one of the ten player wallets for this role.
7. Keep both signer variables absent from `read-only`; never co-reside player
   and phase keys in one process.
8. Use the default bounded JSON-RPC `eth_chainId` verifier, or inject an
   equivalent reviewed `chainVerifier` for tests. Every signer operation calls
   it before Git and again immediately before signed Yarn; both must return
   `84532`.
9. Pass the validated public `seatManifest` and `operationsManifest`, plus the
   role-local expected wallet. Player wallets must be unique seats, and the
   phase wallet must match the operations manifest and be absent from seats.
10. For the phase role, pass a non-empty `forbiddenPrivilegedWallets` array
    containing every public owner/funding/billing or other privileged address.
11. For bundle operations, configure a prepared, real, player-local absolute
    `artifactDirectory` outside and disjoint from the pinned checkout.
12. Treat the returned object shape as
   [`command-result.schema.json`](../shared/schemas/command-result.schema.json).

A signer operation with neither its operation-appropriate environment key nor
an exact canonical `0x` plus 64-hex value stops before Git or Yarn. There is no
keystore or generic wallet signer fallback. Legacy `walletKeystore`,
`walletKeystorePasswordEnv`, `walletKeystorePasswordFile`, and signer `wallet`
options are rejected. `register` alone may carry optional `wallet`, strictly as
the expected public address consumed by the pinned auth CLI.

The default `chainVerifier` sends a bounded, timed, strict JSON-RPC
`eth_chainId` request through global `fetch`. It receives exactly the active
`rpcUrl` and `expectedChainId: 84532`; it never receives either signing key.
Unavailable, oversized, stalled, malformed, or mismatched verification fails
closed before checkout verification or command execution. A second check after
checkout validation prevents chain drift before a signed command.

Before chain verification, every signer operation locally derives the public
address from the operation-appropriate private key and compares it with the
approved role manifest. A correctly formatted player key copied into
`PHASE_ADVANCER_PRIVATE_KEY`, or the inverse, is rejected before Git or Yarn.
The dependency-free bridge primitive derives an uncompressed secp256k1 public
key with Node crypto and applies Ethereum Keccak-256 locally. An injected
replacement is a trusted in-process primitive: it necessarily receives the
private key, must not make a remote call, and must never log, persist, or
return the key. `register --wallet`, when supplied, must match the same derived
and manifest-bound player address. Player and phase manifest wallets may not
coincide. The phase wallet must also differ from the runtime owner and every
caller-supplied privileged public address.

Every operation must explicitly supply the frozen `network`, `chainId`,
`rpcUrl`, tournament game address, and the operation-specific frozen registry
or chat addresses. The bridge loads these values from
`../shared/runtime-source.json`, rejects a different network/RPC/address before
starting a process, and redacts the RPC URL from returned arguments.

Before every command, the bridge verifies the checkout root, pinned `HEAD`, and
clean tracked/index/worktree state. It runs `git` and `yarn` directly with
argument arrays and `shell: false`. The check and Yarn spawn cannot be one
atomic local-filesystem operation; the checkout must remain under the sole
control of the orchestrator account during a run. The bridge narrows that race
by checking immediately before execution, but does not claim to eliminate it.
Any file or symlink at `packages/foundry/.env` rejects the checkout before Git
or Yarn.

`prepare_commit.out` and `commit`/`reveal.input` must be normalized absolute
paths contained by the configured artifact directory. Output must not already
exist; input must be a real regular file. Relative, traversal, symlink,
cross-seat, checkout-contained, and checkout-containing paths fail closed.

Commands have a default 30-second deadline and one-MiB combined output ceiling.
Timeout and excess output return structured errors. A forwarded key is
redacted case-insensitively—including arbitrary mixed-case hex and with or
without `0x`/`0X`—if the child echoes it in stdout, stderr, parsed JSON
property names/values, or an upstream structured error. Git verification and
read-only operations receive neither signing key; unrelated environment
variables are excluded from every child.

```js
import { createGameBridge } from "./src/index.js";

const rpcUrl = "https://your-approved-base-sepolia-rpc.example";
const bridge = createGameBridge({
  allowedRpcUrl: rpcUrl,
  executionRole: "player",
  seatManifest,
  operationsManifest,
  expectedGameplayWallet: selectedSeat.wallet_address,
  expectedPhaseAdvancerWallet:
    operationsManifest.phase_advancer.wallet_address,
  artifactDirectory: `/var/lib/dilemmaeval/${selectedSeat.seat_id}/artifacts`,
});
const joined = await bridge.run("join", {
  network: "base-sepolia",
  chainId: 84532,
  rpcUrl,
  game: "0x42892BEc3d1d926Db25FfB6A144ee363AaE40A1a",
  gameId: 1,
  causeId: 1,
});
```

## Local production primitives

- `deriveEthereumAddress(privateKey)` derives a lowercase Ethereum address
  locally from a canonical private key.
- `localSignerAddressDeriver({ privateKey })` is the default async bridge
  adapter around that derivation.
- `createJsonRpcChainVerifier({ fetchImpl, timeoutMs, maxResponseBytes })`
  creates the strict `eth_chainId` verifier. It defaults to global `fetch`, a
  five-second deadline, and a 4-KiB streaming response ceiling. Dependency
  injection exists for deterministic tests, not to weaken production checks.

## Capability matrix

| Bridge operation | Pinned repo alias | Mutability |
|---|---|---|
| `state` | `yarn query:summary` | Read |
| `wallet_auth_status` | `yarn auth:status` | Read |
| `register` | `yarn auth:register` | Player-local transaction |
| `join` | `yarn game:join` | Transaction |
| `prepare_commit` | `yarn game:prepare-commit` | Local bundle plus state read |
| `commit` | `yarn game:commit` | Transaction |
| `reveal` | `yarn game:reveal` | Transaction |
| `advance` | `yarn game:advance` | Transaction |
| `claim` | `yarn game:claim` | Transaction |

The bridge exposes nine command families. All commands include the pinned
CLI's `--json` flag. `commit` and `reveal`
accept only prepared bundle paths; the bridge deliberately does not accept
choice/salt reveal material for those operations. Raw private-key and
`--allow-unsafe-private-key` arguments are not part of this API.
The bridge intentionally omits the pinned `auth:register` command's optional
`--out` flag and consumes its JSON stdout instead.

The shared command-result schema includes all nine operation names, including
`register`, and every returned outcome is tested against that shared shape.

The phase advancer is orchestration infrastructure, not a player and not a
decision maker. Its key exists only to submit a contract-authorized
`game:advance` call after the separately reviewed on-chain count/deadline rule
allows it. The bridge does not decide when advancement is valid.

Choice values are not interpreted by this bridge; validation belongs to the
pinned CLI. The alias/flag inventory above was compared with the public pinned
checkout at revision `955ce16a59b0efecf6ccdf2d391ede83de8902a8`.
Runtime checkout verification and a live S02 proof remain release gates; the
fixture runner alone is not proof of upstream installation or transaction
compatibility.

## Tests

```bash
cd integration/game-bridge
npm test
```

The tests use a fake process runner, mocked fetch/chain verification, and a
temporary fake checkout, plus bounded local Node child processes for
timeout/output-limit tests. Known Ethereum address vectors cover the real
local derivation. Mocked JSON-RPC cases cover Base Sepolia, Base mainnet,
malformed/error/oversized responses, fetch timeout, and stalled body timeout.
`oc-1`, `hs-1`, and phase-advancer fixtures generate three distinct
runtime-only placeholder keys and prove seat/role address mapping and process
isolation. Tests do not run Yarn, call RPC, read live secrets, or submit
transactions.
