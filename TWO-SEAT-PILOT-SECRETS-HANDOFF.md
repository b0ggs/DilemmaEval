# Two-seat pilot secrets handoff

## Local placement

The hackathon fast path uses plaintext local files outside the repository.
They are visible in VS Code through a gitignored symlink.

| Purpose | Real local path | Permission |
|---|---|---|
| Secret root | `/Users/wade/.config/dilemmaeval-pilot` | `0700` |
| API environment | `/Users/wade/.config/dilemmaeval-pilot/pilot.env` | `0600` |
| Player-wallet directory | `/Users/wade/.config/dilemmaeval-pilot/wallets` | `0700` |
| Individual wallet JSON | `/Users/wade/.config/dilemmaeval-pilot/wallets/<seat>.json` | `0600` |
| VS Code workspace link | `pilot-secrets-local` | Gitignored symlink |

The plaintext risk is accepted only for disposable hackathon/testnet
credentials. Do not reuse these credentials for mainnet or valuable assets.

## API environment file

Fill in:

```dotenv
MARITIME_API_KEY=
ALCHEMY_BASE_SEPOLIA_RPC_URL=
PLAYER_WALLETS_DIRECTORY=/Users/wade/.config/dilemmaeval-pilot/wallets
```

`MARITIME_API_KEY` is the current Maritime SDK credential name.
`ALCHEMY_BASE_SEPOLIA_RPC_URL` is the local pilot loader name: repository code
defines no RPC environment name and accepts the URL as in-memory
`allowedRpcUrl` and `rpcUrl` values.

Do not put private keys in `pilot.env`.

## Player wallet files

Keep each supplied object unchanged in its own JSON file:

```json
{
  "seat_id": "hermes-1",
  "team": "hermes",
  "address": "<PUBLIC_WALLET_ADDRESS>",
  "private_key": "<PRIVATE_KEY>"
}
```

Example filenames:

```text
wallets/hermes-1.json
wallets/hermes-2.json
wallets/hermes-3.json
wallets/hermes-4.json
wallets/hermes-5.json
wallets/openclaw-1.json
wallets/openclaw-2.json
wallets/openclaw-3.json
wallets/openclaw-4.json
wallets/openclaw-5.json
```

The two-seat pilot mapping is:

| Repository seat | Harness/team | Local wallet file |
|---|---|---|
| `oc-1` | OpenClaw | `wallets/openclaw-1.json` |
| `hs-1` | Hermes | `wallets/hermes-1.json` |

This mapping selects filenames only. It does not copy keys into coordinator
state. The implementation loader must read one target file, derive and compare
its public address, then inject that key directly into only its assigned
Maritime agent as `GAMEPLAY_WALLET_PRIVATE_KEY`.

## Permissions

```sh
chmod 700 "/Users/wade/.config/dilemmaeval-pilot"
chmod 700 "/Users/wade/.config/dilemmaeval-pilot/wallets"
chmod 600 "/Users/wade/.config/dilemmaeval-pilot/pilot.env"
chmod 600 "/Users/wade/.config/dilemmaeval-pilot/wallets/"*.json
```

## Verified environment names

| Name | Status |
|---|---|
| `GAMEPLAY_WALLET_PRIVATE_KEY` | Verified in repository bridge code |
| `PHASE_ADVANCER_PRIVATE_KEY` | Verified in repository bridge code; not used or created for this fallback pilot setup |
| `DILEMMA_GAME_REPO` | Verified in repository bridge code; non-secret checkout path |
| `MARITIME_TOKEN` | Verified repository/Maritime CLI credential name |
| `MARITIME_API_KEY` | Verified current Maritime SDK credential name; selected for this local file |
| `ALCHEMY_BASE_SEPOLIA_RPC_URL` | Explicit local pilot loader name; not a repository-defined variable |

## Wallet validation requirement

Before either wallet is injected, validate each JSON locally without printing
its private key. Report only:

- wallet count;
- private-key format validity;
- derived public address;
- derived-address uniqueness; and
- whether the supplied public address matches.

Do not print the environment file, dump process environments, or display wallet
JSON in logs.

## Public-only manifest template

```json
{
  "network": "base-sepolia",
  "chain_id": 84532,
  "seats": [
    {
      "seat_id": "oc-1",
      "team": "openclaw",
      "harness": "openclaw",
      "wallet_address": "<OC_1_PUBLIC_WALLET_ADDRESS>"
    },
    {
      "seat_id": "hs-1",
      "team": "hermes",
      "harness": "hermes",
      "wallet_address": "<HS_1_PUBLIC_WALLET_ADDRESS>"
    }
  ]
}
```

No private-key, RPC-URL, API-token, mnemonic, seed, password, or phase-advancer
field belongs in the public manifest.

## Implementation-session handoff

The implementation session needs only:

- this handoff file;
- `/Users/wade/.config/dilemmaeval-pilot/pilot.env`;
- `/Users/wade/.config/dilemmaeval-pilot/wallets`;
- `oc-1` to `openclaw-1.json`;
- `hs-1` to `hermes-1.json`;
- `GAMEPLAY_WALLET_PRIVATE_KEY`;
- Base Sepolia chain ID `84532`; and
- public addresses produced by the secret-safe validator.

It must not receive private keys in chat, Markdown, command arguments, Git, a
public manifest, or general coordinator state.
