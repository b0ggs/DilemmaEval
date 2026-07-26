# Base Sepolia ETH transfer skill

This package gives the Maritime OpenClaw and Hermes seats the same narrowly
bounded ETH-transfer operation. It signs locally, targets Base Sepolia only
(chain ID `84532`), accepts only the fixed `openclaw-1` and `hermes-1` public
aliases, and caps one transfer at `0.01 ETH`.

It does not fund wallets, submit anything during installation/tests, retry a
send, accept arbitrary recipient addresses, or expose private keys. Live use
can spend testnet ETH and creates external blockchain state.

## Exact request forms

The text grammar is exact and case-sensitive:

```text
Send agent <alias> <positive-canonical-decimal-with-up-to-18-places> ETH
```

Example: `Send agent hermes-1 0.001 ETH`

The structured form has exactly three fields and no extras:

```json
{
  "action": "send_eth",
  "amount_eth": "0.001",
  "recipient_alias": "hermes-1"
}
```

The only aliases are `openclaw-1` and `hermes-1`. Values such as `.1`, `1e-3`,
numbers instead of decimal strings, zero, negatives, more than 18 fractional
digits, and amounts over `0.01` are rejected.

## Public recipient directory

Supply a public-only alias map at startup and do not let an agent modify it:

```js
const recipients = {
  "openclaw-1": "0xPUBLIC_ADDRESS_FROM_APPROVED_MANIFEST",
  "hermes-1": "0xPUBLIC_ADDRESS_FROM_APPROVED_MANIFEST"
};
```

The package validates, lowercases, deduplicates, and freezes the directory.
Do not put private keys, RPC URLs, or arbitrary user-provided addresses in it.

## Live adapter

Install the pinned dependency, then construct the live adapter in the agent:

```js
import { createLiveEthTransferSkill } from "@dilemmaeval/eth-transfer-skill/live";

const transfer = await createLiveEthTransferSkill({
  recipientDirectory: recipients,
  rpcUrl: process.env.ALCHEMY_BASE_SEPOLIA_RPC_URL
});

const result = await transfer.execute("Send agent hermes-1 0.001 ETH");
```

The local signer reads private-key material only from
`GAMEPLAY_WALLET_PRIVATE_KEY`. Maritime must inject that variable into its
assigned seat as a secret. Never pass it in a prompt, tool argument, manifest,
log, result, or command line. The RPC URL must be HTTPS and should likewise be
injected securely.

Before submission the helper checks chain ID, sender balance, estimated gas,
current fee data, and a non-configurable `0.00005 ETH` reserve. It submits the
same recipient, value, estimated gas limit, and validated legacy or EIP-1559
fee ceiling used by those checks. The live adapter performs a raw
`eth_chainId` check for `84532` on every execution and does not use static
network trust.

After `sendTransaction` is attempted it never retries. Any submission,
receipt, or invalid post-send response leaves that skill instance permanently
latched unless a valid successful receipt was obtained. A timeout or receipt
failure is reported as non-retryable/uncertain with the transaction hash when
known; check the chain and wallet nonce, then construct a new instance only
after operator verification.

Run offline unit tests with:

```sh
npm test
```

## Maritime custom-file CLI

`src/cli.mjs` is the production entrypoint for a Maritime custom-file
deployment. Invoke it as five separate arguments:

```sh
node src/cli.mjs Send agent hermes-1 0.001 ETH
```

It emits exactly one JSON line to stdout and exits `0` for a confirmed
transfer or `1` for any rejection/failure. It refuses transfer to the alias
configured as its own and verifies that the local signing key derives the
public address configured for that own alias before sending.

Required fixed environment names:

| Name | Purpose |
| --- | --- |
| `GAMEPLAY_WALLET_ALIAS` | This agent's own alias: `openclaw-1` or `hermes-1` |
| `OPENCLAW_1_WALLET_ADDRESS` | Public address for `openclaw-1` |
| `HERMES_1_WALLET_ADDRESS` | Public address for `hermes-1` |
| `ALCHEMY_BASE_SEPOLIA_RPC_URL` | Secret-bearing HTTPS Base Sepolia RPC URL |
| `GAMEPLAY_WALLET_PRIVATE_KEY` | This agent's locally used signing key; inject as a Maritime secret |

Do not place environment values in arguments. The CLI output serializer
whitelists known public result/error fields and never prints exception
messages, environment values, configuration, or secret material.
