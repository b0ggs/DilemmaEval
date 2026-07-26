# Two-seat Maritime wallet pilot

This is the smallest live fallback already authorized by M05–M07 and
S01–S02: create one OpenClaw agent and one Hermes agent on Maritime, give each
one distinct disposable Base Sepolia wallet material through Maritime's
encrypted secret API, and retain only a public seat mapping as evidence.

It is not a tournament run. It does not join the game, fund a wallet, call an
RPC, create a phase-advancer, register ERC-8004 identity, or prove that either
agent can sign a transaction.

## Fixed pilot identities

| Seat | Team/template | Stable Maritime external ID |
|---|---|---|
| `oc-1` | `openclaw` | `dilemmaeval-pilot-openclaw` |
| `hs-1` | `hermes` | `dilemmaeval-pilot-hermes` |

The public preflight manifest supplies the two distinct wallet addresses. It
must never contain a private key, API token, RPC URL, environment dump, or
wallet JSON.

## Current official Maritime surface

The pilot uses the verified official TypeScript package
`maritime-sdk@0.6.0`, not secret values in CLI arguments:

- SDK credential: `MARITIME_API_KEY`;
- optional SDK base override: `MARITIME_API_URL`;
- idempotent agent creation: `agents.provision({ externalId, name, template })`;
- encrypted wallet injection:
  `agents.setEnv(id, "GAMEPLAY_WALLET_PRIVATE_KEY", value, { secret: true })`;
- environment activation: `agents.reloadEnv(id)`;
- minimum key scopes: `provision`, `secrets`, and `deploy`.
- live SDK construction: `maxRetries: 0`.

`provision` is idempotent on `externalId`, which prevents the pilot runner from
blindly creating duplicate paid agents. The templates are exactly `openclaw`
and `hermes`.

The package version and signatures were checked from the npm archive without
installing it. Live template availability must still be checked immediately
before an authorized run. Current primary sources:

- <https://github.com/maritime-sh/maritime-sdk>
- <https://maritime.sh/docs/api>
- <https://maritime.sh/docs/api/provisioning>
- <https://maritime.sh/docs/cli>
- <https://maritime.sh/docs/frameworks/openclaw>
- <https://maritime.sh/docs/frameworks/hermes>

## Secret boundary

The live runner receives each wallet only from a per-seat runtime callback.
The key is passed directly to that seat's `setEnv` call with `secret: true`.
It is not accepted as part of the public plan and is never returned in
evidence.

The human secret-setup session owns the local OS secret-manager or external
`0600` wallet file. Do not put values in this repository, Markdown, chat,
shell history, VS Code settings, command arguments, or a repository `.env`.

## Execution gates

Local dry run:

1. Validate exactly `oc-1`/OpenClaw and `hs-1`/Hermes.
2. Validate chain ID `84532` and two unique public Ethereum addresses.
3. Emit typed pending actions only.
4. Prove the plan and output contain no secret-shaped material.
5. Exercise the SDK adapter with mocks; no Maritime request is made.

Authorized live run:

1. Obtain an explicit human authorization for paid external creation.
2. Load `MARITIME_API_KEY` and the two player keys from the approved external
   secret source.
3. Construct `maritime-sdk@0.6.0` with `maxRetries: 0` and idempotently
   provision both stable external IDs.
4. Inject only the assigned key into each assigned agent with `secret: true`.
5. Reload each environment.
6. Verify public agent ID, template/status, and masked presence of the
   `GAMEPLAY_WALLET_PRIVATE_KEY` key.
7. Record only public/redacted evidence.

If one external action fails, stop and report the public recovery state.
Never automatically delete an agent or retry an ambiguous write.

## Successful fallback evidence

The fallback is demonstrated when:

- Maritime returns one persistent OpenClaw agent and one persistent Hermes
  agent for the two stable external IDs;
- both environments report the wallet variable as secret/masked;
- the frozen public manifest maps two unique wallet addresses to the two
  seats; and
- captured evidence contains no private key, Maritime API key, or secret RPC
  URL.

Alchemy is not required for this proof. It becomes necessary when the next
test derives live chain state or asks the agents to sign/send a Base Sepolia
transaction.
