import { createHash } from 'node:crypto';
import { Interface, zeroPadValue, toBeHex } from 'ethers';
import { GAME_ABI } from './chain/abi.mjs';
import { FROZEN_NETWORK } from '../../game-bridge/src/index.js';

const ABI = new Interface([...GAME_ABI,
  'event Committed(uint256 indexed gameId,uint32 indexed round,address indexed wallet,bytes32 commitment)',
  'event Revealed(uint256 indexed gameId,uint32 indexed round,address indexed wallet,uint8 choice)']);
const EVENTS = ['GameCreated', 'PlayerJoined', 'Committed', 'Revealed', 'EffectiveChoiceMaterialized',
  'RoundResolved', 'GameEnded', 'GameCancelled'];
const TX = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const uint = /^(0|[1-9][0-9]*)$/;
const digest = text => createHash('sha256').update(text).digest('hex');
class AuditFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}
function requireProof(condition, code) { if (!condition) throw new AuditFailure(code); }
const before = (a, b) => a.blockNumber < b.blockNumber || a.blockNumber === b.blockNumber && a.index < b.index;

/** Read-only acceptance audit; provider failures and private text never enter its result. */
export async function auditControlledProof({ config, gameId, provider, report, outbox }) {
  const audit = { schema_version: 1, proof_complete: false, chain_verified: false, telegram_verified: false,
    game_id: typeof gameId === 'string' && /^[1-9][0-9]*$/.test(gameId) ? gameId : null,
    confirmed_block_number: null, joined_count: 0, committed_seat_count: 0, revealed_seat_count: 0,
    round_count: 0, defaulted_count: 0, discussion_message_count: 0,
    creation_transaction_hash: null, result_transaction_hash: null, result_message_ids: [], seats: [], issues: [] };
  try {
    const confirmations = config?.confirmations ?? 2;
    requireProof(audit.game_id && config?.chain_id === 84532 &&
      config.game_address?.toLowerCase() === FROZEN_NETWORK.game.toLowerCase() &&
      typeof config.run_id === 'string' && config.run_id.length > 0 &&
      uint.test(config.start_block ?? '') && Number.isSafeInteger(Number(config.start_block)) &&
      Number.isSafeInteger(confirmations) && confirmations >= 1 && confirmations <= 100 &&
      Array.isArray(config.roster) && config.roster.length >= 2 && config.roster.length <= 20,
    'PROOF_AUDIT_INPUT_INVALID');
    const roster = config.roster;
    const rosterSize = roster.length;
    requireProof(roster.every(seat => ADDRESS.test(seat.wallet_address ?? '') &&
      /^(?:oc|hs)-(?:[1-9]|10)$/.test(seat.seat_id ?? '') && ['openclaw', 'hermes'].includes(seat.team) &&
      seat.harness === seat.team && seat.seat_id.startsWith(seat.team === 'hermes' ? 'hs-' : 'oc-')) &&
      new Set(roster.map(seat => seat.wallet_address.toLowerCase())).size === rosterSize &&
      new Set(roster.map(seat => seat.seat_id)).size === rosterSize && new Set(roster.map(seat => seat.team)).size === 2,
    'PROOF_AUDIT_INPUT_INVALID');
    audit.seats = roster.map(seat => ({ seat_id: seat.seat_id, joined: false, committed: false, revealed: false,
      discussion_delivered: false, join_transaction_hash: null, commit_transaction_hashes: [],
      reveal_transaction_hashes: [], discussion_message_ids: [] }));
    requireProof(report?.launch_attempts === 1 && report.creation?.status === 'accepted' &&
      report.creation.reference?.kind === 'transaction-hash' && TX.test(report.creation.reference.value ?? ''),
    'PROOF_CREATION_UNVERIFIED');
    const creationHash = report.creation.reference.value.toLowerCase();
    requireProof(BigInt(await provider.send('eth_chainId', [])) === 84532n, 'PROOF_CHAIN_MISMATCH');
    const tip = await provider.getBlockNumber();
    requireProof(Number.isSafeInteger(tip) && tip >= confirmations - 1, 'PROOF_CHAIN_UNCONFIRMED');
    const confirmed = tip - confirmations + 1;
    const head = await provider.getBlock(confirmed);
    requireProof(head?.number === confirmed && TX.test(head.hash ?? ''), 'PROOF_CHAIN_UNCONFIRMED');
    audit.confirmed_block_number = String(confirmed);
    const blocks = new Map([[confirmed, head.hash.toLowerCase()]]);
    async function canonical(blockNumber, blockHash) {
      requireProof(Number.isSafeInteger(blockNumber) && blockNumber >= Number(config.start_block) &&
        blockNumber <= confirmed && TX.test(blockHash ?? ''), 'PROOF_CHAIN_UNCONFIRMED');
      if (!blocks.has(blockNumber)) {
        const block = await provider.getBlock(blockNumber);
        requireProof(block?.number === blockNumber && TX.test(block.hash ?? ''), 'PROOF_CHAIN_REORG');
        blocks.set(blockNumber, block.hash.toLowerCase());
      }
      requireProof(blocks.get(blockNumber) === blockHash.toLowerCase(), 'PROOF_CHAIN_REORG');
    }
    async function receiptFor(hash) {
      const receipt = await provider.getTransactionReceipt(hash);
      requireProof(receipt?.status === 1 && receipt.hash?.toLowerCase() === hash &&
        receipt.to?.toLowerCase() === config.game_address.toLowerCase() && Array.isArray(receipt.logs),
      'PROOF_RECEIPT_UNVERIFIED');
      await canonical(receipt.blockNumber, receipt.blockHash);
      return receipt;
    }
    const creationReceipt = await receiptFor(creationHash);
    const logs = [];
    for (let first = creationReceipt.blockNumber; first <= confirmed; first += 1000) {
      const batch = await provider.getLogs({ address: config.game_address, fromBlock: first,
        toBlock: Math.min(first + 999, confirmed), topics: [EVENTS.map(name => ABI.getEvent(name).topicHash),
          zeroPadValue(toBeHex(BigInt(gameId)), 32)] });
      requireProof(Array.isArray(batch), 'PROOF_CHAIN_LOG_INVALID');
      logs.push(...batch);
    }
    const events = [];
    const ids = new Set();
    for (const log of logs) {
      requireProof(log?.address?.toLowerCase() === config.game_address.toLowerCase() && !log.removed &&
        TX.test(log.transactionHash ?? '') && Number.isSafeInteger(log.index) && log.index >= 0,
      'PROOF_CHAIN_LOG_INVALID');
      const event = ABI.parseLog(log);
      requireProof(event && EVENTS.includes(event.name) && String(event.args.gameId) === gameId, 'PROOF_CHAIN_LOG_INVALID');
      const id = `${log.transactionHash.toLowerCase()}:${log.index}`;
      requireProof(!ids.has(id), 'PROOF_CHAIN_LOG_INVALID'); ids.add(id);
      await canonical(log.blockNumber, log.blockHash);
      events.push({ ...log, event, id });
    }
    events.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
    const named = name => events.filter(log => log.event.name === name);
    const receiptContains = (receipt, log) => receipt.logs.some(item => item.address?.toLowerCase() === config.game_address.toLowerCase() &&
      item.index === log.index && item.data === log.data && JSON.stringify(item.topics) === JSON.stringify(log.topics));
    const created = named('GameCreated');
    requireProof(created.length === 1 && created[0].transactionHash.toLowerCase() === creationHash &&
      receiptContains(creationReceipt, created[0]), 'PROOF_CREATION_UNVERIFIED');
    audit.creation_transaction_hash = creationHash;
    const ended = named('GameEnded');
    requireProof(ended.length === 1 && [1, 2].includes(Number(ended[0].event.args.outcome)) &&
      named('GameCancelled').length === 0 && events.every(log => log === ended[0] || before(log, ended[0])),
    'PROOF_RESULT_UNVERIFIED');
    const resultHash = ended[0].transactionHash.toLowerCase();
    requireProof(receiptContains(await receiptFor(resultHash), ended[0]), 'PROOF_RESULT_UNVERIFIED');
    audit.result_transaction_hash = resultHash;
    const joined = named('PlayerJoined');
    const rosterWallets = new Set(roster.map(seat => seat.wallet_address.toLowerCase()));
    requireProof(joined.length === rosterSize &&
      new Set(joined.map(log => log.event.args.wallet.toLowerCase())).size === rosterSize &&
      joined.every(log => rosterWallets.has(log.event.args.wallet.toLowerCase()) && before(created[0], log)),
    'PROOF_ROSTER_UNVERIFIED');
    audit.joined_count = rosterSize;
    const commits = named('Committed'), reveals = named('Revealed'), effective = named('EffectiveChoiceMaterialized');
    audit.defaulted_count = effective.filter(log => log.event.args.defaultedCommit || log.event.args.defaultedReveal).length;
    requireProof(audit.defaulted_count === 0, 'PROOF_DEFAULTED_ACTIONS');
    const rounds = named('RoundResolved');
    const endRound = Number(ended[0].event.args.round);
    requireProof(Number.isSafeInteger(endRound) && endRound >= 1 && rounds.length === endRound &&
      rounds.every((log, index) => Number(log.event.args.round) === index + 1), 'PROOF_ACTIONS_UNVERIFIED');
    let living = rosterSize;
    for (const round of rounds) {
      const args = round.event.args;
      const materialized = effective.filter(log => log.event.args.round === args.round);
      const expected = Number(args.sharers) + Number(args.catchers) + Number(args.stealers);
      requireProof(expected === living && materialized.length === expected &&
        new Set(materialized.map(log => log.event.args.wallet.toLowerCase())).size === expected,
      'PROOF_ACTIONS_UNVERIFIED');
      for (const choice of materialized) {
        const wallet = choice.event.args.wallet.toLowerCase();
        const committed = commits.filter(log => log.event.args.round === args.round && log.event.args.wallet.toLowerCase() === wallet);
        const revealed = reveals.filter(log => log.event.args.round === args.round && log.event.args.wallet.toLowerCase() === wallet);
        requireProof(rosterWallets.has(wallet) && committed.length === 1 && revealed.length === 1 &&
          before(committed[0], revealed[0]) && before(revealed[0], choice) && before(choice, round) &&
          choice.event.args.choice === revealed[0].event.args.choice, 'PROOF_ACTIONS_UNVERIFIED');
      }
      living = Number(args.aliveCount);
    }
    requireProof(commits.length === effective.length && reveals.length === effective.length, 'PROOF_ACTIONS_UNVERIFIED');
    for (let index = 0; index < roster.length; index++) {
      const wallet = roster[index].wallet_address.toLowerCase(), seat = audit.seats[index];
      const seatCommits = commits.filter(log => log.event.args.wallet.toLowerCase() === wallet);
      const seatReveals = reveals.filter(log => log.event.args.wallet.toLowerCase() === wallet);
      requireProof(seatCommits.length > 0 && seatReveals.length > 0, 'PROOF_ACTIONS_UNVERIFIED');
      seat.joined = seat.committed = seat.revealed = true;
      seat.join_transaction_hash = joined.find(log => log.event.args.wallet.toLowerCase() === wallet).transactionHash.toLowerCase();
      seat.commit_transaction_hashes = seatCommits.map(log => log.transactionHash.toLowerCase());
      seat.reveal_transaction_hashes = seatReveals.map(log => log.transactionHash.toLowerCase());
    }
    audit.committed_seat_count = audit.revealed_seat_count = rosterSize; audit.round_count = endRound;
    requireProof((await provider.getBlock(confirmed))?.hash?.toLowerCase() === head.hash.toLowerCase(), 'PROOF_CHAIN_REORG');
    audit.chain_verified = true;

    const teams = ['openclaw', 'hermes'];
    requireProof(outbox?.schema_version === 1 && outbox.run_id === config.run_id && Array.isArray(outbox.entries) &&
      teams.every(team => /^-\d+$/.test(String(config.telegram?.[team]?.chat_id ?? '')) &&
        outbox.chats?.[team] === String(config.telegram[team].chat_id)), 'PROOF_TELEGRAM_SCOPE_MISMATCH');
    const entries = outbox.entries;
    requireProof(entries.every(entry => entry.status === 'sent'), 'PROOF_TELEGRAM_UNDELIVERED');
    requireProof(new Set(entries.map(entry => entry.key)).size === entries.length && entries.every(entry =>
      typeof entry.key === 'string' && teams.includes(entry.team) && typeof entry.text === 'string' &&
      entry.digest === digest(entry.text) && Number.isSafeInteger(entry.message_id) && entry.message_id > 0 &&
      Number.isFinite(Date.parse(entry.delivered_at))), 'PROOF_TELEGRAM_UNDELIVERED');
    requireProof(new Set(entries.map(entry => `${outbox.chats[entry.team]}:${entry.message_id}`)).size === entries.length,
      'PROOF_TELEGRAM_UNDELIVERED');
    for (let index = 0; index < roster.length; index++) {
      const seat = roster[index];
      const discussions = (report.dispatches ?? []).filter(row => row.game_id === gameId && row.seat_id === seat.seat_id &&
        row.operation === 'discussion' && row.status === 'observed' && row.has_team_message === true &&
        Number.isSafeInteger(row.round) && row.round >= 1 && row.round <= endRound);
      const delivered = entries.filter(entry => {
        if (entry.team !== seat.team || !new RegExp(`^message:${seat.team}:${gameId}:[1-9][0-9]*$`).test(entry.key)) return false;
        return discussions.some(row => {
          const prefix = `${seat.seat_id} (${seat.team === 'hermes' ? 'Hermes' : 'OpenClaw'}) · Game ${gameId} · Round ${row.round}\n`;
          return entry.text.startsWith(prefix) && entry.text.slice(prefix.length).trim().length > 0 &&
            commits.some(log => log.event.args.wallet.toLowerCase() === seat.wallet_address.toLowerCase() && Number(log.event.args.round) === row.round);
        });
      });
      requireProof(delivered.length > 0, 'PROOF_DISCUSSION_UNVERIFIED');
      audit.seats[index].discussion_delivered = true;
      audit.seats[index].discussion_message_ids = delivered.map(entry => entry.message_id);
      audit.discussion_message_count += delivered.length;
    }
    const resultTeams = outbox.chats.openclaw === outbox.chats.hermes ? ['openclaw'] : teams;
    for (const team of resultTeams) {
      const key = `event:${team}:${ended[0].id}`;
      const entry = entries.find(item => item.key === key && item.team === team);
      requireProof(entry?.text.startsWith(`Dealer · Game ${gameId} · Round ${endRound}\nGame completed\n`) &&
        entry.text.endsWith(`https://sepolia.basescan.org/tx/${resultHash}`), 'PROOF_RESULT_DELIVERY_UNVERIFIED');
      audit.result_message_ids.push({ team, message_id: entry.message_id });
    }
    audit.telegram_verified = audit.proof_complete = true;
  } catch (error) {
    audit.issues.push(error instanceof AuditFailure ? error.code : 'PROOF_AUDIT_UNAVAILABLE');
  }
  return audit;
}
