import { access, lstat, readFile, realpath, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createECDH } from "node:crypto";
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
  join as joinPath
} from "node:path";

const runtimeSource = JSON.parse(
  await readFile(new URL("../../shared/runtime-source.json", import.meta.url), "utf8")
);

export const PINNED_GAME_REVISION = runtimeSource.game_revision;
export const GAME_REPOSITORY_ENV = runtimeSource.runtime_path_environment;
export const FROZEN_NETWORK = Object.freeze({
  name: runtimeSource.network.name,
  chainId: runtimeSource.network.chain_id,
  game: runtimeSource.network.game_address,
  chat: runtimeSource.network.game_chat_address,
  authRegistry: runtimeSource.network.auth_adapter_address,
  identityRegistry: runtimeSource.network.identity_registry_address,
  owner: runtimeSource.network.expected_owner
});

export const DEFAULT_EXECUTION_LIMITS = Object.freeze({
  timeoutMs: 30_000,
  maxOutputBytes: 1_048_576
});

export const GAMEPLAY_PRIVATE_KEY_ENV = "GAMEPLAY_WALLET_PRIVATE_KEY";
export const PHASE_ADVANCER_PRIVATE_KEY_ENV = "PHASE_ADVANCER_PRIVATE_KEY";

const BASE_ENVIRONMENT_NAMES = Object.freeze(["PATH", "HOME", "TMPDIR"]);
const CANONICAL_PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/;
const RAW_PRIVATE_KEY_ARGUMENT = /(?:0[xX])?[0-9a-fA-F]{64}/;
const RAW_PRIVATE_KEY_ARGUMENT_GLOBAL = /(?:0[xX])?[0-9a-fA-F]{64}/gi;
const ETHEREUM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UINT64_MASK = (1n << 64n) - 1n;
const KECCAK_RATE_BYTES = 136;
const KECCAK_ROTATION_OFFSETS = Object.freeze([
  0, 1, 62, 28, 27,
  36, 44, 6, 55, 20,
  3, 10, 43, 25, 39,
  41, 45, 15, 21, 8,
  18, 2, 61, 56, 14
]);
const KECCAK_ROUND_CONSTANTS = Object.freeze([
  0x0000000000000001n, 0x0000000000008082n,
  0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n,
  0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n,
  0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn,
  0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n,
  0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n,
  0x0000000080000001n, 0x8000000080008008n
]);
const PLAYER_SIGNER_OPERATIONS = Object.freeze(
  new Set(["register", "join", "prepare_commit", "commit", "reveal", "claim"])
);
const PHASE_ADVANCER_OPERATIONS = Object.freeze(new Set(["advance"]));
const READ_ONLY_OPERATIONS = Object.freeze(
  new Set(["state", "wallet_auth_status"])
);
const EXECUTION_ROLE_OPERATIONS = Object.freeze({
  player: PLAYER_SIGNER_OPERATIONS,
  "phase-advancer": PHASE_ADVANCER_OPERATIONS,
  "read-only": READ_ONLY_OPERATIONS
});

const GAME_OPTIONS = Object.freeze({
  rpcUrl: "--rpc-url",
  game: "--game",
  gameId: "--game-id"
});

const SAFETY_OPTIONS = Object.freeze(new Set(["network", "chainId"]));

const OPERATION_SPECS = Object.freeze({
  state: {
    script: "query:summary",
    options: {
      ...GAME_OPTIONS,
      registry: "--registry",
      chat: "--chat",
      fromBlock: "--from-block",
      toBlock: "--to-block"
    },
    required: ["rpcUrl", "game", "gameId", "registry", "chat"]
  },
  wallet_auth_status: {
    script: "auth:status",
    options: {
      rpcUrl: "--rpc-url",
      identityRegistry: "--identity-registry",
      authRegistry: "--auth-registry",
      game: "--game",
      registrationFile: "--registration-file",
      wallet: "--wallet",
      agentId: "--agent-id"
    },
    required: [
      "rpcUrl",
      "identityRegistry",
      "authRegistry",
      "game",
      "wallet"
    ]
  },
  register: {
    script: "auth:register",
    options: {
      rpcUrl: "--rpc-url",
      identityRegistry: "--identity-registry",
      wallet: "--wallet",
      agentUri: "--agent-uri",
      game: "--game",
      authRegistry: "--auth-registry"
    },
    required: [
      "rpcUrl",
      "identityRegistry",
      "agentUri",
      "game",
      "authRegistry"
    ]
  },
  join: {
    script: "game:join",
    options: {
      ...GAME_OPTIONS,
      causeId: "--cause-id",
      valueWei: "--value-wei"
    },
    required: ["rpcUrl", "game", "gameId", "causeId"]
  },
  prepare_commit: {
    script: "game:prepare-commit",
    options: {
      ...GAME_OPTIONS,
      choice: "--choice",
      out: "--out"
    },
    required: ["rpcUrl", "game", "gameId", "choice"]
  },
  commit: {
    script: "game:commit",
    options: {
      ...GAME_OPTIONS,
      input: "--input"
    },
    required: ["rpcUrl", "game", "gameId", "input"]
  },
  reveal: {
    script: "game:reveal",
    options: {
      ...GAME_OPTIONS,
      input: "--input"
    },
    required: ["rpcUrl", "game", "gameId", "input"]
  },
  advance: {
    script: "game:advance",
    options: { ...GAME_OPTIONS },
    required: ["rpcUrl", "game", "gameId"]
  },
  claim: {
    script: "game:claim",
    options: { ...GAME_OPTIONS },
    required: ["rpcUrl", "game", "gameId"]
  }
});

export const SUPPORTED_OPERATIONS = Object.freeze(Object.keys(OPERATION_SPECS));

function rotateLeft64(value, offset) {
  if (offset === 0) return value & UINT64_MASK;
  const bits = BigInt(offset);
  return ((value << bits) | (value >> (64n - bits))) & UINT64_MASK;
}

function keccakPermutation(state) {
  for (const roundConstant of KECCAK_ROUND_CONSTANTS) {
    const columns = new Array(5);
    for (let x = 0; x < 5; x += 1) {
      columns[x] =
        state[x] ^
        state[x + 5] ^
        state[x + 10] ^
        state[x + 15] ^
        state[x + 20];
    }
    for (let x = 0; x < 5; x += 1) {
      const delta =
        columns[(x + 4) % 5] ^ rotateLeft64(columns[(x + 1) % 5], 1);
      for (let y = 0; y < 5; y += 1) {
        state[x + 5 * y] = (state[x + 5 * y] ^ delta) & UINT64_MASK;
      }
    }

    const moved = new Array(25).fill(0n);
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        const source = x + 5 * y;
        const destinationX = y;
        const destinationY = (2 * x + 3 * y) % 5;
        moved[destinationX + 5 * destinationY] = rotateLeft64(
          state[source],
          KECCAK_ROTATION_OFFSETS[source]
        );
      }
    }

    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        const index = x + 5 * y;
        state[index] =
          moved[index] ^
          ((~moved[((x + 1) % 5) + 5 * y] & UINT64_MASK) &
            moved[((x + 2) % 5) + 5 * y]);
      }
    }
    state[0] = (state[0] ^ roundConstant) & UINT64_MASK;
  }
}

function keccak256(input) {
  const source = Buffer.from(input);
  const paddingLength =
    KECCAK_RATE_BYTES - (source.length % KECCAK_RATE_BYTES);
  const padded = Buffer.alloc(source.length + paddingLength);
  source.copy(padded);
  padded[source.length] = 0x01;
  padded[padded.length - 1] |= 0x80;

  const state = new Array(25).fill(0n);
  for (let offset = 0; offset < padded.length; offset += KECCAK_RATE_BYTES) {
    for (let lane = 0; lane < KECCAK_RATE_BYTES / 8; lane += 1) {
      state[lane] ^= padded.readBigUInt64LE(offset + lane * 8);
    }
    keccakPermutation(state);
  }

  const digest = Buffer.alloc(32);
  for (let lane = 0; lane < 4; lane += 1) {
    digest.writeBigUInt64LE(state[lane], lane * 8);
  }
  return digest;
}

export function deriveEthereumAddress(privateKey) {
  if (typeof privateKey !== "string" || !CANONICAL_PRIVATE_KEY.test(privateKey)) {
    throw new TypeError(
      "privateKey must be canonical 0x-prefixed 32-byte hex."
    );
  }
  const keyBytes = Buffer.from(privateKey.slice(2), "hex");
  let publicKey;
  try {
    const ecdh = createECDH("secp256k1");
    ecdh.setPrivateKey(keyBytes);
    publicKey = ecdh.getPublicKey(undefined, "uncompressed");
  } catch {
    throw new TypeError("privateKey is not a valid secp256k1 private key.");
  }
  const digest = keccak256(publicKey.subarray(1));
  return `0x${digest.subarray(12).toString("hex")}`;
}

export async function localSignerAddressDeriver({ privateKey } = {}) {
  return Object.freeze({ address: deriveEthereumAddress(privateKey) });
}

async function readBoundedResponseBody(response, maxResponseBytes) {
  const declaredLength = response.headers?.get?.("content-length");
  if (
    declaredLength !== null &&
    declaredLength !== undefined &&
    /^\d+$/.test(declaredLength) &&
    Number(declaredLength) > maxResponseBytes
  ) {
    throw new Error("The chain verification response exceeded its size limit.");
  }

  if (response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!(value instanceof Uint8Array)) {
          throw new Error("The chain verification response body was invalid.");
        }
        total += value.byteLength;
        if (total > maxResponseBytes) {
          await reader.cancel();
          throw new Error(
            "The chain verification response exceeded its size limit."
          );
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock?.();
    }
    return Buffer.concat(chunks, total).toString("utf8");
  }

  if (typeof response.text !== "function") {
    throw new Error("The chain verification response body was unavailable.");
  }
  const body = await response.text();
  if (
    typeof body !== "string" ||
    Buffer.byteLength(body) > maxResponseBytes
  ) {
    throw new Error("The chain verification response was invalid.");
  }
  return body;
}

export function createJsonRpcChainVerifier({
  fetchImpl = globalThis.fetch,
  timeoutMs = 5_000,
  maxResponseBytes = 4_096
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function.");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError("timeoutMs must be a positive integer.");
  }
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1) {
    throw new TypeError("maxResponseBytes must be a positive integer.");
  }

  return async ({ rpcUrl, expectedChainId } = {}) => {
    assertSafeRpcUrl(rpcUrl, rpcUrl);
    if (!Number.isSafeInteger(expectedChainId) || expectedChainId < 1) {
      throw new TypeError("expectedChainId must be a positive safe integer.");
    }

    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("The chain verification request timed out."));
      }, timeoutMs);
    });

    const request = async () => {
      const response = await fetchImpl(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_chainId",
          params: []
        }),
        signal: controller.signal
      });
      if (!response || response.ok !== true) {
        throw new Error("The chain verification response was unsuccessful.");
      }
      const body = await readBoundedResponseBody(response, maxResponseBytes);

      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        throw new Error("The chain verification response was not valid JSON.");
      }
      if (
        !payload ||
        typeof payload !== "object" ||
        Array.isArray(payload) ||
        payload.jsonrpc !== "2.0" ||
        payload.id !== 1 ||
        Object.hasOwn(payload, "error") ||
        typeof payload.result !== "string" ||
        !/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(payload.result)
      ) {
        throw new Error(
          "The chain verification response was not valid JSON-RPC."
        );
      }

      const chainIdBigInt = BigInt(payload.result);
      if (
        chainIdBigInt < 1n ||
        chainIdBigInt > BigInt(Number.MAX_SAFE_INTEGER)
      ) {
        throw new Error("The chain verification chain ID was out of range.");
      }
      return Object.freeze({ chainId: Number(chainIdBigInt) });
    };

    try {
      return await Promise.race([request(), deadline]);
    } catch {
      throw new Error("The chain verification request failed.");
    } finally {
      clearTimeout(timer);
    }
  };
}

function toArgument(value, key) {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "bigint"
  ) {
    throw new TypeError(`Option '${key}' must be a string or integer.`);
  }
  const rendered = String(value);
  if (rendered.length === 0 || rendered.includes("\0")) {
    throw new TypeError(`Option '${key}' must be a non-empty safe value.`);
  }
  if (RAW_PRIVATE_KEY_ARGUMENT.test(rendered)) {
    throw new TypeError("Raw private-key-shaped arguments are forbidden.");
  }
  return rendered;
}

function assertSupportedOperation(operation) {
  if (!Object.hasOwn(OPERATION_SPECS, operation)) {
    throw new TypeError(`Unsupported game operation '${operation}'.`);
  }
}

function assertExactAddress(value, expected, key) {
  if (
    typeof value !== "string" ||
    value.toLowerCase() !== expected.toLowerCase()
  ) {
    throw new TypeError(`Option '${key}' must match the frozen tournament address.`);
  }
}

function assertEthereumAddress(value, key) {
  if (typeof value !== "string" || !ETHEREUM_ADDRESS.test(value)) {
    throw new TypeError(`Option '${key}' must be a 20-byte Ethereum address.`);
  }
}

function assertSafeRpcUrl(value, allowedRpcUrl) {
  if (typeof allowedRpcUrl !== "string" || allowedRpcUrl.length === 0) {
    throw new TypeError("An explicit allowed Base Sepolia RPC URL is required.");
  }
  if (value !== allowedRpcUrl) {
    throw new TypeError("Option 'rpcUrl' is not the configured Base Sepolia RPC URL.");
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError("Option 'rpcUrl' must be a valid URL.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  ) {
    throw new TypeError(
      "Option 'rpcUrl' must be HTTPS and cannot contain credentials or a fragment."
    );
  }
}

function assertFrozenProfile(operation, options, allowedRpcUrl) {
  if (options.network !== FROZEN_NETWORK.name) {
    throw new TypeError(`Option 'network' must be '${FROZEN_NETWORK.name}'.`);
  }
  if (options.chainId !== FROZEN_NETWORK.chainId) {
    throw new TypeError(`Option 'chainId' must be ${FROZEN_NETWORK.chainId}.`);
  }
  assertSafeRpcUrl(options.rpcUrl, allowedRpcUrl);
  assertExactAddress(options.game, FROZEN_NETWORK.game, "game");
  if (operation === "state") {
    assertExactAddress(options.registry, FROZEN_NETWORK.identityRegistry, "registry");
    assertExactAddress(options.chat, FROZEN_NETWORK.chat, "chat");
  }
  if (operation === "wallet_auth_status" || operation === "register") {
    assertExactAddress(
      options.identityRegistry,
      FROZEN_NETWORK.identityRegistry,
      "identityRegistry"
    );
    assertExactAddress(
      options.authRegistry,
      FROZEN_NETWORK.authRegistry,
      "authRegistry"
    );
    if (options.wallet !== undefined) {
      assertEthereumAddress(options.wallet, "wallet");
    }
  }
}

export function buildInvocation(operation, options = {}, { allowedRpcUrl } = {}) {
  assertSupportedOperation(operation);
  if (
    options === null ||
    typeof options !== "object" ||
    Array.isArray(options)
  ) {
    throw new TypeError("Operation options must be an object.");
  }

  const spec = OPERATION_SPECS[operation];
  const suppliedKeys = Object.keys(options);
  const rejectedKey = suppliedKeys.find(
    (key) => !Object.hasOwn(spec.options, key) && !SAFETY_OPTIONS.has(key)
  );
  if (rejectedKey) {
    throw new TypeError(
      `Option '${rejectedKey}' is not supported for '${operation}'.`
    );
  }

  for (const key of [...(spec.required ?? []), "network", "chainId"]) {
    if (options[key] === undefined || options[key] === null) {
      throw new TypeError(`Option '${key}' is required for '${operation}'.`);
    }
  }

  assertFrozenProfile(operation, options, allowedRpcUrl);

  const args = [spec.script, "--"];
  for (const [key, flag] of Object.entries(spec.options)) {
    const value = options[key];
    if (value === undefined || value === null) continue;
    args.push(flag, toArgument(value, key));
  }
  args.push("--json");
  return Object.freeze({ command: "yarn", args: Object.freeze(args) });
}

function validateExecutionLimits(limits) {
  for (const key of ["timeoutMs", "maxOutputBytes"]) {
    if (!Number.isInteger(limits[key]) || limits[key] < 1) {
      throw new TypeError(`${key} must be a positive integer.`);
    }
  }
  return Object.freeze({ ...limits });
}

export function createProcessRunner(limits = DEFAULT_EXECUTION_LIMITS) {
  const frozenLimits = validateExecutionLimits({
    ...DEFAULT_EXECUTION_LIMITS,
    ...limits
  });
  return ({ command, args, cwd, env }) =>
    new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      let outputBytes = 0;
      let bridgeError = null;
      let settled = false;
      let forceKillTimer = null;

      function terminate() {
        child.kill("SIGTERM");
        if (forceKillTimer === null) {
          forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 250);
        }
      }

      const timer = setTimeout(() => {
        if (bridgeError === null) {
          bridgeError = {
            code: "COMMAND_TIMEOUT",
            message: "The pinned game command exceeded its execution deadline."
          };
        }
        terminate();
      }, frozenLimits.timeoutMs);

      function collect(target, chunk) {
        const bytes = Buffer.byteLength(chunk);
        const remaining = Math.max(0, frozenLimits.maxOutputBytes - outputBytes);
        const accepted =
          bytes <= remaining
            ? chunk
            : Buffer.from(chunk).subarray(0, remaining).toString("utf8");
        outputBytes += Buffer.byteLength(accepted);
        if (target === "stdout") stdout += accepted;
        else stderr += accepted;
        if (bytes > remaining && bridgeError === null) {
          bridgeError = {
            code: "OUTPUT_LIMIT_EXCEEDED",
            message: "The pinned game command exceeded its output limit."
          };
          terminate();
        }
      }

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => collect("stdout", chunk));
      child.stderr.on("data", (chunk) => collect("stderr", chunk));
      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (forceKillTimer !== null) clearTimeout(forceKillTimer);
        reject(error);
      });
      child.once("close", (exitCode, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (forceKillTimer !== null) clearTimeout(forceKillTimer);
        resolve({ stdout, stderr, exitCode, signal, bridgeError });
      });
    });
}

export function redactPublicArgument(argument) {
  if (typeof argument !== "string") {
    throw new TypeError("Public invocation arguments must be strings.");
  }
  return argument.replace(
    RAW_PRIVATE_KEY_ARGUMENT_GLOBAL,
    "[REDACTED_PRIVATE_KEY]"
  );
}

function publicInvocation(invocation) {
  const args = invocation.args.map(redactPublicArgument);
  const rpcIndex = args.indexOf("--rpc-url");
  if (rpcIndex !== -1 && rpcIndex + 1 < args.length) {
    args[rpcIndex + 1] = "[REDACTED_RPC_URL]";
  }
  return { command: invocation.command, args };
}

function errorResult(operation, invocation, code, message, execution = {}) {
  const safe = publicInvocation(invocation);
  return {
    schema_version: 1,
    operation,
    command: safe.command,
    args: safe.args,
    exit_code:
      Number.isInteger(execution.exitCode) ? execution.exitCode : null,
    signal: typeof execution.signal === "string" ? execution.signal : null,
    stdout: typeof execution.stdout === "string" ? execution.stdout : "",
    stderr: typeof execution.stderr === "string" ? execution.stderr : "",
    parsed: execution.parsed ?? null,
    error: { code, message }
  };
}

function parseOutput(stdout) {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return { parsed: null, valid: false };
  try {
    return { parsed: JSON.parse(trimmed), valid: true };
  } catch {
    return { parsed: null, valid: false };
  }
}

async function verifyCheckout(repoPath, runner, env) {
  if (typeof repoPath !== "string" || repoPath.length === 0) {
    return {
      ok: false,
      code: "REPOSITORY_NOT_CONFIGURED",
      message: `${GAME_REPOSITORY_ENV} must name the pinned game checkout.`
    };
  }

  let checkoutRoot;
  let checkoutIdentity;
  try {
    const details = await stat(repoPath);
    if (!details.isDirectory()) throw new Error("not-directory");
    checkoutIdentity = { device: details.dev, inode: details.ino };
    await access(joinPath(repoPath, ".git"));
    checkoutRoot = await realpath(repoPath);
  } catch {
    return {
      ok: false,
      code: "INVALID_REPOSITORY",
      message: `${GAME_REPOSITORY_ENV} must name the root of a git checkout.`
    };
  }

  const initialEnvBoundary = await verifyForbiddenEnvBoundary(checkoutRoot);
  if (!initialEnvBoundary.ok) return initialEnvBoundary;

  let revisionResult;
  let statusResult;
  try {
    revisionResult = await runner({
      command: "git",
      args: ["rev-parse", "--show-toplevel", "HEAD"],
      cwd: checkoutRoot,
      env
    });
    statusResult = await runner({
      command: "git",
      args: ["status", "--porcelain=v1", "--untracked-files=all"],
      cwd: checkoutRoot,
      env
    });
  } catch {
    return {
      ok: false,
      code: "REVISION_CHECK_FAILED",
      message: "Unable to verify the configured game checkout revision."
    };
  }

  if (
    !revisionResult ||
    !statusResult ||
    revisionResult.exitCode !== 0 ||
    revisionResult.signal ||
    revisionResult.bridgeError ||
    statusResult.exitCode !== 0 ||
    statusResult.signal ||
    statusResult.bridgeError
  ) {
    return {
      ok: false,
      code: "REVISION_CHECK_FAILED",
      message: "Unable to verify the configured game checkout revision."
    };
  }

  const [reportedRoot, revision, ...extra] = String(
    revisionResult.stdout ?? ""
  )
    .trim()
    .split(/\r?\n/);
  let resolvedReportedRoot;
  try {
    resolvedReportedRoot = await realpath(reportedRoot);
  } catch {
    return {
      ok: false,
      code: "INVALID_REPOSITORY",
      message: `${GAME_REPOSITORY_ENV} must name the root of a git checkout.`
    };
  }

  if (
    extra.length > 0 ||
    resolvedReportedRoot !== checkoutRoot ||
    revision !== PINNED_GAME_REVISION
  ) {
    return {
      ok: false,
      code: "REVISION_MISMATCH",
      message: "The configured game checkout is not the required pinned revision."
    };
  }
  if (String(statusResult.stdout ?? "").trim().length !== 0) {
    return {
      ok: false,
      code: "DIRTY_REPOSITORY",
      message: "The configured game checkout has tracked, staged, or untracked changes."
    };
  }
  return { ok: true, cwd: checkoutRoot, identity: checkoutIdentity };
}

async function verifyForbiddenEnvBoundary(checkoutRoot) {
  try {
    await lstat(joinPath(checkoutRoot, "packages", "foundry", ".env"));
    return {
      ok: false,
      code: "FORBIDDEN_ENV_FILE",
      message: "The pinned checkout must not contain packages/foundry/.env."
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { ok: true };
    return {
      ok: false,
      code: "REVISION_CHECK_FAILED",
      message: "Unable to verify the pinned checkout secret-file boundary."
    };
  }
}

function isContainedPath(parent, candidate) {
  const pathFromParent = relative(parent, candidate);
  return (
    pathFromParent === "" ||
    (
      pathFromParent !== ".." &&
      !pathFromParent.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromParent)
    )
  );
}

function hasExactOwnKeys(value, expectedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(value, key))
  );
}

async function validateArtifactBoundary(
  operation,
  options,
  artifactDirectory,
  repoPath
) {
  if (!["prepare_commit", "commit", "reveal"].includes(operation)) {
    return { ok: true };
  }
  if (
    typeof artifactDirectory !== "string" ||
    !isAbsolute(artifactDirectory) ||
    resolve(artifactDirectory) !== artifactDirectory
  ) {
    return {
      ok: false,
      code: "ARTIFACT_DIRECTORY_INVALID",
      message: "A normalized absolute player artifact directory is required."
    };
  }

  let artifactRoot;
  let checkoutRoot;
  try {
    const artifactDetails = await lstat(artifactDirectory);
    if (!artifactDetails.isDirectory() || artifactDetails.isSymbolicLink()) {
      throw new Error("artifact-directory");
    }
    artifactRoot = await realpath(artifactDirectory);
    checkoutRoot = await realpath(repoPath);
  } catch {
    return {
      ok: false,
      code: "ARTIFACT_DIRECTORY_INVALID",
      message: "The player artifact directory must be a prepared real directory."
    };
  }
  if (artifactRoot !== artifactDirectory) {
    return {
      ok: false,
      code: "ARTIFACT_DIRECTORY_INVALID",
      message: "The player artifact directory path must contain no symlink."
    };
  }
  if (
    isContainedPath(checkoutRoot, artifactRoot) ||
    isContainedPath(artifactRoot, checkoutRoot)
  ) {
    return {
      ok: false,
      code: "ARTIFACT_DIRECTORY_INVALID",
      message: "The player artifact directory and pinned checkout must be disjoint."
    };
  }

  const optionName = operation === "prepare_commit" ? "out" : "input";
  const candidate = options[optionName];
  if (
    typeof candidate !== "string" ||
    !isAbsolute(candidate) ||
    resolve(candidate) !== candidate
  ) {
    return {
      ok: false,
      code: "ARTIFACT_PATH_INVALID",
      message: `Option '${optionName}' must be a normalized absolute artifact path.`
    };
  }

  let parentRoot;
  try {
    const parentDetails = await lstat(dirname(candidate));
    if (!parentDetails.isDirectory() || parentDetails.isSymbolicLink()) {
      throw new Error("artifact-parent");
    }
    parentRoot = await realpath(dirname(candidate));
  } catch {
    return {
      ok: false,
      code: "ARTIFACT_PATH_INVALID",
      message: "The artifact path parent must be a prepared real directory."
    };
  }
  if (parentRoot !== dirname(candidate)) {
    return {
      ok: false,
      code: "ARTIFACT_PATH_INVALID",
      message: "The artifact path parent must contain no symlink."
    };
  }
  if (!isContainedPath(artifactRoot, parentRoot)) {
    return {
      ok: false,
      code: "ARTIFACT_PATH_INVALID",
      message: "The artifact path is outside the player-local artifact directory."
    };
  }

  if (operation === "prepare_commit") {
    try {
      await lstat(candidate);
      return {
        ok: false,
        code: "ARTIFACT_PATH_INVALID",
        message: "The prepared bundle output path must not already exist."
      };
    } catch (error) {
      if (error?.code !== "ENOENT") {
        return {
          ok: false,
          code: "ARTIFACT_PATH_INVALID",
          message: "The prepared bundle output path could not be validated."
        };
      }
    }
    return { ok: true };
  }

  try {
    const inputDetails = await lstat(candidate);
    if (!inputDetails.isFile() || inputDetails.isSymbolicLink()) {
      throw new Error("artifact-input");
    }
    const inputRoot = await realpath(candidate);
    if (inputRoot !== candidate || !isContainedPath(artifactRoot, inputRoot)) {
      throw new Error("artifact-input-boundary");
    }
  } catch {
    return {
      ok: false,
      code: "ARTIFACT_PATH_INVALID",
      message: "The prepared bundle input must be a real player-local file."
    };
  }
  return { ok: true };
}

function validatePublicManifests({
  seatManifest,
  operationsManifest,
  expectedGameplayWallet,
  expectedPhaseAdvancerWallet,
  forbiddenPrivilegedWallets,
  playerSigner
}) {
  const seatManifestKeys = ["schema_version", "network", "game_id", "seats"];
  const seatKeys = [
    "seat_id",
    "team",
    "harness",
    "maritime_agent",
    "wallet_address"
  ];
  const operationsManifestKeys = [
    "schema_version",
    "network",
    "chain_id",
    "phase_advancer",
    "gas_ceiling_wei"
  ];
  const phaseAdvancerKeys = [
    "role",
    "wallet_address",
    "is_player_seat",
    "erc8004_registered"
  ];
  if (
    !hasExactOwnKeys(seatManifest, seatManifestKeys) ||
    seatManifest.schema_version !== 1 ||
    seatManifest.network !== FROZEN_NETWORK.name ||
    typeof seatManifest.game_id !== "string" ||
    seatManifest.game_id.length === 0 ||
    !Array.isArray(seatManifest.seats) ||
    seatManifest.seats.length < 2 ||
    seatManifest.seats.length > 10
  ) {
    return { ok: false, code: "SEAT_MANIFEST_INVALID" };
  }

  const seatIds = new Set();
  const agents = new Set();
  const seatWallets = new Set();
  for (const seat of seatManifest.seats) {
    const openClaw = seat?.team === "openclaw";
    const hermes = seat?.team === "hermes";
    if (
      !hasExactOwnKeys(seat, seatKeys) ||
      !/^(oc|hs)-[1-5]$/.test(seat.seat_id) ||
      (!openClaw && !hermes) ||
      seat.harness !== seat.team ||
      (openClaw && !/^oc-[1-5]$/.test(seat.seat_id)) ||
      (hermes && !/^hs-[1-5]$/.test(seat.seat_id)) ||
      typeof seat.maritime_agent !== "string" ||
      seat.maritime_agent.length === 0 ||
      typeof seat.wallet_address !== "string" ||
      !ETHEREUM_ADDRESS.test(seat.wallet_address)
    ) {
      return { ok: false, code: "SEAT_MANIFEST_INVALID" };
    }
    const wallet = seat.wallet_address.toLowerCase();
    if (
      seatIds.has(seat.seat_id) ||
      agents.has(seat.maritime_agent) ||
      seatWallets.has(wallet)
    ) {
      return { ok: false, code: "SEAT_MANIFEST_DUPLICATE" };
    }
    seatIds.add(seat.seat_id);
    agents.add(seat.maritime_agent);
    seatWallets.add(wallet);
  }

  const phaseAddress = operationsManifest?.phase_advancer?.wallet_address;
  if (
    !hasExactOwnKeys(operationsManifest, operationsManifestKeys) ||
    !hasExactOwnKeys(operationsManifest.phase_advancer, phaseAdvancerKeys) ||
    operationsManifest.schema_version !== 1 ||
    operationsManifest.network !== FROZEN_NETWORK.name ||
    operationsManifest.chain_id !== FROZEN_NETWORK.chainId ||
    operationsManifest.phase_advancer?.role !== "phase-advancer" ||
    typeof phaseAddress !== "string" ||
    !ETHEREUM_ADDRESS.test(phaseAddress) ||
    operationsManifest.phase_advancer.is_player_seat !== false ||
    operationsManifest.phase_advancer.erc8004_registered !== false ||
    typeof operationsManifest.gas_ceiling_wei !== "string" ||
    !/^[1-9][0-9]*$/.test(operationsManifest.gas_ceiling_wei)
  ) {
    return { ok: false, code: "OPERATIONS_MANIFEST_INVALID" };
  }
  const normalizedPhase = phaseAddress.toLowerCase();
  if (
    typeof expectedPhaseAdvancerWallet !== "string" ||
    !ETHEREUM_ADDRESS.test(expectedPhaseAdvancerWallet) ||
    expectedPhaseAdvancerWallet.toLowerCase() !== normalizedPhase ||
    seatWallets.has(normalizedPhase) ||
    normalizedPhase === FROZEN_NETWORK.owner.toLowerCase()
  ) {
    return { ok: false, code: "SIGNER_ROLE_COLLISION" };
  }

  if (playerSigner) {
    if (
      typeof expectedGameplayWallet !== "string" ||
      !ETHEREUM_ADDRESS.test(expectedGameplayWallet) ||
      !seatWallets.has(expectedGameplayWallet.toLowerCase())
    ) {
      return { ok: false, code: "SIGNER_IDENTITY_NOT_CONFIGURED" };
    }
  } else {
    if (
      !Array.isArray(forbiddenPrivilegedWallets) ||
      forbiddenPrivilegedWallets.length === 0 ||
      forbiddenPrivilegedWallets.some(
        (address) =>
          typeof address !== "string" || !ETHEREUM_ADDRESS.test(address)
      )
    ) {
      return { ok: false, code: "PRIVILEGED_MANIFEST_INVALID" };
    }
    if (
      forbiddenPrivilegedWallets.some(
        (address) => address.toLowerCase() === normalizedPhase
      )
    ) {
      return { ok: false, code: "SIGNER_ROLE_COLLISION" };
    }
  }
  return { ok: true, seatWallets };
}

async function verifySignedChain(chainVerifier, rpcUrl) {
  if (typeof chainVerifier !== "function") {
    return {
      ok: false,
      code: "CHAIN_VERIFIER_NOT_CONFIGURED",
      message: "A fail-closed signer-operation chain verifier is required."
    };
  }
  let verification;
  try {
    verification = await chainVerifier(
      Object.freeze({
        rpcUrl,
        expectedChainId: FROZEN_NETWORK.chainId
      })
    );
  } catch {
    return {
      ok: false,
      code: "CHAIN_VERIFICATION_FAILED",
      message: "The signer-operation chain could not be verified."
    };
  }
  if (!verification || !Number.isInteger(verification.chainId)) {
    return {
      ok: false,
      code: "CHAIN_VERIFICATION_FAILED",
      message: "The signer-operation chain verifier returned no usable chain ID."
    };
  }
  if (verification.chainId !== FROZEN_NETWORK.chainId) {
    return {
      ok: false,
      code: "CHAIN_ID_MISMATCH",
      message: "The verified signer-operation chain is not Base Sepolia."
    };
  }
  return { ok: true };
}

function resolveSigner(operation, source) {
  const isPlayerOperation = PLAYER_SIGNER_OPERATIONS.has(operation);
  const isAdvanceOperation = PHASE_ADVANCER_OPERATIONS.has(operation);
  if (!isPlayerOperation && !isAdvanceOperation) {
    return Object.freeze({ required: false });
  }

  const sourceName = isAdvanceOperation
    ? PHASE_ADVANCER_PRIVATE_KEY_ENV
    : GAMEPLAY_PRIVATE_KEY_ENV;
  const privateKey = source?.[sourceName];
  if (privateKey === undefined || privateKey === null || privateKey === "") {
    return Object.freeze({ required: true, configured: false, invalid: false });
  }
  if (typeof privateKey !== "string" || !CANONICAL_PRIVATE_KEY.test(privateKey)) {
    return Object.freeze({ required: true, configured: false, invalid: true });
  }

  return Object.freeze({
    required: true,
    configured: true,
    childPrivateKey: privateKey
  });
}

function childEnvironment(source, { childPrivateKey = null } = {}) {
  const selected = {};
  for (const name of BASE_ENVIRONMENT_NAMES) {
    if (typeof source?.[name] === "string") selected[name] = source[name];
  }
  if (childPrivateKey !== null) {
    selected[GAMEPLAY_PRIVATE_KEY_ENV] = childPrivateKey;
  }
  return selected;
}

function privateKeyRedactionForms(privateKey) {
  if (typeof privateKey !== "string") return [];
  const stripped = privateKey.slice(2);
  return [
    privateKey,
    privateKey.toLowerCase(),
    privateKey.toUpperCase(),
    stripped,
    stripped.toLowerCase(),
    stripped.toUpperCase()
  ];
}

function redactSensitiveOutput(value, sensitiveValues) {
  let redacted = value;
  const uniqueSecrets = [...new Set(sensitiveValues)]
    .filter((secret) => typeof secret === "string" && secret.length > 0)
    .sort((left, right) => right.length - left.length);
  const keyHexValues = new Set();
  for (const secret of uniqueSecrets) {
    if (/^(?:0x)?[0-9a-fA-F]{64}$/.test(secret)) {
      keyHexValues.add(secret.replace(/^0x/i, "").toLowerCase());
    }
  }
  for (const keyHex of keyHexValues) {
    redacted = redacted.replace(
      new RegExp(`(?:0x)?${keyHex}`, "gi"),
      "[REDACTED]"
    );
  }
  for (const secret of uniqueSecrets) {
    if (secret.length > 0) redacted = redacted.replaceAll(secret, "[REDACTED]");
  }
  return redacted;
}

function redactStructuredOutput(value, sensitiveValues) {
  if (typeof value === "string") {
    return redactSensitiveOutput(value, sensitiveValues);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactStructuredOutput(item, sensitiveValues));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        redactSensitiveOutput(key, sensitiveValues),
        redactStructuredOutput(item, sensitiveValues)
      ])
    );
  }
  return value;
}

export function createGameBridge({
  runner,
  env = process.env,
  allowedRpcUrl,
  chainVerifier = createJsonRpcChainVerifier(),
  signerAddressDeriver = localSignerAddressDeriver,
  executionRole,
  seatManifest,
  operationsManifest,
  expectedGameplayWallet,
  expectedPhaseAdvancerWallet,
  forbiddenPrivilegedWallets,
  artifactDirectory,
  executionLimits = DEFAULT_EXECUTION_LIMITS
} = {}) {
  const processRunner = runner ?? createProcessRunner(executionLimits);
  if (typeof processRunner !== "function") {
    throw new TypeError("runner must be a function.");
  }

  return Object.freeze({
    async run(operation, options = {}) {
      assertSupportedOperation(operation);
      const fallback = {
        command: "yarn",
        args: [OPERATION_SPECS[operation].script, "--", "--json"]
      };
      if (!Object.hasOwn(EXECUTION_ROLE_OPERATIONS, executionRole)) {
        return errorResult(
          operation,
          fallback,
          "EXECUTION_ROLE_INVALID",
          "An explicit player, phase-advancer, or read-only execution role is required."
        );
      }
      if (!EXECUTION_ROLE_OPERATIONS[executionRole].has(operation)) {
        return errorResult(
          operation,
          fallback,
          "EXECUTION_ROLE_VIOLATION",
          "The operation is not permitted for this execution role."
        );
      }
      const hasGameplayKey = env?.[GAMEPLAY_PRIVATE_KEY_ENV] !== undefined;
      const hasPhaseKey = env?.[PHASE_ADVANCER_PRIVATE_KEY_ENV] !== undefined;
      if (
        (executionRole === "player" && hasPhaseKey) ||
        (executionRole === "phase-advancer" && hasGameplayKey) ||
        (executionRole === "read-only" && (hasGameplayKey || hasPhaseKey))
      ) {
        return errorResult(
          operation,
          fallback,
          "CROSS_ROLE_KEY_ENVIRONMENT",
          "The execution environment contains a signer key for another role."
        );
      }

      let invocation;
      let processEnv;
      let verificationEnv;
      try {
        invocation = buildInvocation(operation, options, { allowedRpcUrl });
      } catch {
        return errorResult(
          operation,
          fallback,
          "INVALID_ARGUMENT",
          "Operation arguments, frozen network profile, or environment reference are invalid."
        );
      }

      const signer = resolveSigner(operation, env);
      if (signer.required && !signer.configured) {
        return errorResult(
          operation,
          invocation,
          signer.invalid ? "SIGNER_INVALID_FORMAT" : "SIGNER_NOT_CONFIGURED",
          signer.invalid
            ? "The operation-appropriate signer key must be canonical 0x-prefixed 32-byte hex."
            : operation === "advance"
              ? "A phase-advancer environment key is required."
              : "A player gameplay environment key is required."
        );
      }

      if (signer.required) {
        const playerSigner = PLAYER_SIGNER_OPERATIONS.has(operation);
        const manifests = validatePublicManifests({
          seatManifest,
          operationsManifest,
          expectedGameplayWallet,
          expectedPhaseAdvancerWallet,
          forbiddenPrivilegedWallets,
          playerSigner
        });
        if (!manifests.ok) {
          return errorResult(
            operation,
            invocation,
            manifests.code,
            "The public signer manifests failed closed validation."
          );
        }
        if (
          operation !== "register" &&
          String(options.gameId) !== seatManifest.game_id
        ) {
          return errorResult(
            operation,
            invocation,
            "SEAT_MANIFEST_INVALID",
            "The public seat manifest game ID does not match the operation."
          );
        }
        const expectedSignerAddress = playerSigner
          ? expectedGameplayWallet
          : expectedPhaseAdvancerWallet;
        if (
          operation === "register" &&
          options.wallet !== undefined &&
          options.wallet.toLowerCase() !== expectedSignerAddress.toLowerCase()
        ) {
          return errorResult(
            operation,
            invocation,
            "SIGNER_IDENTITY_MISMATCH",
            "The register public wallet does not match the player signer manifest."
          );
        }
        if (typeof signerAddressDeriver !== "function") {
          return errorResult(
            operation,
            invocation,
            "SIGNER_IDENTITY_VERIFIER_NOT_CONFIGURED",
            "A trusted local signer-address derivation function is required."
          );
        }
        let derivedIdentity;
        try {
          derivedIdentity = await signerAddressDeriver(
            Object.freeze({ privateKey: signer.childPrivateKey })
          );
        } catch {
          return errorResult(
            operation,
            invocation,
            "SIGNER_IDENTITY_VERIFICATION_FAILED",
            "The signer public address could not be derived."
          );
        }
        if (
          !derivedIdentity ||
          typeof derivedIdentity.address !== "string" ||
          !ETHEREUM_ADDRESS.test(derivedIdentity.address)
        ) {
          return errorResult(
            operation,
            invocation,
            "SIGNER_IDENTITY_VERIFICATION_FAILED",
            "The signer-address derivation function returned no usable address."
          );
        }
        if (
          derivedIdentity.address.toLowerCase() !==
          expectedSignerAddress.toLowerCase()
        ) {
          return errorResult(
            operation,
            invocation,
            "SIGNER_IDENTITY_MISMATCH",
            "The signer key does not match the expected public wallet."
          );
        }

        const firstChainCheck = await verifySignedChain(
          chainVerifier,
          options.rpcUrl
        );
        if (!firstChainCheck.ok) {
          return errorResult(
            operation,
            invocation,
            firstChainCheck.code,
            firstChainCheck.message
          );
        }
      }
      processEnv = childEnvironment(env, signer);
      verificationEnv = childEnvironment(env);

      const firstArtifactCheck = await validateArtifactBoundary(
        operation,
        options,
        artifactDirectory,
        env?.[GAME_REPOSITORY_ENV]
      );
      if (!firstArtifactCheck.ok) {
        return errorResult(
          operation,
          invocation,
          firstArtifactCheck.code,
          firstArtifactCheck.message
        );
      }

      const checkout = await verifyCheckout(
        env?.[GAME_REPOSITORY_ENV],
        processRunner,
        verificationEnv
      );
      if (!checkout.ok) {
        return errorResult(
          operation,
          invocation,
          checkout.code,
          checkout.message
        );
      }

      try {
        const current = await stat(checkout.cwd);
        if (
          current.dev !== checkout.identity.device ||
          current.ino !== checkout.identity.inode
        ) {
          return errorResult(
            operation,
            invocation,
            "CHECKOUT_CHANGED",
            "The pinned game checkout root changed after verification."
          );
        }
      } catch {
        return errorResult(
          operation,
          invocation,
          "CHECKOUT_CHANGED",
          "The pinned game checkout became unavailable after verification."
        );
      }

      const secondArtifactCheck = await validateArtifactBoundary(
        operation,
        options,
        artifactDirectory,
        checkout.cwd
      );
      if (!secondArtifactCheck.ok) {
        return errorResult(
          operation,
          invocation,
          secondArtifactCheck.code,
          secondArtifactCheck.message
        );
      }

      const finalEnvBoundary = await verifyForbiddenEnvBoundary(checkout.cwd);
      if (!finalEnvBoundary.ok) {
        return errorResult(
          operation,
          invocation,
          finalEnvBoundary.code,
          finalEnvBoundary.message
        );
      }

      if (signer.required) {
        const secondChainCheck = await verifySignedChain(
          chainVerifier,
          options.rpcUrl
        );
        if (!secondChainCheck.ok) {
          return errorResult(
            operation,
            invocation,
            secondChainCheck.code,
            secondChainCheck.message
          );
        }
      }

      let execution;
      try {
        execution = await processRunner({
          command: invocation.command,
          args: [...invocation.args],
          cwd: checkout.cwd,
          env: processEnv
        });
      } catch {
        return errorResult(
          operation,
          invocation,
          "EXECUTION_ERROR",
          "The pinned game command could not be started."
        );
      }

      const stdout =
        typeof execution?.stdout === "string" ? execution.stdout : "";
      const stderr =
        typeof execution?.stderr === "string" ? execution.stderr : "";
      const sensitiveValues = [
        options.rpcUrl,
        ...privateKeyRedactionForms(signer.childPrivateKey)
      ];
      const safeStdout = redactSensitiveOutput(stdout, sensitiveValues);
      const safeStderr = redactSensitiveOutput(stderr, sensitiveValues);
      const parsedOutput = parseOutput(stdout);
      const safeParsed = redactStructuredOutput(
        parsedOutput.parsed,
        sensitiveValues
      );
      const exitCode = Number.isInteger(execution?.exitCode)
        ? execution.exitCode
        : null;
      const signal =
        typeof execution?.signal === "string" ? execution.signal : null;

      if (execution?.bridgeError) {
        return errorResult(
          operation,
          invocation,
          redactSensitiveOutput(
            String(execution.bridgeError.code ?? "EXECUTION_ERROR"),
            sensitiveValues
          ),
          redactSensitiveOutput(
            String(execution.bridgeError.message ?? ""),
            sensitiveValues
          ),
          {
            stdout: safeStdout,
            stderr: safeStderr,
            exitCode,
            signal,
            parsed: safeParsed
          }
        );
      }
      if (exitCode !== 0 || signal !== null) {
        return errorResult(
          operation,
          invocation,
          "COMMAND_FAILED",
          "The pinned game command returned a nonzero result.",
          {
            stdout: safeStdout,
            stderr: safeStderr,
            exitCode,
            signal,
            parsed: safeParsed
          }
        );
      }
      if (!parsedOutput.valid) {
        return errorResult(
          operation,
          invocation,
          "INVALID_JSON",
          "The pinned game command did not return valid JSON.",
          { stdout: safeStdout, stderr: safeStderr, exitCode, signal, parsed: null }
        );
      }

      const safe = publicInvocation(invocation);
      return {
        schema_version: 1,
        operation,
        command: safe.command,
        args: safe.args,
        exit_code: exitCode,
        signal,
        stdout: safeStdout,
        stderr: safeStderr,
        parsed: safeParsed,
        error: null
      };
    }
  });
}
