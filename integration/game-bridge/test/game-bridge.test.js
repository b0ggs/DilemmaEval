import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  GAME_REPOSITORY_ENV,
  FROZEN_NETWORK,
  PINNED_GAME_REVISION,
  SUPPORTED_OPERATIONS,
  buildInvocation,
  createGameBridge as createRawGameBridge,
  createProcessRunner,
} from "../src/index.js";

const schemaPath = new URL(
  "../../shared/schemas/command-result.schema.json",
  import.meta.url,
);
const fixtureDirectory = new URL("./fixtures/", import.meta.url);
const ALLOWED_RPC_URL = "https://base-sepolia.example.invalid/rpc-key";

const BASE_OPTIONS = Object.freeze({
  network: FROZEN_NETWORK.name,
  chainId: FROZEN_NETWORK.chainId,
  rpcUrl: ALLOWED_RPC_URL,
  game: FROZEN_NETWORK.game,
  gameId: 7,
});

function createGameBridge(options = {}) {
  return createRawGameBridge({ allowedRpcUrl: ALLOWED_RPC_URL, ...options });
}

async function fixture(name) {
  return readFile(new URL(name, fixtureDirectory), "utf8");
}

async function makeCheckout(t) {
  const directory = await mkdtemp(join(tmpdir(), "dilemma-game-bridge-"));
  await mkdir(join(directory, ".git"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return realpath(directory);
}

function bridgeEnv(root, extra = {}) {
  return {
    [GAME_REPOSITORY_ENV]: root,
    PLAYER_1_PASSWORD: "test-password",
    OPERATOR_PASSWORD: "test-password",
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
      wallet: "0x0000000000000000000000000000000000000001",
    },
    script: "auth:status",
  },
  join: {
    options: {
      ...BASE_OPTIONS,
      causeId: 1,
      walletKeystore: "player-1",
      walletKeystorePasswordEnv: "PLAYER_1_PASSWORD",
    },
    script: "game:join",
  },
  prepare_commit: {
    options: {
      ...BASE_OPTIONS,
      choice: "share",
      out: "bundles/game-7-round-1.json",
      walletKeystore: "player-1",
      walletKeystorePasswordEnv: "PLAYER_1_PASSWORD",
    },
    script: "game:prepare-commit",
  },
  commit: {
    options: {
      ...BASE_OPTIONS,
      input: "bundles/game-7-round-1.json",
      walletKeystore: "player-1",
      walletKeystorePasswordFile: ".secrets/player-1.pass",
    },
    script: "game:commit",
  },
  reveal: {
    options: {
      ...BASE_OPTIONS,
      input: "bundles/game-7-round-1.json",
      walletKeystore: "player-1",
      walletKeystorePasswordFile: ".secrets/player-1.pass",
    },
    script: "game:reveal",
  },
  advance: {
    options: {
      ...BASE_OPTIONS,
      walletKeystore: "operator",
      walletKeystorePasswordEnv: "OPERATOR_PASSWORD",
    },
    script: "game:advance",
  },
  claim: {
    options: {
      ...BASE_OPTIONS,
      walletKeystore: "player-1",
      walletKeystorePasswordEnv: "PLAYER_1_PASSWORD",
    },
    script: "game:claim",
  },
};

test("operation inventory is frozen to the eight required pinned command families", () => {
  assert.deepEqual(SUPPORTED_OPERATIONS, Object.keys(CASES));
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
      env:
        expected.options.walletKeystorePasswordEnv === undefined
          ? {}
          : {
              [expected.options.walletKeystorePasswordEnv]: "test-password",
            },
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
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });

  assert.equal(result.error.code, "INVALID_ARGUMENT");
  assert.equal(calls.length, 0);
  assert.ok(!result.args.includes("--wallet-private-key"));

  const disguised = await bridge.run("join", {
    ...BASE_OPTIONS,
    causeId: 1,
    wallet: `0x${"aa".repeat(32)}`,
  });
  assert.equal(disguised.error.code, "INVALID_ARGUMENT");
  assert.equal(calls.length, 0);
});

test("only explicitly referenced secret environment reaches the child and results redact it", async (t) => {
  const root = await makeCheckout(t);
  const calls = [];
  const secret = "do-not-emit-this-value";
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
    env: {
      [GAME_REPOSITORY_ENV]: root,
      PRIVATE_KEY: secret,
      PLAYER_1_PASSWORD: secret,
    },
    runner: fakeRunner({
      root,
      capture: calls,
      commandOutput: {
        stdout: JSON.stringify({ echoed: secret, rpc: ALLOWED_RPC_URL }),
        stderr: `warning ${secret} ${ALLOWED_RPC_URL}`,
        exitCode: 0,
        signal: null,
      },
    }),
  });
  const result = await bridge.run("claim", CASES.claim.options);

  assert.equal(result.error, null);
  assert.equal(logged.length, 0);
  assert.ok(calls.every((call) => !Object.hasOwn(call.env, "PRIVATE_KEY")));
  assert.equal(calls.at(-1).env.PLAYER_1_PASSWORD, secret);
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.ok(!JSON.stringify(result).includes(ALLOWED_RPC_URL));
  assert.deepEqual(result.parsed, {
    echoed: "[REDACTED]",
    rpc: "[REDACTED]",
  });
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
    walletKeystore: "player one",
  }, { allowedRpcUrl: ALLOWED_RPC_URL });

  assert.equal(invocation.command, "yarn");
  assert.ok(invocation.args.includes("1; touch /tmp/should-not-run"));
  assert.ok(invocation.args.includes("player one"));
  assert.equal(Object.hasOwn(invocation, "shell"), false);
});
