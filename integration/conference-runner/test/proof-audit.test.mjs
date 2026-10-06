import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Interface } from 'ethers';
import { auditControlledProof } from '../src/proof-audit.mjs';
import { GAME_ABI } from '../src/chain/abi.mjs';
import { FROZEN_NETWORK } from '../../game-bridge/src/index.js';
import { formatAgentMessages, formatDealerEvent } from '../src/telegram/index.mjs';

const abi = new Interface([...GAME_ABI,
  'event Committed(uint256 indexed gameId,uint32 indexed round,address indexed wallet,bytes32 commitment)',
  'event Revealed(uint256 indexed gameId,uint32 indexed round,address indexed wallet,uint8 choice)']);
const H = value => `0x${value.toString(16).padStart(64, '0')}`;
const hash = value => createHash('sha256').update(value).digest('hex');
const PRIVATE_TEXT = 'fixture-only discussion text never included in audit output';
const OWNER = `0x${'f'.repeat(40)}`;
const tenSeatRoster = Array.from({ length: 10 }, (_, index) => ({
  seat_id: `${index < 5 ? 'oc' : 'hs'}-${index % 5 + 1}`,
  team: index < 5 ? 'openclaw' : 'hermes', harness: index < 5 ? 'openclaw' : 'hermes',
  wallet_address: `0x${(index + 1).toString(16).padStart(40, '0')}`,
}));
const config = {
  chain_id: 84532, game_address: FROZEN_NETWORK.game, run_id: 'controlled-proof-fixture',
  start_block: '100', confirmations: 2, expected_owner: OWNER,
  roster: [
    { seat_id: 'oc-1', team: 'openclaw', harness: 'openclaw', wallet_address: '0x1111111111111111111111111111111111111111' },
    { seat_id: 'oc-2', team: 'openclaw', harness: 'openclaw', wallet_address: '0x2222222222222222222222222222222222222222' },
    { seat_id: 'hs-1', team: 'hermes', harness: 'hermes', wallet_address: '0x3333333333333333333333333333333333333333' },
  ],
  telegram: { openclaw: { chat_id: '-100123' }, hermes: { chat_id: '-100123' } },
};

function log(name, values, blockNumber, index = 0, transactionHash = H(1000 + blockNumber)) {
  return { ...abi.encodeEventLog(abi.getEvent(name), values), address: config.game_address,
    blockNumber, blockHash: H(blockNumber), transactionHash, index, removed: false };
}
function sent(key, team, text, message_id) {
  return { key, team, text, digest: hash(text), status: 'sent', message_id,
    delivered_at: '2026-09-25T12:00:00.000Z' };
}
function fixture(roster = config.roster) {
  const fixtureConfig = { ...structuredClone(config), roster: structuredClone(roster) };
  const logs = [log('GameCreated', [9, 1000, 100000000000000n, roster.length, roster.length, 2], 100)];
  for (const [i, seat] of roster.entries()) {
    const choice = i === roster.length - 1 ? 3 : 1;
    logs.push(log('PlayerJoined', [9, seat.wallet_address, H(300 + i), 1, i + 1], 101, i, H(10000 + i)));
    logs.push(log('Committed', [9, 1, seat.wallet_address, H(9000 + i)], 104, i, H(20000 + i)));
    logs.push(log('Revealed', [9, 1, seat.wallet_address, choice], 107, i, H(30000 + i)));
    logs.push(log('EffectiveChoiceMaterialized', [9, 1, seat.wallet_address, choice, false, false], 110, i));
  }
  logs.push(log('RoundResolved', [9, 1, roster.length - 1, 0, 1, roster.length - 1, 1, 0], 110, roster.length));
  logs.push(log('GameEnded', [9, 1, 1, 1, 0], 110, roster.length + 1));
  const receipts = new Map(logs.map(item => [item.transactionHash, {
    status: 1, hash: item.transactionHash, from: abi.parseLog(item).args.wallet ?? OWNER,
    to: config.game_address, blockNumber: item.blockNumber, blockHash: item.blockHash,
    logs: logs.filter(log => log.transactionHash === item.transactionHash),
  }]));
  receipts.get(H(1110)).from = OWNER;
  const calls = [];
  const provider = {
    async send(method, params) {
      if (method === 'eth_chainId') { assert.deepEqual(params, []); return '0x14a34'; }
      assert.equal(method, 'eth_call'); assert.equal(params[1], '0x6e');
      const call = abi.decodeFunctionData('previewWinnerClaim', params[0].data);
      assert.equal(String(call[0]), '9');
      const index = roster.findIndex(seat => seat.wallet_address.toLowerCase() === call[1].toLowerCase());
      assert.ok(index >= 0);
      return abi.encodeFunctionResult('previewWinnerClaim', [BigInt(index + 1) * 100n, 0n, BigInt(index + 1) * 100n, true]);
    },
    async getBlockNumber() { return 112; },
    async getBlock(number) { return { number, hash: H(number) }; },
    async getTransactionReceipt(tx) { return receipts.get(tx) ?? null; },
    async getLogs(filter) {
      calls.push(filter);
      assert.equal(filter.address, config.game_address);
      assert.equal(filter.topics[1], H(9));
      assert.equal(filter.topics[0].length, 8);
      return logs.filter(item => item.blockNumber >= filter.fromBlock && item.blockNumber <= filter.toBlock);
    },
  };
  const report = { launch_attempts: 1, proof_complete: true, telegram: { ok: true },
    creation: { status: 'accepted', reference: { kind: 'transaction-hash', value: H(1100) } },
    dispatches: roster.flatMap((seat, index) => [
      { game_id: '9', round: 1, seat_id: seat.seat_id, operation: 'discussion', status: 'observed', has_team_message: true },
      ...['join', 'commit', 'reveal'].map((operation, opIndex) => ({ game_id: '9', round: operation === 'join' ? 0 : 1,
        request_id: `conference:${hash(`${seat.seat_id}:${operation}`).slice(0, 32)}`,
        seat_id: seat.seat_id, operation, status: 'submitted', transaction_hash: H(10000 * (opIndex + 1) + index) })),
    ]) };
  const outbox = { schema_version: 1, run_id: fixtureConfig.run_id,
    chats: { openclaw: '-100123', hermes: '-100123' }, entries: roster.map((seat, i) => sent(
      `message:${seat.team}:9:${i + 1}`, seat.team,
      `${seat.seat_id} (${seat.team === 'hermes' ? 'Hermes' : 'OpenClaw'}) · Game 9 · Round 1\n${PRIVATE_TEXT}`, 20 + i)),
  };
  outbox.entries.push(sent(`event:openclaw:${H(1110)}:${roster.length + 1}`, 'openclaw',
    formatDealerEvent({ id: `${H(1110)}:${roster.length + 1}`, game_id: '9', round: 1, kind: 'completed',
      transaction_hash: H(1110), data: { awards: roster.map((seat, index) => ({ wallet_address: seat.wallet_address,
        award_wei: String((index + 1) * 100) })) } }, fixtureConfig), 20 + roster.length));
  return { config: fixtureConfig, gameId: '9', provider, report, outbox, logs, receipts, calls };
}
function replaceEvent(f, name, replacement) {
  const index = f.logs.findIndex(item => abi.parseLog(item).name === name);
  const original = f.logs[index];
  f.logs[index] = replacement(original);
  for (const receipt of f.receipts.values()) receipt.logs = f.logs.filter(item => item.transactionHash === receipt.hash);
}

function multipartDiscussion(f) {
  const seat = f.config.roster[0];
  const parts = formatAgentMessages({ team: seat.team, seat_id: seat.seat_id,
    game_id: '9', round: 1, sequence: 1, request_id: 'fixture-discussion',
    message: `${PRIVATE_TEXT} 🦀\n`.repeat(150) }, seat.team, f.config);
  assert.ok(parts.length > 2);
  const entries = parts.map((part, index) => ({ ...sent(
    `message:${seat.team}:9:1${index === 0 ? '' : `:part:${index + 1}`}`, seat.team, part.text, 200 + index),
    message_part: part.message_part, message_parts: part.message_parts }));
  f.outbox.entries.splice(0, 1, ...entries);
  return entries;
}

test('proof accepts complete multipart discussion and counts logical messages', async () => {
  const f = fixture();
  const parts = multipartDiscussion(f);
  const audit = await auditControlledProof(f);
  assert.equal(audit.proof_complete, true, JSON.stringify(audit));
  assert.equal(audit.discussion_message_count, f.config.roster.length);
  assert.deepEqual(audit.seats[0].discussion_message_ids, parts.map(part => part.message_id));
  assert.equal(JSON.stringify(audit).includes(PRIVATE_TEXT), false);
});

for (const defect of ['missing-part', 'wrong-count', 'wrong-label']) {
  test(`proof rejects ${defect} in multipart discussion`, async () => {
    const f = fixture();
    const parts = multipartDiscussion(f);
    if (defect === 'missing-part') f.outbox.entries.splice(1, 1);
    if (defect === 'wrong-count') parts[1].message_parts += 1;
    if (defect === 'wrong-label') { parts[1].text = parts[1].text.replace('Part 2/', 'Part 1/'); parts[1].digest = hash(parts[1].text); }
    const audit = await auditControlledProof(f);
    assert.equal(audit.proof_complete, false);
    assert.ok(audit.issues.includes('PROOF_DISCUSSION_UNVERIFIED'));
  });
}

test('audits actual confirmed per-seat events and delivered discussion without exposing content', async () => {
  const f = fixture();
  const audit = await auditControlledProof(f);
  assert.equal(audit.proof_complete, true, JSON.stringify(audit));
  assert.equal(audit.chain_verified, true);
  assert.equal(audit.telegram_verified, true);
  assert.equal(audit.joined_count, 3);
  assert.equal(audit.committed_seat_count, 3);
  assert.equal(audit.revealed_seat_count, 3);
  assert.equal(audit.round_count, 1);
  assert.equal(audit.defaulted_count, 0);
  assert.equal(audit.discussion_message_count, 3);
  assert.equal(audit.creation_transaction_hash, H(1100));
  assert.equal(audit.result_transaction_hash, H(1110));
  assert.deepEqual(audit.result_message_ids, [{ team: 'openclaw', message_id: 23 }]);
  assert.ok(audit.seats.every(seat => seat.joined && seat.committed && seat.revealed && seat.discussion_delivered));
  assert.ok(f.calls.every(call => call.fromBlock >= 100 && call.toBlock <= 111));
  assert.equal(JSON.stringify(audit).includes(PRIVATE_TEXT), false);
  assert.equal(JSON.stringify(audit).includes(H(9000)), false);
});

test('full award comparison rejects wrong, omitted or added awards even with a valid recomputed digest', async () => {
  for (const defect of ['wrong', 'omitted', 'added']) {
    const f = fixture(tenSeatRoster);
    const entry = f.outbox.entries.at(-1);
    if (defect === 'wrong') entry.text = entry.text.replace('0.0000000000000001 testnet ETH', '99 testnet ETH');
    if (defect === 'omitted') entry.text = entry.text.split('\n').filter(line => !line.startsWith('hs-5 (')).join('\n');
    if (defect === 'added') entry.text = entry.text.replace('Game completed\n', 'Game completed\noc-9: awarded 9 testnet ETH\n');
    entry.digest = hash(entry.text);
    const audit = await auditControlledProof(f);
    assert.equal(audit.proof_complete, false);
    assert.deepEqual(audit.issues, ['PROOF_RESULT_DELIVERY_UNVERIFIED']);
  }
  const valid = await auditControlledProof(fixture(tenSeatRoster));
  assert.equal(valid.award_total_wei, '5500'); assert.equal(valid.seats.at(-1).award_wei, '1000');
});

test('audits a complete five-vs-five roster without weakening per-seat acceptance', async () => {
  const roster = [];
  for (const [team, prefix, offset] of [['openclaw', 'oc', 0], ['hermes', 'hs', 5]]) {
    for (let index = 1; index <= 5; index++) {
      roster.push({ seat_id: `${prefix}-${index}`, team, harness: team,
        wallet_address: `0x${(offset + index).toString(16).padStart(40, '0')}` });
    }
  }
  const complete = fixture(roster);
  const audit = await auditControlledProof(complete);
  assert.equal(audit.proof_complete, true, JSON.stringify(audit));
  assert.equal(audit.joined_count, 10);
  assert.equal(audit.committed_seat_count, 10);
  assert.equal(audit.revealed_seat_count, 10);
  assert.equal(audit.discussion_message_count, 10);
  assert.equal(audit.defaulted_count, 0);
  assert.equal(audit.seats.length, 10);
  assert.ok(audit.seats.every(seat => seat.joined && seat.committed && seat.revealed && seat.discussion_delivered));

  const missing = fixture(roster);
  missing.logs.splice(missing.logs.findIndex(item => abi.parseLog(item).name === 'Revealed'), 1);
  assert.deepEqual((await auditControlledProof(missing)).issues, ['PROOF_ACTIONS_UNVERIFIED']);
});

test('old-game dispatches and outbox messages cannot satisfy current-game discussion', async () => {
  for (const kind of ['dispatch', 'outbox']) {
    const f = fixture();
    if (kind === 'dispatch') f.report.dispatches.filter(row => row.operation === 'discussion').forEach(row => { row.game_id = '8'; });
    else f.outbox.entries.filter(row => row.key.startsWith('message:')).forEach(row => {
      row.key = row.key.replace(':9:', ':8:'); row.text = row.text.replace('Game 9', 'Game 8'); row.digest = hash(row.text);
    });
    const audit = await auditControlledProof(f);
    assert.equal(audit.proof_complete, false);
    assert.equal(audit.chain_verified, true);
    assert.deepEqual(audit.issues, ['PROOF_DISCUSSION_UNVERIFIED']);
  }
});

test('old-game chain logs cannot satisfy even an agent-reported successful proof', async () => {
  const f = fixture();
  replaceEvent(f, 'Committed', original => log('Committed', [8, 1, config.roster[0].wallet_address, H(9000)], original.blockNumber));
  const audit = await auditControlledProof(f);
  assert.equal(audit.proof_complete, false);
  assert.deepEqual(audit.issues, ['PROOF_CHAIN_LOG_INVALID']);
});

test('submitted acknowledgements cannot replace each seat’s actual commit and reveal', async () => {
  for (const missing of ['Committed', 'Revealed']) {
    const f = fixture();
    f.logs.splice(f.logs.findIndex(item => abi.parseLog(item).name === missing), 1);
    const audit = await auditControlledProof(f);
    assert.equal(audit.proof_complete, false);
    assert.deepEqual(audit.issues, ['PROOF_ACTIONS_UNVERIFIED']);
  }
});

test('joined players must be the exact roster and all effective choices must be voluntary', async () => {
  const wrong = fixture();
  replaceEvent(wrong, 'PlayerJoined', original => log('PlayerJoined', [9, '0x4444444444444444444444444444444444444444', H(300), 1, 1], original.blockNumber));
  assert.deepEqual((await auditControlledProof(wrong)).issues, ['PROOF_ROSTER_UNVERIFIED']);
  for (const flags of [[true, false], [false, true]]) {
    const f = fixture();
    replaceEvent(f, 'EffectiveChoiceMaterialized', original => log('EffectiveChoiceMaterialized',
      [9, 1, config.roster[0].wallet_address, 1, ...flags], original.blockNumber, original.index));
    const audit = await auditControlledProof(f);
    assert.equal(audit.proof_complete, false);
    assert.equal(audit.defaulted_count, 1);
    assert.deepEqual(audit.issues, ['PROOF_DEFAULTED_ACTIONS']);
  }
});

test('pending, inflight, uncertain and rejected Telegram entries fail despite healthy report', async () => {
  for (const status of ['pending', 'inflight', 'uncertain', 'rejected']) {
    const f = fixture(); f.outbox.entries[0].status = status;
    const audit = await auditControlledProof(f);
    assert.equal(audit.chain_verified, true);
    assert.equal(audit.proof_complete, false);
    assert.deepEqual(audit.issues, ['PROOF_TELEGRAM_UNDELIVERED']);
  }
});

test('discussion delivery needs integrity and completed result delivery to every distinct chat', async () => {
  const tampered = fixture(); tampered.outbox.entries[0].text += ' changed';
  assert.deepEqual((await auditControlledProof(tampered)).issues, ['PROOF_TELEGRAM_UNDELIVERED']);
  const missing = fixture(); missing.outbox.entries.pop();
  assert.deepEqual((await auditControlledProof(missing)).issues, ['PROOF_RESULT_DELIVERY_UNVERIFIED']);
  const separate = fixture(); separate.config.telegram.hermes.chat_id = '-100456'; separate.outbox.chats.hermes = '-100456';
  assert.deepEqual((await auditControlledProof(separate)).issues, ['PROOF_RESULT_DELIVERY_UNVERIFIED']);
  const result = separate.outbox.entries.at(-1);
  separate.outbox.entries.push(sent(result.key.replace('openclaw', 'hermes'), 'hermes', result.text, 23));
  assert.equal((await auditControlledProof(separate)).proof_complete, true);
});

test('creation and completed result require successful matching canonical confirmed receipts', async () => {
  for (const tx of [H(1100), H(1110)]) {
    const f = fixture(); f.receipts.get(tx).status = 0;
    assert.deepEqual((await auditControlledProof(f)).issues, ['PROOF_RECEIPT_UNVERIFIED']);
  }
  const missing = fixture(); missing.receipts.get(H(1110)).logs = [];
  assert.deepEqual((await auditControlledProof(missing)).issues, ['PROOF_RESULT_UNVERIFIED']);
  const unconfirmed = fixture(); unconfirmed.provider.getBlockNumber = async () => 110;
  assert.equal((await auditControlledProof(unconfirmed)).proof_complete, false);
  const reorg = fixture(); let reads = 0;
  reorg.provider.getBlock = async number => ({ number, hash: number === 111 && ++reads > 1 ? H(999) : H(number) });
  assert.deepEqual((await auditControlledProof(reorg)).issues, ['PROOF_CHAIN_REORG']);
});

test('scope mismatch and provider failures fail closed without copying secrets', async () => {
  const wrong = fixture(); wrong.outbox.run_id = 'other-run';
  assert.deepEqual((await auditControlledProof(wrong)).issues, ['PROOF_TELEGRAM_SCOPE_MISMATCH']);
  const failure = fixture(); failure.provider.send = async () => { throw new Error('SECRET_RPC_KEY_PRIVATE'); };
  const audit = await auditControlledProof(failure);
  assert.equal(audit.proof_complete, false);
  assert.deepEqual(audit.issues, ['PROOF_AUDIT_UNAVAILABLE']);
  assert.equal(JSON.stringify(audit).includes('SECRET_RPC_KEY_PRIVATE'), false);
});

test('repeated ten-seat audits require every action receipt and both independent rooms', async () => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const f = fixture(tenSeatRoster);
    f.config.run_id += `-${attempt}`; f.outbox.run_id = f.config.run_id;
    f.config.telegram.hermes.chat_id = '-100456'; f.outbox.chats.hermes = '-100456';
    const result = f.outbox.entries.at(-1);
    f.outbox.entries.push(sent(result.key.replace('openclaw', 'hermes'), 'hermes', result.text, 99));
    const read = f.provider.getTransactionReceipt;
    const readHashes = new Set();
    f.provider.getTransactionReceipt = async tx => { readHashes.add(tx); return read(tx); };
    const audit = await auditControlledProof(f);
    assert.equal(audit.proof_complete, true, JSON.stringify(audit));
    assert.equal(audit.discussion_message_count, 10);
    assert.equal(audit.result_message_ids.length, 2);
    assert.equal(readHashes.size, 32);
    assert.ok(f.report.dispatches.filter(row => row.transaction_hash).every(row => readHashes.has(row.transaction_hash)));
  }
});

test('ten-seat audit rejects corrupted player receipts and dispatch binding independently', async t => {
  const cases = [
    ['missing receipt', f => f.receipts.delete(H(10000)), 'PROOF_RECEIPT_UNVERIFIED'],
    ['reverted receipt', f => { f.receipts.get(H(20000)).status = 0; }, 'PROOF_RECEIPT_UNVERIFIED'],
    ['wrong transaction', f => { f.receipts.get(H(20000)).hash = H(999); }, 'PROOF_RECEIPT_UNVERIFIED'],
    ['wrong contract', f => { f.receipts.get(H(20000)).to = OWNER; }, 'PROOF_RECEIPT_UNVERIFIED'],
    ['wrong sender', f => { f.receipts.get(H(20000)).from = tenSeatRoster[1].wallet_address; }, 'PROOF_PLAYER_RECEIPT_UNVERIFIED'],
    ['missing operation event', f => { f.receipts.get(H(30000)).logs = []; }, 'PROOF_PLAYER_RECEIPT_UNVERIFIED'],
    ['receipt log from another transaction', f => { f.receipts.get(H(30000)).logs = f.receipts.get(H(30000)).logs.map(log => ({ ...log, transactionHash: H(999) })); }, 'PROOF_PLAYER_RECEIPT_UNVERIFIED'],
    ['noncanonical player receipt', f => { f.receipts.get(H(30000)).blockHash = H(999); }, 'PROOF_CHAIN_REORG'],
    ['wrong reported hash', f => { f.report.dispatches.find(row => row.operation === 'commit').transaction_hash = H(999); }, 'PROOF_DISPATCH_UNVERIFIED'],
    ['wrong reported seat', f => { f.report.dispatches.find(row => row.operation === 'commit').seat_id = 'hs-5'; }, 'PROOF_DISPATCH_UNVERIFIED'],
    ['wrong reported game', f => { f.report.dispatches.find(row => row.operation === 'commit').game_id = '8'; }, 'PROOF_DISPATCH_UNVERIFIED'],
    ['wrong reported round', f => { f.report.dispatches.find(row => row.operation === 'commit').round = 2; }, 'PROOF_DISPATCH_UNVERIFIED'],
    ['missing gameplay journal', f => { f.report.dispatches = f.report.dispatches.filter(row => row.operation === 'discussion'); }, 'PROOF_DISPATCH_UNVERIFIED'],
    ['missing request identity', f => { delete f.report.dispatches.find(row => row.operation === 'reveal').request_id; }, 'PROOF_DISPATCH_UNVERIFIED'],
    ['pre-submit rejection cannot prove operation attempt', f => { f.report.dispatches.find(row => row.operation === 'join').status = 'rejected-before-submit'; }, 'PROOF_DISPATCH_UNVERIFIED'],
    ['wrong creation owner', f => { f.receipts.get(H(1100)).from = tenSeatRoster[0].wallet_address; }, 'PROOF_CREATION_UNVERIFIED'],
    ['missing configured owner', f => { delete f.config.expected_owner; }, 'PROOF_AUDIT_INPUT_INVALID'],
    ['wrong creation roster limits', f => replaceEvent(f, 'GameCreated', original => log('GameCreated', [9, 1000, 100000000000000n, 3, 3, 2], original.blockNumber)), 'PROOF_CREATION_UNVERIFIED'],
    ['wrong choice tally', f => replaceEvent(f, 'RoundResolved', original => log('RoundResolved', [9, 1, 8, 1, 1, 9, 1, 0], original.blockNumber, original.index)), 'PROOF_ACTIONS_UNVERIFIED'],
    ['wrong elimination tally', f => replaceEvent(f, 'RoundResolved', original => log('RoundResolved', [9, 1, 9, 0, 1, 8, 1, 0], original.blockNumber, original.index)), 'PROOF_ACTIONS_UNVERIFIED'],
    ['wrong winner count', f => replaceEvent(f, 'GameEnded', original => log('GameEnded', [9, 1, 1, 2, 0], original.blockNumber, original.index)), 'PROOF_RESULT_UNVERIFIED'],
    ['missing last seat reveal', f => { f.logs.splice(f.logs.findIndex(item => item.transactionHash === H(30009)), 1); }, 'PROOF_ACTIONS_UNVERIFIED'],
    ['duplicate chain event', f => { f.logs.push(f.logs[1]); }, 'PROOF_CHAIN_LOG_INVALID'],
    ['removed chain event', f => { f.logs[1].removed = true; }, 'PROOF_CHAIN_LOG_INVALID'],
    ['defaulted last seat', f => replaceEvent(f, 'EffectiveChoiceMaterialized', original => log('EffectiveChoiceMaterialized', [9, 1, tenSeatRoster[0].wallet_address, 1, true, false], original.blockNumber, original.index)), 'PROOF_DEFAULTED_ACTIONS'],
    ['missing last discussion', f => { f.outbox.entries = f.outbox.entries.filter(entry => !entry.text.startsWith('hs-5 ')); }, 'PROOF_DISCUSSION_UNVERIFIED'],
    ['misrouted discussion', f => { f.outbox.entries[0].team = 'hermes'; }, 'PROOF_DISCUSSION_UNVERIFIED'],
    ['duplicate Telegram message ID', f => { f.outbox.entries[1].message_id = f.outbox.entries[0].message_id; }, 'PROOF_TELEGRAM_UNDELIVERED'],
    ['wrong result transaction link', f => { const entry = f.outbox.entries.at(-1); entry.text = entry.text.replace(H(1110), H(999)); entry.digest = hash(entry.text); }, 'PROOF_RESULT_DELIVERY_UNVERIFIED'],
  ];
  for (const [name, corrupt, issue] of cases) await t.test(name, async () => {
    const f = fixture(tenSeatRoster); corrupt(f);
    const audit = await auditControlledProof(f);
    assert.equal(audit.proof_complete, false);
    assert.deepEqual(audit.issues, [issue]);
    assert.ok(!JSON.stringify(audit).includes(PRIVATE_TEXT));
  });
});

test('a durable ambiguous attempt without a returned hash is reconciled only by its canonical player event', async () => {
  for (const status of ['ambiguous', 'cancelled-after-submit', 'observed']) {
    const f = fixture(tenSeatRoster);
    const dispatch = f.report.dispatches.find(row => row.operation === 'reveal');
    dispatch.status = status; dispatch.transaction_hash = null;
    assert.equal((await auditControlledProof(f)).proof_complete, true);
    f.receipts.delete(H(30000));
    assert.deepEqual((await auditControlledProof(f)).issues, ['PROOF_RECEIPT_UNVERIFIED']);
  }
});

test('reported claims require a successful canonical receipt from the seat with its exact game/wallet event', async () => {
  function withClaim() {
    const f = fixture(tenSeatRoster), wallet = tenSeatRoster[0].wallet_address;
    const claim = log('PrizeClaimed', [9, wallet, 1, 1, 0, 1, OWNER], 111, 0, H(40000));
    f.receipts.set(H(40000), { status: 1, hash: H(40000), from: wallet, to: config.game_address,
      blockNumber: 111, blockHash: H(111), logs: [claim] });
    f.report.dispatches.push({ game_id: '9', round: 1, seat_id: 'oc-1', operation: 'claim', status: 'submitted', transaction_hash: H(40000) });
    return f;
  }
  assert.equal((await auditControlledProof(withClaim())).proof_complete, true);
  for (const corrupt of [f => { f.receipts.get(H(40000)).from = OWNER; },
    f => { f.receipts.get(H(40000)).logs = []; },
    f => { f.receipts.get(H(40000)).logs = [log('PrizeClaimed', [8, tenSeatRoster[0].wallet_address, 1, 1, 0, 1, OWNER], 111, 0, H(40000))]; }]) {
    const f = withClaim(); corrupt(f);
    assert.deepEqual((await auditControlledProof(f)).issues, ['PROOF_DISPATCH_UNVERIFIED']);
  }
});
