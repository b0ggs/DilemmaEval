# Maritime transport

Zero-runtime-dependency fixture library for `TASK-C1`. It freezes the shared
Maritime proxy/model/settings profile, validates the shared poke and agent
response envelopes, and exercises timeout/retry/idempotency behavior without a
live or paid call.

## Boundary

- Both harnesses use `https://api.maritime.sh/api/llm/v1`.
- Primary model is `gpt-5.4-mini`; fallback is `gpt-4o`.
- Native `api.openai.com` routes and unequal parity-sensitive settings fail
  closed.
- The runtime policy is locked to the same frozen profile for both harnesses:
  30-second attempts, a one-second cancellation grace, at most three attempts,
  and retry delays of 250/1,000 ms. Runtime overrides are rejected.
- The injected transport receives the exact same serialized payload and
  `request_id` on every retry.
- A timeout aborts the transport. A retry starts only after the prior transport
  settles inside the bounded cancellation grace; ignored aborts fail closed.
- Agent ID, harness, team, and seat prefix must agree. Poke identity is copied
  into a deeply frozen snapshot before dispatch.
- Team-log context must be same-team/same-game, nonfuture, strictly ascending,
  and end exactly at `through_sequence`.
- Agent-reported status and transaction hash are returned as operational
  evidence only. They are never interpreted as chain truth.
- Private keys, mnemonic/seed material, authorization/tokens, API keys,
  passwords, credentials, cookies, and environment dumps are rejected from
  pokes and evidence metadata before serialization or recording. The standalone
  redaction utility also covers common snake_case and camelCase credential
  names.

The OpenClaw and Hermes renderers are non-secret, representative reference
data. They are explicitly marked `live_verify`; current Maritime/OpenClaw
tooling must be checked before provisioning. No function in this package runs
the Maritime CLI or performs network I/O.

## Commands

Requires Node.js 20 or newer.

```sh
cd integration/maritime-transport
npm test
```

## Public API

Import from `src/index.mjs`:

- `FROZEN_PROXY_CONFIG`, `createHarnessConfig`, `assertPairedParity`
- `renderOpenClawReference`, `renderHermesReference`
- `validatePoke`, `serializePoke`, `validateAgentResponse`,
  `parseAndValidateResponse`, `assertResponseIdentity`,
  `assertNoSensitiveMaterial`
- `createRequestCoordinator`
- `createFakeTransport`
- `redactSensitive`, `createParityEvidence`

The transport interface is one injected method:

```js
await transport.send({
  agentId,
  harness,
  requestId,
  payload,
  attempt,
  signal,
  proxyConfig
});
```

It returns an agent-response object, a serialized response, or a
Maritime-shaped `{ response }` wrapper. `payload` is immutable serialized JSON;
implementations must not add wallet material or mutate it.

The injected transport must settle its promise when `signal` aborts. If it does
not settle within the locked cancellation grace, the coordinator returns
`TRANSPORT_CANCELLATION_UNCONFIRMED` and does not start another attempt.

## What remains live-verify

This module proves local invariants only. It does not prove proxy model
availability, installed CLI syntax, actual wake latency, container
self-signing, or chain submission. Those remain the S01/S03 live gates.
