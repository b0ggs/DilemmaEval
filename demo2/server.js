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

// --- SSE transfer stream ---
// Emits real stage transitions from the request's own lifecycle as they
// genuinely happen (not simulated agent-internal reasoning - see plan
// addendum "live status feed for demo2": neither `maritime logs -f` nor the
// chat API expose real per-request agent activity, so this reports on our
// own side of the pipeline instead, which is real telemetry, just not
// agent-internal).
async function handleTransferStream(req, res, query) {
  const { from, to, amountEth } = query;
  const roster = loadRoster();
  const sender = roster.find((a) => a.name === from);
  const recipient = roster.find((a) => a.name === to);
  const amount = Number(amountEth);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const emit = (event, data) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify({ ...data, timestamp: Date.now() })}\n\n`);
  };

  let clientGone = false;
  req.on("close", () => {
    clientGone = true;
  });

  if (!sender) return emit("error", { ok: false, error: `Unknown sender agent: ${from}` }), res.end();
  if (!recipient) return emit("error", { ok: false, error: `Unknown recipient agent: ${to}` }), res.end();
  if (sender.name === recipient.name) {
    emit("error", { ok: false, error: "Sender and recipient must differ" });
    return res.end();
  }
  if (!Number.isFinite(amount) || amount <= 0 || amount > 0.01) {
    emit("error", { ok: false, error: "Amount must be > 0 and <= 0.01 ETH (demo safety cap)" });
    return res.end();
  }

  const instruction =
    `Send exactly ${amount} ETH from your wallet to ${recipient.address} on Base Sepolia ` +
    `(chain ID 84532, RPC https://sepolia.base.org). Your private key is available as ` +
    `GAMEPLAY_WALLET_PRIVATE_KEY. Use Node.js with ethers or viem (install if needed) to sign ` +
    `and broadcast the transaction yourself. Report back only the resulting transaction hash.`;

  emit("stage", { stage: "sending", message: `Instruction sent to ${sender.name}` });

  let agentReply;
  try {
    const waitingTimer = setTimeout(() => {
      emit("stage", { stage: "waiting", message: `Still waiting on ${sender.name}…` });
    }, 5000);
    emit("stage", { stage: "waiting", message: `Waiting for ${sender.name}'s response…` });
    agentReply = await runMaritimeChat(sender.name, instruction);
    clearTimeout(waitingTimer);
  } catch (err) {
    emit("error", { ok: false, error: `maritime chat failed: ${err.message}` });
    return res.end();
  }

  if (clientGone) return res.end();

  emit("stage", { stage: "received", message: "Response received — extracting transaction hash…" });
  emit("agentReply", { agentReply });

  const txHash = extractTxHash(agentReply);
  if (!txHash) {
    emit("error", { ok: false, error: "Agent did not report a transaction hash", agentReply });
    return res.end();
  }

  emit("stage", { stage: "hash-found", message: `Transaction hash found: ${txHash}` });

  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const maxAttempts = 12;
  let onchain = { found: false };
  for (let attempt = 1; attempt <= maxAttempts && !clientGone; attempt++) {
    emit("stage", {
      stage: "verifying",
      message: `Verifying on Base Sepolia (attempt ${attempt} of ${maxAttempts})…`,
    });
    const receipt = await provider.getTransactionReceipt(txHash);
    if (receipt) {
      const tx = await provider.getTransaction(txHash);
      const block = await provider.getBlock(receipt.blockNumber);
      onchain = {
        found: true,
        status: receipt.status === 1 ? "success" : "failed",
        from: receipt.from,
        to: receipt.to,
        value: ethers.utils.formatEther(tx.value),
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        timestamp: block.timestamp,
      };
      break;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }

  if (clientGone) return res.end();

  if (onchain.found) {
    emit("stage", {
      stage: "confirmed",
      message: `Confirmed in block ${onchain.blockNumber.toLocaleString()}`,
    });
  } else {
    emit("stage", { stage: "unconfirmed", message: "Not yet confirmed after all attempts" });
  }

  emit("result", {
    ok: true,
    from: sender,
    to: recipient,
    amountEth: amount,
    txHash,
    agentReply,
    onchain,
    explorerUrl: `https://sepolia.basescan.org/tx/${txHash}`,
  });
  res.end();
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === "GET" && url.pathname === "/api/agents") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(loadRoster()));
  }
  if (req.method === "GET" && url.pathname === "/api/transfer/stream") {
    const query = Object.fromEntries(url.searchParams);
    return handleTransferStream(req, res, query).catch((err) => {
      if (!res.headersSent) return sendError(res, 500, err.message);
      res.end();
    });
  }
  return serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Live transfer dashboard: http://localhost:${PORT}`);
});
