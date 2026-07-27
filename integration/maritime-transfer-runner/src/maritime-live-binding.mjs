import { readFile } from "node:fs/promises";

export const VERIFIED_MARITIME_SDK = Object.freeze({
  package: "maritime-sdk",
  version: "0.6.0",
  maxRetries: 0
});

export const TEMPORARY_BASE_SEPOLIA_RPC_URL = "https://sepolia.base.org";

const API_BASE = "https://api.maritime.sh/api/v1";
const UUID =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
const RAW_PRIVATE_KEY = /(?:0[xX])?[0-9a-fA-F]{64}/;
const TRANSACTION_HASH = /0x[0-9a-fA-F]{64}/;
const READY = new Set(["active", "sleeping"]);

const INSTALL_SCRIPT = `#!/bin/sh
set -eu
if ! command -v node >/dev/null 2>&1; then
  if ! command -v apt-get >/dev/null 2>&1; then
    echo "Node.js is unavailable and apt-get is not present" >&2
    exit 1
  fi
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs npm
fi
cd /opt/dilemma-transfer
npm install --omit=dev --ignore-scripts --no-audit --no-fund
chmod 700 src/cli.mjs
`;

export function createCurrentMaritimeLiveBinding({
  maritime,
  sdkPolicy,
  fetchImpl = globalThis.fetch,
  readFileImpl = readFile,
  rpcUrl = TEMPORARY_BASE_SEPOLIA_RPC_URL,
  pollIntervalMs = 2_000,
  deploymentTimeoutMs = 180_000
} = {}) {
  assertMaritime(maritime);
  assertSdkPolicy(sdkPolicy);
  if (typeof fetchImpl !== "function" || typeof readFileImpl !== "function") {
    throw new TypeError("fetchImpl and readFileImpl must be functions");
  }
  if (rpcUrl !== TEMPORARY_BASE_SEPOLIA_RPC_URL) {
    throw new TypeError("the time-critical binding accepts only the reviewed public RPC");
  }

  return Object.freeze({
    async execute({ public_plan: plan, transfer, secret_access: secrets } = {}) {
      const rows = validatePlan(plan);
      validateTransfer(transfer, rows);
      if (!secrets || typeof secrets !== "object") {
        throw new TypeError("one-run secret access is required");
      }

      const apiKey = secrets.takeMaritimeApiKey();
      const walletKeys = new Map(
        rows.map((row) => [row.seat_id, secrets.takeWalletPrivateKey(row.seat_id)])
      );
      const secretValues = [apiKey, ...walletKeys.values()];
      const agents = new Map();

      try {
        for (const row of rows) {
          const agent = await maritime.agents.provision({
            externalId: row.maritime_agent,
            name: row.maritime_agent,
            template: row.harness,
            instructions: plan.agent_configuration.find(
              (entry) => entry.seat_id === row.seat_id
            ).instructions,
            env: [
              {
                key: "GAMEPLAY_WALLET_PRIVATE_KEY",
                value: walletKeys.get(row.seat_id),
                secret: true
              },
              {
                key: "GAMEPLAY_WALLET_ALIAS",
                value: row.alias,
                secret: false
              },
              {
                key: "OPENCLAW_1_WALLET_ADDRESS",
                value: rows.find((entry) => entry.alias === "openclaw-1")
                  .wallet_address,
                secret: false
              },
              {
                key: "HERMES_1_WALLET_ADDRESS",
                value: rows.find((entry) => entry.alias === "hermes-1")
                  .wallet_address,
                secret: false
              },
              {
                key: "ALCHEMY_BASE_SEPOLIA_RPC_URL",
                value: rpcUrl,
                secret: false
              }
            ]
          });
          validateAgent(agent, row);
          agents.set(row.alias, agent);
          walletKeys.delete(row.seat_id);

          await waitUntilReady({
            maritime,
            agentId: agent.id,
            pollIntervalMs,
            deploymentTimeoutMs
          });
          await uploadSkillFiles({
            agentId: agent.id,
            apiKey,
            fetchImpl,
            readFileImpl
          });
          await apiRequest({
            fetchImpl,
            apiKey,
            path: `/agents/${agent.id}/deploy`,
            method: "POST",
            accepted: [200, 202]
          });
          await waitUntilReady({
            maritime,
            agentId: agent.id,
            pollIntervalMs,
            deploymentTimeoutMs
          });
          await confirmWalletEnvironment(maritime, agent.id);
        }

        const sender = agents.get(transfer.sender_alias);
        const chat = await maritime.agents.chat(sender.id, transfer.command);
        if (
          !chat ||
          typeof chat !== "object" ||
          chat.error ||
          typeof chat.response !== "string" ||
          chat.response.length === 0 ||
          chat.response.length > 8_192
        ) {
          throw new Error("Maritime chat did not return a bounded successful response");
        }
        for (const secret of secretValues) {
          if (typeof secret === "string" && secret.length > 0 && chat.response.includes(secret)) {
            throw new Error("agent response reflected secret material");
          }
        }
        return parseConfirmedAgentResponse({
          response: chat.response,
          transfer,
          rows
        });
      } finally {
        walletKeys.clear();
      }
    }
  });
}

export class MaritimeLiveBindingError extends Error {
  constructor(code, transactionHash = null) {
    super(code);
    this.name = "MaritimeLiveBindingError";
    this.code = code;
    this.transactionHash = transactionHash;
  }
}

function parseConfirmedAgentResponse({ response, transfer, rows }) {
  let payload;
  try {
    payload = JSON.parse(response.trim());
  } catch {
    throw new MaritimeLiveBindingError("AGENT_RESPONSE_NOT_EXACT_JSON");
  }
  const result = payload?.result;
  const sender = rows.find((row) => row.alias === transfer.sender_alias);
  const recipient = rows.find((row) => row.alias === transfer.recipient_alias);
  if (
    !hasExactKeys(payload, ["ok", "result"]) ||
    payload?.ok !== true ||
    !result ||
    !hasExactKeys(result, [
      "amount_eth",
      "amount_wei",
      "block_number",
      "chain_id",
      "recipient_address",
      "recipient_alias",
      "sender",
      "status",
      "transaction_hash"
    ]) ||
    result.status !== "confirmed" ||
    result.chain_id !== 84532 ||
    result.sender !== sender.wallet_address ||
    result.recipient_alias !== transfer.recipient_alias ||
    result.recipient_address !== recipient.wallet_address ||
    result.amount_eth !== transfer.amount_eth ||
    !/^(?:0|[1-9][0-9]*)$/.test(result.amount_wei) ||
    !TRANSACTION_HASH.test(result.transaction_hash) ||
    !Number.isSafeInteger(result.block_number) ||
    result.block_number < 0
  ) {
    const publicHash =
      payload?.error?.public_state?.transaction_hash;
    const approvedErrorShape =
      hasExactKeys(payload, ["error", "ok"]) &&
      payload?.ok === false &&
      hasExactKeys(payload.error, ["code", "public_state", "retryable"]) &&
      payload.error.retryable === false &&
      payload.error.public_state &&
      typeof payload.error.public_state === "object" &&
      hasExactKeys(
        payload.error.public_state,
        publicHash ? ["transaction_hash"] : []
      );
    throw new MaritimeLiveBindingError(
      approvedErrorShape &&
      typeof payload?.error?.code === "string" &&
      /^[A-Z][A-Z0-9_]{0,63}$/.test(payload.error.code)
        ? payload.error.code
        : "AGENT_TRANSFER_NOT_CONFIRMED",
      typeof publicHash === "string" && TRANSACTION_HASH.test(publicHash)
        ? publicHash.toLowerCase()
        : null
    );
  }
  return Object.freeze({
    status: "confirmed",
    chain_id: 84532,
    sender_alias: transfer.sender_alias,
    sender_address: result.sender,
    recipient_alias: transfer.recipient_alias,
    recipient_address: result.recipient_address,
    amount_eth: result.amount_eth,
    amount_wei: result.amount_wei,
    transaction_hash: result.transaction_hash.toLowerCase(),
    block_number: result.block_number
  });
}

function hasExactKeys(value, expected) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...expected].sort().join("\0")
  );
}

async function uploadSkillFiles({ agentId, apiKey, fetchImpl, readFileImpl }) {
  const source = new URL("../../eth-transfer-skill/", import.meta.url);
  const descriptions = [
    ["package.json", "package.json"],
    ["src/index.mjs", "src/index.mjs"],
    ["src/live.mjs", "src/live.mjs"],
    ["src/cli-lib.mjs", "src/cli-lib.mjs"],
    ["src/cli.mjs", "src/cli.mjs"]
  ];
  const files = await Promise.all(
    descriptions.map(async ([sourcePath, targetPath]) => ({
      path: targetPath,
      content: await readFileImpl(new URL(sourcePath, source), "utf8"),
      executable: targetPath === "src/cli.mjs",
      run_on_deploy: false,
      target_dir: "/opt/dilemma-transfer"
    }))
  );
  files.push({
    path: "install-dilemma-transfer.sh",
    content: INSTALL_SCRIPT,
    executable: true,
    run_on_deploy: true,
    target_dir: "/maritime/scripts"
  });
  await apiRequest({
    fetchImpl,
    apiKey,
    path: `/agents/${agentId}/files`,
    method: "POST",
    body: { files },
    accepted: [200, 201]
  });
}

async function apiRequest({
  fetchImpl,
  apiKey,
  path,
  method,
  body,
  accepted
}) {
  const response = await fetchImpl(`${API_BASE}${path}`, {
    method,
    headers: {
      "X-API-Key": apiKey,
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  if (!accepted.includes(response.status)) {
    throw new Error(`Maritime provisioning action failed with HTTP ${response.status}`);
  }
}

async function waitUntilReady({
  maritime,
  agentId,
  pollIntervalMs,
  deploymentTimeoutMs
}) {
  const deadline = Date.now() + deploymentTimeoutMs;
  while (Date.now() < deadline) {
    const agent = await maritime.agents.get(agentId);
    if (READY.has(agent.status)) return agent;
    if (agent.status === "error" || agent.status === "stopped") {
      throw new Error(`Maritime agent entered terminal status ${agent.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error("Maritime deployment readiness timed out");
}

async function confirmWalletEnvironment(maritime, agentId) {
  const environment = await maritime.agents.listEnv(agentId);
  const entry = environment.find(
    (candidate) => candidate.key === "GAMEPLAY_WALLET_PRIVATE_KEY"
  );
  if (
    !entry ||
    entry.isSecret !== true ||
    typeof entry.value !== "string" ||
    RAW_PRIVATE_KEY.test(entry.value)
  ) {
    throw new Error("Maritime did not confirm a masked wallet secret");
  }
}

function validatePlan(plan) {
  if (
    !plan ||
    plan.network?.chain_id !== 84532 ||
    !Array.isArray(plan.alias_directory) ||
    plan.alias_directory.length !== 2 ||
    !Array.isArray(plan.agent_configuration) ||
    plan.agent_configuration.length !== 2
  ) {
    throw new TypeError("public transfer plan is invalid");
  }
  const rows = plan.alias_directory;
  for (const [alias, harness, externalId] of [
    ["openclaw-1", "openclaw", "dilemmaeval-pilot-openclaw"],
    ["hermes-1", "hermes", "dilemmaeval-pilot-hermes"]
  ]) {
    const row = rows.find((candidate) => candidate.alias === alias);
    if (
      !row ||
      row.harness !== harness ||
      row.maritime_agent !== externalId ||
      !/^0x[0-9a-fA-F]{40}$/.test(row.wallet_address)
    ) {
      throw new TypeError("public transfer plan identity is invalid");
    }
  }
  return rows;
}

function validateTransfer(transfer, rows) {
  if (
    !transfer ||
    !rows.some((row) => row.alias === transfer.sender_alias) ||
    !rows.some((row) => row.alias === transfer.recipient_alias) ||
    transfer.sender_alias === transfer.recipient_alias ||
    typeof transfer.command !== "string"
  ) {
    throw new TypeError("validated transfer request is invalid");
  }
}

function validateAgent(agent, row) {
  if (
    !agent ||
    !UUID.test(agent.id) ||
    agent.externalId !== row.maritime_agent ||
    agent.name !== row.maritime_agent ||
    agent.framework !== row.harness
  ) {
    throw new Error("Maritime returned a mismatched agent identity");
  }
}

function assertMaritime(maritime) {
  if (!maritime || !maritime.agents) throw new TypeError("maritime.agents is required");
  for (const method of ["provision", "get", "listEnv", "chat"]) {
    if (typeof maritime.agents[method] !== "function") {
      throw new TypeError(`maritime.agents.${method} must be a function`);
    }
  }
}

function assertSdkPolicy(policy) {
  if (
    !policy ||
    policy.package !== VERIFIED_MARITIME_SDK.package ||
    policy.version !== VERIFIED_MARITIME_SDK.version ||
    policy.maxRetries !== 0
  ) {
    throw new TypeError("maritime-sdk@0.6.0 with maxRetries 0 is required");
  }
}
