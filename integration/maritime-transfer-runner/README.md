# Maritime fallback transfer runner

This zero-dependency leaf prepares the bounded two-agent fallback chat demo
without making network calls. It follows the existing
`maritime-pilot-client` safety patterns: fixed identities, local
private-key/address validation, non-reflecting errors, public-only output,
one-run secret access, and exact live authorization.

## Fixed secret inputs

The runner accepts one absolute `secretRoot` and reads exactly:

```text
<secretRoot>/pilot.env
<secretRoot>/wallets/openclaw-1.json
<secretRoot>/wallets/hermes-1.json
```

It never scans or loads another wallet file. It requires the handoff
permissions: `0700` on both directories and `0600` on all three files, with no
symlinks.

`pilot.env` must contain exactly:

```dotenv
MARITIME_API_KEY=<local secret>
ALCHEMY_BASE_SEPOLIA_RPC_URL=<local secret-bearing URL>
PLAYER_WALLETS_DIRECTORY=<secretRoot>/wallets
```

It may also contain `ALCHEMY_API_KEY`. When present, the runner requires it to
match the final `/v2/` segment of `ALCHEMY_BASE_SEPOLIA_RPC_URL`.

Do not place values in Git, chat, Markdown, command arguments, logs, or test
fixtures. The local runner validates a Maritime `mk_` credential shape and an
HTTPS Alchemy `/v2/` RPC shape without returning either value.

Each wallet JSON must keep the handoff shape:

```json
{
  "seat_id": "openclaw-1 or hermes-1",
  "team": "openclaw or hermes",
  "address": "<public address>",
  "private_key": "<local disposable testnet key>"
}
```

The runner derives each Ethereum address locally through the existing audited
game bridge, checks the supplied address, and rejects duplicate keys or public
addresses.

## Public alias directory

Dry-run emits:

| Alias | Seat | Maritime identity |
|---|---|---|
| `openclaw-1` | `oc-1` | `dilemmaeval-pilot-openclaw` |
| `hermes-1` | `hs-1` | `dilemmaeval-pilot-hermes` |

Each row also contains only its public Base Sepolia wallet address. Both agents
receive the same public directory and byte-identical instructions.

The only accepted chat syntax is exactly:

```text
Send agent <alias> <decimal> ETH
```

Amounts must be positive plain decimals no greater than `0.01 ETH`, with at
most 18 decimal places.
Scientific notation, unknown aliases, self-transfers, capitalization changes,
extra words, and non-ETH units fail closed.

## Dry-run

```js
import { createMaritimeTransferRunner } from "./src/index.mjs";

const runner = createMaritimeTransferRunner({
  secretRoot: "/Users/wade/.config/dilemmaeval-pilot"
});

const publicPlan = await runner.dryRun();
```

Dry-run reads and locally validates the three fixed inputs. It emits public
addresses, aliases, validation booleans, identical agent instructions, and
live-gate status. It cannot invoke the injected live binding.

Run the local tests:

```sh
cd integration/maritime-transfer-runner
npm test
```

## Explicit live gates and current binding

This repository currently verifies the pilot client's Maritime provisioning
and masked environment operations, but it does not locally verify the current
SDK deploy-plus-chat surface needed for the fallback transfer demo. This leaf
therefore contains no Maritime endpoint, CLI command, SDK import, SDK method
name, retry behavior, or package installation.

Live execution is impossible unless all three are supplied:

1. exact `LIVE_TRANSFER_AUTHORIZATION`;
2. exact `VERIFIED_LIVE_BINDING_ATTESTATION`, asserted only after an operator
   checks the installed current SDK/CLI surface; and
3. an injected `liveBinding.execute(...)` implementation.

`src/maritime-live-binding.mjs` is the reviewed time-critical binding for
`maritime-sdk@0.6.0` with `maxRetries: 0`. It provisions the two fixed
templates, injects the assigned wallet as an encrypted environment secret,
uploads the pinned transfer helper as custom build files, redeploys, verifies
the masked secret, and sends one exact chat command. While the supplied
Alchemy endpoint returns HTTP 401, this binding is intentionally locked to
the public Base Sepolia RPC `https://sepolia.base.org`.

The binding receives the deeply frozen public plan, validated transfer
command, and one-run getters for only:

- Maritime API credential;
- Alchemy Base Sepolia RPC URL;
- `oc-1` wallet private key; and
- `hs-1` wallet private key.

The binding must provision/reconcile the two fixed agents, configure each
assigned wallet and RPC access, deploy byte-identical instructions and the
same public alias directory, and deliver the exact validated chat command.
It must consume secrets only in memory and must never return or log them.

Until that binding is independently verified and injected, the exact deferred
live hook is `current_maritime_deploy_and_chat_binding`; attempts fail with
`LIVE_BINDING_DEFERRED`. No live action was performed while building or
testing this leaf.
