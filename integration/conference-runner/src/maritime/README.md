# Maritime conference adapter and player tools

This lane implements current REST transport, a distinct discussion envelope,
roster reconciliation, and runnable per-agent gameplay tools. Its tests use
explicit fixtures. No provision, chat, upload, deployment, registration, or
transaction was performed by this worker; a local passing suite is not a
three-agent rehearsal.

The transport uses the documented
[Maritime REST API](https://maritime.sh/docs/api): Bearer authentication,
`GET /api/agents`, and `POST /api/agents/{id}/chat`. The earlier pilot's
`/api/v1` / `X-API-Key` binding is not silently substituted. Responses must
contain exact protocol JSON. Requests are not retried, including network
errors and timeouts: aborting an HTTP client does not prove remote gameplay
was cancelled. The runner must preserve the request ID and its durable intent
across restarts; transport deduplication is only in memory.

`dispatch({seat, request, deadline_at_ms, signal})` applies one wall-clock
boundary across the one-awake queue, environment reload, wake delay, Hermes
configuration, chat, and final sleep. If the boundary expires before the
adapter starts any POST, it returns retryable, non-ambiguous
`MARITIME_DISPATCH_EXPIRED`, performs no remote call, and allows the same
stable request ID to be tried later. Once any POST starts, timeout or abort is
an ambiguous outcome: the attempt stays cached, is never replayed, and blocks
one-awake rotation until authoritative reconciliation. Without an outer
deadline, the configured per-request transport timeout remains in effect.

`reconcileRoster({roster, agents, maxAgents:3})` is pure: it checks existing
IDs/names/frameworks, distinct seat/wallet/agent bindings, readiness, unrelated
account usage, and missing slots. It never deletes or provisions an agent and
does not treat more than the user's three slots as free. A larger roster works
with explicitly established additional account capacity.

`createConferenceProvisioner` supplies the operator's missing third-slot and
wallet-injection path. It reuses the two bound agents, validates all supplied
wallet keys against the roster locally, refreshes the full account inventory
before creating anything, and defaults to the user's three-slot budget. It
sets no size, tier, always-on, or paid-capacity option and never deletes agents.

```js
import { createConferenceProvisioner } from './src/maritime/index.mjs';
const provisioner = createConferenceProvisioner({
  config, runtimeDir, apiKey: process.env.MARITIME_API_KEY,
  secretProvider: seatId => privateOperatorKeyStore.take(seatId)
});
const plan = await provisioner.plan(); // GET only; no wallet-secret access
// After reviewing the concrete roster/account plan, the authorized operator:
const configured = await provisioner.provision();
```

The API encodings follow the current
[official SDK implementation](https://raw.githubusercontent.com/maritime-sh/maritime-sdk/main/typescript/src/resources/agents.ts):
create uses `name`, `templateId`, and stable `externalId`; secret environment
updates use `isSecret:true`, which is the REST encoding of SDK `secret:true`.
Each assigned wallet is set independently, checked through a masked listing,
reloaded, and checked again. Keys are never written to local state or returned.
The durable journal and exclusive operator lock reuse the runner primitives in
a separate `maritime-provisioning` directory.

A timed-out creation is recovered only by finding the same stable identity in
a fresh inventory. If it is absent, the provisioner stops instead of issuing
another create. An ambiguous wallet update or reload also stops: a masked
value cannot establish which key an uncertain update installed. Resolve that
specific state with operator inspection before further setup. A configured
masked variable is not proof of the runtime's public signer address or live
gameplay; the installed CLI inspection and actual transactions remain required.

`validateDiscussionRequest`, `validateDiscussionResponse`, and
`discussionToLogResponse(response, request)` implement a separate discussion
pass. The latter maps an accepted message to the existing TeamLogStore format
only; its `commit` tag never authorizes a transaction. Both request protocols
reject opposing-team messages and coordinator-provided move material.
Responses preserve accepted agent wording, with a 200-character limit.

## Operator installation

The helper is inert until `install` is called. The lead/operator owns all
external writes. Credentials belong in local environment or role-private
secret injection, never in this artifact or command-line arguments.

```js
import {
  createMaritimeInstaller, buildInstallArtifact
} from './src/maritime/index.mjs';

const installer = createMaritimeInstaller({ apiKey: process.env.MARITIME_API_KEY });
const row = config.roster.find(row => row.seat_id === 'oc-1');
const root = await installer.inspectVolumeRoot(row.agent_id);
const artifact = await buildInstallArtifact({
  config, seatId: row.seat_id, persistentRoot: root, operationsManifest
});
// Review artifact.files, instructions, commands, and digest before installation.
const installed = await installer.install(artifact);
```

Discover the persistent volume using `files/list.root`; do not assume `/data`
for every template. The current [Hermes guide](https://maritime.sh/docs/frameworks/hermes)
documents a different home path. Files are contained by
`<volume>/dilemma-conference/<seat>/`. Each artifact contains only the player
runtime, bridge, shared validators, pinned deployment metadata, public seat
settings, and instructions. It contains no coordinator, Telegram credentials,
spectator URLs, player keys, launcher key, or phase key.

The legacy `operations_manifest.phase_advancer.wallet_address` field denotes
the public operator address and supplies no signing key. For this conference,
it may reference the contract owner: one operator wallet creates games and
advances phases. Its `DILEMMA_LAUNCHER_PRIVATE_KEY` remains in the sole operator
process. Player runtimes reject privileged keys and reject any player wallet
equal to either the owner or the public operator address.

The selected VM needs Node.js 22+ and Git already installed. The installer
clones the pinned game revision into its own directory, rejects an existing
Foundry `.env`, validates exact `HEAD` and tracked cleanliness, and installs
using the repository's Yarn 3.2.3 release:

```sh
node .yarn/releases/yarn-3.2.3.cjs install --immutable --mode=skip-build
```

`YARN_ENABLE_SCRIPTS=false` alone does not suppress Yarn workspace postinstall
scripts. `--mode=skip-build` is essential: the Foundry postinstall would create
the `.env` that the bridge correctly refuses. The installer rechecks the env
boundary, revision, and cleanliness after installation. It never removes an
existing environment file or resets a checkout. A per-seat `yarn` wrapper
preserves the existing bridge interface without a global Yarn installation.
The remote exec API has a 120-second maximum; if a fresh dependency install
exceeds that window, reconcile the remote process/install before restarting
it. An install error is not reported as a successful installation.

Inject only the assigned `GAMEPLAY_WALLET_PRIVATE_KEY` through Maritime's
encrypted environment mechanism. Configure the actual harness to use the
artifact's `PLAYER-INSTRUCTIONS.md` and allow its `gameplay_command`. Both
OpenClaw and Hermes execute the same Node CLI through their terminal tool.
The transport repeats protocol instructions, but cannot install a tool or
change a model by prompting it.

Run `artifact.inspect_command` inside the VM to check wallet binding and
writable persistent storage. It emits public facts only and explicitly says
gameplay is unproven. The gameplay command reads this JSON from stdin:

```json
{"request":{"...":"exact coordinator poke"},"choice":"share"}
```

The actual agent chooses `share`, `steal`, or `catch` locally for a commit.
Omit `choice` for join, reveal and claim. This is an input shape example, not
an executable game request. The tool returns the shared agent-response only.
It never exposes upstream stdout, salts, prepared bundles, or strategy fields.
`claim` reads authoritative state; an actual cancelled game maps to the pinned
`refund` command, whose own preview checks claimability.

The tool keeps a private round bundle and durable submission journal with
restrictive permissions. The bundle file and parent directory are synced
before submission intent. An interrupted commit never regenerates a salt;
reveal reads the same file. A submitted action without a confirmed result is
blocked from repetition, even under a new request ID. The old CLI exposes its
hash only after a receipt, so an interrupted submission still needs chain
reconciliation; the tool does not pretend to recover a hash it never observed.

## Required live verification

Installation helpers report `installed` separately from these currently
unproven properties:

- Both actual harnesses can invoke the installed CLI and complete a real
  join, commit, reveal, and applicable claim/refund.
- Effective model route and settings match the reviewed Maritime proxy setup.
- Harness tool/network policy blocks opposing spectator-feed access. Filtering
  team_chat and withholding links alone does not restrict broad browser or
  shell tools from fetching a public site.
- The persistent volume survives an actual restart after commitment, and the
  same bundle successfully reveals.

Set none of these evidence fields from an agent's self-report or the existence
of an uploaded file. Record operator-observed invocation/configuration,
on-chain transaction evidence, a spectator-access denial test, and recovery.

Run local tests from `integration/conference-runner` with
`node --test test/maritime/*.test.mjs`.
