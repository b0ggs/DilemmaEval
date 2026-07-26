# Two-seat Maritime pilot preflight

Local-only, zero-dependency preflight for the bounded fallback pilot:

- `oc-1` / `openclaw`
- `hs-1` / `hermes`
- Base Sepolia (`network: "base-sepolia"`, derived chain ID `84532`)

This package accepts only a public seat manifest shaped by
`../shared/schemas/seat-manifest.schema.json`. The shared schema intentionally
does not contain `chain_id`; its fixed `base-sepolia` network value maps to
chain ID `84532` in the generated plan. No shared schema is changed here.

## Safety boundary

The preflight:

- requires exactly the two pilot seats, with matching team and harness;
- requires distinct, syntactically valid 20-byte Ethereum addresses;
- requires the exact stable Maritime SDK idempotency references
  `dilemmaeval-pilot-openclaw` and `dilemmaeval-pilot-hermes`;
- rejects unknown fields and detects private-key, environment, API token,
  authorization, credential, and secret-bearing RPC fields before validation;
- rejects common private-key-, `sk-`/Maritime `mk_` API-token-, JWT-, assignment-, and
  Alchemy/Infura-secret-shaped string values;
- produces a deterministic, deeply frozen plan from the JavaScript API;
- performs no network calls, wallet access, SDK calls, agent creation,
  environment changes, address proofs, funding, or transactions.

Do not put a private wallet JSON, API key, RPC URL, environment object, or
token in the manifest. The literal `GAMEPLAY_WALLET_PRIVATE_KEY` appears only
as the fixed name of a future per-agent configuration action; no value is
accepted or emitted.

## Public manifest

Use the exact shared-schema fields:

```json
{
  "schema_version": 1,
  "network": "base-sepolia",
  "game_id": "two-seat-pilot",
  "seats": [
    {
      "seat_id": "oc-1",
      "team": "openclaw",
      "harness": "openclaw",
      "maritime_agent": "dilemmaeval-pilot-openclaw",
      "wallet_address": "YOUR_PUBLIC_OC_WALLET_ADDRESS"
    },
    {
      "seat_id": "hs-1",
      "team": "hermes",
      "harness": "hermes",
      "maritime_agent": "dilemmaeval-pilot-hermes",
      "wallet_address": "YOUR_PUBLIC_HS_WALLET_ADDRESS"
    }
  ]
}
```

Place the public manifest wherever your handoff session specifies. This
package does not establish a location for any secret file.

## Run

Requires Node.js 20 or newer:

```sh
cd integration/pilot-preflight
npm test
npm run dry-run -- --manifest /path/to/public-seat-manifest.json
```

Successful output is a secret-free plan. It contains six typed `pending`
steps: agent creation, wallet-environment configuration, and masked
wallet-environment verification for each seat. Every live step requires
explicit operator approval. This package remains dry-run-only; the verified
SDK executor is the sibling `../maritime-pilot-client` module. This bounded
fallback verifies wallet assignment and masked secret presence without
claiming an agent-side wallet command is installed.

## JavaScript API

```js
import {
  buildTwoSeatPilotPlan,
  validateTwoSeatManifest
} from "./src/index.mjs";
```

`validateTwoSeatManifest(manifest)` returns a normalized, deeply immutable
public manifest. `buildTwoSeatPilotPlan(manifest)` returns a deterministic,
deeply immutable dry-run plan.

## Live executor handoff

The sibling `../maritime-pilot-client` module implements the verified
`maritime-sdk@0.6.0` mapping for the three plan step types:

1. `create_agent`
2. `configure_wallet_environment`
3. `verify_masked_wallet_environment`

The preflight itself never imports the SDK or performs a live action. The
executor requires exact live authorization, resolves wallet material out of
band, derives and compares each public address locally before Maritime,
injects the key only into the assigned agent, and verifies the SDK's masked
secret-presence result. A concrete external secret loader/live command is
deferred until the human secret handoff is complete.
