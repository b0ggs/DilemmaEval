// Local-only backend for the live transfer dashboard.
// Holds no secrets of its own - shells out to the already-authenticated
// `maritime` CLI (same credentials this whole session has been using) and to
// `ethers` for on-chain verification. Never exposes any key/token to the browser.
import http from "node:http";
import { readFile, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROSTER_PATH = join(__dirname, "..", "packages", "harness", "roster.json");
const RPC_URL = "https://sepolia.base.org";
const PORT = 8787;

const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json" };

function loadRoster() {
  const roster = JSON.parse(readFileSync(ROSTER_PATH, "utf8"));
  return roster.seats
    .filter((s) => s.walletAddress)
    .map((s) => ({ name: s.maritimeAgentName, team: s.team, address: s.walletAddress }));
}

function runMaritimeChat(agent, message) {
  return new Promise((resolve, reject) => {
    execFile(
      "maritime",
      ["chat", agent, message],
      { timeout: 90_000, maxBuffer: 4 * 1024 * 1024, shell: true },
      (err, stdout, stderr) => {
        if (err && !stdout) return reject(new Error(stderr || err.message));
        resolve(stdout || stderr);
      },
    );
  });
}

function extractTxHash(text) {
  const match = text.match(/0x[a-fA-F0-9]{64}/);
  return match ? match[0] : null;
}

async function verifyOnChain(txHash, { maxAttempts = 12, delayMs = 3000 } = {}) {
  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const receipt = await provider.getTransactionReceipt(txHash);
    if (receipt) {
      const tx = await provider.getTransaction(txHash);
      const block = await provider.getBlock(receipt.blockNumber);
      return {
        found: true,
        status: receipt.status === 1 ? "success" : "failed",
        from: receipt.from,
        to: receipt.to,
        value: ethers.utils.formatEther(tx.value),
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        timestamp: block.timestamp,
      };
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return { found: false };
}

async function handleTransfer(req, res) {
  let body = "";
  for await (const chunk of req) body += chunk;
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Invalid JSON body" }));
  }

  const { from, to, amountEth } = payload;
  const roster = loadRoster();
  const sender = roster.find((a) => a.name === from);
  const recipient = roster.find((a) => a.name === to);
  const amount = Number(amountEth);

  if (!sender) return sendError(res, 400, `Unknown sender agent: ${from}`);
  if (!recipient) return sendError(res, 400, `Unknown recipient agent: ${to}`);
  if (sender.name === recipient.name) return sendError(res, 400, "Sender and recipient must differ");
  if (!Number.isFinite(amount) || amount <= 0 || amount > 0.01) {
    return sendError(res, 400, "Amount must be > 0 and <= 0.01 ETH (demo safety cap)");
  }

  const instruction =
    `Send exactly ${amount} ETH from your wallet to ${recipient.address} on Base Sepolia ` +
    `(chain ID 84532, RPC https://sepolia.base.org). Your private key is available as ` +
    `GAMEPLAY_WALLET_PRIVATE_KEY. Use Node.js with ethers or viem (install if needed) to sign ` +
    `and broadcast the transaction yourself. Report back only the resulting transaction hash.`;

  let agentReply;
  try {
    agentReply = await runMaritimeChat(sender.name, instruction);
  } catch (err) {
    return sendError(res, 502, `maritime chat failed: ${err.message}`);
  }

  const txHash = extractTxHash(agentReply);
  if (!txHash) {
    return sendError(res, 502, "Agent did not report a transaction hash", { agentReply });
  }

  const onchain = await verifyOnChain(txHash);

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      ok: true,
      from: sender,
      to: recipient,
      amountEth: amount,
      txHash,
      agentReply,
      onchain,
      explorerUrl: `https://sepolia.basescan.org/tx/${txHash}`,
    }),
  );
}

function sendError(res, code, message, extra = {}) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: message, ...extra }));
}

function serveStatic(req, res) {
  const filePath = req.url === "/" ? join(__dirname, "live-dashboard.html") : join(__dirname, req.url);
  readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": MIME[extname(filePath)] || "text/plain" });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/api/agents") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(loadRoster()));
  }
  if (req.method === "POST" && req.url === "/api/transfer") {
    return handleTransfer(req, res).catch((err) => sendError(res, 500, err.message));
  }
  return serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Live transfer dashboard: http://localhost:${PORT}`);
});
