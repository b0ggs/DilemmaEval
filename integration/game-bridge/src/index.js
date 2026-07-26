import { access, readFile, realpath, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join as joinPath } from "node:path";

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
  identityRegistry: runtimeSource.network.identity_registry_address
});

export const DEFAULT_EXECUTION_LIMITS = Object.freeze({
  timeoutMs: 30_000,
  maxOutputBytes: 1_048_576
});

const BASE_ENVIRONMENT_NAMES = Object.freeze(["PATH", "HOME", "TMPDIR"]);
const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const SIGNER_OPTIONS = Object.freeze({
  wallet: "--wallet",
  walletKeystore: "--wallet-keystore",
  walletKeystorePasswordEnv: "--wallet-keystore-password-env",
  walletKeystorePasswordFile: "--wallet-keystore-password-file"
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
  join: {
    script: "game:join",
    options: {
      ...GAME_OPTIONS,
      causeId: "--cause-id",
      valueWei: "--value-wei",
      ...SIGNER_OPTIONS
    },
    required: ["rpcUrl", "game", "gameId", "causeId"]
  },
  prepare_commit: {
    script: "game:prepare-commit",
    options: {
      ...GAME_OPTIONS,
      choice: "--choice",
      out: "--out",
      ...SIGNER_OPTIONS
    },
    required: ["rpcUrl", "game", "gameId", "choice"]
  },
  commit: {
    script: "game:commit",
    options: {
      ...GAME_OPTIONS,
      input: "--input",
      ...SIGNER_OPTIONS
    },
    required: ["rpcUrl", "game", "gameId", "input"]
  },
  reveal: {
    script: "game:reveal",
    options: {
      ...GAME_OPTIONS,
      input: "--input",
      ...SIGNER_OPTIONS
    },
    required: ["rpcUrl", "game", "gameId", "input"]
  },
  advance: {
    script: "game:advance",
    options: { ...GAME_OPTIONS, ...SIGNER_OPTIONS },
    required: ["rpcUrl", "game", "gameId"]
  },
  claim: {
    script: "game:claim",
    options: { ...GAME_OPTIONS, ...SIGNER_OPTIONS },
    required: ["rpcUrl", "game", "gameId"]
  }
});

export const SUPPORTED_OPERATIONS = Object.freeze(Object.keys(OPERATION_SPECS));

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
  if (/^0x[0-9a-fA-F]{64}$/.test(rendered)) {
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
  if (operation === "wallet_auth_status") {
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

function publicInvocation(invocation) {
  const args = [...invocation.args];
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

function childEnvironment(source, options) {
  const selected = {};
  for (const name of BASE_ENVIRONMENT_NAMES) {
    if (typeof source?.[name] === "string") selected[name] = source[name];
  }
  const passwordName = options.walletKeystorePasswordEnv;
  if (passwordName !== undefined) {
    if (
      typeof passwordName !== "string" ||
      !ENVIRONMENT_NAME.test(passwordName)
    ) {
      throw new TypeError("walletKeystorePasswordEnv is not a valid environment name.");
    }
    if (typeof source?.[passwordName] !== "string") {
      throw new TypeError(
        "The referenced wallet keystore password environment value is unavailable."
      );
    }
    selected[passwordName] = source[passwordName];
  }
  return selected;
}

function redactSensitiveOutput(value, sensitiveValues) {
  let redacted = value;
  for (const secret of sensitiveValues) {
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
        key,
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
  executionLimits = DEFAULT_EXECUTION_LIMITS
} = {}) {
  const processRunner = runner ?? createProcessRunner(executionLimits);
  if (typeof processRunner !== "function") {
    throw new TypeError("runner must be a function.");
  }

  return Object.freeze({
    async run(operation, options = {}) {
      assertSupportedOperation(operation);
      let invocation;
      let processEnv;
      let verificationEnv;
      try {
        invocation = buildInvocation(operation, options, { allowedRpcUrl });
        processEnv = childEnvironment(env, options);
        verificationEnv = childEnvironment(env, {});
      } catch {
        const fallback = {
          command: "yarn",
          args: [OPERATION_SPECS[operation].script, "--", "--json"]
        };
        return errorResult(
          operation,
          fallback,
          "INVALID_ARGUMENT",
          "Operation arguments, frozen network profile, or environment reference are invalid."
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
      const passwordName = options.walletKeystorePasswordEnv;
      const sensitiveValues =
        typeof passwordName === "string" &&
        typeof processEnv[passwordName] === "string"
          ? [options.rpcUrl, processEnv[passwordName]]
          : [options.rpcUrl];
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
          execution.bridgeError.code,
          execution.bridgeError.message,
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
