import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import test from "node:test";

import {
  GAME_REPOSITORY_ENV,
  GAMEPLAY_PRIVATE_KEY_ENV,
  FROZEN_NETWORK,
  PHASE_ADVANCER_PRIVATE_KEY_ENV,
  PINNED_GAME_REVISION,
  SUPPORTED_OPERATIONS,
  buildInvocation,
  createJsonRpcChainVerifier,
  createGameBridge as createRawGameBridge,
  createProcessRunner,
  deriveEthereumAddress,
  redactPublicArgument,
} from "../src/index.js";

const schemaPath = new URL(
  "../../shared/schemas/command-result.schema.json",
  import.meta.url,
);
const fixtureDirectory = new URL("./fixtures/", import.meta.url);
const ALLOWED_RPC_URL = "https://base-sepolia.example.invalid/rpc-key";
const TEST_GAMEPLAY_KEY = `0x${"01".repeat(32)}`;
const TEST_ADVANCER_KEY = `0x${"02".repeat(32)}`;
const TEST_GAMEPLAY_ADDRESS = "0x00000000000000000000000000000000000000a1";
const TEST_ADVANCER_ADDRESS = "0x00000000000000000000000000000000000000c1";
const TEST_PRIVILEGED_ADDRESS = "0x00000000000000000000000000000000000000f1";
const passingChainVerifier = async () => ({
  chainId: FROZEN_NETWORK.chainId,
});
const testAddressByKey = new Map([
  [TEST_GAMEPLAY_KEY, TEST_GAMEPLAY_ADDRESS],
  [TEST_ADVANCER_KEY, TEST_ADVANCER_ADDRESS],
]);
const passingSignerAddressDeriver = async ({ privateKey }) => ({
  address: testAddressByKey.get(privateKey),
});
const PLAYER_OPERATIONS = Object.freeze([
  "register",
  "join",
  "prepare_commit",
  "commit",
  "reveal",
  "claim",
]);
const TEST_SEAT_MANIFEST = Object.freeze({
  schema_version: 1,
  network: "base-sepolia",
  game_id: "7",
  seats: Object.freeze([
    Object.freeze({
      seat_id: "oc-1",
      team: "openclaw",
      harness: "openclaw",
      maritime_agent: "oc-1",
      wallet_address: TEST_GAMEPLAY_ADDRESS,
    }),
    Object.freeze({
      seat_id: "hs-1",
      team: "hermes",
      harness: "hermes",
      maritime_agent: "hs-1",
      wallet_address: "0x00000000000000000000000000000000000000b1",
    }),
  ]),
});
const TEST_OPERATIONS_MANIFEST = Object.freeze({
  schema_version: 1,
  network: "base-sepolia",
  chain_id: 84532,
  phase_advancer: Object.freeze({
    role: "phase-advancer",
    wallet_address: TEST_ADVANCER_ADDRESS,
    is_player_seat: false,
    erc8004_registered: false,
  }),
  gas_ceiling_wei: "1000000000000000",
});

const BASE_OPTIONS = Object.freeze({
  network: FROZEN_NETWORK.name,
  chainId: FROZEN_NETWORK.chainId,
  rpcUrl: ALLOWED_RPC_URL,
  game: FROZEN_NETWORK.game,
  gameId: 7,
});

function artifactDirectoryFor(root) {
  return `${root}-artifacts`;
}

function executionRoleFor(operation) {
  if (PLAYER_OPERATIONS.includes(operation)) return "player";
  if (operation === "advance") return "phase-advancer";
  return "read-only";
}

function operationPaths(root, operation, options) {
  if (operation === "prepare_commit") {
    return {
      ...options,
      out: join(artifactDirectoryFor(root), "prepared-new.json"),
    };
  }
  if (operation === "commit" || operation === "reveal") {
    return {
      ...options,
      input: join(artifactDirectoryFor(root), "prepared-existing.json"),
    };
  }
  return options;
}

function createGameBridge(options = {}) {
  return Object.freeze({
    run(operation, operationOptions) {
      const {
        preserveRoleEnvironment = false,
        preserveOperationPaths = false,
        ...bridgeOptions
      } = options;
      const role = bridgeOptions.executionRole ?? executionRoleFor(operation);
      const sourceEnvironment = bridgeOptions.env ?? {};
      const effectiveEnvironment = { ...sourceEnvironment };
      if (!preserveRoleEnvironment) {
        if (role === "player") {
          delete effectiveEnvironment[PHASE_ADVANCER_PRIVATE_KEY_ENV];
        } else if (role === "phase-advancer") {
          delete effectiveEnvironment[GAMEPLAY_PRIVATE_KEY_ENV];
        } else if (role === "read-only") {
          delete effectiveEnvironment[GAMEPLAY_PRIVATE_KEY_ENV];
          delete effectiveEnvironment[PHASE_ADVANCER_PRIVATE_KEY_ENV];
        }
      }
      const root = effectiveEnvironment[GAME_REPOSITORY_ENV];
      return createRawGameBridge({
        allowedRpcUrl: ALLOWED_RPC_URL,
        chainVerifier: passingChainVerifier,
        signerAddressDeriver: passingSignerAddressDeriver,
        executionRole: role,
        seatManifest: TEST_SEAT_MANIFEST,
        operationsManifest: TEST_OPERATIONS_MANIFEST,
        expectedGameplayWallet: TEST_GAMEPLAY_ADDRESS,
        expectedPhaseAdvancerWallet: TEST_ADVANCER_ADDRESS,
        forbiddenPrivilegedWallets: [TEST_PRIVILEGED_ADDRESS],
        artifactDirectory:
          typeof root === "string" ? artifactDirectoryFor(root) : undefined,
        ...bridgeOptions,
        env: effectiveEnvironment,
      }).run(
        operation,
        typeof root === "string" && !preserveOperationPaths
          ? operationPaths(root, operation, operationOptions)
          : operationOptions,
      );
    },
  });
}

async function fixture(name) {
  return readFile(new URL(name, fixtureDirectory), "utf8");
}

async function makeCheckout(t) {
  const directory = await mkdtemp(join(tmpdir(), "dilemma-game-bridge-"));
  await mkdir(join(directory, ".git"));
  const root = await realpath(directory);
  const artifacts = artifactDirectoryFor(root);
  await mkdir(artifacts);
  await writeFile(join(artifacts, "prepared-existing.json"), "{}\n");
  t.after(() => rm(directory, { recursive: true, force: true }));
  t.after(() => rm(artifacts, { recursive: true, force: true }));
  return root;
}

function bridgeEnv(root, extra = {}) {
  return {
    [GAME_REPOSITORY_ENV]: root,
    [GAMEPLAY_PRIVATE_KEY_ENV]: TEST_GAMEPLAY_KEY,
    [PHASE_ADVANCER_PRIVATE_KEY_ENV]: TEST_ADVANCER_KEY,
    ...extra,
  };
}

function assertMatchesSharedSchema(result, schema) {
  assert.equal(result.schema_version, 1);
  assert.ok(schema.properties.operation.enum.includes(result.operation));
  assert.equal(typeof result.command, "string");
  assert.ok(result.command.length > 0);
  assert.ok(Array.isArray(result.args));
  assert.ok(result.args.every((item) => typeof item === "string"));
  assert.ok(result.exit_code === null || Number.isInteger(result.exit_code));
  assert.ok(result.signal === null || typeof result.signal === "string");
  assert.equal(typeof result.stdout, "string");
  assert.equal(typeof result.stderr, "string");
  if (result.error !== null) {
    assert.deepEqual(Object.keys(result.error).sort(), ["code", "message"]);
    assert.equal(typeof result.error.code, "string");
    assert.equal(typeof result.error.message, "string");
  }
  assert.deepEqual(Object.keys(result).sort(), schema.required.toSorted());
}

function fakeRunner({
  root,
  commandOutput = { stdout: '{"ok":true}\n', stderr: "", exitCode: 0, signal: null },
  revision = PINNED_GAME_REVISION,
  status = "",
  capture = [],
}) {
  return async (invocation) => {
    capture.push(structuredClone(invocation));
    if (invocation.command === "git") {
      if (invocation.args[0] === "status") {
        return {
          stdout: status,
          stderr: "",
          exitCode: 0,
          signal: null,
        };
      }
      return {
        stdout: `${root}\n${revision}\n`,
        stderr: "",
        exitCode: 0,
        signal: null,
      };
    }
    return commandOutput;
  };
}

const CASES = {
  state: {
    options: {
      ...BASE_OPTIONS,
      registry: FROZEN_NETWORK.identityRegistry,
      chat: FROZEN_NETWORK.chat,
    },
    script: "query:summary",
  },
  wallet_auth_status: {
    options: {
      network: FROZEN_NETWORK.name,
      chainId: FROZEN_NETWORK.chainId,
      rpcUrl: ALLOWED_RPC_URL,
      game: FROZEN_NETWORK.game,
      identityRegistry: FROZEN_NETWORK.identityRegistry,
      authRegistry: FROZEN_NETWORK.authRegistry,
      wallet: TEST_GAMEPLAY_ADDRESS,
    },
    script: "auth:status",
  },
  register: {
    options: {
      network: FROZEN_NETWORK.name,
      chainId: FROZEN_NETWORK.chainId,
      rpcUrl: ALLOWED_RPC_URL,
      identityRegistry: FROZEN_NETWORK.identityRegistry,
      wallet: TEST_GAMEPLAY_ADDRESS,
      agentUri: "ipfs://dilemmaeval-agent",
      game: FROZEN_NETWORK.game,
      authRegistry: FROZEN_NETWORK.authRegistry,
    },
    script: "auth:register",
  },
  join: {
    options: {
      ...BASE_OPTIONS,
      causeId: 1,
    },
    script: "game:join",
  },
  prepare_commit: {
    options: {
      ...BASE_OPTIONS,
      choice: "share",
      out: "bundles/game-7-round-1.json",
    },
    script: "game:prepare-commit",
  },
  commit: {
    options: {
      ...BASE_OPTIONS,
      input: "bundles/game-7-round-1.json",
    },
    script: "game:commit",
  },
  reveal: {
    options: {
      ...BASE_OPTIONS,
      input: "bundles/game-7-round-1.json",
    },
    script: "game:reveal",
  },
  advance: {
    options: {
      ...BASE_OPTIONS,
    },
    script: "game:advance",
  },
  claim: {
    options: {
      ...BASE_OPTIONS,
    },
    script: "game:claim",
  },
};

function mockRpcResponse(payload, { ok = true, headers = undefined } = {}) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  return {
    ok,
    headers,
    text: async () => body,
  };
}

test("local Ethereum address derivation matches known secp256k1/Keccak vectors", () => {
  assert.equal(
    deriveEthereumAddress(`0x${"0".repeat(63)}1`),
    "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf",
  );
  assert.equal(
    deriveEthereumAddress(
      `0x${"0123456789abcdef".repeat(4)}`,
    ),
    "0xfcad0b19bb29d4674531d6f115237e16afce377c",
  );
  assert.throws(
    () => deriveEthereumAddress(`0x${"0".repeat(64)}`),
    /valid secp256k1/,
  );
});

test("JSON-RPC chain verifier issues a strict bounded eth_chainId request", async () => {
  const calls = [];
  const verifier = createJsonRpcChainVerifier({
    timeoutMs: 100,
    fetchImpl: async (...args) => {
      calls.push(args);
      return mockRpcResponse({
        jsonrpc: "2.0",
        id: 1,
        result: "0x14a34",
      });
    },
  });

  const result = await verifier({
    rpcUrl: ALLOWED_RPC_URL,
    expectedChainId: 84532,
  });

  assert.deepEqual(result, { chainId: 84532 });
  assert.equal(calls.length, 1);
  const [url, request] = calls[0];
  assert.equal(url, ALLOWED_RPC_URL);
  assert.equal(request.method, "POST");
  assert.deepEqual(request.headers, { "content-type": "application/json" });
  assert.deepEqual(JSON.parse(request.body), {
    jsonrpc: "2.0",
    id: 1,
    method: "eth_chainId",
    params: [],
  });
  assert.ok(request.signal instanceof AbortSignal);
  assert.ok(!JSON.stringify(request).includes(TEST_GAMEPLAY_KEY));
});

test("JSON-RPC chain verifier reports a valid Base mainnet chain ID for bridge rejection", async () => {
  const verifier = createJsonRpcChainVerifier({
    fetchImpl: async () => mockRpcResponse({
      jsonrpc: "2.0",
      id: 1,
      result: "0x2105",
    }),
  });
  assert.deepEqual(
    await verifier({
      rpcUrl: ALLOWED_RPC_URL,
      expectedChainId: 84532,
    }),
    { chainId: 8453 },
  );
});

test("JSON-RPC chain verifier rejects transport, status, JSON, protocol, and size failures", async () => {
  const failures = [
    async () => {
      throw new Error("transport secret must not escape");
    },
    async () => mockRpcResponse({}, { ok: false }),
    async () => mockRpcResponse("{"),
    async () => mockRpcResponse({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32000, message: "failure" },
    }),
    async () => mockRpcResponse({
      jsonrpc: "2.0",
      id: 2,
      result: "0x14a34",
    }),
    async () => mockRpcResponse({
      jsonrpc: "2.0",
      id: 1,
      result: "0x014a34",
    }),
    async () => mockRpcResponse("x".repeat(200)),
  ];

  for (const fetchImpl of failures) {
    const verifier = createJsonRpcChainVerifier({
      fetchImpl,
      timeoutMs: 100,
      maxResponseBytes: 128,
    });
    await assert.rejects(
      verifier({
        rpcUrl: ALLOWED_RPC_URL,
        expectedChainId: 84532,
      }),
      /chain verification request failed/i,
    );
  }
});

test("JSON-RPC chain verifier timeout covers fetch and stalled body reads", async () => {
  for (const fetchImpl of [
    async () => new Promise(() => {}),
    async () => ({
      ok: true,
      text: async () => new Promise(() => {}),
    }),
  ]) {
    const verifier = createJsonRpcChainVerifier({
      fetchImpl,
      timeoutMs: 15,
    });
    await assert.rejects(
      verifier({
        rpcUrl: ALLOWED_RPC_URL,
        expectedChainId: 84532,
      }),
      /chain verification request failed/i,
    );
  }
});

test("operation inventory is frozen to the nine required pinned command families", () => {
  assert.deepEqual(SUPPORTED_OPERATIONS, Object.keys(CASES));
});

test("executionRole is required and operation allowlists are disjoint", async (t) => {
  const root = await makeCheckout(t);
  let processCalled = false;
  const runner = async () => {
    processCalled = true;
  };
  const base = {
    allowedRpcUrl: ALLOWED_RPC_URL,
    env: { [GAME_REPOSITORY_ENV]: root },
    runner,
  };

  const missing = await createRawGameBridge(base).run(
    "state",
    CASES.state.options,
  );
  assert.equal(missing.error.code, "EXECUTION_ROLE_INVALID");

  for (const [executionRole, operation] of [
    ["player", "advance"],
    ["phase-advancer", "join"],
    ["read-only", "claim"],
  ]) {
    const result = await createRawGameBridge({
      ...base,
      executionRole,
    }).run(operation, CASES[operation].options);
    assert.equal(result.error.code, "EXECUTION_ROLE_VIOLATION");
  }
  assert.equal(processCalled, false);
});

test("execution roles reject co-resident and cross-role signer environments", async (t) => {
  const root = await makeCheckout(t);
  const cases = [
    {
      role: "player",
      operation: "join",
      env: {
        [GAMEPLAY_PRIVATE_KEY_ENV]: TEST_GAMEPLAY_KEY,
        [PHASE_ADVANCER_PRIVATE_KEY_ENV]: TEST_ADVANCER_KEY,
      },
    },
    {
      role: "phase-advancer",
      operation: "advance",
      env: {
        [GAMEPLAY_PRIVATE_KEY_ENV]: TEST_GAMEPLAY_KEY,
        [PHASE_ADVANCER_PRIVATE_KEY_ENV]: TEST_ADVANCER_KEY,
      },
    },
    {
      role: "read-only",
      operation: "state",
      env: { [GAMEPLAY_PRIVATE_KEY_ENV]: TEST_GAMEPLAY_KEY },
    },
    {
      role: "read-only",
      operation: "wallet_auth_status",
      env: { [PHASE_ADVANCER_PRIVATE_KEY_ENV]: TEST_ADVANCER_KEY },
    },
  ];

  for (const current of cases) {
    let processCalled = false;
    const result = await createRawGameBridge({
      allowedRpcUrl: ALLOWED_RPC_URL,
      executionRole: current.role,
      env: {
        [GAME_REPOSITORY_ENV]: root,
        ...current.env,
      },
      runner: async () => {
        processCalled = true;
      },
    }).run(current.operation, CASES[current.operation].options);
    assert.equal(result.error.code, "CROSS_ROLE_KEY_ENVIRONMENT");
    assert.equal(processCalled, false);
  }
});

test("signed operations require valid unique public seat and operations manifests", async (t) => {
  const root = await makeCheckout(t);
  const duplicateWalletSeats = TEST_SEAT_MANIFEST.seats.map((seat, index) => ({
    ...seat,
    wallet_address:
      index === 1
        ? TEST_GAMEPLAY_ADDRESS.toUpperCase().replace("0X", "0x")
        : seat.wallet_address,
  }));
  const duplicateIdSeats = TEST_SEAT_MANIFEST.seats.map((seat, index) => ({
    ...seat,
    ...(index === 1
      ? {
          seat_id: "oc-1",
          team: "openclaw",
          harness: "openclaw",
        }
      : {}),
  }));

  for (const seats of [duplicateWalletSeats, duplicateIdSeats]) {
    let processCalled = false;
    const bridge = createGameBridge({
      env: bridgeEnv(root),
      seatManifest: { ...TEST_SEAT_MANIFEST, seats },
      runner: async () => {
        processCalled = true;
      },
    });
    const result = await bridge.run("join", CASES.join.options);
    assert.equal(result.error.code, "SEAT_MANIFEST_DUPLICATE");
    assert.equal(processCalled, false);
  }

  for (const override of [
    { schema_version: 2 },
    { network: "base-mainnet" },
    { seats: [TEST_SEAT_MANIFEST.seats[0]] },
    { game_id: "different-game" },
  ]) {
    const result = await createGameBridge({
      env: bridgeEnv(root),
      seatManifest: { ...TEST_SEAT_MANIFEST, ...override },
      runner: async () => assert.fail("runner must not execute"),
    }).run("join", CASES.join.options);
    assert.equal(result.error.code, "SEAT_MANIFEST_INVALID");
  }
});

test("public manifests reject every schema-unknown field before any process", async (t) => {
  const root = await makeCheckout(t);
  const cases = [
    {
      override: {
        seatManifest: { ...TEST_SEAT_MANIFEST, unexpected_secret: "reject" },
      },
      code: "SEAT_MANIFEST_INVALID",
    },
    {
      override: {
        seatManifest: {
          ...TEST_SEAT_MANIFEST,
          seats: TEST_SEAT_MANIFEST.seats.map((seat, index) =>
            index === 0 ? { ...seat, unexpected_secret: "reject" } : seat
          ),
        },
      },
      code: "SEAT_MANIFEST_INVALID",
    },
    {
      override: {
        operationsManifest: {
          ...TEST_OPERATIONS_MANIFEST,
          unexpected_secret: "reject",
        },
      },
      code: "OPERATIONS_MANIFEST_INVALID",
    },
    {
      override: {
        operationsManifest: {
          ...TEST_OPERATIONS_MANIFEST,
          phase_advancer: {
            ...TEST_OPERATIONS_MANIFEST.phase_advancer,
            unexpected_secret: "reject",
          },
        },
      },
      code: "OPERATIONS_MANIFEST_INVALID",
    },
  ];

  for (const current of cases) {
    let processCalled = false;
    const result = await createGameBridge({
      env: bridgeEnv(root),
      runner: async () => {
        processCalled = true;
      },
      ...current.override,
    }).run("join", CASES.join.options);
    assert.equal(result.error.code, current.code);
    assert.equal(processCalled, false);
  }
});

test("phase manifest must match expected address, seats, owner, and privileged exclusions", async (t) => {
  const root = await makeCheckout(t);
  const phaseCases = [
    {
      options: { forbiddenPrivilegedWallets: undefined },
      code: "PRIVILEGED_MANIFEST_INVALID",
    },
    {
      options: {
        expectedPhaseAdvancerWallet:
          "0x00000000000000000000000000000000000000d1",
      },
      code: "SIGNER_ROLE_COLLISION",
    },
    {
      options: {
        operationsManifest: {
          ...TEST_OPERATIONS_MANIFEST,
          phase_advancer: {
            ...TEST_OPERATIONS_MANIFEST.phase_advancer,
            wallet_address: TEST_GAMEPLAY_ADDRESS,
          },
        },
        expectedPhaseAdvancerWallet: TEST_GAMEPLAY_ADDRESS,
      },
      code: "SIGNER_ROLE_COLLISION",
    },
    {
      options: {
        operationsManifest: {
          ...TEST_OPERATIONS_MANIFEST,
          phase_advancer: {
            ...TEST_OPERATIONS_MANIFEST.phase_advancer,
            wallet_address: FROZEN_NETWORK.owner,
          },
        },
        expectedPhaseAdvancerWallet: FROZEN_NETWORK.owner,
      },
      code: "SIGNER_ROLE_COLLISION",
    },
    {
      options: {
        forbiddenPrivilegedWallets: [
          TEST_PRIVILEGED_ADDRESS,
          TEST_ADVANCER_ADDRESS,
        ],
      },
      code: "SIGNER_ROLE_COLLISION",
    },
  ];

  for (const current of phaseCases) {
    let processCalled = false;
    const result = await createGameBridge({
      env: bridgeEnv(root),
      runner: async () => {
        processCalled = true;
      },
      ...current.options,
    }).run("advance", CASES.advance.options);
    assert.equal(result.error.code, current.code);
    assert.equal(processCalled, false);
  }
});

for (const [operation, expected] of Object.entries(CASES)) {
  test(`${operation} verifies the revision then invokes its pinned yarn alias`, async (t) => {
    const root = await makeCheckout(t);
    const calls = [];
    const bridge = createGameBridge({
      env: bridgeEnv(root),
      allowedRpcUrl: ALLOWED_RPC_URL,
      runner: fakeRunner({ root, capture: calls }),
    });

    const result = await bridge.run(operation, expected.options);

    assert.equal(result.error, null);
    assert.equal(result.operation, operation);
    assert.equal(result.command, "yarn");
    assert.equal(result.args[0], expected.script);
    assert.equal(result.args.at(-1), "--json");
    assert.ok(!result.args.includes(ALLOWED_RPC_URL));
    assert.ok(result.args.includes("[REDACTED_RPC_URL]"));
    assert.deepEqual(result.parsed, { ok: true });
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[0], {
      command: "git",
      args: ["rev-parse", "--show-toplevel", "HEAD"],
      cwd: root,
      env: {},
    });
    assert.deepEqual(calls[1], {
      command: "git",
      args: ["status", "--porcelain=v1", "--untracked-files=all"],
      cwd: root,
      env: {},
    });
    assert.deepEqual(calls[2], {
      command: "yarn",
      args: result.args.map((arg) =>
        arg === "[REDACTED_RPC_URL]" ? ALLOWED_RPC_URL : arg,
      ),
      cwd: root,
      env: operation === "advance"
        ? { [GAMEPLAY_PRIVATE_KEY_ENV]: TEST_ADVANCER_KEY }
        : ["register", "join", "prepare_commit", "commit", "reveal", "claim"].includes(operation)
          ? { [GAMEPLAY_PRIVATE_KEY_ENV]: TEST_GAMEPLAY_KEY }
          : {},
    });
  });
}

test("state and auth JSON fixtures survive parsing verbatim", async (t) => {
  const root = await makeCheckout(t);
  for (const [operation, fixtureName] of [
    ["state", "state.json"],
    ["wallet_auth_status", "auth-status.json"],
  ]) {
    const stdout = await fixture(fixtureName);
    const bridge = createGameBridge({
      env: bridgeEnv(root),
      runner: fakeRunner({
        root,
        commandOutput: { stdout, stderr: "", exitCode: 0, signal: null },
      }),
    });
    const result = await bridge.run(operation, CASES[operation].options);
    assert.deepEqual(result.parsed, JSON.parse(stdout));
    assert.equal(result.stdout, stdout);
  }
});

test("revision mismatch blocks yarn execution", async (t) => {
  const root = await makeCheckout(t);
  const calls = [];
  const bridge = createGameBridge({
    env: bridgeEnv(root),
    runner: fakeRunner({
      root,
      revision: "0000000000000000000000000000000000000000",
      capture: calls,
    }),
  });

  const result = await bridge.run("state", CASES.state.options);

  assert.equal(result.error.code, "REVISION_MISMATCH");
  assert.equal(result.exit_code, null);
  assert.equal(calls.length, 2);
});

test("dirty tracked, staged, or untracked checkout blocks yarn execution", async (t) => {
  const root = await makeCheckout(t);
  const calls = [];
  const bridge = createGameBridge({
    env: bridgeEnv(root),
    runner: fakeRunner({
      root,
      status: " M package.json\n",
      capture: calls,
    }),
  });

  const result = await bridge.run("state", CASES.state.options);

  assert.equal(result.error.code, "DIRTY_REPOSITORY");
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.command === "git"));
});

test("checkout rejects packages/foundry/.env files and symlinks before Git or Yarn", async (t) => {
  for (const kind of ["file", "symlink"]) {
    const root = await makeCheckout(t);
    const foundryDirectory = join(root, "packages", "foundry");
    await mkdir(foundryDirectory, { recursive: true });
    const envPath = join(foundryDirectory, ".env");
    if (kind === "file") {
      await writeFile(envPath, "PRIVATE_KEY=forbidden\n");
    } else {
      await symlink(
        join(artifactDirectoryFor(root), "prepared-existing.json"),
        envPath,
      );
    }
    const calls = [];
    const result = await createGameBridge({
      env: bridgeEnv(root),
      runner: fakeRunner({ root, capture: calls }),
    }).run("join", CASES.join.options);
    assert.equal(result.error.code, "FORBIDDEN_ENV_FILE");
    assert.equal(calls.length, 0);
  }
});

test("checkout rechecks packages/foundry/.env after Git before signed Yarn", async (t) => {
  const root = await makeCheckout(t);
  const foundryDirectory = join(root, "packages", "foundry");
  await mkdir(foundryDirectory, { recursive: true });
  const calls = [];
  const baseRunner = fakeRunner({ root, capture: calls });
  const runner = async (invocation) => {
    const result = await baseRunner(invocation);
    if (
      invocation.command === "git" &&
      invocation.args[0] === "status"
    ) {
      await writeFile(join(foundryDirectory, ".env"), "forbidden=true\n");
    }
    return result;
  };

  const result = await createGameBridge({
    env: bridgeEnv(root),
    runner,
  }).run("join", CASES.join.options);

  assert.equal(result.error.code, "FORBIDDEN_ENV_FILE");
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.command === "git"));
});

test("wrong network, chain, RPC, or tournament addresses fail before any process", async (t) => {
  const root = await makeCheckout(t);
  const invalidCases = [
    { network: "base-mainnet" },
    { chainId: 8453 },
    { rpcUrl: "https://mainnet.example.invalid" },
    { game: "0x0000000000000000000000000000000000000001" },
    { registry: "0x0000000000000000000000000000000000000001" },
    { chat: "0x0000000000000000000000000000000000000001" },
  ];
  for (const override of invalidCases) {
    let called = false;
    const bridge = createGameBridge({
      env: bridgeEnv(root),
      runner: async () => {
        called = true;
      },
    });
    const result = await bridge.run("state", {
      ...CASES.state.options,
      ...override,
    });
    assert.equal(result.error.code, "INVALID_ARGUMENT");
    assert.equal(called, false);
  }
});

test("signer operations reject Base mainnet even when a key is configured", async (t) => {
  const root = await makeCheckout(t);
  let called = false;
  const bridge = createGameBridge({
    env: bridgeEnv(root, {
      [GAMEPLAY_PRIVATE_KEY_ENV]: `0x${"10".repeat(32)}`,
    }),
    runner: async () => {
      called = true;
    },
  });

  const result = await bridge.run("join", {
    ...BASE_OPTIONS,
    network: "base-mainnet",
    chainId: 8453,
    causeId: 1,
  });

  assert.equal(result.error.code, "INVALID_ARGUMENT");
  assert.equal(called, false);
});

test("missing checkout produces a structured error without running a process", async () => {
  let called = false;
  const bridge = createGameBridge({
    env: {},
    runner: async () => {
      called = true;
    },
  });

  const result = await bridge.run("state", CASES.state.options);

  assert.equal(result.error.code, "REPOSITORY_NOT_CONFIGURED");
  assert.equal(called, false);
});

test("nonzero exit preserves all process evidence and parses JSON if present", async (t) => {
  const root = await makeCheckout(t);
  const bridge = createGameBridge({
    env: bridgeEnv(root),
    runner: fakeRunner({
      root,
      commandOutput: {
        stdout: '{"reason":"phase"}\n',
        stderr: "transaction refused\n",
        exitCode: 9,
        signal: null,
      },
    }),
  });

  const result = await bridge.run("advance", CASES.advance.options);

  assert.equal(result.error.code, "COMMAND_FAILED");
  assert.equal(result.exit_code, 9);
  assert.equal(result.stderr, "transaction refused\n");
  assert.deepEqual(result.parsed, { reason: "phase" });
});

test("signal termination is preserved as a structured command failure", async (t) => {
  const root = await makeCheckout(t);
  const bridge = createGameBridge({
    env: bridgeEnv(root),
    runner: fakeRunner({
      root,
      commandOutput: {
        stdout: "",
        stderr: "terminated\n",
        exitCode: null,
        signal: "SIGTERM",
      },
    }),
  });

  const result = await bridge.run("claim", CASES.claim.options);

  assert.equal(result.error.code, "COMMAND_FAILED");
  assert.equal(result.exit_code, null);
  assert.equal(result.signal, "SIGTERM");
  assert.equal(result.stderr, "terminated\n");
});

for (const [label, stdout] of [
  ["plain output", "not-json\n"],
  ["empty output", ""],
]) {
  test(`${label} is preserved and classified as invalid JSON`, async (t) => {
    const root = await makeCheckout(t);
    const bridge = createGameBridge({
      env: bridgeEnv(root),
      runner: fakeRunner({
        root,
        commandOutput: { stdout, stderr: "", exitCode: 0, signal: null },
      }),
    });

    const result = await bridge.run("state", CASES.state.options);

    assert.equal(result.error.code, "INVALID_JSON");
    assert.equal(result.stdout, stdout);
    assert.equal(result.parsed, null);
  });
}

test("raw private-key options are rejected before checkout or execution", async (t) => {
  const root = await makeCheckout(t);
  const calls = [];
  const bridge = createGameBridge({
    env: bridgeEnv(root),
    runner: fakeRunner({ root, capture: calls }),
  });

  const result = await bridge.run("join", {
    ...BASE_OPTIONS,
    causeId: 1,
    walletPrivateKey:
      `0x${"aa".repeat(32)}`,
  });

  assert.equal(result.error.code, "INVALID_ARGUMENT");
  assert.equal(calls.length, 0);
  assert.ok(!result.args.includes("--wallet-private-key"));

  for (const shapedKey of [
    "aA".repeat(32),
    `0x${"aA".repeat(32)}`,
    `0X${"aA".repeat(32)}`,
    `prefix-${"aA".repeat(32)}-suffix`,
    `prefix-0X${"aA".repeat(32)}-suffix`,
  ]) {
    const disguised = await bridge.run("register", {
      ...CASES.register.options,
      wallet: shapedKey,
    });
    assert.equal(disguised.error.code, "INVALID_ARGUMENT");
  }
  const embedded = await bridge.run("join", {
    ...BASE_OPTIONS,
    causeId: `cause-${"bB".repeat(32)}-forbidden`,
  });
  assert.equal(embedded.error.code, "INVALID_ARGUMENT");

  const removedRegisterOut = await bridge.run("register", {
    ...CASES.register.options,
    out: "/tmp/registration.json",
  });
  assert.equal(removedRegisterOut.error.code, "INVALID_ARGUMENT");
  assert.equal(calls.length, 0);
});

test("public argument redaction removes private-key-shaped substrings defensively", () => {
  for (const shaped of [
    "cD".repeat(32),
    `0x${"cD".repeat(32)}`,
    `0X${"Cd".repeat(32)}`,
  ]) {
    const safe = redactPublicArgument(`prefix-${shaped}-suffix`);
    assert.equal(safe, "prefix-[REDACTED_PRIVATE_KEY]-suffix");
    assert.ok(!safe.toLowerCase().includes(shaped.toLowerCase()));
  }
});

test("prepared bundle paths must remain absolute, real, and player-local", async (t) => {
  const root = await makeCheckout(t);
  const artifacts = artifactDirectoryFor(root);
  const crossDirectory = await mkdtemp(join(tmpdir(), "other-seat-artifacts-"));
  t.after(() => rm(crossDirectory, { recursive: true, force: true }));
  const symlinkInput = join(artifacts, "linked-input.json");
  await symlink(join(artifacts, "prepared-existing.json"), symlinkInput);

  const cases = [
    {
      operation: "prepare_commit",
      options: { ...CASES.prepare_commit.options, out: "relative.json" },
      code: "ARTIFACT_PATH_INVALID",
    },
    {
      operation: "prepare_commit",
      options: {
        ...CASES.prepare_commit.options,
        out: `${artifacts}${sep}..${sep}escape.json`,
      },
      code: "ARTIFACT_PATH_INVALID",
    },
    {
      operation: "prepare_commit",
      options: {
        ...CASES.prepare_commit.options,
        out: join(crossDirectory, "other-seat.json"),
      },
      code: "ARTIFACT_PATH_INVALID",
    },
    {
      operation: "prepare_commit",
      options: {
        ...CASES.prepare_commit.options,
        out: join(artifacts, "prepared-existing.json"),
      },
      code: "ARTIFACT_PATH_INVALID",
    },
    {
      operation: "commit",
      options: { ...CASES.commit.options, input: symlinkInput },
      code: "ARTIFACT_PATH_INVALID",
    },
  ];

  for (const current of cases) {
    const calls = [];
    const result = await createGameBridge({
      env: bridgeEnv(root),
      preserveOperationPaths: true,
      runner: fakeRunner({ root, capture: calls }),
    }).run(current.operation, current.options);
    assert.equal(result.error.code, current.code);
    assert.equal(calls.length, 0);
  }
});

test("artifact directory must be real and disjoint from the pinned checkout", async (t) => {
  const root = await makeCheckout(t);
  const insideCheckout = join(root, "player-artifacts");
  await mkdir(insideCheckout);
  const output = join(insideCheckout, "bundle.json");
  const calls = [];
  const result = await createGameBridge({
    env: bridgeEnv(root),
    artifactDirectory: insideCheckout,
    preserveOperationPaths: true,
    runner: fakeRunner({ root, capture: calls }),
  }).run("prepare_commit", {
    ...CASES.prepare_commit.options,
    out: output,
  });
  assert.equal(result.error.code, "ARTIFACT_DIRECTORY_INVALID");
  assert.equal(calls.length, 0);

  const linkedArtifacts = `${artifactDirectoryFor(root)}-link`;
  await symlink(artifactDirectoryFor(root), linkedArtifacts);
  t.after(() => rm(linkedArtifacts, { force: true }));
  const linkedResult = await createGameBridge({
    env: bridgeEnv(root),
    artifactDirectory: linkedArtifacts,
    preserveOperationPaths: true,
    runner: async () => assert.fail("runner must not execute"),
  }).run("prepare_commit", {
    ...CASES.prepare_commit.options,
    out: join(linkedArtifacts, "bundle.json"),
  });
  assert.equal(linkedResult.error.code, "ARTIFACT_DIRECTORY_INVALID");
});

test("all six player signer operations receive only their gameplay key", async (t) => {
  const root = await makeCheckout(t);
  const gameplayKey = `0x${"11".repeat(32)}`;
  const advancerKey = `0x${"22".repeat(32)}`;

  for (const operation of PLAYER_OPERATIONS) {
    const calls = [];
    const verifierCalls = [];
    const bridge = createGameBridge({
      env: bridgeEnv(root, {
        [GAMEPLAY_PRIVATE_KEY_ENV]: gameplayKey,
        [PHASE_ADVANCER_PRIVATE_KEY_ENV]: advancerKey,
        UNRELATED_SECRET: "must-not-reach-child",
      }),
      chainVerifier: async (request) => {
        verifierCalls.push(structuredClone(request));
        return { chainId: FROZEN_NETWORK.chainId };
      },
      signerAddressDeriver: async ({ privateKey }) => ({
        address: privateKey === gameplayKey ? TEST_GAMEPLAY_ADDRESS : null,
      }),
      runner: fakeRunner({ root, capture: calls }),
    });

    const result = await bridge.run(operation, CASES[operation].options);

    assert.equal(result.error, null);
    assert.deepEqual(verifierCalls, [
      {
        rpcUrl: ALLOWED_RPC_URL,
        expectedChainId: FROZEN_NETWORK.chainId,
      },
      {
        rpcUrl: ALLOWED_RPC_URL,
        expectedChainId: FROZEN_NETWORK.chainId,
      },
    ]);
    assert.deepEqual(calls[0].env, {});
    assert.deepEqual(calls[1].env, {});
    assert.deepEqual(calls[2].env, {
      [GAMEPLAY_PRIVATE_KEY_ENV]: gameplayKey,
    });
  }
});

test("advance maps only the distinct phase-advancer key to the pinned CLI name", async (t) => {
  const root = await makeCheckout(t);
  const gameplayKey = `0x${"33".repeat(32)}`;
  const advancerKey = `0x${"44".repeat(32)}`;
  const calls = [];
  const bridge = createGameBridge({
    env: bridgeEnv(root, {
      [GAMEPLAY_PRIVATE_KEY_ENV]: gameplayKey,
      [PHASE_ADVANCER_PRIVATE_KEY_ENV]: advancerKey,
      UNRELATED_SECRET: "must-not-reach-child",
    }),
    signerAddressDeriver: async ({ privateKey }) => ({
      address: privateKey === advancerKey ? TEST_ADVANCER_ADDRESS : null,
    }),
    runner: fakeRunner({ root, capture: calls }),
  });

  const result = await bridge.run("advance", CASES.advance.options);

  assert.equal(result.error, null);
  assert.deepEqual(calls[0].env, {});
  assert.deepEqual(calls[1].env, {});
  assert.deepEqual(calls[2].env, {
    [GAMEPLAY_PRIVATE_KEY_ENV]: advancerKey,
  });
  assert.ok(!JSON.stringify(result).includes(advancerKey));
  assert.ok(!JSON.stringify(result).includes(PHASE_ADVANCER_PRIVATE_KEY_ENV));
});

test("read-only operations and git verification receive no signer keys", async (t) => {
  const root = await makeCheckout(t);
  for (const operation of ["state", "wallet_auth_status"]) {
    const calls = [];
    const bridge = createGameBridge({
      env: bridgeEnv(root, {
        [GAMEPLAY_PRIVATE_KEY_ENV]: `0x${"55".repeat(32)}`,
        [PHASE_ADVANCER_PRIVATE_KEY_ENV]: `0x${"66".repeat(32)}`,
        UNRELATED_SECRET: "must-not-reach-child",
      }),
      runner: fakeRunner({ root, capture: calls }),
    });

    const result = await bridge.run(operation, CASES[operation].options);

    assert.equal(result.error, null);
    assert.ok(calls.every((call) => !Object.hasOwn(call.env, GAMEPLAY_PRIVATE_KEY_ENV)));
    assert.ok(
      calls.every(
        (call) => !Object.hasOwn(call.env, PHASE_ADVANCER_PRIVATE_KEY_ENV),
      ),
    );
    assert.ok(calls.every((call) => !Object.hasOwn(call.env, "UNRELATED_SECRET")));
  }
});

test("missing operation-appropriate signer fails before git or yarn", async (t) => {
  const root = await makeCheckout(t);
  for (const operation of [...PLAYER_OPERATIONS, "advance"]) {
    let called = false;
    const bridge = createGameBridge({
      env: { [GAME_REPOSITORY_ENV]: root },
      runner: async () => {
        called = true;
      },
    });

    const result = await bridge.run(operation, CASES[operation].options);

    assert.equal(result.error.code, "SIGNER_NOT_CONFIGURED");
    assert.equal(called, false);
  }
});

test("phase-only signer cannot authorize any player operation", async (t) => {
  const root = await makeCheckout(t);
  for (const operation of PLAYER_OPERATIONS) {
    let called = false;
    const bridge = createGameBridge({
      env: {
        [GAME_REPOSITORY_ENV]: root,
        [PHASE_ADVANCER_PRIVATE_KEY_ENV]: TEST_ADVANCER_KEY,
      },
      runner: async () => {
        called = true;
      },
    });
    const result = await bridge.run(operation, CASES[operation].options);
    assert.equal(result.error.code, "SIGNER_NOT_CONFIGURED");
    assert.equal(called, false);
  }
});

test("gameplay-only signer cannot authorize advance", async (t) => {
  const root = await makeCheckout(t);
  let called = false;
  const bridge = createGameBridge({
    env: {
      [GAME_REPOSITORY_ENV]: root,
      [GAMEPLAY_PRIVATE_KEY_ENV]: TEST_GAMEPLAY_KEY,
    },
    runner: async () => {
      called = true;
    },
  });
  const result = await bridge.run("advance", CASES.advance.options);
  assert.equal(result.error.code, "SIGNER_NOT_CONFIGURED");
  assert.equal(called, false);
});

test("legacy keystore and raw wallet signer options are rejected for signer operations", async (t) => {
  const root = await makeCheckout(t);
  let called = false;
  const bridge = createGameBridge({
    env: bridgeEnv(root),
    runner: async () => {
      called = true;
    },
  });

  for (const operation of [...PLAYER_OPERATIONS, "advance"]) {
    for (const legacyOptions of [
      {
        walletKeystore: "legacy",
        walletKeystorePasswordEnv: "LEGACY_PASSWORD",
      },
      {
        walletKeystore: "legacy",
        walletKeystorePasswordFile: "legacy.pass",
      },
    ]) {
      const result = await bridge.run(operation, {
        ...CASES[operation].options,
        ...legacyOptions,
      });
      assert.equal(result.error.code, "INVALID_ARGUMENT");
    }
  }

  for (const operation of ["join", "prepare_commit", "commit", "reveal", "advance", "claim"]) {
    const result = await bridge.run(operation, {
      ...CASES[operation].options,
      wallet: "0x0000000000000000000000000000000000000001",
    });
    assert.equal(result.error.code, "INVALID_ARGUMENT");
  }
  assert.equal(called, false);
});

test("environment signer keys must use canonical 0x-prefixed 32-byte hex", async (t) => {
  const root = await makeCheckout(t);
  for (const malformed of [
    "aa".repeat(32),
    `0X${"aa".repeat(32)}`,
    `0x${"aa".repeat(31)}`,
    `0x${"gg".repeat(32)}`,
  ]) {
    let called = false;
    const bridge = createGameBridge({
      env: {
        [GAME_REPOSITORY_ENV]: root,
        [GAMEPLAY_PRIVATE_KEY_ENV]: malformed,
      },
      runner: async () => {
        called = true;
      },
    });
    const result = await bridge.run("join", CASES.join.options);
    assert.equal(result.error.code, "SIGNER_INVALID_FORMAT");
    assert.equal(called, false);
  }
});

test("signer identity binding is mandatory and fails closed before git or yarn", async (t) => {
  const root = await makeCheckout(t);
  const cases = [
    {
      override: { expectedGameplayWallet: undefined },
      code: "SIGNER_IDENTITY_NOT_CONFIGURED",
    },
    {
      override: { signerAddressDeriver: null },
      code: "SIGNER_IDENTITY_VERIFIER_NOT_CONFIGURED",
    },
    {
      override: {
        signerAddressDeriver: async () => {
          throw new Error("derivation unavailable");
        },
      },
      code: "SIGNER_IDENTITY_VERIFICATION_FAILED",
    },
    {
      override: { signerAddressDeriver: async () => null },
      code: "SIGNER_IDENTITY_VERIFICATION_FAILED",
    },
    {
      override: {
        signerAddressDeriver: async () => ({
          address: "0x00000000000000000000000000000000000000ff",
        }),
      },
      code: "SIGNER_IDENTITY_MISMATCH",
    },
  ];

  for (const current of cases) {
    let processCalled = false;
    const bridge = createGameBridge({
      env: bridgeEnv(root),
      runner: async () => {
        processCalled = true;
      },
      ...current.override,
    });
    const result = await bridge.run("join", CASES.join.options);
    assert.equal(result.error.code, current.code);
    assert.equal(processCalled, false);
  }
});

test("game bridge securely defaults to real local signer-address derivation", async (t) => {
  const root = await makeCheckout(t);
  const privateKey = `0x${"0".repeat(63)}1`;
  const expectedAddress = "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf";
  const calls = [];
  const bridge = createRawGameBridge({
    allowedRpcUrl: ALLOWED_RPC_URL,
    env: {
      [GAME_REPOSITORY_ENV]: root,
      [GAMEPLAY_PRIVATE_KEY_ENV]: privateKey,
    },
    chainVerifier: passingChainVerifier,
    executionRole: "player",
    seatManifest: {
      ...TEST_SEAT_MANIFEST,
      seats: [
        {
          ...TEST_SEAT_MANIFEST.seats[0],
          wallet_address: expectedAddress,
        },
        TEST_SEAT_MANIFEST.seats[1],
      ],
    },
    operationsManifest: TEST_OPERATIONS_MANIFEST,
    expectedGameplayWallet: expectedAddress,
    expectedPhaseAdvancerWallet: TEST_ADVANCER_ADDRESS,
    runner: fakeRunner({ root, capture: calls }),
  });

  const result = await bridge.run("join", CASES.join.options);

  assert.equal(result.error, null);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.at(-1).env, {
    [GAMEPLAY_PRIVATE_KEY_ENV]: privateKey,
  });
});

test("player and phase-advancer manifest wallets cannot collide", async (t) => {
  const root = await makeCheckout(t);
  let derivationCalled = false;
  let processCalled = false;
  const bridge = createGameBridge({
    env: bridgeEnv(root),
    expectedGameplayWallet: TEST_GAMEPLAY_ADDRESS,
    expectedPhaseAdvancerWallet: TEST_GAMEPLAY_ADDRESS.toUpperCase().replace("0X", "0x"),
    signerAddressDeriver: async () => {
      derivationCalled = true;
      return { address: TEST_GAMEPLAY_ADDRESS };
    },
    runner: async () => {
      processCalled = true;
    },
  });

  const result = await bridge.run("join", CASES.join.options);

  assert.equal(result.error.code, "SIGNER_ROLE_COLLISION");
  assert.equal(derivationCalled, false);
  assert.equal(processCalled, false);
});

test("phase advancer cannot collide with any forbidden public role wallet", async (t) => {
  const root = await makeCheckout(t);
  let derivationCalled = false;
  let processCalled = false;
  const bridge = createGameBridge({
    env: bridgeEnv(root),
    forbiddenPrivilegedWallets: [
      "0x00000000000000000000000000000000000000f1",
      TEST_ADVANCER_ADDRESS,
    ],
    signerAddressDeriver: async () => {
      derivationCalled = true;
      return { address: TEST_ADVANCER_ADDRESS };
    },
    runner: async () => {
      processCalled = true;
    },
  });

  const result = await bridge.run("advance", CASES.advance.options);

  assert.equal(result.error.code, "SIGNER_ROLE_COLLISION");
  assert.equal(derivationCalled, false);
  assert.equal(processCalled, false);
});

test("a player key substituted into the phase-advancer slot is rejected by derived address", async (t) => {
  const root = await makeCheckout(t);
  let processCalled = false;
  let chainVerifierCalled = false;
  const bridge = createGameBridge({
    env: {
      [GAME_REPOSITORY_ENV]: root,
      [PHASE_ADVANCER_PRIVATE_KEY_ENV]: TEST_GAMEPLAY_KEY,
    },
    chainVerifier: async () => {
      chainVerifierCalled = true;
      return { chainId: FROZEN_NETWORK.chainId };
    },
    runner: async () => {
      processCalled = true;
    },
  });

  const result = await bridge.run("advance", CASES.advance.options);

  assert.equal(result.error.code, "SIGNER_IDENTITY_MISMATCH");
  assert.equal(chainVerifierCalled, false);
  assert.equal(processCalled, false);
});

test("register expected public wallet must match the player signer manifest", async (t) => {
  const root = await makeCheckout(t);
  let processCalled = false;
  const bridge = createGameBridge({
    env: bridgeEnv(root),
    runner: async () => {
      processCalled = true;
    },
  });

  const result = await bridge.run("register", {
    ...CASES.register.options,
    wallet: "0x00000000000000000000000000000000000000ff",
  });

  assert.equal(result.error.code, "SIGNER_IDENTITY_MISMATCH");
  assert.equal(processCalled, false);
});

test("signer operations fail closed when the chain verifier is absent", async (t) => {
  const root = await makeCheckout(t);
  let processCalled = false;
  const bridge = createRawGameBridge({
    allowedRpcUrl: ALLOWED_RPC_URL,
    env: {
      [GAME_REPOSITORY_ENV]: root,
      [GAMEPLAY_PRIVATE_KEY_ENV]: TEST_GAMEPLAY_KEY,
    },
    chainVerifier: null,
    signerAddressDeriver: passingSignerAddressDeriver,
    executionRole: "player",
    seatManifest: TEST_SEAT_MANIFEST,
    operationsManifest: TEST_OPERATIONS_MANIFEST,
    expectedGameplayWallet: TEST_GAMEPLAY_ADDRESS,
    expectedPhaseAdvancerWallet: TEST_ADVANCER_ADDRESS,
    runner: async () => {
      processCalled = true;
    },
  });

  const result = await bridge.run("join", CASES.join.options);

  assert.equal(result.error.code, "CHAIN_VERIFIER_NOT_CONFIGURED");
  assert.equal(processCalled, false);
});

test("chain verifier errors, unavailable results, and mainnet mismatches fail before git or yarn", async (t) => {
  const root = await makeCheckout(t);
  const cases = [
    {
      verifier: async () => {
        throw new Error("RPC unavailable");
      },
      code: "CHAIN_VERIFICATION_FAILED",
    },
    {
      verifier: async () => null,
      code: "CHAIN_VERIFICATION_FAILED",
    },
    {
      verifier: async () => ({ chainId: 8453 }),
      code: "CHAIN_ID_MISMATCH",
    },
  ];

  for (const current of cases) {
    let processCalled = false;
    const bridge = createGameBridge({
      env: bridgeEnv(root),
      chainVerifier: current.verifier,
      runner: async () => {
        processCalled = true;
      },
    });
    const result = await bridge.run("claim", CASES.claim.options);
    assert.equal(result.error.code, current.code);
    assert.equal(processCalled, false);
  }
});

test("chain verifier receives only the RPC URL and expected Base Sepolia ID", async (t) => {
  const root = await makeCheckout(t);
  const verifierCalls = [];
  const processCalls = [];
  const bridge = createGameBridge({
    env: bridgeEnv(root, {
      UNRELATED_SECRET: "never-forward",
    }),
    chainVerifier: async (request) => {
      verifierCalls.push(structuredClone(request));
      return { chainId: 84532 };
    },
    runner: fakeRunner({ root, capture: processCalls }),
  });

  const result = await bridge.run("join", CASES.join.options);

  assert.equal(result.error, null);
  assert.deepEqual(verifierCalls, [
    {
      rpcUrl: ALLOWED_RPC_URL,
      expectedChainId: 84532,
    },
    {
      rpcUrl: ALLOWED_RPC_URL,
      expectedChainId: 84532,
    },
  ]);
  const serialized = JSON.stringify(verifierCalls);
  assert.ok(!serialized.includes(TEST_GAMEPLAY_KEY));
  assert.ok(!serialized.includes(TEST_ADVANCER_KEY));
  assert.ok(!serialized.includes("UNRELATED_SECRET"));
  assert.equal(processCalls.length, 3);
});

test("signed operations repeat chain verification after checkout and block Yarn on drift", async (t) => {
  const root = await makeCheckout(t);
  const verifierCalls = [];
  const processCalls = [];
  const bridge = createGameBridge({
    env: bridgeEnv(root),
    chainVerifier: async (request) => {
      verifierCalls.push(structuredClone(request));
      return {
        chainId:
          verifierCalls.length === 1
            ? FROZEN_NETWORK.chainId
            : 8453,
      };
    },
    runner: fakeRunner({ root, capture: processCalls }),
  });

  const result = await bridge.run("join", CASES.join.options);

  assert.equal(result.error.code, "CHAIN_ID_MISMATCH");
  assert.equal(verifierCalls.length, 2);
  assert.equal(processCalls.length, 2);
  assert.ok(processCalls.every((call) => call.command === "git"));
});

test("echoed key variants are redacted from output, parsed data, and errors", async (t) => {
  const root = await makeCheckout(t);
  const gameplayKey = `0x${"aB".repeat(32)}`;
  const forms = [
    gameplayKey,
    gameplayKey.toLowerCase(),
    gameplayKey.toUpperCase(),
    gameplayKey.slice(2),
    gameplayKey.slice(2).toLowerCase(),
    gameplayKey.slice(2).toUpperCase(),
    `0X${"Ab".repeat(32)}`,
    "Ab".repeat(32),
  ];
  const bridge = createGameBridge({
    env: bridgeEnv(root, { [GAMEPLAY_PRIVATE_KEY_ENV]: gameplayKey }),
    signerAddressDeriver: async ({ privateKey }) => ({
      address: privateKey === gameplayKey ? TEST_GAMEPLAY_ADDRESS : null,
    }),
    runner: fakeRunner({
      root,
      commandOutput: {
        stdout: JSON.stringify({
          echoed: forms,
          [forms[3]]: "key-shaped-property-name",
        }),
        stderr: `stderr ${forms.join(" ")}`,
        exitCode: null,
        signal: "SIGTERM",
        bridgeError: {
          code: `UPSTREAM_${forms[2]}`,
          message: `upstream echoed ${forms[4]}`,
        },
      },
    }),
  });

  const result = await bridge.run("claim", CASES.claim.options);

  assert.equal(result.error.code, "UPSTREAM_[REDACTED]");
  for (const form of forms) assert.ok(!JSON.stringify(result).includes(form));
  assert.deepEqual(result.parsed.echoed, forms.map(() => "[REDACTED]"));
  assert.equal(result.parsed["[REDACTED]"], "key-shaped-property-name");
  assert.equal(result.stderr, `stderr ${forms.map(() => "[REDACTED]").join(" ")}`);
  assert.equal(result.error.message, "upstream echoed [REDACTED]");
});

test("three runtime-generated player and advancer keys remain isolated by seat and role", async (t) => {
  const root = await makeCheckout(t);
  const identities = [
    {
      seat: "oc-1",
      key: `0x${randomBytes(32).toString("hex")}`,
      address: "0x00000000000000000000000000000000000000a1",
      operation: "register",
    },
    {
      seat: "hs-1",
      key: `0x${randomBytes(32).toString("hex")}`,
      address: "0x00000000000000000000000000000000000000b1",
      operation: "prepare_commit",
    },
    {
      seat: "phase-advancer",
      key: `0x${randomBytes(32).toString("hex")}`,
      address: "0x00000000000000000000000000000000000000c1",
      operation: "advance",
    },
  ];
  assert.equal(new Set(identities.map(({ key }) => key)).size, 3);
  const addressByKey = new Map(identities.map(({ key, address }) => [key, address]));
  const captures = new Map();

  for (const expected of identities) {
    const calls = [];
    captures.set(expected.seat, calls);
    const runner = fakeRunner({ root, capture: calls });
    const signerEnvironment = expected.operation === "advance"
      ? { [PHASE_ADVANCER_PRIVATE_KEY_ENV]: expected.key }
      : { [GAMEPLAY_PRIVATE_KEY_ENV]: expected.key };
    const bridge = createGameBridge({
      env: {
        [GAME_REPOSITORY_ENV]: root,
        ...signerEnvironment,
      },
      expectedGameplayWallet:
        expected.operation === "advance"
          ? TEST_GAMEPLAY_ADDRESS
          : expected.address,
      expectedPhaseAdvancerWallet:
        expected.operation === "advance"
          ? expected.address
          : TEST_ADVANCER_ADDRESS,
      signerAddressDeriver: async ({ privateKey }) => ({
        address: addressByKey.get(privateKey),
      }),
      runner: async (invocation) => {
        if (invocation.command !== "yarn") return runner(invocation);
        calls.push(structuredClone(invocation));
        return {
          stdout: JSON.stringify({
            seat: expected.seat,
            public_address: addressByKey.get(
              invocation.env[GAMEPLAY_PRIVATE_KEY_ENV],
            ),
          }),
          stderr: "",
          exitCode: 0,
          signal: null,
        };
      },
    });

    const result = await bridge.run(
      expected.operation,
      CASES[expected.operation].options,
    );

    assert.deepEqual(result.parsed, {
      seat: expected.seat,
      public_address: expected.address,
    });
  }

  for (const expected of identities) {
    const yarnCall = captures.get(expected.seat).at(-1);
    assert.deepEqual(yarnCall.env, {
      [GAMEPLAY_PRIVATE_KEY_ENV]: expected.key,
    });
    for (const other of identities.filter(({ seat }) => seat !== expected.seat)) {
      assert.notEqual(yarnCall.env[GAMEPLAY_PRIVATE_KEY_ENV], other.key);
    }
  }
});

test("unrelated environment values never reach git or yarn", async (t) => {
  const root = await makeCheckout(t);
  const calls = [];
  const logged = [];
  const original = {
    log: console.log,
    error: console.error,
    warn: console.warn,
  };
  console.log = (...parts) => logged.push(parts.join(" "));
  console.error = (...parts) => logged.push(parts.join(" "));
  console.warn = (...parts) => logged.push(parts.join(" "));
  t.after(() => Object.assign(console, original));

  const bridge = createGameBridge({
    env: bridgeEnv(root, {
      PRIVATE_KEY: "unrelated-value",
      LEGACY_PASSWORD: "unrelated-password",
    }),
    runner: fakeRunner({
      root,
      capture: calls,
    }),
  });
  const result = await bridge.run("claim", CASES.claim.options);

  assert.equal(result.error, null);
  assert.equal(logged.length, 0);
  assert.ok(calls.every((call) => !Object.hasOwn(call.env, "PRIVATE_KEY")));
  assert.ok(calls.every((call) => !Object.hasOwn(call.env, "LEGACY_PASSWORD")));
});

test("every returned outcome matches the shared command-result shape", async (t) => {
  const root = await makeCheckout(t);
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  const success = await createGameBridge({
    env: bridgeEnv(root),
    runner: fakeRunner({ root }),
  }).run("state", CASES.state.options);
  const failure = await createGameBridge({
    env: {},
    runner: async () => assert.fail("runner should not be called"),
  }).run("state", CASES.state.options);

  assertMatchesSharedSchema(success, schema);
  assertMatchesSharedSchema(failure, schema);
});

for (const [code, message] of [
  ["COMMAND_TIMEOUT", "deadline"],
  ["OUTPUT_LIMIT_EXCEEDED", "output limit"],
]) {
  test(`${code} is returned as a bounded structured process error`, async (t) => {
    const root = await makeCheckout(t);
    const bridge = createGameBridge({
      env: bridgeEnv(root),
      runner: fakeRunner({
        root,
        commandOutput: {
          stdout: "partial",
          stderr: "",
          exitCode: null,
          signal: "SIGTERM",
          bridgeError: { code, message },
        },
      }),
    });
    const result = await bridge.run("state", CASES.state.options);
    assert.equal(result.error.code, code);
    assert.equal(result.error.message, message);
    assert.equal(result.stdout, "partial");
  });
}

test("real process runner enforces timeout and output ceilings without a shell", async () => {
  const timeoutRunner = createProcessRunner({
    timeoutMs: 20,
    maxOutputBytes: 1_024,
  });
  const timed = await timeoutRunner({
    command: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    cwd: process.cwd(),
    env: { PATH: process.env.PATH },
  });
  assert.equal(timed.bridgeError.code, "COMMAND_TIMEOUT");

  const outputRunner = createProcessRunner({
    timeoutMs: 2_000,
    maxOutputBytes: 32,
  });
  const bounded = await outputRunner({
    command: process.execPath,
    args: ["-e", "process.stdout.write('x'.repeat(10000))"],
    cwd: process.cwd(),
    env: { PATH: process.env.PATH },
  });
  assert.equal(bounded.bridgeError.code, "OUTPUT_LIMIT_EXCEEDED");
  assert.ok(Buffer.byteLength(bounded.stdout) <= 32);
});

test("prepare choice syntax is delegated to the pinned CLI", () => {
  const invocation = buildInvocation(
    "prepare_commit",
    {
      ...BASE_OPTIONS,
      choice: "future-pinned-cli-choice",
    },
    { allowedRpcUrl: ALLOWED_RPC_URL },
  );
  assert.ok(invocation.args.includes("future-pinned-cli-choice"));
});

test("invocations are argumentized and contain no shell command string", () => {
  const invocation = buildInvocation("join", {
    ...BASE_OPTIONS,
    causeId: "1; touch /tmp/should-not-run",
  }, { allowedRpcUrl: ALLOWED_RPC_URL });

  assert.equal(invocation.command, "yarn");
  assert.ok(invocation.args.includes("1; touch /tmp/should-not-run"));
  assert.equal(Object.hasOwn(invocation, "shell"), false);
});
