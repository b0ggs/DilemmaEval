import test from 'node:test';
import assert from 'node:assert/strict';
import { Interface } from 'ethers';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { GAME_ABI } from '../../src/chain/abi.mjs';
import { buildCompletedJournalReadCommand, verifyCompletedReceipt, verifyPublicTransactionReferences } from '../../src/maritime/reconcile.mjs';
import { config, poke, reply, roster } from './fixtures.mjs';

const abi = new Interface([...GAME_ABI,
  'event Committed(uint256 indexed gameId,uint32 indexed round,address indexed wallet,bytes32 commitment)',
  'event Revealed(uint256 indexed gameId,uint32 indexed round,address indexed wallet,uint8 choice)']);
const H = value => `0x${value.toString(16).padStart(64, '0')}`;
const run = promisify(execFile);

function binding() {
  return { gameplay_command: ['node', '/volume/a/code/player-cli.mjs', '/volume/a/seat.json'] };
}

test('journal read command is shell-free and embeds only public recovery identity', () => {
  const request = poke('commit');
  const command = buildCompletedJournalReadCommand({ binding: binding(), request, config });
  assert.deepEqual(command.slice(0, 3), ['node', '--input-type=module', '-e']);
  assert.equal(command.length, 4);
  assert.match(command[3], /O_NOFOLLOW/);
  assert.match(command[3], /stage!==['"]done['"]/);
  assert.equal(command[3].includes('team_chat'), false);
  assert.equal(command[3].includes('choice'), false);
  assert.equal(command[3].includes('salt'), false);
});

test('journal reader emits only the public response and rejects stale, incomplete, or wrong-request state', async t => {
  const created = await mkdtemp(join(tmpdir(), 'dilemma-reconcile-'));
  const base = await realpath(created);
  t.after(() => rm(base, { recursive: true, force: true }));
  const stateDirectory = join(base, 'private');
  const requests = join(stateDirectory, 'requests');
  await mkdir(requests, { recursive: true, mode: 0o700 });
  const request = poke('commit');
  const settingsPath = join(base, 'seat.json');
  const localConfig = { ...config, roster: structuredClone(roster) };
  await writeFile(settingsPath, JSON.stringify({ schema_version: 1, chain_id: 84532,
    game_address: config.game_address, seat_id: request.seat_id, state_directory: stateDirectory,
    roster: roster.map(({ seat_id, wallet_address }) => ({ seat_id, wallet_address })) }), { mode: 0o600 });
  const binding = { gameplay_command: ['node', join(base, 'player-cli.mjs'), settingsPath] };
  const name = `${createHash('sha256').update(`84532:${config.game_address.toLowerCase()}:7:1:commit`).digest('hex')}.json`;
  const journalPath = join(requests, name);
  const response = reply(request, { status: 'submitted', transaction_hash: H(1) });
  const command = buildCompletedJournalReadCommand({ binding, request, config: localConfig });
  const writeJournal = value => writeFile(journalPath, JSON.stringify(value), { mode: 0o600 });
  await writeJournal({ schema_version: 1, stage: 'done', request_id: request.request_id,
    operation: 'commit', private_bundle: 'must-not-leak', response });
  const valid = await run(command[0], command.slice(1));
  assert.deepEqual(JSON.parse(valid.stdout), response);
  assert.equal(valid.stdout.includes('private_bundle'), false);
  for (const journal of [
    { schema_version: 1, stage: 'submitting', request_id: request.request_id, operation: 'commit', response },
    { schema_version: 1, stage: 'done', request_id: 'stale-request', operation: 'commit', response },
    { schema_version: 1, stage: 'done', request_id: request.request_id, operation: 'commit',
      response: { ...response, request_id: 'wrong-request' } }
  ]) {
    await writeJournal(journal);
    await assert.rejects(run(command[0], command.slice(1)), error => error.code === 1 && error.stdout === '');
  }
});

function eventLog(name, args, blockHash, transactionHash) {
  const encoded = abi.encodeEventLog(abi.getEvent(name), args);
  return { address: config.game_address, topics: encoded.topics, data: encoded.data,
    blockNumber: 100, blockHash, transactionHash, index: 0, removed: false };
}

function providerFor({ request, seat = roster[0], eventName = 'Committed', eventGame = 7,
  eventWallet = seat.wallet_address, eventRound = 1, from = seat.wallet_address,
  blockHash = H(2), canonicalHash = blockHash, status = 1 } = {}) {
  const transactionHash = H(1);
  const args = eventName === 'PlayerJoined' ? [eventGame, eventWallet, H(3), 1, 1] :
    eventName === 'Committed' ? [eventGame, eventRound, eventWallet, H(4)] : [eventGame, eventRound, eventWallet, 1];
  return {
    send: async () => '0x14a34',
    getTransactionReceipt: async () => ({ status, hash: transactionHash, from, to: config.game_address,
      blockNumber: 100, blockHash, logs: [eventLog(eventName, args, blockHash, transactionHash)] }),
    getBlockNumber: async () => 102,
    getBlock: async () => ({ number: 100, hash: canonicalHash })
  };
}

test('receipt verification requires the exact wallet, action event, game, round and canonical block', async () => {
  const request = poke('commit');
  const response = reply(request, { status: 'submitted', transaction_hash: H(1) });
  assert.equal(await verifyCompletedReceipt({ config: { ...config, confirmations: 2 }, seat: roster[0], request,
    response, provider: providerFor({ request }) }), true);
  for (const provider of [
    providerFor({ request, from: roster[1].wallet_address }),
    providerFor({ request, eventWallet: roster[1].wallet_address }),
    providerFor({ request, eventGame: 8 }),
    providerFor({ request, eventRound: 2 }),
    providerFor({ request, eventName: 'Revealed' }),
    providerFor({ request, canonicalHash: H(9) })
  ]) {
    assert.equal(await verifyCompletedReceipt({ config: { ...config, confirmations: 2 }, seat: roster[0], request,
      response, provider }), false);
  }
});

test('join and reveal receipts verify their corresponding event', async () => {
  for (const [phase, eventName] of [['join', 'PlayerJoined'], ['reveal', 'Revealed']]) {
    const request = poke(phase);
    const response = reply(request, { status: 'submitted', transaction_hash: H(1) });
    assert.equal(await verifyCompletedReceipt({ config, seat: roster[0], request, response,
      provider: providerFor({ request, eventName }) }), true);
  }
});

test('direct receipt verification is deadline-bounded without destroying an injected provider', async () => {
  const request = poke('commit');
  const response = reply(request, { status: 'submitted', transaction_hash: H(1) });
  let destroyed = false;
  const provider = { send: async () => new Promise(() => {}), destroy: () => { destroyed = true; } };
  const started = Date.now();
  assert.equal(await verifyCompletedReceipt({ config, seat: roster[0], request, response,
    deadlineAtMs: started + 20, provider }), false);
  assert.ok(Date.now() - started < 200);
  assert.equal(destroyed, false);
});

test('public transaction exemptions require a matching confirmed receipt on the canonical Base Sepolia chain', async () => {
  const input = { config, hashes: [H(1)], deadlineAtMs: Date.now() + 1000 };
  assert.equal(await verifyPublicTransactionReferences({ ...input, provider: providerFor() }), true);
  for (const provider of [providerFor({ canonicalHash: H(9) }),
    { ...providerFor(), send: async () => '0x1' },
    { ...providerFor(), getTransactionReceipt: async () => null },
    { ...providerFor(), getBlockNumber: async () => 100 },
    { ...providerFor(), getTransactionReceipt: async () => ({ hash: H(9), blockNumber: 100, blockHash: H(2) }) }]) {
    assert.equal(await verifyPublicTransactionReferences({ ...input, provider }), false);
  }
});
