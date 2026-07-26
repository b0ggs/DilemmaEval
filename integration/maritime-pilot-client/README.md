# Maritime two-seat pilot SDK executor

This leaf maps the validated public pilot manifest to the verified official
TypeScript `maritime-sdk@0.6.0` surface:

- idempotent `agents.provision({ externalId, name, template })`;
- encrypted `agents.setEnv(..., { secret: true })`;
- `agents.reloadEnv(id)`;
- masked verification through `agents.listEnv(id)`.

It creates no agent unless the caller supplies the exact
`LIVE_PILOT_AUTHORIZATION` constant at execution time. Tests inject a fake SDK;
they make no network or paid call.

## Fixed scope

Exactly two idempotent identities are accepted:

| Seat | Template | External ID/name |
|---|---|---|
| `oc-1` | `openclaw` | `dilemmaeval-pilot-openclaw` |
| `hs-1` | `hermes` | `dilemmaeval-pilot-hermes` |

The executor validates the public manifest through `pilot-preflight`. It loads
both private keys from an async per-seat `secretProvider`, validates that they
are distinct, derives each Ethereum address locally through the audited game
bridge, requires it to match that seat's public manifest address before any
Maritime call, and never places a key in its result or error state.

## SDK and credential prerequisites

Before a live run:

1. Install the verified official `maritime-sdk@0.6.0` package in the approved
   external runner location, not this repository.
2. Create a Maritime API key with only `provision`, `secrets`, and `deploy`
   scopes.
3. Supply it to the SDK through `MARITIME_API_KEY`; never put it in this repo.
4. Supply a `secretProvider(seatId)` from the separate approved local secret
   handoff. Do not pass a wallet JSON or private keys in the public manifest.
5. Verify the installed SDK still exposes `provision`, `setEnv`, `reloadEnv`,
   and `listEnv`.
6. Obtain explicit approval for the two paid external agents.

Construct the live SDK with `maxRetries: 0` and pass the exported
`VERIFIED_SDK_POLICY` attestation to this executor. The SDK's default retry
policy is intentionally not accepted for this narrow pilot.

The SDK object is injected deliberately, so importing this testable module
cannot make a network call by itself.

## API

```js
import { Maritime } from "maritime-sdk";
import {
  LIVE_PILOT_AUTHORIZATION,
  VERIFIED_SDK_POLICY,
  createMaritimePilotExecutor
} from "./src/index.mjs";

const maritime = new Maritime({
  apiKey: process.env.MARITIME_API_KEY,
  maxRetries: 0
});

const executor = createMaritimePilotExecutor({
  maritime,
  secretProvider: getWalletKeyFromApprovedExternalStore,
  sdkPolicy: VERIFIED_SDK_POLICY
});

const evidence = await executor.execute({
  manifest: publicTwoSeatManifest,
  authorization: LIVE_PILOT_AUTHORIZATION
});
```

Do not hard-code the authorization in an unattended runner. The live wrapper
must obtain it from the operator for that run.

## Failure behavior

Provisioning is idempotent on the stable external IDs. The executor never
automatically deletes an agent. A failed provision, secret write, or reload is
treated as an ambiguous external write, stops immediately, and returns only
public recovery state for manual reconciliation. The approved live SDK wrapper
uses `maxRetries: 0`.

## Tests

```sh
cd integration/maritime-pilot-client
npm test
```

The tests prove authorization gating, stable idempotent identities, two-seat
secret isolation, local key/address binding, encrypted-secret flags, masked
verification, redacted evidence, duplicate-key rejection, and
partial/ambiguous failure handling.
