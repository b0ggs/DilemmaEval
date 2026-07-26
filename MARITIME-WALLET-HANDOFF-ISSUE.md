# Maritime gameplay-wallet handoff issue

- **Status:** Blocking S02 self-signing, M04 agent game kit, and M10 pilot
- **Scope:** Disposable Base Sepolia gameplay wallets only
- **Decision:** Raw private keys are acceptable for this testnet demo. They must never be reused for mainnet, valuable assets, or another project.

## Summary

The tournament design intends every Maritime player to have one unique wallet:

- five OpenClaw agents have five wallets;
- five Hermes agents have five wallets;
- each agent signs its own game transactions inside its Maritime container; and
- the orchestrator never signs for a player.

The documented wallet handoff is:

1. generate a disposable wallet;
2. map its public address to one seat;
3. set its private key in that Maritime agent as
   `GAMEPLAY_WALLET_PRIVATE_KEY`;
4. let the pinned game CLI read that environment variable and sign locally.

That path is not currently complete. Maritime can inject the variable, and the
pinned game CLI can consume it, but the DilemmaEval game bridge removes the
variable before launching the pinned CLI.

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

### The local bridge currently removes it

`integration/game-bridge/src/index.js` builds a restricted child environment.
It currently forwards only:

- `PATH`;
- `HOME`;
- `TMPDIR`; and
- an explicitly referenced keystore-password environment variable.

Consequently, a Maritime container can contain
`GAMEPLAY_WALLET_PRIVATE_KEY`, but the Yarn process started by the bridge does
not receive it. The pinned CLI then reports a missing signer.

This affects OpenClaw and Hermes equally because both are intended to use the
same bridge.

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
5. the value is redacted if an upstream command accidentally echoes it.

Signer operations are:

- `join`;
- `prepare_commit`;
- `commit`;
- `reveal`;
- `advance`; and
- `claim`.

If registration is added to the bridge, it must use the same player-local
environment path.

Conceptually:

```js
function childEnvironment(
  source,
  options,
  { includeGameplayPrivateKey = false } = {}
) {
  const selected = {};

  // Existing PATH/HOME/TMPDIR and keystore-password handling stays here.

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
const processEnv = childEnvironment(env, options, {
  includeGameplayPrivateKey: signerOperation,
});

const verificationEnv = childEnvironment(env, {});
```

This is environment pass-through, not a new signing implementation. The pinned
game repository remains responsible for wallet construction and signing.

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
creates an encrypted Foundry keystore. The raw Maritime environment path above
is simpler because it requires no separate file transfer into the container.

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

### 4. Verify address ownership

Inside each player boundary, derive the address from the injected key and
compare it with the public seat manifest. Verification must report only:

- agent/seat ID;
- harness;
- derived public address;
- expected public address; and
- match or mismatch.

The verification must not substitute one agent's key for another agent.

### 5. Register and fund

After freezing the public pilot manifest:

1. register each wallet through the existing ERC-8004 path;
2. fund each public address with Base Sepolia ETH;
3. verify both balances and registrations; and
4. retain only public transaction hashes and addresses as evidence.

### 6. Prove self-signing

Run S02 with one bounded Base Sepolia transaction from each pilot agent. The
receipt sender must match that agent's public wallet.

Then run M10 so `oc-1` and `hs-1` complete a real round using their own keys.

### 7. Scale to ten

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

- a signer operation receives `GAMEPLAY_WALLET_PRIVATE_KEY`;
- Git verification subprocesses do not receive the key;
- read-only operations do not receive it unnecessarily;
- unrelated environment variables are still removed;
- a raw `walletPrivateKey` bridge option remains rejected;
- echoed key values are redacted from stdout, stderr, parsed output, and errors;
- a missing key produces a structured signer error rather than a fallback
  signer;
- OpenClaw and Hermes adapters invoke the identical bridge behavior; and
- Base mainnet configuration is still rejected.

Add a mocked paired-adapter test with two distinct placeholder keys and public
addresses. The test must demonstrate mapping and isolation without submitting
a transaction.

## Acceptance criteria

This issue is resolved when:

- [ ] `oc-1` receives only the `oc-1` testnet key.
- [ ] `hs-1` receives only the `hs-1` testnet key.
- [ ] The bridge forwards the canonical variable to signer operations.
- [ ] The pinned CLI derives the expected address in both harnesses.
- [ ] Both agents independently sign a Base Sepolia transaction.
- [ ] Transaction senders match the frozen public pilot manifest.
- [ ] M10 completes without orchestrator signing.
- [ ] Scaling produces ten unique one-to-one agent/wallet mappings.
- [ ] No mainnet wallet, key, RPC, chain ID, or asset enters the workflow.

## Documentation that must be reconciled

After the implementation is accepted, update:

- `integration/game-bridge/README.md` to distinguish forbidden raw-key
  arguments from the allowed player-local testnet environment variable;
- `wiki/00-start-here/M03-SECURITY-AND-SECRETS.md` to record the explicit
  testnet key-exposure risk acceptance;
- `wiki/10-first-hour-spikes/S02-SELF-SIGNING.md` with the verified
  environment-to-CLI path;
- `wiki/20-build/M04-AGENT-GAME-KIT.md` with the accepted bridge behavior; and
- the pilot/full-fleet handoffs with the public address mappings only.

## Hard safety boundary

Key secrecy is not a launch requirement for these disposable wallets, but the
following remain hard failures:

- any wallet has ever held a mainnet or valuable asset;
- a key is reused outside this Base Sepolia tournament;
- two agents share a wallet;
- a key is assigned to the wrong seat;
- an orchestrator or another player signs for an agent; or
- the runtime connects the key to a non-Base-Sepolia chain.
