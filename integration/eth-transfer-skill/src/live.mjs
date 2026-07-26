import {
  GAMEPLAY_PRIVATE_KEY_ENV,
  TransferError,
  createEthTransferSkill
} from "./index.mjs";

const PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/;

export async function createLiveEthTransferSkill({
  recipientDirectory,
  rpcUrl,
  timeoutMs = 30_000,
  expectedSenderAddress,
  env = process.env,
  ethersModule
}) {
  if (typeof rpcUrl !== "string" || !isAllowedRpcUrl(rpcUrl)) {
    throw new TransferError("RPC_URL_INVALID", "A valid HTTPS Base Sepolia RPC URL is required.");
  }
  const key = env?.[GAMEPLAY_PRIVATE_KEY_ENV];
  if (typeof key !== "string" || !PRIVATE_KEY.test(key)) {
    throw new TransferError(
      "GAMEPLAY_PRIVATE_KEY_MISSING",
      `${GAMEPLAY_PRIVATE_KEY_ENV} is missing or malformed.`
    );
  }

  let ethers;
  try {
    ethers = ethersModule ?? (await import("ethers"));
  } catch {
    throw new TransferError("ETHERS_UNAVAILABLE", "The pinned ethers runtime dependency is unavailable.");
  }
  if (
    typeof ethers.JsonRpcProvider !== "function" ||
    typeof ethers.Wallet !== "function"
  ) {
    throw new TransferError("ETHERS_INVALID", "The ethers runtime module is invalid.");
  }

  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    if (typeof provider.send !== "function") {
      throw new Error("provider does not support raw JSON-RPC");
    }
    const checkedProvider = {
      async getNetwork() {
        return { chainId: await provider.send("eth_chainId", []) };
      },
      getBalance(address) {
        return provider.getBalance(address);
      },
      getFeeData() {
        return provider.getFeeData();
      }
    };
    return createEthTransferSkill({
      recipientDirectory,
      provider: checkedProvider,
      timeoutMs,
      expectedSenderAddress,
      signerFactory: () => new ethers.Wallet(key, provider)
    });
  } catch {
    throw new TransferError(
      "LIVE_RUNTIME_INITIALIZATION_FAILED",
      "The live Base Sepolia runtime could not be initialized."
    );
  }
}

function isAllowedRpcUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      url.hostname.length > 0
    );
  } catch {
    return false;
  }
}
