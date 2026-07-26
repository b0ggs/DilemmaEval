# Maritime gameplay-wallet and phase-advancer handoff issue

- **Status:** Blocking S02 self-signing, M04 agent game kit, and M10 pilot
- **Scope:** Disposable Base Sepolia gameplay wallets and one separate disposable Base Sepolia phase-advancer wallet
- **Decision:** Raw private keys are acceptable for this testnet demo. They must never be reused for mainnet, valuable assets, or another project. Player keys and the phase-advancer key are different authority classes and must never be substituted for one another.

## Summary

The tournament design intends every Maritime player to have one unique wallet:

- five OpenClaw agents have five wallets;
- five Hermes agents have five wallets;
- each agent signs its own game transactions inside its Maritime container; and
- the orchestrator never signs for a player.

Phase advancement is different from player gameplay. The contract permits
anyone to advance when its on-chain conditions are satisfied. The narrowly
scoped advancement executor therefore uses a separate, non-player disposable
Base Sepolia wallet supplied as `PHASE_ADVANCER_PRIVATE_KEY`. That wallet is
not the owner/configuration signer, funding signer, Maritime billing wallet,
or one of the ten seat wallets.

The documented wallet handoff is:

1. generate a disposable wallet;
2. map its public address to one seat;
3. set its private key in that Maritime agent as
   `GAMEPLAY_WALLET_PRIVATE_KEY`;
4. let the pinned game CLI read that environment variable and sign locally.

The same seat-local path is used when the bridge invokes `auth:register`.
Registration is scheduled by the coordinator, but the player signs it inside
its own boundary. The coordinator receives only the resulting public address,
identity/registration identifiers, transaction hash, and receipt.

Before Wave 1.5, that path was incomplete. Maritime could inject the variable,
and the pinned game CLI could consume it, but the DilemmaEval game bridge
removed the variable before launching the pinned CLI. The candidate Wave 1.5
implementation below remediates that baseline defect; its local and live gates
remain authoritative.

## Evidence of the mismatch

### Maritime injection is already documented

The approved addendum specifies:

```bash
maritime env set <agent> GAMEPLAY_WALLET_PRIVATE_KEY=0x... --reload
```

Maritime marks environment values as encrypted secrets by default and injects
them into the agent at runtime.

### The pinned game CLI supports this exact variable

At pinned revision
`955ce16a59b0efecf6ccdf2d391ede83de8902a8`,
`packages/foundry/scripts-js/authTooling.js` declares:

```js
export const GAMEPLAY_PK_ENV = "GAMEPLAY_WALLET_PRIVATE_KEY";
```

When no keystore is supplied, `resolveSignerWallet()` reads that variable and
constructs the `ethers.Wallet` used for registration and gameplay signing.

### Pre-remediation baseline: the local bridge removed it

`integration/game-bridge/src/index.js` builds a restricted child environment.
Before Wave 1.5 remediation it forwards only:

- `PATH`;
- `HOME`;
- `TMPDIR`; and
- a legacy explicitly referenced keystore-password environment variable.

Consequently, a Maritime container can contain
`GAMEPLAY_WALLET_PRIVATE_KEY`, but the Yarn process started by the bridge does
not receive it. The pinned CLI then reports a missing signer.

This affects OpenClaw and Hermes equally because both are intended to use the
same bridge.

Wave 1.5 rejects the legacy keystore path completely for signed operations.
No `--wallet-keystore`, keystore-password environment/file option,
`--wallet`, or other signer alternative may compete with the role-specific
environment key. Public wallet addresses remain valid inputs to read-only
status queries.

## Selected fix: permit the testnet key environment variable

Keep raw private keys out of bridge arguments and response schemas, but allow
the one canonical environment variable to reach signer operations.

### Required bridge behavior

Add a constant:

```js
const GAMEPLAY_PRIVATE_KEY_ENV = "GAMEPLAY_WALLET_PRIVATE_KEY";
```

Change child-environment construction so that:

1. `GAMEPLAY_WALLET_PRIVATE_KEY` is copied from the Maritime agent environment
   into the pinned Yarn process for signer operations;
2. it is not passed to the preliminary Git checkout/revision commands;
3. unrelated environment variables remain excluded;
4. `--wallet-private-key` remains rejected as a bridge option; and
5. all legacy keystore/signer alternatives are rejected for signed
   operations; and
6. the value is redacted if an upstream command accidentally echoes it.

Player signer operations are:

- `register` (invokes pinned `auth:register`);
- `join`;
- `prepare_commit`;
- `commit`;
- `reveal`;
- `claim`.

The coordinator may schedule bridge operation `register` and verify its public result, but
it never receives or substitutes for the seat's gameplay key.

`advance` must never receive a player's
`GAMEPLAY_WALLET_PRIVATE_KEY`. For `advance` only, the bridge may read
`PHASE_ADVANCER_PRIVATE_KEY` from the narrowly scoped advancement executor and
map it to `GAMEPLAY_WALLET_PRIVATE_KEY` in the pinned CLI child environment.
This internal name translation exists only because the pinned CLI expects its
canonical signer variable. Neither key may enter bridge arguments, schemas,
Git verification subprocesses, output, logs, or evidence.

Immediately before every signed bridge operation, the bridge must query the
configured RPC with the actual `eth_chainId` method and require decimal
`84532` (`0x14a34`). A configured `chainId` field, RPC hostname, or cached
preflight is not sufficient.

Conceptually:

```js
function childEnvironment(
  source,
  options,
  { includeGameplayPrivateKey = false } = {}
) {
  const selected = {};

  // Existing minimal PATH/HOME/TMPDIR handling stays here.

  if (
    includeGameplayPrivateKey &&
    typeof source?.[GAMEPLAY_PRIVATE_KEY_ENV] === "string" &&
    source[GAMEPLAY_PRIVATE_KEY_ENV].length > 0
  ) {
    selected[GAMEPLAY_PRIVATE_KEY_ENV] =
      source[GAMEPLAY_PRIVATE_KEY_ENV];
  }

  return selected;
}
```

The execution environment and repository-verification environment must be
constructed separately:

```js
const processEnv = playerSignerOperation
  ? childEnvironment(env, options, {
      includeGameplayPrivateKey: true,
    })
  : phaseAdvanceOperation
    ? phaseAdvancerEnvironment(env, options)
    : childEnvironment(env, options);

const verificationEnv = childEnvironment(env, {});
```

This is environment pass-through, not a new signing implementation. The pinned
game repository remains responsible for wallet construction and signing.
`phaseAdvancerEnvironment()` must select only
`PHASE_ADVANCER_PRIVATE_KEY` from its source environment and expose that value
to the pinned `advance` child process under the canonical
`GAMEPLAY_WALLET_PRIVATE_KEY` name.

## Exact operator workflow

### 1. Generate the pilot wallets

Generate one disposable wallet for `oc-1` and one for `hs-1`:

```bash
cast wallet new
```

The command prints an address and private key. For this demo, exposure of these
testnet-only keys is accepted. Do not use either wallet on mainnet or transfer
anything valuable to it.

Record the public mapping:

| Seat | Harness | Public wallet |
|---|---|---|
| `oc-1` | OpenClaw | generated address A |
| `hs-1` | Hermes | generated address B |

Never give two seats the same key.

The pinned repository also has `yarn account:generate`, but that workflow
creates an encrypted Foundry keystore. Do not use that signer path for this
Wave 1.5 integration: signed bridge operations reject complete and incomplete
keystore alternatives and accept only the role-specific environment key.

### 2. Provision the pilot agents

After confirming current Maritime syntax, provision one of each harness:

```bash
maritime create oc-1 --template openclaw --always-on --json
maritime create hs-1 --template hermes --tier extended --always-on --json
```

### 3. Give each agent its own key

Set the corresponding key on each agent:

```bash
maritime env set oc-1 GAMEPLAY_WALLET_PRIVATE_KEY=<OC_1_PRIVATE_KEY> --reload
maritime env set hs-1 GAMEPLAY_WALLET_PRIVATE_KEY=<HS_1_PRIVATE_KEY> --reload
```

OpenClaw and Hermes use the same variable name. No key is included in a poke,
team message, seat manifest, or orchestrator request.

### 4. Create the separate phase-advancer wallet

Generate one additional disposable Base Sepolia wallet for phase advancement.
Derive its public address from the key and bind that address to the
`phase-advancer` role in an operations manifest separate from the ten-seat
manifest. This is the eleventh operations wallet, not an eleventh player.

Provision `PHASE_ADVANCER_PRIVATE_KEY` through a VM secret manager, systemd
credential, or equivalent approved facility that injects it only into a
separate advancement-executor process. It must never enter shell history, the
repository, a `.env` file, or the general orchestrator process environment.

Do not:

- assign this wallet to a seat;
- inject it into a Maritime player as a gameplay key;
- use a player, owner/configuration, funding, or Maritime billing key instead;
- expose it to chain-read, poke, team-log, observer, or evidence components; or
- ERC-8004-register it, join it to a game, or pay an entry fee from it; or
- call `advance` because of an agent acknowledgement.

The executor may call `advance` from join only when
`block.timestamp > joinDeadline`; equality remains inside the join window. In
commit, it may call only when `committedCount == aliveCount` or
`block.number > commitDeadlineBlock`. In reveal, it may call only when
`revealedCount == committedCount` or
`block.number > revealDeadlineBlock`.
Anyone-can-advance contract behavior is the authority; possession of this key
does not grant policy authority.

Immediately before submitting `advance`, reread the current phase, counts, and
deadline from chain. If the transaction races, reverts, or observes a changed
phase, reread chain state and reevaluate from scratch; never blind-retry.

### 5. Verify address ownership

Inside each player boundary, derive the address from the injected key and
compare it with the public seat manifest. Verification must report only:

- agent/seat ID;
- harness;
- derived public address;
- expected public address; and
- match or mismatch.

The verification must not substitute one agent's key for another agent.

### 6. Register and fund

After freezing the public pilot manifest, the coordinator schedules each
player-local registration:

1. the assigned player bridge invokes `register`/pinned `auth:register`
   with that seat's `GAMEPLAY_WALLET_PRIVATE_KEY`;
2. the coordinator receives no key and verifies only public registration
   evidence;
3. fund each public player address with Base Sepolia ETH;
4. verify balances and registrations; and
5. retain only public transaction hashes, addresses, and identity/registration
   identifiers as evidence.

Fund the phase-advancer public address only with the approved Base Sepolia gas
allowance and verify the balance before M09 or M10. It is not ERC-8004
registered, does not join, does not pay an entry fee, and never appears in the
ten-seat manifest.

### 7. Prove self-signing

Run S02 with one bounded Base Sepolia transaction from each pilot agent. The
receipt sender must match that agent's public wallet.

Then run M10 so `oc-1` and `hs-1` complete a real round using their own keys.

### 8. Scale to ten

Only after M10 passes:

1. create `oc-2` through `oc-5`;
2. create `hs-2` through `hs-5`;
3. generate eight additional disposable wallets;
4. inject exactly one unique key into each new agent;
5. register and fund all remaining public addresses; and
6. reconcile the final ten-seat manifest.

The completed fleet must have ten agents and ten unique wallets.

## Required tests

Add bridge tests proving:

- each player signer operation receives `GAMEPLAY_WALLET_PRIVATE_KEY`;
- `register` uses the same seat-local gameplay key while its public result
  is safe for coordinator verification;
- `advance` never receives a player key;
- `advance` maps only `PHASE_ADVANCER_PRIVATE_KEY` to the pinned CLI's
  canonical signer variable;
- Git verification subprocesses do not receive the key;
- read-only operations do not receive it unnecessarily;
- unrelated environment variables are still removed;
- a raw `walletPrivateKey` bridge option remains rejected;
- complete and incomplete legacy keystore/signer alternatives are rejected for
  every signed operation;
- every signed operation performs a fresh actual-RPC `eth_chainId` check and
  refuses any value other than `84532`;
- echoed key values are redacted from stdout, stderr, parsed output, and errors;
- a missing key produces a structured signer error rather than a fallback
  signer;
- OpenClaw and Hermes adapters invoke the identical bridge behavior; and
- Base mainnet configuration is still rejected.

Add a mocked paired-adapter test with two distinct placeholder keys and public
addresses. The test must demonstrate mapping and isolation without submitting
a transaction. Add a third distinct placeholder for the phase advancer and
prove it cannot reach either player operation while neither player key can
reach `advance`.

Add advancement-driver tests proving it rereads phase/count/deadline
immediately before submission and, after a race/revert, rereads and reevaluates
instead of automatically retrying.

## Acceptance criteria

### Local implementation acceptance

- [x] The bridge forwards the canonical variable only to the listed player
      signer operations.
- [x] Player signer operations are limited to `register`, `join`,
      `prepare_commit`, `commit`, `reveal`, and `claim`.
- [x] `advance` rejects player-key substitution and maps only the separate
      `PHASE_ADVANCER_PRIVATE_KEY` internally for the pinned CLI child.
- [x] Repository verification, read-only commands, bridge arguments, schemas,
      output, logs, and evidence remain key-free.
- [x] Paired player fixtures plus a distinct phase-advancer fixture prove
      cross-seat and cross-role isolation.
- [x] Redaction, missing-key, wrong-network, and mainnet rejection tests pass.
- [x] Legacy keystore/signer options are rejected and fresh actual-RPC
      `eth_chainId == 84532` checks run before Git and again immediately before
      every signed Yarn operation.
- [x] Separate `player`, `phase-advancer`, and `read-only` bridge roles expose
      disjoint operation sets and reject co-resident/cross-role key variables.
- [x] Exact public seat/operations manifests prove unique seat wallets and
      keep the phase wallet distinct from seats, owner, funding, and every
      reviewed privileged address.
- [x] Any pinned `packages/foundry/.env` file or symlink fails closed before
      Git/Yarn.
- [x] Registration returns JSON without `--out`; commit bundles remain only in
      a prepared real player-local absolute artifact directory outside the
      pinned checkout.
- [x] Private-key-shaped substrings are rejected from raw options and redacted
      defensively from returned public arguments.

Local acceptance unblocks Wave 2 implementation, but it does not pass S02 or
authorize any live operation.

### Live acceptance

- [ ] `oc-1` receives only the `oc-1` testnet key through the approved Maritime
      encrypted-environment injection.
- [ ] `hs-1` receives only the `hs-1` testnet key through the approved Maritime
      encrypted-environment injection.
- [ ] The phase-advancer wallet is distinct from both pilots, all seat wallets,
      the owner/configuration signer, and the funding signer.
- [ ] The phase-advancer is bound in the separate operations manifest, loaded
      only into the advancement executor by the approved VM secret facility,
      funded under the gas ceiling, and absent from ERC-8004, game joins,
      entry-fee payments, and the ten-seat manifest.
- [ ] The pinned CLI derives the expected address in both harnesses.
- [ ] Each pilot's player-local `register` sender matches its public seat
      wallet, and the coordinator retains only public registration evidence.
- [ ] Both agents independently sign a Base Sepolia transaction.
- [ ] Transaction senders match the frozen public pilot manifest.
- [ ] A bounded phase advance is sent by the public phase-advancer address only
      after the exact pinned-contract condition is true: timestamp strictly
      after the join deadline; `committedCount == aliveCount` or block strictly
      after the commit deadline; `revealedCount == committedCount` or block
      strictly after the reveal deadline.
- [ ] M10 completes without the orchestrator signing for a player.
- [ ] Scaling produces ten unique one-to-one agent/wallet mappings.
- [ ] No mainnet wallet, key, RPC, chain ID, or asset enters the workflow.

Live acceptance requires the relevant human approvals and public evidence. It
must not be inferred from mocked tests.

## Documentation that must be reconciled

After the implementation is accepted, update:

- `integration/game-bridge/README.md` to distinguish forbidden raw-key
  arguments from the allowed player-local testnet environment variable;
- `wiki/00-start-here/M03-SECURITY-AND-SECRETS.md` to record the explicit
  testnet key-exposure risk acceptance;
- `wiki/10-first-hour-spikes/S02-SELF-SIGNING.md` with the verified
  environment-to-CLI path;
- `wiki/20-build/M04-AGENT-GAME-KIT.md` with the accepted bridge behavior;
- `wiki/20-build/M09-ORCHESTRATOR-VM.md` with the separate advancement-executor
  signer boundary; and
- the pilot/full-fleet handoffs with the public address mappings only.

## Hard safety boundary

Key secrecy is not a launch requirement for these disposable wallets, but the
following remain hard failures:

- any wallet has ever held a mainnet or valuable asset;
- a key is reused outside this Base Sepolia tournament;
- two agents share a wallet;
- a key is assigned to the wrong seat;
- the phase-advancer key is reused as a player, owner/configuration, funding, or
  Maritime billing key;
- the eleventh operations wallet is ERC-8004 registered, joins, pays an entry
  fee, or appears in the ten-seat manifest;
- a signed operation runs without a fresh actual-RPC
  `eth_chainId == 84532` result;
- an orchestrator or another player signs for an agent;
- the coordinator receives a player key or signs `register` for a player;
- `advance` receives a player key or runs without a verified on-chain
  count/deadline condition;
- an `advance` race/revert is blindly retried without rereading chain state; or
- the runtime connects the key to a non-Base-Sepolia chain.
