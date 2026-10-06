import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { Interface, Wallet, Transaction } from 'ethers';
import { GAME_ABI, CONFIG_FIELDS } from '../../src/chain/abi.mjs';
import { createChainReader, createIsolatedSigner, createLauncherClient, createPhaseExecutorClient, createSignerServer } from '../../src/chain/index.mjs';
import { PINNED_DEPLOYMENT, assertSignerDeployment, assertSignerEnvironment, prepareSignerDirectory } from '../../src/chain/guards.mjs';
import { chainFailureCode, safeChainDiagnostic } from '../../src/chain/diagnostics.mjs';

const iface = new Interface([...GAME_ABI, 'function identityRegistry() view returns(address)']);
const addresses = { game: '0x1111111111111111111111111111111111111111', auth: '0x2222222222222222222222222222222222222222', owner: '0x3333333333333333333333333333333333333333', registry: '0x5555555555555555555555555555555555555555', player: '0x4444444444444444444444444444444444444444' };
const H = (n) => `0x${n.toString(16).padStart(64, '0')}`;
const defaults = ['100000000000000', 100, 100, 60, 60, 40, 3, 3, 2];
const config = { chain_id: 84532, game_address: addresses.game, auth_adapter_address: addresses.auth, identity_registry_address: addresses.registry, expected_owner: addresses.owner, confirmations: 2, start_block: '10', roster: [{ seat_id: 'oc-1', wallet_address: addresses.player, cause_id: 1 }] };
function fixture({ phase = 2, outcome = 0, chainId = 84532n, active = 1n, current = 1n, claimed = false, refunded = false } = {}) {
  const calls = [];
  const state = { phase, outcome, active, current, claimed, refunded, ready: false };
  const provider = {
    logs: [], broadcasts: [], receipts: new Map(), transactions: new Map(),
    async getNetwork() { return { chainId }; },
    async send(method) { assert.equal(method, 'eth_chainId'); return `0x${(this.rpcChainId ?? chainId).toString(16)}`; },
    async getBlockNumber() { return 101; },
    async getBlock(number) { return { number, timestamp: 1000 + number, hash: H(number), baseFeePerGas: 5_000_000n }; },
    async getCode() { return '0x1234'; },
    async getBalance() { return 10n ** 17n; },
    async getLogs(filter) { calls.push({ filter }); return this.logs.filter((log) => log.blockNumber >= filter.fromBlock && log.blockNumber <= filter.toBlock); },
    async call(tx) {
      const parsed = iface.parseTransaction(tx); calls.push({ name: parsed.name, blockTag: tx.blockTag, args: parsed.args });
      const values = {
        identityRegistry: [addresses.registry], owner: [config.expected_owner], authRegistry: [addresses.auth], activeGameId: [state.active], currentGameId: [state.current],
        getDefaultConfig: [defaults],
        getGame: [[...defaults, 1, state.phase === 4 && state.outcome === 2 ? 0 : 1, 1, 1, 0, 100, 200, 100, 150, 1, 0, state.phase, state.outcome, addresses.owner]],
        playerCount: [1], playerAt: [addresses.player],
        getPlayer: [[true, state.outcome !== 2, state.claimed, state.refunded, true, false, addresses.player, H(9), 1, H(10), 0, 0, 0]],
        previewWinnerClaim: [state.outcome === 1 ? 990n : 0n, state.outcome === 1 ? 9n : 0n, state.outcome === 1 ? 981n : 0n, !state.claimed && state.outcome === 1],
        previewRefund: [state.outcome === 3 ? 1000n : 0n, !state.refunded && state.outcome === 3],
        isAdmissionReady: [true], admissionAgentKey: [H(9)], isCauseWhitelisted: [true], canAdvancePhase: [state.ready],
      };
      if (!values[parsed.name]) throw new Error(`Unexpected fixture call: ${parsed.name}`);
      return iface.encodeFunctionResult(parsed.fragment, values[parsed.name]);
    },
    async getTransactionReceipt(hash) { return this.receipts.get(hash) ?? null; },
    async getTransaction(hash) { return this.transactions.get(hash) ?? null; },
    async getTransactionCount() { return this.nonce ?? 0; },
    async broadcastTransaction(raw) {
      const tx = Transaction.from(raw); this.broadcasts.push(tx); this.transactions.set(tx.hash, tx);
      if (this.failBroadcast) throw new Error('AMBIGUOUS_PROVIDER_ERROR_WITH_SECRETS');
      return { hash: tx.hash };
    },
  };
  return { provider, calls, state };
}
function event(name, values, index, blockNumber = 100, transactionHash = H(888)) {
  const encoded = iface.encodeEventLog(iface.getEvent(name), values);
  return { ...encoded, address: addresses.game, blockNumber, blockHash: H(blockNumber), transactionHash, index, removed: false };
}
const temp = async (t) => { const dir = await mkdtemp(path.join(tmpdir(), 'conference-chain-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; };
const isolatedFixtureSigner = (options) => createIsolatedSigner({ ...options, deployment: options.config });
function signerFor(wallet) {
  return { getAddress: () => wallet.getAddress(), populateTransaction: async (tx) => ({ ...tx, nonce: 0, gasLimit: 500000n, gasPrice: 100n, type: 0 }), signTransaction: (tx) => wallet.signTransaction(tx) };
}

test('reader pins all getter calls to a confirmed block and never returns commitment material', async () => {
  const { provider, calls } = fixture();
  const snapshot = await createChainReader({ config, provider }).readSnapshot();
  assert.equal(snapshot.block_number, '100');
  assert.equal(snapshot.phase, 'commit');
  assert.equal(snapshot.clock.deadline, '100');
  assert.equal(snapshot.players[0].committed, true);
  assert.ok(calls.every((call) => call.blockTag === 100));
  assert.equal(JSON.stringify(snapshot).includes(H(10)), false);
  assert.equal(JSON.stringify(snapshot).includes('commitment'), false);
});

test('reader rejects wrong network, missing game and a read-time reorg', async () => {
  const wrong = fixture({ chainId: 8453n });
  await assert.rejects(createChainReader({ config, provider: wrong.provider }).readSnapshot(), /WRONG_CHAIN/);
  const reorg = fixture(); let reads = 0;
  reorg.provider.getBlock = async (number) => ({ number, timestamp: 1000, hash: ++reads === 1 ? H(number) : H(999) });
  await assert.rejects(createChainReader({ config, provider: reorg.provider }).readSnapshot(), /REORG/);
});

test('preflight refreshes admission, balances, owner, auth and cause whitelist', async () => {
  const { provider, calls } = fixture();
  const blockReads = [];
  const originalGetBlock = provider.getBlock;
  provider.getBlock = async number => { blockReads.push(number); return originalGetBlock(number); };
  provider.getFeeData = async () => { throw new Error('ETHERS6_FEE_ESTIMATE_MUST_NOT_BE_USED'); };
  const result = await createChainReader({ config, provider }).preflight();
  assert.equal(result.players[0].admitted, true);
  assert.equal(result.players[0].cause_whitelisted, true);
  assert.equal(result.players[0].balance_wei, '100000000000000000');
  assert.deepEqual(result.player_funding, {
    fee_model: 'pinned-ethers-5', base_fee_per_gas_wei: '5000000', max_fee_per_gas_wei: '1510000000',
    reserve_gas_units: '1000000', minimum_balance_wei: '1610000000000000'
  });
  assert.deepEqual(blockReads, [100, 100]);
  assert.ok(calls.every(call => call.blockTag === 100));
  assert.match(result.code_hash, /^0x[a-f0-9]{64}$/);
});

test('preflight rejects missing base fee and a reorg instead of publishing an unverified funding budget', async () => {
  const missing = fixture();
  missing.provider.getBlock = async number => ({ number, timestamp: 1000, hash: H(number), baseFeePerGas: null });
  await assert.rejects(createChainReader({ config, provider: missing.provider }).preflight(), /PLAYER_FEE_BUDGET_UNAVAILABLE/);
  const reorg = fixture();
  let reads = 0;
  reorg.provider.getBlock = async number => ({ number, timestamp: 1000, baseFeePerGas: 5_000_000n,
    hash: ++reads === 1 ? H(number) : H(999) });
  await assert.rejects(createChainReader({ config, provider: reorg.provider }).preflight(), /CHAIN_REORG_DURING_READ/);
});

test('ten-seat preflight stays within the public RPC read capacity at one canonical block', async () => {
  const { provider, calls } = fixture();
  let concurrent = 0, peak = 0;
  for (const name of ['call', 'getBalance']) {
    const original = provider[name].bind(provider);
    provider[name] = async (...args) => {
      concurrent++; peak = Math.max(peak, concurrent);
      try {
        assert.ok(concurrent <= 4, 'public RPC read capacity exceeded');
        await new Promise(resolve => setTimeout(resolve, 1));
        return await original(...args);
      } finally { concurrent--; }
    };
  }
  const roster = Array.from({ length: 10 }, (_, i) => ({ ...config.roster[0], seat_id: `seat-${i}` }));
  const result = await createChainReader({ config: { ...config, roster }, provider }).preflight();
  assert.equal(result.players.length, 10);
  assert.equal(peak, 4);
  assert.ok(calls.every(call => call.blockTag === 100));
});

test('events include actual defaults/eliminations, net awards and separate net claims; unconfirmed events excluded', async () => {
  const { provider, calls } = fixture({ phase: 4, outcome: 1, active: 0n });
  provider.logs = [
    event('GameCreated', [1, 200, 1000, 3, 3, 2], 0),
    event('EffectiveChoiceMaterialized', [1, 1, addresses.player, 2, false, true], 1),
    event('PlayerEliminated', [1, 1, addresses.player, 2], 2),
    event('RoundResolved', [1, 1, 0, 1, 0, 1, 0, 0], 3),
    event('GameEnded', [1, 1, 1, 1, 0], 4),
    event('PrizeClaimed', [1, addresses.player, 1, 990, 9, 981, addresses.owner], 5),
    event('GameCancelled', [2], 6, 101),
  ];
  const events = await createChainReader({ config, provider }).readEvents({ fromBlock: '10', toBlock: '500' });
  assert.deepEqual(events.map((entry) => entry.kind), ['created', 'round-resolved', 'completed', 'claimed']);
  assert.deepEqual(events[1].data.choices, [{ wallet_address: addresses.player, choice: 'Catch', defaulted: true, eliminated: true }]);
  assert.deepEqual(events[2].data.awards, [{ wallet_address: addresses.player, award_wei: '981' }]);
  assert.equal(events[3].data.amount_wei, '981');
  assert.ok(calls.filter((entry) => entry.name === 'getGame').every((entry) => entry.blockTag === 100));
});

test('completed event retains zero awards so scoreboard can verify every player', async () => {
  const { provider } = fixture({ phase: 4, outcome: 2, active: 0n });
  provider.logs = [event('GameEnded', [1, 1, 2, 0, 0], 0)];
  const events = await createChainReader({ config, provider }).readEvents({ fromBlock: '10', toBlock: '100' });
  assert.deepEqual(events[0].data.awards, [{ wallet_address: addresses.player, award_wei: '0' }]);
});

test('delayed preparation catches up through an RPC with a 100-block log limit without losing boundary events', async () => {
  const { provider, calls } = fixture();
  provider.getBlockNumber = async () => 1002;
  const blocks = [1, 100, 101, 200, 201, 1000, 1001, 1002];
  provider.logs = blocks.map((block, index) => event('GameCreated', [index + 1, 200, 1000, 3, 3, 2], index, block));
  const getLogs = provider.getLogs.bind(provider);
  provider.getLogs = async filter => {
    if (filter.toBlock - filter.fromBlock + 1 > 100) {
      throw Object.assign(new Error('SECRET_PROVIDER_ERROR'), { code: 'SERVER_ERROR', response: { statusCode: 413 } });
    }
    return getLogs(filter);
  };
  const events = await createChainReader({ config, provider }).readEvents({ fromBlock: '1', toBlock: '5000' });
  assert.deepEqual(events.map(entry => entry.block_number), blocks.slice(0, -1).map(String));
  assert.equal(new Set(events.map(entry => entry.id)).size, events.length);
  const ranges = calls.filter(call => call.filter).map(call => call.filter);
  assert.equal(ranges[0].fromBlock, 1);
  assert.equal(ranges.at(-1).toBlock, 1001);
  for (let index = 1; index < ranges.length; index++) assert.equal(ranges[index].fromBlock, ranges[index - 1].toBlock + 1);
});

test('RPC request-size rejection has a fixed safe reason without retaining provider prose', () => {
  const error = Object.assign(new Error('SECRET_PROVIDER_URL'), { code: 'SERVER_ERROR', response: { statusCode: 413 } });
  assert.equal(chainFailureCode(error), 'RPC_REQUEST_TOO_LARGE');
  const diagnostic = safeChainDiagnostic({ stage: 'readEvents', code: chainFailureCode(error), elapsed_ms: 185, message: error.message });
  assert.deepEqual(diagnostic, { stage: 'readEvents', code: 'RPC_REQUEST_TOO_LARGE', elapsed_ms: 185 });
  assert.equal(JSON.stringify(diagnostic).includes('SECRET_'), false);
});

test('cancelled game refunds remain separate from player awards', async () => {
  const { provider } = fixture({ phase: 5, outcome: 3, active: 0n, refunded: true });
  const snapshot = await createChainReader({ config, provider }).readSnapshot();
  assert.equal(snapshot.outcome, 'cancelled');
  assert.equal(snapshot.players[0].award_wei, '0');
  assert.equal(snapshot.players[0].refunded_wei, '1000');
});

test('launcher persists deterministic hash before broadcast; ambiguous response reconciles across restart without resending', async (t) => {
  const directory = await temp(t); const wallet = Wallet.createRandom();
  const local = { ...config, expected_owner: wallet.address };
  const { provider } = fixture({ active: 0n, current: 0n });
  const originalCall = provider.call;
  provider.call = async (tx) => iface.parseTransaction(tx).name === 'owner' ? iface.encodeFunctionResult('owner', [wallet.address]) : originalCall(tx);
  provider.failBroadcast = true;
  const originalBroadcast = provider.broadcastTransaction;
  provider.broadcastTransaction = async function(raw) {
    const saved = JSON.parse(await readFile(path.join(directory, 'transactions.json'), 'utf8'));
    const record = Object.values(saved.records)[0];
    assert.equal(record.hash, Transaction.from(raw).hash);
    assert.equal(record.nonce, 0);
    return originalBroadcast.call(this, raw);
  };
  let service = await isolatedFixtureSigner({ role: 'launcher', config: local, provider, signer: signerFor(wallet), directory });
  const intent = { action_id: 'launch:one', source_block_number: '100' };
  const response = await service.create(intent);
  assert.equal(response.status, 'race-or-revert');
  assert.equal(provider.broadcasts.length, 1);
  assert.equal(iface.parseTransaction(provider.broadcasts[0]).name, 'createGame');
  await service.close();
  service = await isolatedFixtureSigner({ role: 'launcher', config: local, provider, signer: signerFor(wallet), directory });
  t.after(() => service.close());
  assert.equal((await service.create(intent)).status, 'accepted');
  assert.equal((await service.create({ action_id: 'launch:different', source_block_number: '101' })).status, 'rejected-before-submit');
  assert.equal(provider.broadcasts.length, 1);
  const saved = await readFile(path.join(directory, 'transactions.json'), 'utf8');
  assert.equal(saved.includes(wallet.privateKey), false);
  assert.equal(saved.includes('AMBIGUOUS_PROVIDER_ERROR'), false);
});

test('signer checks selected owner, active game and role/player isolation before sending', async (t) => {
  const directory = await temp(t); const wallet = Wallet.createRandom();
  const { provider } = fixture();
  await assert.rejects(isolatedFixtureSigner({ role: 'launcher', config, provider, signer: signerFor(wallet), directory }), /OWNER_SIGNER_REQUIRED/);
  await assert.rejects(isolatedFixtureSigner({ role: 'phase-executor', config: { ...config, expected_owner: wallet.address }, provider, signer: signerFor(wallet), directory }), /SEPARATE_PHASE_SIGNER/);
  await assert.rejects(isolatedFixtureSigner({ role: 'phase-executor', config: { ...config, roster: [{ wallet_address: wallet.address }] }, provider, signer: signerFor(wallet), directory }), /PLAYER_SIGNER/);
});

function intentFor({ phase = 'commit', round = 1, block = '100' } = {}) {
  const fingerprint = (obj) => createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b))))).digest('hex');
  const action_id = `advance:${fingerprint({ game_id: '1', phase, round })}`;
  return { schema_version: 1, type: 'advance-request', action_id, attempt_id: `${action_id}:${fingerprint({ block_number: block, block_hash: H(Number(block)) })}`, game_id: '1', round, phase, source_block_number: block, source_block_hash: H(Number(block)), source_predicate_token: 'a'.repeat(64), reason: 'all-alive-committed' };
}

test('phase executor refuses ineligible/stale rounds, accepts exact core intent and signs only advancePhase', async (t) => {
  const directory = await temp(t); const wallet = Wallet.createRandom();
  const { provider, state } = fixture();
  const service = await isolatedFixtureSigner({ role: 'phase-executor', config, provider, signer: signerFor(wallet), directory });
  t.after(() => service.close());
  assert.equal((await service.advance(intentFor())).status, 'rejected-before-submit');
  assert.equal(provider.broadcasts.length, 0);
  state.ready = true;
  assert.equal((await service.advance(intentFor({ block: '101' }))).status, 'accepted');
  assert.equal(provider.broadcasts.length, 1);
  assert.equal(iface.parseTransaction(provider.broadcasts[0]).name, 'advancePhase');
  assert.throws(() => service.create({ action_id: 'no', source_block_number: '100' }), /ROLE_OPERATION_FORBIDDEN/);
});

test('operator configuration requires every field, preserves fees, and only signs complete defaults while idle', async (t) => {
  const directory = await temp(t); const wallet = Wallet.createRandom();
  const local = { ...config, expected_owner: wallet.address };
  const { provider, state } = fixture({ active: 0n, current: 0n });
  const originalCall = provider.call;
  provider.call = async (tx) => iface.parseTransaction(tx).name === 'owner' ? iface.encodeFunctionResult('owner', [wallet.address]) : originalCall(tx);
  const service = await isolatedFixtureSigner({ role: 'operator', config: local, provider, signer: signerFor(wallet), directory });
  t.after(() => service.close());
  const selected = Object.fromEntries(CONFIG_FIELDS.map((key, index) => [key, String(defaults[index])]));
  assert.equal((await service.configureDefaults({ action_id: 'configure:missing', source_block_number: '100', defaults: { entryFeeWei: '1' } })).status, 'rejected-before-submit');
  assert.equal((await service.configureDefaults({ action_id: 'configure:fees', source_block_number: '100', defaults: { ...selected, creatorFeeBps: '101' } })).status, 'rejected-before-submit');
  state.active = 1n;
  assert.equal((await service.configureDefaults({ action_id: 'configure:active', source_block_number: '100', defaults: selected })).status, 'rejected-before-submit');
  state.active = 0n;
  assert.equal((await service.configureDefaults({ action_id: 'configure:valid', source_block_number: '100', defaults: selected })).status, 'accepted');
  assert.equal(provider.broadcasts.length, 1);
  const decoded = iface.parseTransaction(provider.broadcasts[0]);
  assert.equal(decoded.name, 'configureDefaults');
  assert.deepEqual(Array.from(decoded.args[0]).map(String), defaults.map(String));
});

test('only a confirmed revert permits a fresh-block transaction retry; an unresolved hash never does', async (t) => {
  const directory = await temp(t); const wallet = Wallet.createRandom();
  const local = { ...config, expected_owner: wallet.address };
  const { provider } = fixture({ active: 0n, current: 0n });
  const originalCall = provider.call;
  provider.call = async (tx) => iface.parseTransaction(tx).name === 'owner' ? iface.encodeFunctionResult('owner', [wallet.address]) : originalCall(tx);
  let nonce = 0;
  const signer = signerFor(wallet);
  signer.populateTransaction = async (tx) => ({ ...tx, nonce: nonce++, gasLimit: 500000n, gasPrice: 100n, type: 0 });
  const service = await isolatedFixtureSigner({ role: 'launcher', config: local, provider, signer, directory });
  t.after(() => service.close());
  const intent = { action_id: 'launch:retry', source_block_number: '99' };
  const first = await service.create(intent);
  assert.equal(first.status, 'accepted');
  provider.transactions.clear(); // A missing mempool entry does not prove rejection.
  assert.equal((await service.create({ ...intent, source_block_number: '100' })).status, 'race-or-revert');
  assert.equal(provider.broadcasts.length, 1);
  provider.receipts.set(first.reference.value, { status: 0, blockNumber: 100, blockHash: H(100) });
  provider.nonce = 1;
  assert.equal((await service.create(intent)).status, 'confirmed-revert');
  assert.equal(provider.broadcasts.length, 1);
  assert.equal((await service.create({ ...intent, source_block_number: '101' })).status, 'accepted');
  assert.equal(provider.broadcasts.length, 2);
});

test('signer clients redact failures and refuse plaintext remote endpoints', async () => {
  assert.throws(() => createLauncherClient({ url: 'http://example.com', token: 'a'.repeat(24) }), /HTTPS/);
  const client = createPhaseExecutorClient({ url: 'http://localhost:8792', token: 'a'.repeat(24), fetchImpl: async () => { throw new Error('secret'); } });
  const outcome = await client.advance(intentFor());
  assert.equal(outcome.status, 'race-or-revert');
  assert.equal(outcome.diagnostic.code, 'OPERATION_FAILED');
  assert.deepEqual(Object.keys(outcome.diagnostic).sort(), ['code', 'elapsed_ms', 'stage']);
  assert.equal(JSON.stringify(outcome).includes('secret'), false);
});

test('signer defaults enforce the pinned deployment and reject cross-role signing environments', () => {
  assert.doesNotThrow(() => assertSignerDeployment(PINNED_DEPLOYMENT));
  assert.throws(() => assertSignerDeployment({ ...PINNED_DEPLOYMENT, game_address: addresses.game }), /PINNED_DEPLOYMENT/);
  assert.throws(() => assertSignerDeployment({ ...PINNED_DEPLOYMENT, chain_id: 8453 }), /BASE_SEPOLIA/);
  assert.equal(assertSignerEnvironment('launcher', { DILEMMA_LAUNCHER_PRIVATE_KEY: 'fixture' }), 'DILEMMA_LAUNCHER_PRIVATE_KEY');
  assert.equal(assertSignerEnvironment('operator', { DILEMMA_LAUNCHER_PRIVATE_KEY: 'fixture' }), 'DILEMMA_LAUNCHER_PRIVATE_KEY');
  assert.throws(() => assertSignerEnvironment('operator', { DILEMMA_LAUNCHER_PRIVATE_KEY: 'fixture', DILEMMA_PHASE_PRIVATE_KEY: 'fixture' }), /CROSS_ROLE/);
  assert.throws(() => assertSignerEnvironment('launcher', { DILEMMA_LAUNCHER_PRIVATE_KEY: 'fixture', GAMEPLAY_WALLET_PRIVATE_KEY: 'fixture' }), /CROSS_ROLE/);
  assert.throws(() => assertSignerEnvironment('phase-executor', { DILEMMA_LAUNCHER_PRIVATE_KEY: 'fixture' }), /CROSS_ROLE/);
  assert.throws(() => assertSignerEnvironment('read-only', { DILEMMA_PHASE_PRIVATE_KEY: 'fixture' }), /CROSS_ROLE/);
});

test('signer private directory rejects symlinks into the repository before creating descendants', async (t) => {
  const directory = await temp(t);
  const target = fileURLToPath(new URL('.', import.meta.url));
  const link = path.join(directory, 'checkout-link');
  await symlink(target, link);
  await assert.rejects(prepareSignerDirectory(link), /OUTSIDE_REPOSITORY/);
  const leaf = `must-not-create-${process.pid}`;
  await assert.rejects(prepareSignerDirectory(path.join(link, leaf)), /OUTSIDE_REPOSITORY/);
  await assert.rejects(stat(path.join(target, leaf)), { code: 'ENOENT' });
});

test('canonical block hash lookup verifies the actual RPC chain, not a cached network', async () => {
  const { provider } = fixture();
  const reader = createChainReader({ config, provider });
  assert.equal(await reader.readBlockHash({ blockNumber: '100' }), H(100));
  provider.rpcChainId = 8453n;
  await assert.rejects(reader.readBlockHash({ blockNumber: '100' }), /WRONG_CHAIN/);
});

test('RPC chain drift after preparation prevents broadcast and keeps the prepared hash uncertain', async (t) => {
  const directory = await temp(t); const wallet = Wallet.createRandom();
  const { provider, state } = fixture(); state.ready = true;
  let verifications = 0;
  provider.send = async () => ++verifications === 1 ? '0x14a34' : '0x2105';
  const service = await isolatedFixtureSigner({ role: 'phase-executor', config, provider, signer: signerFor(wallet), directory });
  t.after(() => service.close());
  const response = await service.advance(intentFor());
  assert.equal(verifications, 2);
  assert.equal(response.status, 'race-or-revert');
  assert.match(response.reference.value, /^0x[0-9a-f]{64}$/);
  assert.equal(provider.broadcasts.length, 0);
});

test('untracked pending signer nonce prevents a second writer from submitting', async (t) => {
  const directory = await temp(t); const wallet = Wallet.createRandom();
  const { provider, state } = fixture(); state.ready = true;
  provider.getTransactionCount = async (_wallet, blockTag) => blockTag === 'pending' ? 1 : 0;
  const service = await isolatedFixtureSigner({ role: 'phase-executor', config, provider, signer: signerFor(wallet), directory });
  t.after(() => service.close());
  const outcome = await service.advance(intentFor());
  assert.equal(outcome.status, 'rejected-before-submit');
  assert.equal(outcome.diagnostic.code, 'UNTRACKED_PENDING_SIGNER_NONCE');
  assert.equal(provider.broadcasts.length, 0);
});

test('role HTTP server exposes only its assigned operation and requires authentication', async (t) => {
  let invoked = 0;
  const server = createSignerServer({ role: 'launcher', token: 'a'.repeat(24), service: { create: async () => { invoked++; return { status: 'accepted' }; } } });
  const request = (url, options) => new Promise((resolve) => {
    const stream = Readable.from([options.body]);
    Object.assign(stream, { method: options.method, url: new URL(url, 'http://localhost').pathname, headers: options.headers ?? {} });
    let status = 200;
    const response = { writeHead(value) { status = value; return this; }, end(body) { resolve({ status, ok: status >= 200 && status < 300, json: async () => JSON.parse(body) }); } };
    server.emit('request', stream, response);
  });
  assert.equal((await request('/create', { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await request('/advance', { method: 'POST', headers: { authorization: `Bearer ${'a'.repeat(24)}` }, body: '{}' })).status, 404);
  const client = createLauncherClient({ url: 'http://localhost:8791', token: 'a'.repeat(24), fetchImpl: request });
  assert.equal((await client.create({ action_id: 'launch:test', source_block_number: '100' })).status, 'accepted');
  assert.equal(invoked, 1);
});

async function operatorFixture(t) {
  const directory = await temp(t);
  const wallet = Wallet.createRandom();
  const local = { ...config, expected_owner: wallet.address };
  const { provider, state } = fixture({ active: 0n, current: 0n });
  const originalCall = provider.call;
  provider.call = async (tx) => iface.parseTransaction(tx).name === 'owner' ? iface.encodeFunctionResult('owner', [wallet.address]) : originalCall(tx);
  const signer = signerFor(wallet);
  signer.populateTransaction = async (tx) => ({ ...tx, nonce: provider.nonce ?? 0, gasLimit: 500000n, gasPrice: 100n, type: 0 });
  const options = { role: 'operator', config: local, provider, signer, directory };
  const service = await isolatedFixtureSigner(options);
  t.after(() => service.close());
  return { directory, wallet, config: local, provider, state, service, options };
}

test('one operator owner creates and advances with one journal, queue and distinct nonces across restart', async (t) => {
  const { directory, provider, state, service, options } = await operatorFixture(t);
  const created = await service.create({ action_id: 'launch:operator', source_block_number: '100' });
  assert.equal(created.status, 'accepted');
  provider.receipts.set(created.reference.value, { status: 1, blockNumber: 100, blockHash: H(100) });
  provider.nonce = 1;
  state.active = 1n; state.current = 1n; state.ready = true;
  const [advanced, duplicate] = await Promise.all([service.advance(intentFor()), service.advance(intentFor())]);
  assert.equal(advanced.status, 'accepted');
  assert.deepEqual(duplicate, advanced);
  assert.deepEqual(provider.broadcasts.map((tx) => iface.parseTransaction(tx).name), ['createGame', 'advancePhase']);
  assert.deepEqual(provider.broadcasts.map((tx) => tx.nonce), [0, 1]);
  assert.equal(new Set(provider.broadcasts.map((tx) => tx.from)).size, 1);
  const journal = JSON.parse(await readFile(path.join(directory, 'transactions.json'), 'utf8'));
  assert.equal(journal.role, 'operator');
  assert.deepEqual(Object.values(journal.records).map((record) => record.operation).sort(), ['advance', 'create']);
  await service.close();
  const resumed = await isolatedFixtureSigner(options);
  t.after(() => resumed.close());
  assert.deepEqual(await resumed.advance(intentFor()), advanced);
  assert.equal(provider.broadcasts.length, 2);
});

test('operator rejects a nonowner or player key before accessing the signer journal', async (t) => {
  const directory = await temp(t);
  const wallet = Wallet.createRandom();
  const { provider } = fixture();
  await assert.rejects(isolatedFixtureSigner({ role: 'operator', config, provider, signer: signerFor(wallet), directory }), /OWNER_SIGNER_REQUIRED/);
  await assert.rejects(isolatedFixtureSigner({ role: 'operator', config: { ...config, expected_owner: wallet.address, roster: [{ wallet_address: wallet.address }] }, provider, signer: signerFor(wallet), directory }), /PLAYER_SIGNER_FORBIDDEN/);
  await assert.rejects(stat(path.join(directory, 'transactions.json')), { code: 'ENOENT' });
});

test('uncertain operator creation blocks advancement through the shared nonce journal, including after restart', async (t) => {
  const { provider, state, service, options } = await operatorFixture(t);
  provider.failBroadcast = true;
  assert.equal((await service.create({ action_id: 'launch:uncertain', source_block_number: '100' })).status, 'race-or-revert');
  provider.transactions.clear();
  state.active = 1n; state.current = 1n; state.ready = true;
  const blocked = await service.advance(intentFor());
  assert.equal(blocked.status, 'rejected-before-submit');
  assert.equal(blocked.diagnostic.code, 'SIGNER_UNRESOLVED_OPERATION');
  await service.close();
  const resumed = await isolatedFixtureSigner(options);
  t.after(() => resumed.close());
  assert.equal((await resumed.advance(intentFor())).status, 'rejected-before-submit');
  assert.equal(provider.broadcasts.length, 1);
});

test('operator action IDs cannot be replayed across operations or bypass exact advance intent validation', async (t) => {
  const { provider, state, service } = await operatorFixture(t);
  const advance = intentFor();
  const created = await service.create({ action_id: advance.action_id, source_block_number: '100' });
  assert.equal(created.status, 'accepted');
  provider.receipts.set(created.reference.value, { status: 1, blockNumber: 100, blockHash: H(100) });
  provider.nonce = 1; state.active = 1n; state.current = 1n; state.ready = true;
  assert.deepEqual(await service.advance(advance), { status: 'rejected-before-submit' });
  await assert.rejects(service.advance({ action_id: advance.action_id, source_block_number: '100' }), /INVALID_SIGNER_REQUEST/);
  await assert.rejects(service.create(advance), /INVALID_SIGNER_REQUEST/);
  assert.equal(provider.broadcasts.length, 1);
});

test('operator HTTP authenticates both exact routes and never exposes configuration', async () => {
  const invoked = [];
  const server = createSignerServer({ role: 'operator', token: 'a'.repeat(24), service: {
    create: async () => { invoked.push('create'); return { status: 'accepted' }; },
    advance: async () => { invoked.push('advance'); return { status: 'accepted' }; },
  } });
  const request = (url, options) => new Promise((resolve) => {
    const stream = Readable.from([options.body]);
    Object.assign(stream, { method: options.method, url: new URL(url, 'http://localhost').pathname, headers: options.headers ?? {} });
    let status = 200;
    const response = { writeHead(value) { status = value; return this; }, end(body) { resolve({ status, ok: status >= 200 && status < 300, json: async () => JSON.parse(body) }); } };
    server.emit('request', stream, response);
  });
  for (const route of ['/create', '/advance']) assert.equal((await request(route, { method: 'POST', body: '{}' })).status, 401);
  for (const route of ['/configure-defaults', '/configureDefaults', '/advance/']) assert.equal((await request(route, { method: 'POST', headers: { authorization: `Bearer ${'a'.repeat(24)}` }, body: '{}' })).status, 404);
  const options = { url: 'http://localhost:8791', token: 'a'.repeat(24), fetchImpl: request };
  assert.equal((await createLauncherClient(options).create({ action_id: 'launch:test', source_block_number: '100' })).status, 'accepted');
  assert.equal((await createPhaseExecutorClient(options).advance(intentFor())).status, 'accepted');
  assert.deepEqual(invoked, ['create', 'advance']);
});
