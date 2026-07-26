# Existing-game CLI bridge

This leaf is a zero-runtime-dependency Node.js ESM wrapper around the command
surface already present in
[`botnotstrawberry/prisoners-daolemma`](https://github.com/botnotstrawberry/prisoners-daolemma)
at revision `955ce16a59b0efecf6ccdf2d391ede83de8902a8`.

It does not contain contract calls, an ABI, RPC logic, game rules, or signing
logic. The pinned game checkout remains the implementation authority.

## Runtime contract

1. Supply the root of an exact checkout through `DILEMMA_GAME_REPO`.
2. Install that checkout exactly as its own pinned package metadata requires.
3. Configure one explicit HTTPS Base Sepolia RPC URL as `allowedRpcUrl`.
4. Keep wallet keys/passwords in the player environment or password files.
5. Reference a password environment variable by name with
   `walletKeystorePasswordEnv`; only that value and the minimal
   `PATH`/`HOME`/`TMPDIR` process environment are passed to Yarn.
6. Call `createGameBridge({ allowedRpcUrl }).run(operation, options)`.
7. Treat the returned object as
   [`command-result.schema.json`](../shared/schemas/command-result.schema.json).

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

Commands have a default 30-second deadline and one-MiB combined output ceiling.
Timeout and excess output return structured errors. A referenced password is
redacted if the child echoes it in stdout, stderr, or parsed JSON.

```js
import { createGameBridge } from "./src/index.js";

const rpcUrl = "https://your-approved-base-sepolia-rpc.example";
const bridge = createGameBridge({ allowedRpcUrl: rpcUrl });
const snapshot = await bridge.run("state", {
  network: "base-sepolia",
  chainId: 84532,
  rpcUrl,
  game: "0x42892BEc3d1d926Db25FfB6A144ee363AaE40A1a",
  gameId: 1,
  registry: "0x7177a6867296406881E20d6647232314736Dd09A",
  chat: "0xc2604D5C87663efE959342F23c3DC9E4D9Db3e99",
});
```

## Capability matrix

| Bridge operation | Pinned repo alias | Mutability |
|---|---|---|
| `state` | `yarn query:summary` | Read |
| `wallet_auth_status` | `yarn auth:status` | Read |
| `join` | `yarn game:join` | Transaction |
| `prepare_commit` | `yarn game:prepare-commit` | Local bundle plus state read |
| `commit` | `yarn game:commit` | Transaction |
| `reveal` | `yarn game:reveal` | Transaction |
| `advance` | `yarn game:advance` | Transaction |
| `claim` | `yarn game:claim` | Transaction |

All commands include the pinned CLI's `--json` flag. `commit` and `reveal`
accept only prepared bundle paths; the bridge deliberately does not accept
choice/salt reveal material for those operations. Raw private-key and
`--allow-unsafe-private-key` arguments are not part of this API.

Choice values are not interpreted by this bridge; validation belongs to the
pinned CLI. The alias/flag inventory above matches the frozen project plan and
addendum. Primary-source comparison against the public pinned checkout remains
an explicit release check because that source was unavailable during this
offline remediation. Do not treat the fixture runner as proof of upstream CLI
compatibility.

## Tests

```bash
cd integration/game-bridge
npm test
```

The tests use a fake process runner and temporary fake checkout, plus bounded
local Node child processes for timeout/output-limit tests. They do not run
Yarn, call RPC, read live secrets, or submit transactions.
