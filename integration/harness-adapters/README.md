# Paired OpenClaw and Hermes harness adapters

This leaf implements the local, fixture-tested portion of wiki M05. It is a
thin contract over the existing game bridge and Maritime transport primitives;
it does not implement either harness, perform installation/provisioning, or
make a network call.

## Shared surface

`createOpenClawAdapter` and `createHermesAdapter` expose the same:

- player operation allowlist: `state`, `wallet_auth_status`, `register`,
  `join`, `prepare_commit`, `commit`, `reveal`, and `claim`;
- disjoint bridge routing: `state`/`wallet_auth_status` use a credential-free
  read-only bridge; the six player-local operations use a distinct player
  bridge; one object cannot fill both roles;
- pinned game revision and shared command-result contract;
- Maritime proxy endpoint, primary/fallback model, prompt/tool/settings
  profile, timeout, cancellation grace, attempts, and retry delays;
- poke and response schema identifiers and validators;
- player signing boundary: no private key is accepted by the adapter, and
  `advance` is never exposed.

The adapter validates seat/team/request identity, forwards only an allowed
operation to an injected per-player game bridge, validates the bridge's
structured command result, and rejects sensitive material before dispatch.
The player bridge—not this adapter—reads `GAMEPLAY_WALLET_PRIVATE_KEY` from
its assigned player process and enforces the signer, chain, and
pinned-checkout boundaries. The separate read-only bridge must be constructed
without a player signer.

The pinned `prepare_commit` result intentionally contains the reveal salt.
That result is accepted only as player-local material returned to the same
assigned harness and is never part of the poke, Maritime transport, adapter
contract, or parity evidence. `prepare_commit` requires its choice at this
player-local API, rejects caller-supplied salt, and is always routed to the
player bridge. Choice/prepared-bundle fields in orchestrator-supplied
`chain_state`, or a salt/private-key-shaped value in a poke/response message,
fail closed. All other credential-shaped result material also fails closed.

Untyped 32-byte values in command arguments or parsed fields are rejected.
Raw stdout/stderr/error text redacts every 32-byte-shaped value because a
private key cannot be distinguished from a transaction hash there. Typed
parsed transaction-hash/commitment fields remain available; the canonical
`prepare_commit` `salt` field is the only player-local exception.

The shared poke JSON Schema permits an empty `team_chat.messages` window with
a positive `through_sequence`. The inbound adapters accept that shape without
altering the cursor. The sibling Maritime transport validator now accepts the
same shape, so the cursor remains consistent across both module boundaries.

## Unavoidable differences

Only these differences are represented:

1. Harness/team identity and seat prefix (`openclaw`/`oc-` versus
   `hermes`/`hs-`).
2. Reference-only configuration encoding: OpenClaw's custom-provider
   onboarding arguments versus Hermes's Maritime inference environment names.

They do not change the effective model profile, operations, schemas,
communication opportunities, or runtime policy. Both reference renderings are
explicitly `live_verify`.

## Example

```js
import {
  createPairedHarnessAdapters
} from "./src/index.mjs";

const adapters = createPairedHarnessAdapters({
  openclaw: {
    seatId: "oc-1",
    playerBridge: openClawPlayerBridge,
    readOnlyBridge: openClawReadOnlyBridge
  },
  hermes: {
    seatId: "hs-1",
    playerBridge: hermesPlayerBridge,
    readOnlyBridge: hermesReadOnlyBridge
  }
});

const acceptedPoke = adapters.openclaw.acceptPoke(poke);
const result = await adapters.openclaw.runGameOperation({
  seatId: acceptedPoke.seat_id,
  operation: acceptedPoke.requested_action,
  options: publicBridgeOptions
});
```

The operation call contains public bridge options only. Do not pass
environment objects, credentials, private keys, commit salts, or unrevealed
move material through an adapter.

## Tests

```sh
cd integration/harness-adapters
npm test
```

Tests use bridge spies and fixture envelopes only. They prove paired parity,
all-player-operation forwarding, response validation, verbatim optional
`team_message`, disjoint read-only/player routing,
cross-seat/cross-team/cross-role rejection, player-local prepare material,
shared-schema empty-window cursors, immutable snapshots, and no secret
propagation. They do not invoke Yarn, RPC, Maritime, OpenClaw, Hermes, a
wallet, or a transaction.

## Unsupported assumptions and remaining live gates

The repository does not contain authoritative OpenClaw or Hermes internal
installation APIs. This leaf therefore does not invent skills, plugin layouts,
container paths, or provisioning commands. Before M05 can pass, the harness
contributors must still:

- verify the current OpenClaw and Hermes configuration/install interfaces;
- prove both effective runtimes resolve to the frozen Maritime proxy profile;
- install/reference the accepted M04 game-kit artifact in each actual agent;
- prove the proxy serves the selected model and run equivalent authorized
  S01/S03 smoke tests;
- prove a real Maritime poke wakes each harness, carries the exact same-team
  snapshot, and returns a schema-valid response;
- capture redacted effective configuration, artifact digest/install evidence,
  and the reviewed difference register.

These are intentionally live verification tasks; local fixtures are not
evidence that either external harness is installed or operational.
