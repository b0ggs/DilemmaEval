import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Interface, keccak256 } from 'ethers';
import { GAME_ABI } from '../../src/chain/abi.mjs';
import { PINNED_DEPLOYMENT } from '../../src/chain/guards.mjs';
import { createIsolatedSigner } from '../../src/chain/signer.mjs';
import { createLauncherClient, createPhaseExecutorClient, createSignerServer } from '../../src/chain/transport.mjs';

const abi = new Interface([...GAME_ABI, 'function identityRegistry() view returns(address)']);
const hash = value => `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const defaults = ['100000000000000', 100, 100, 60, 60, 40, 3, 3, 2];
const digest = value => createHash('sha256').update(JSON.stringify(typeof value === 'object' ?
  Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value)).digest('hex');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function advanceIntent(notAfter = 2000) {
  const action_id = `advance:${digest({ game_id: '1', phase: 'commit', round: 1 })}`;
  return { schema_version: 1, type: 'advance-request', action_id,
    attempt_id: `${action_id}:${digest({ block_number: '100', block_hash: hash(100) })}`,
    game_id: '1', round: 1, phase: 'commit', source_block_number: '100', source_block_hash: hash(100),
    source_predicate_token: 'a'.repeat(64), reason: 'all-alive-committed', not_after_ms: notAfter };
}

async function fixture(t, { active = false } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'signer-deadline-fixture-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const player = `0x${'1'.repeat(40)}`;
  const config = { ...PINNED_DEPLOYMENT, confirmations: 2, start_block: '10',
    roster: [{ seat_id: 'oc-1', wallet_address: player, cause_id: 1 }] };
  const counts = { sign: 0, broadcast: 0, populate: 0, rpc: 0, preflight: 0 };
  let time = 1000;
  const provider = {
    receipts: new Map(), transactions: new Map(),
    getNetwork: async () => ({ chainId: 84532n }),
    send: async () => { counts.rpc++; return '0x14a34'; },
    getBlockNumber: async () => { counts.preflight++; return 101; },
    getBlock: async number => ({ number, hash: hash(number), timestamp: 1000, baseFeePerGas: 5000000n }),
    getCode: async () => '0x1234', getBalance: async () => 10n ** 17n,
    call: async transaction => {
      const { name, fragment } = abi.parseTransaction(transaction);
      const values = {
        owner: [config.expected_owner], authRegistry: [config.auth_adapter_address], identityRegistry: [config.identity_registry_address],
        activeGameId: [active ? 1 : 0], currentGameId: [active ? 1 : 0], getDefaultConfig: [defaults],
        isAdmissionReady: [true], admissionAgentKey: [hash(9)], isCauseWhitelisted: [true], canAdvancePhase: [true],
        getGame: [[...defaults, 1, 1, 1, 1, 0, 100, 200, 100, 150, 1, 0, 2, 0, config.expected_owner]],
        playerCount: [1], playerAt: [player],
        getPlayer: [[true, true, false, false, true, false, player, hash(9), 1, hash(10), 0, 0, 0]],
        previewWinnerClaim: [0, 0, 0, false], previewRefund: [0, false]
      };
      assert.ok(values[name], name);
      return abi.encodeFunctionResult(fragment, values[name]);
    },
    getTransactionCount: async () => 0,
    getTransactionReceipt: async value => provider.receipts.get(value) ?? null,
    getTransaction: async value => provider.transactions.get(value) ?? null,
    broadcastTransaction: async raw => {
      counts.broadcast++; const value = keccak256(raw); provider.transactions.set(value, { hash: value }); return { hash: value };
    }
  };
  // This stub does not possess a key and cannot produce an Ethereum transaction.
  const signer = { getAddress: async () => config.expected_owner,
    populateTransaction: async transaction => { counts.populate++; return { ...transaction, nonce: 0, gasLimit: 100000n, gasPrice: 1n, type: 0 }; },
    signTransaction: async () => { counts.sign++; return '0x1234'; } };
  const service = await createIsolatedSigner({ role: 'operator', config, provider, signer, directory, now: () => time });
  t.after(() => service.close());
  const journal = async () => JSON.parse(await readFile(path.join(directory, 'transactions.json'), 'utf8'));
  return { directory, config, provider, signer, counts, service, journal, setTime: value => { time = value; } };
}

test('owner failure records the nonce check without signing or exposing provider text', async t => {
  const f = await fixture(t);
  f.provider.getTransactionCount = async (_address, block) => block === 'pending' ? 1 : 0;
  const outcome = await f.service.create({ action_id: 'create:logging-nonce', source_block_number: '100', not_after_ms: 2000 });
  assert.equal(outcome.status, 'rejected-before-submit');
  assert.equal(outcome.diagnostic.stage, 'nonce_check');
  assert.equal(outcome.diagnostic.code, 'UNTRACKED_PENDING_SIGNER_NONCE');
  assert.equal(f.counts.sign, 0); assert.equal(f.counts.broadcast, 0);
  assert.deepEqual(Object.values((await f.journal()).records)[0].diagnostic, outcome.diagnostic);
});

test('owner RPC timeout retains a fixed cause and broadcast uncertainty, with no resend', async t => {
  const f = await fixture(t);
  f.provider.broadcastTransaction = async () => {
    f.counts.broadcast++; throw Object.assign(new Error('SECRET_PROVIDER_URL'), { code: 'TIMEOUT' });
  };
  const intent = { action_id: 'create:logging-timeout', source_block_number: '100', not_after_ms: 2000 };
  const outcome = await f.service.create(intent);
  assert.equal(outcome.status, 'race-or-revert');
  assert.equal(outcome.diagnostic.stage, 'broadcast'); assert.equal(outcome.diagnostic.code, 'RPC_TIMEOUT');
  assert.equal(f.counts.sign, 1); assert.equal(f.counts.broadcast, 1);
  await f.service.create(intent);
  assert.equal(f.counts.sign, 1); assert.equal(f.counts.broadcast, 1);
  assert.equal(JSON.stringify(await f.journal()).includes('SECRET_'), false);
});

test('bounded create and phase requests work before expiry without changing semantic action identity', async t => {
  const creation = await fixture(t);
  const intent = { action_id: 'create:bounded', source_block_number: '100', not_after_ms: 2000 };
  assert.equal((await creation.service.create(intent)).status, 'accepted');
  assert.equal(creation.counts.sign, 1); assert.equal(creation.counts.broadcast, 1);
  assert.equal(Object.values((await creation.journal()).records)[0].intent.not_after_ms, 2000);
  const phase = await fixture(t, { active: true });
  const advance = advanceIntent();
  assert.equal((await phase.service.advance(advance)).status, 'accepted');
  assert.equal(phase.counts.sign, 1); assert.equal(phase.counts.broadcast, 1);
  assert.equal(Object.values((await phase.journal()).records)[0].intent.action_id, advance.action_id);
});

test('expiry before queue execution, after preflight, nonce reads, population or final chain check prevents signing', async t => {
  const stages = ['queue', 'preflight', 'nonce', 'populate', 'pre-sign'];
  for (const stage of stages) {
    const f = await fixture(t);
    if (stage === 'queue') f.setTime(2000);
    if (stage === 'preflight') { const original = f.provider.getBlockNumber; f.provider.getBlockNumber = async () => { f.setTime(2000); return original(); }; }
    if (stage === 'nonce') f.provider.getTransactionCount = async () => { f.setTime(2000); return 0; };
    if (stage === 'populate') { const original = f.signer.populateTransaction; f.signer.populateTransaction = async args => { f.setTime(2000); return original(args); }; }
    if (stage === 'pre-sign') { const original = f.provider.send; f.provider.send = async () => { f.setTime(2000); return original(); }; }
    const response = await f.service.create({ action_id: `create:${stage}`, source_block_number: '100', not_after_ms: 2000 });
    assert.equal(response.status, 'rejected-before-submit', stage);
    assert.equal(f.counts.sign, 0, stage); assert.equal(f.counts.broadcast, 0, stage);
  }
});

test('late signing or pre-broadcast expiry preserves its hash as uncertain and never broadcasts or retries', async t => {
  for (const stage of ['sign', 'pre-broadcast']) {
    const f = await fixture(t);
    if (stage === 'sign') { const original = f.signer.signTransaction; f.signer.signTransaction = async () => { f.setTime(2000); return original(); }; }
    else { const original = f.provider.send; f.provider.send = async () => { if (f.counts.rpc === 1) f.setTime(2000); return original(); }; }
    const intent = { action_id: `create:${stage}`, source_block_number: '100', not_after_ms: 2000 };
    const response = await f.service.create(intent);
    assert.equal(response.status, 'race-or-revert'); assert.equal(response.reference.value, keccak256('0x1234'));
    assert.equal(f.counts.sign, 1); assert.equal(f.counts.broadcast, 0);
    const saved = Object.values((await f.journal()).records)[0];
    assert.equal(saved.stage, 'uncertain'); assert.equal(saved.hash, response.reference.value);
    assert.equal((await f.service.create({ ...intent, source_block_number: '101', not_after_ms: 9999 })).status, 'race-or-revert');
    assert.equal(f.counts.sign, 1); assert.equal(f.counts.broadcast, 0);
  }
});

test('queued intents are captured before caller mutation and cannot extend their original deadline on replay', async t => {
  const f = await fixture(t); const entered = deferred(), release = deferred();
  const original = f.provider.getBlockNumber; let held = false;
  f.provider.getBlockNumber = async () => { if (!held) { held = true; entered.resolve(); await release.promise; } return original(); };
  const first = f.service.create({ action_id: 'create:first', source_block_number: '100', not_after_ms: 3000 });
  await entered.promise;
  const intent = { action_id: 'create:queued', source_block_number: '100', not_after_ms: 1500 };
  const queued = f.service.create(intent);
  intent.not_after_ms = 9999; intent.action_id = 'changed-caller-id';
  f.setTime(2000); release.resolve();
  assert.equal((await first).status, 'accepted'); assert.equal((await queued).status, 'rejected-before-submit');
  assert.equal(f.counts.sign, 1); assert.equal(f.counts.broadcast, 1);
  const saved = Object.values((await f.journal()).records).find(record => record.intent.action_id === 'create:queued');
  assert.equal(saved.intent.not_after_ms, 1500);
  const replay = { action_id: 'create:queued', source_block_number: '101', not_after_ms: 9999 };
  assert.equal((await f.service.create(replay)).status, 'rejected-before-submit');
  delete replay.not_after_ms;
  assert.equal((await f.service.create(replay)).status, 'rejected-before-submit');
  assert.equal(f.counts.sign, 1);
});

test('phase hard stop and AbortSignal are checked again after asynchronous provider work', async t => {
  for (const mode of ['expiry', 'abort']) {
    const f = await fixture(t, { active: true }); const controller = new AbortController();
    const original = f.signer.populateTransaction;
    f.signer.populateTransaction = async args => { if (mode === 'expiry') f.setTime(2000); else controller.abort(); return original(args); };
    assert.equal((await f.service.advance(advanceIntent(), { signal: controller.signal })).status, 'rejected-before-submit');
    assert.equal(f.counts.sign, 0); assert.equal(f.counts.broadcast, 0);
  }
});

test('expiry while reconciling an earlier transaction stays durably bound against a later replay', async t => {
  const f = await fixture(t);
  const first = await f.service.create({ action_id: 'create:earlier', source_block_number: '100', not_after_ms: 5000 });
  f.provider.getTransactionReceipt = async value => {
    assert.equal(value, first.reference.value); f.setTime(2000);
    return { status: 1, blockNumber: 100, blockHash: hash(100) };
  };
  const next = { action_id: 'create:after-reconciliation', source_block_number: '100', not_after_ms: 2000 };
  assert.equal((await f.service.create(next)).status, 'rejected-before-submit');
  assert.equal(f.counts.sign, 1); assert.equal(f.counts.broadcast, 1);
  assert.equal((await f.service.create({ ...next, source_block_number: '101', not_after_ms: 9000 })).status, 'rejected-before-submit');
  const saved = Object.values((await f.journal()).records).find(record => record.intent.action_id === next.action_id);
  assert.equal(saved.intent.not_after_ms, 2000);
  assert.equal(f.counts.sign, 1); assert.equal(f.counts.broadcast, 1);
});

test('a started uncertain broadcast is retained and never resubmitted with a later deadline', async t => {
  const f = await fixture(t);
  f.provider.broadcastTransaction = async () => { f.counts.broadcast++; throw new Error('private provider error'); };
  const intent = { action_id: 'create:unknown', source_block_number: '100', not_after_ms: 2000 };
  const response = await f.service.create(intent);
  assert.equal(response.status, 'race-or-revert');
  assert.equal((await f.service.create({ ...intent, source_block_number: '101', not_after_ms: 9000 })).status, 'race-or-revert');
  assert.equal(f.counts.broadcast, 1); assert.equal(f.counts.sign, 1);
  assert.ok(!JSON.stringify(await f.journal()).includes('private provider error'));
});

test('clients cap bounded wire requests to their HTTP window and never extend shorter caller deadlines', async () => {
  for (const operation of ['create', 'advance']) for (const offset of [5000, 60000]) {
    let captured;
    const client = (operation === 'create' ? createLauncherClient : createPhaseExecutorClient)({
      url: 'http://127.0.0.1:8791', token: 'fixture-token-that-is-not-a-secret', fetchImpl: async (_url, options) => {
        captured = JSON.parse(options.body); return { ok: true, json: async () => ({ status: 'accepted' }) };
      } });
    const before = Date.now(); const deadline = before + offset;
    const intent = { ...(operation === 'create' ? { action_id: 'create:transport', source_block_number: '100' } : advanceIntent()), not_after_ms: deadline };
    assert.equal((await client[operation](intent)).status, 'accepted');
    assert.equal(captured.action_id, intent.action_id);
    assert.ok(captured.not_after_ms <= deadline && captured.not_after_ms <= Date.now() + 20000);
    assert.ok(captured.not_after_ms >= before + Math.min(offset, 20000));
    assert.equal(intent.not_after_ms, deadline);
  }
  let called = false;
  const client = createLauncherClient({ url: 'http://127.0.0.1:8791', token: 'fixture-token-that-is-not-a-secret',
    fetchImpl: async () => { called = true; throw new Error('must not call'); } });
  assert.deepEqual(await client.create({ action_id: 'create:expired', source_block_number: '100', not_after_ms: Date.now() - 1 }), { status: 'rejected-before-submit' });
  assert.equal(called, false);
});

test('preaborted caller signals reject before opening either signer HTTP operation', async () => {
  const controller = new AbortController(); controller.abort();
  for (const operation of ['create', 'advance']) {
    let called = false;
    const client = (operation === 'create' ? createLauncherClient : createPhaseExecutorClient)({
      url: 'http://127.0.0.1:8791', token: 'fixture-token-that-is-not-a-secret',
      fetchImpl: async () => { called = true; throw new Error('must not call'); } });
    const intent = operation === 'create' ? { action_id: 'create:preaborted', source_block_number: '100' } : advanceIntent(Date.now() + 10000);
    assert.deepEqual(await client[operation](intent, { signal: controller.signal }), { status: 'rejected-before-submit' });
    assert.equal(called, false);
  }
});

async function listeningServer(t, service) {
  const token = 'fixture-local-server-authentication';
  const server = createSignerServer({ role: 'operator', service, token });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const post = intent => {
    let request;
    const response = new Promise((resolve, reject) => {
      request = http.request({ hostname: '127.0.0.1', port: server.address().port, path: '/create', method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } }, incoming => {
        let body = ''; incoming.on('data', chunk => { body += chunk; }); incoming.on('end', () => resolve(JSON.parse(body)));
      });
      request.on('error', reject); request.end(JSON.stringify(intent));
    });
    response.catch(() => {});
    return { request, response };
  };
  return Object.assign(post, { url: `http://127.0.0.1:${server.address().port}`, token });
}

test('actual HTTP caller abort propagates through clients to prevent late creation or phase signing', async t => {
  for (const operation of ['create', 'advance']) {
    const f = await fixture(t, { active: operation === 'advance' });
    const entered = deferred(), release = deferred(), aborted = deferred(), finished = deferred();
    const original = f.provider.getBlockNumber;
    f.provider.getBlockNumber = async () => { entered.resolve(); await release.promise; return original(); };
    const endpoint = await listeningServer(t, { [operation]: async (intent, context) => {
      context.signal.addEventListener('abort', () => aborted.resolve(), { once: true });
      try { return await f.service[operation](intent, context); } finally { finished.resolve(); }
    } });
    const client = (operation === 'create' ? createLauncherClient : createPhaseExecutorClient)({ url: endpoint.url, token: endpoint.token });
    const controller = new AbortController();
    const intent = operation === 'create' ? { action_id: 'create:caller-abort', source_block_number: '100', not_after_ms: Date.now() + 60000 }
      : advanceIntent(Date.now() + 60000);
    const response = client[operation](intent, { signal: controller.signal });
    try {
      await entered.promise; controller.abort();
      const outcome = await response;
      assert.equal(outcome.status, 'race-or-revert');
      assert.equal(outcome.diagnostic.code, 'OPERATION_ABORTED');
      await aborted.promise;
    } finally { release.resolve(); }
    await finished.promise;
    assert.equal(f.counts.sign, 0, operation); assert.equal(f.counts.broadcast, 0, operation);
    assert.equal(Object.values((await f.journal()).records)[0].status, 'rejected-before-submit');
  }
});

test('actual HTTP disconnect during delayed preflight aborts the server signer context before signing', async t => {
  const f = await fixture(t); const entered = deferred(), release = deferred(), aborted = deferred(), finished = deferred();
  const original = f.provider.getBlockNumber;
  f.provider.getBlockNumber = async () => { entered.resolve(); await release.promise; return original(); };
  const post = await listeningServer(t, { create: async (intent, context) => {
    context.signal.addEventListener('abort', () => aborted.resolve(), { once: true });
    try { return await f.service.create(intent, context); } finally { finished.resolve(); }
  } });
  const connection = post({ action_id: 'create:disconnect', source_block_number: '100', not_after_ms: 3000 });
  try { await entered.promise; connection.request.destroy(); await aborted.promise; }
  finally { release.resolve(); }
  await finished.promise;
  assert.equal(f.counts.sign, 0); assert.equal(f.counts.broadcast, 0);
  assert.equal(Object.values((await f.journal()).records)[0].status, 'rejected-before-submit');
});

test('actual disconnected queued HTTP request stays aborted when the earlier signing request completes', async t => {
  const f = await fixture(t); const entered = deferred(), release = deferred(), queued = deferred(), aborted = deferred(), secondFinished = deferred();
  const original = f.provider.getBlockNumber; let first = true;
  f.provider.getBlockNumber = async () => { if (first) { first = false; entered.resolve(); await release.promise; } return original(); };
  const post = await listeningServer(t, { create: async (intent, context) => {
    if (intent.action_id === 'create:queued-http') {
      context.signal.addEventListener('abort', () => aborted.resolve(), { once: true }); queued.resolve();
      try { return await f.service.create(intent, context); } finally { secondFinished.resolve(); }
    }
    return f.service.create(intent, context);
  } });
  const connection = post({ action_id: 'create:first-http', source_block_number: '100', not_after_ms: 3000 });
  await entered.promise;
  const second = post({ action_id: 'create:queued-http', source_block_number: '100', not_after_ms: 3000 });
  try { await queued.promise; second.request.destroy(); await aborted.promise; }
  finally { release.resolve(); }
  assert.equal((await connection.response).status, 'accepted'); await secondFinished.promise;
  assert.equal(f.counts.sign, 1); assert.equal(f.counts.broadcast, 1);
});
