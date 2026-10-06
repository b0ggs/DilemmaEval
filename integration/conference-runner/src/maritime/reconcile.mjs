import { createHash } from 'node:crypto';
import { Interface, getAddress } from 'ethers';
import { GAME_ABI } from '../chain/abi.mjs';
import { makeProvider } from '../chain/reader.mjs';
import { validateGameplayResponse } from './protocol.mjs';
import { FROZEN_NETWORK } from '../../../game-bridge/src/index.js';

const HASH = /^0x[0-9a-fA-F]{64}$/;
const RECOVERY_ABI = new Interface([...GAME_ABI,
  'event Committed(uint256 indexed gameId,uint32 indexed round,address indexed wallet,bytes32 commitment)',
  'event Revealed(uint256 indexed gameId,uint32 indexed round,address indexed wallet,uint8 choice)']);

function literal(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e');
}

/** Build a shell-free, read-only command which discloses only a validated public receipt response. */
export function buildCompletedJournalReadCommand({ binding, request, config }) {
  const settingsPath = binding?.gameplay_command?.[2];
  const base = typeof settingsPath === 'string' ? settingsPath.slice(0, settingsPath.lastIndexOf('/')) : '';
  if (!settingsPath?.startsWith('/') || !settingsPath.endsWith('/seat.json') || !base || config?.chain_id !== 84532 ||
      config.game_address?.toLowerCase() !== FROZEN_NETWORK.game.toLowerCase()) {
    throw new TypeError('MARITIME_RECOVERY_INPUT_INVALID');
  }
  const expected = {
    settingsPath, stateDirectory: `${base}/private`, chainId: 84532,
    gameAddress: config.game_address.toLowerCase(), seatId: request.seat_id,
    walletAddress: config.roster.find(row => row.seat_id === request.seat_id)?.wallet_address?.toLowerCase(),
    requestId: request.request_id, gameId: request.game_id, round: request.round,
    phase: request.phase, operation: request.requested_action,
    journalName: `${createHash('sha256').update(`${config.chain_id}:${config.game_address.toLowerCase()}:${request.game_id}:${request.round}:${request.phase}`).digest('hex')}.json`
  };
  if (!expected.walletAddress || !['join', 'commit', 'reveal'].includes(expected.operation)) {
    throw new TypeError('MARITIME_RECOVERY_INPUT_INVALID');
  }
  const source = `
import { constants } from 'node:fs';
import { lstat, open, readFile, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
const x=${literal(expected)};
const fail=()=>{process.exitCode=1;};
try {
  if (resolve(x.settingsPath)!==x.settingsPath || dirname(x.settingsPath)===x.settingsPath) throw 0;
  const sm=await lstat(x.settingsPath);
  if (!sm.isFile() || sm.isSymbolicLink() || await realpath(x.settingsPath)!==x.settingsPath) throw 0;
  const sf=await open(x.settingsPath,constants.O_RDONLY|constants.O_NOFOLLOW);
  let settingsText; try { if ((await sf.stat()).size>65536) throw 0; settingsText=await sf.readFile('utf8'); } finally { await sf.close(); }
  const s=JSON.parse(settingsText);
  const seat=Array.isArray(s.roster)&&s.roster.find(v=>v?.seat_id===x.seatId);
  if (s?.schema_version!==1 || s.chain_id!==x.chainId || String(s.game_address).toLowerCase()!==x.gameAddress ||
      s.seat_id!==x.seatId || s.state_directory!==x.stateDirectory || resolve(s.state_directory)!==x.stateDirectory ||
      String(seat?.wallet_address).toLowerCase()!==x.walletAddress) throw 0;
  const dm=await lstat(x.stateDirectory);
  if (!dm.isDirectory() || dm.isSymbolicLink() || await realpath(x.stateDirectory)!==x.stateDirectory) throw 0;
  const journalPath=join(x.stateDirectory,'requests',x.journalName);
  const jm=await lstat(journalPath);
  if (!jm.isFile() || jm.isSymbolicLink() || await realpath(journalPath)!==journalPath || jm.size>16384) throw 0;
  const jf=await open(journalPath,constants.O_RDONLY|constants.O_NOFOLLOW);
  let journalText; try { journalText=await jf.readFile('utf8'); } finally { await jf.close(); }
  const j=JSON.parse(journalText),r=j?.response;
  const keys=['schema_version','request_id','game_id','round','phase','seat_id','status','transaction_hash'];
  if (j?.schema_version!==1 || j.stage!=='done' || j.operation!==x.operation || j.request_id!==x.requestId ||
      !r || Object.keys(r).sort().join('\\0')!==keys.sort().join('\\0') || r.schema_version!==1 ||
      r.request_id!==x.requestId || r.game_id!==x.gameId || r.round!==x.round || r.phase!==x.phase ||
      r.seat_id!==x.seatId || r.status!=='submitted' || !/^0x[0-9a-fA-F]{64}$/.test(r.transaction_hash)) throw 0;
  process.stdout.write(JSON.stringify(Object.fromEntries(keys.map(k=>[k,r[k]]))));
} catch { fail(); }
`;
  return ['node', '--input-type=module', '-e', source];
}

function withinDeadline(deadlineAtMs) {
  return deadlineAtMs === undefined || (Number.isSafeInteger(deadlineAtMs) && Date.now() < deadlineAtMs);
}

async function deadlineRead(promise, deadlineAtMs) {
  if (deadlineAtMs === undefined) return promise;
  const remaining = deadlineAtMs - Date.now();
  if (remaining <= 0) throw new Error('RECOVERY_DEADLINE');
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('RECOVERY_DEADLINE')), remaining);
    })]);
  } finally { clearTimeout(timer); }
}

/** Dialogue exemptions must identify transactions actually confirmed on Base Sepolia. */
export async function verifyPublicTransactionReferences({ config, hashes, deadlineAtMs, provider }) {
  const ownedProvider = !provider;
  provider ??= makeProvider(config.rpc_url);
  try {
    if (config.chain_id !== 84532 || !Array.isArray(hashes) || !hashes.length || hashes.some(hash => !HASH.test(hash)) ||
        BigInt(await deadlineRead(provider.send('eth_chainId', []), deadlineAtMs)) !== 84532n) return false;
    const tip = await deadlineRead(provider.getBlockNumber(), deadlineAtMs);
    for (const hash of new Set(hashes)) {
      const receipt = await deadlineRead(provider.getTransactionReceipt(hash), deadlineAtMs);
      if (!receipt || receipt.hash?.toLowerCase() !== hash.toLowerCase() ||
          receipt.blockNumber > tip - (config.confirmations ?? 2) + 1 || !withinDeadline(deadlineAtMs)) return false;
      const block = await deadlineRead(provider.getBlock(receipt.blockNumber), deadlineAtMs);
      if (!block?.hash || block.hash.toLowerCase() !== receipt.blockHash?.toLowerCase()) return false;
    }
    return withinDeadline(deadlineAtMs);
  } catch { return false; }
  finally { if (ownedProvider) { try { provider.destroy(); } catch {} } }
}

/** Verify one recovered transaction against a confirmed, canonical receipt and its exact action event. */
export async function verifyCompletedReceipt({ config, seat, request, response, deadlineAtMs,
  provider }) {
  const ownedProvider = !provider;
  provider ??= makeProvider(config.rpc_url);
  try {
    if (!withinDeadline(deadlineAtMs) || config?.chain_id !== 84532 ||
        config.game_address?.toLowerCase() !== FROZEN_NETWORK.game.toLowerCase() ||
        !['join', 'commit', 'reveal'].includes(request?.requested_action)) return false;
    validateGameplayResponse(response, request);
    if (response.status !== 'submitted' || !HASH.test(response.transaction_hash) ||
        getAddress(seat.wallet_address) !== getAddress(config.roster.find(row => row.seat_id === seat.seat_id)?.wallet_address)) return false;
    if (BigInt(await deadlineRead(provider.send('eth_chainId', []), deadlineAtMs)) !== 84532n || !withinDeadline(deadlineAtMs)) return false;
    const receipt = await deadlineRead(provider.getTransactionReceipt(response.transaction_hash), deadlineAtMs);
    if (!receipt || Number(receipt.status) !== 1 || receipt.hash?.toLowerCase() !== response.transaction_hash.toLowerCase() ||
        receipt.from?.toLowerCase() !== seat.wallet_address.toLowerCase() ||
        receipt.to?.toLowerCase() !== config.game_address.toLowerCase() || !withinDeadline(deadlineAtMs)) return false;
    const confirmations = config.confirmations ?? 2;
    if (!Number.isInteger(confirmations) || confirmations < 1 || confirmations > 100) return false;
    const tip = await deadlineRead(provider.getBlockNumber(), deadlineAtMs);
    if (!Number.isSafeInteger(tip) || receipt.blockNumber > tip - confirmations + 1 || !withinDeadline(deadlineAtMs)) return false;
    const block = await deadlineRead(provider.getBlock(receipt.blockNumber), deadlineAtMs);
    if (!block?.hash || block.hash.toLowerCase() !== receipt.blockHash?.toLowerCase() || !withinDeadline(deadlineAtMs)) return false;
    const eventName = { join: 'PlayerJoined', commit: 'Committed', reveal: 'Revealed' }[request.requested_action];
    const matches = (receipt.logs ?? []).filter(log => log.address?.toLowerCase() === config.game_address.toLowerCase()).map(log => {
      try { return RECOVERY_ABI.parseLog(log); } catch { return null; }
    }).filter(event => event?.name === eventName && String(event.args.gameId) === request.game_id &&
      event.args.wallet?.toLowerCase() === seat.wallet_address.toLowerCase() &&
      (request.requested_action === 'join' || Number(event.args.round) === request.round));
    if (matches.length !== 1) return false;
    const canonical = await deadlineRead(provider.getBlock(receipt.blockNumber), deadlineAtMs);
    return withinDeadline(deadlineAtMs) && canonical?.hash?.toLowerCase() === block.hash.toLowerCase();
  } catch { return false; }
  finally { if (ownedProvider) { try { provider.destroy(); } catch {} } }
}
