import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deriveEthereumAddress } from '../../../game-bridge/src/index.js';
import { createConferenceProvisioner } from '../../src/maritime/index.mjs';
import { config, roster, jsonResponse } from './fixtures.mjs';

async function setup(t, options = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'conference-provision-test-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const keys = roster.map((_, index) => `0x${'0'.repeat(63)}${index + 1}`);
  const rows = roster.map((row, index) => ({ ...row, wallet_address: deriveEthereumAddress(keys[index]), agent_id: index === 1 ? null : row.agent_id }));
  const settings = { ...config, roster: rows };
  const agents = rows.filter(row => row.agent_id).map(row => ({ id: row.agent_id, name: row.maritime_agent,
    externalId: row.maritime_agent, framework: row.harness, status: 'active' }));
  if (options.full) agents.push({ id: 'unrelated-agent', name: 'unrelated', externalId: 'unrelated', framework: 'hermes', status: 'active' });
  const environments = new Map(); const calls = [];
  const fetchImpl = async (url, request) => {
    const path = new URL(url).pathname;
    const body = request.body ? JSON.parse(request.body) : null;
    // Test spy records only public metadata; even fixture keys are excluded.
    calls.push({ path, method: request.method, ...(body?.isSecret !== undefined ? { isSecret: body.isSecret, key: body.key } : {}) });
    if (path === '/api/agents' && request.method === 'GET') return jsonResponse(agents);
    if (path === '/api/agents' && request.method === 'POST') {
      assert.deepEqual(body, { name: rows[1].maritime_agent, templateId: 'openclaw', externalId: rows[1].maritime_agent });
      const created = { id: 'created-third-slot', name: body.name, externalId: body.externalId, framework: body.templateId, status: 'active' };
      if (options.createFailure !== 'absent') agents.push(created);
      if (options.createFailure) throw new Error('sensitive provider error');
      return jsonResponse(created);
    }
    const match = path.match(/^\/api\/agents\/([^/]+)\/(env|reload-env)$/);
    assert.ok(match);
    if (match[2] === 'reload-env') return jsonResponse({ status: 'active' });
    if (request.method === 'GET') return jsonResponse(environments.get(match[1]) ?? []);
    assert.equal(body.isSecret, true);
    const seat = match[1] === 'created-third-slot' ? rows[1] : rows.find(row => row.agent_id === match[1]);
    assert.equal(deriveEthereumAddress(body.value), seat.wallet_address);
    if (options.envFailure) throw new Error(`provider reflected ${body.value}`);
    environments.set(match[1], [{ key: body.key, isSecret: true, value: options.unmasked ? body.value : '********' }]);
    return jsonResponse({ key: body.key, isSecret: true, value: '********' });
  };
  let secretReads = 0;
  const make = () => createConferenceProvisioner({ config: settings, runtimeDir: directory, apiKey: 'fixture-api-credential',
    fetchImpl, secretProvider: async seatId => { secretReads++; return options.wrongKey ? keys[0] : keys[rows.findIndex(row => row.seat_id === seatId)]; } });
  return { directory, calls, keys, make, secretReads: () => secretReads };
}

test('read-only plan identifies only the third slot without accessing wallet secrets', async t => {
  const f = await setup(t); const plan = await f.make().plan();
  assert.equal(plan.creates.length, 1); assert.equal(plan.creates[0].seat_id, 'oc-2');
  assert.equal(plan.available_slots, 1); assert.equal(f.secretReads(), 0);
  assert.ok(f.calls.every(call => call.method === 'GET'));
});

test('provisions only missing third agent, injects distinct encrypted keys, verifies masks and resumes without writes', async t => {
  const f = await setup(t); const result = await f.make().provision();
  assert.equal(result.status, 'configured'); assert.equal(result.seats.length, 3);
  assert.equal(f.calls.filter(call => call.path === '/api/agents' && call.method === 'POST').length, 1);
  assert.equal(f.calls.filter(call => call.key === 'GAMEPLAY_WALLET_PRIVATE_KEY').length, 3);
  assert.equal(result.live_gameplay_proven, false);
  const journal = await readFile(join(f.directory, 'maritime-provisioning/records.json'), 'utf8');
  for (const key of f.keys) { assert.equal(journal.includes(key), false); assert.equal(JSON.stringify(result).includes(key), false); }
  const before = f.calls.filter(call => call.method === 'POST').length;
  await f.make().provision();
  assert.equal(f.calls.filter(call => call.method === 'POST').length, before);
});

test('full account or mismatched assigned wallet stops before any mutation', async t => {
  for (const options of [{ full: true }, { wrongKey: true }]) {
    const f = await setup(t, options);
    await assert.rejects(f.make().provision(), error => ['FREE_SLOT_BUDGET_EXCEEDED', 'PLAYER_WALLET_MISMATCH'].includes(error.code));
    assert.equal(f.calls.some(call => call.method !== 'GET'), false);
  }
});

test('unknown create with a matching stable external identity recovers without another creation', async t => {
  const f = await setup(t, { createFailure: 'created' });
  await assert.rejects(f.make().provision(), error => error.code === 'AGENT_CREATE_OUTCOME_UNKNOWN' && error.ambiguous);
  const recovered = await f.make().provision(); assert.equal(recovered.status, 'configured');
  assert.equal(f.calls.filter(call => call.path === '/api/agents' && call.method === 'POST').length, 1);
});

test('unknown create absent from inventory stays blocked across restart without blind retry', async t => {
  const f = await setup(t, { createFailure: 'absent' });
  for (let i = 0; i < 2; i++) await assert.rejects(f.make().provision(), error => error.code === 'AGENT_CREATE_OUTCOME_UNKNOWN' && error.ambiguous);
  assert.equal(f.calls.filter(call => call.path === '/api/agents' && call.method === 'POST').length, 1);
});

test('unknown secret injection and unmasked listing fail without leaking or replaying secrets', async t => {
  const f = await setup(t, { envFailure: true });
  for (let i = 0; i < 2; i++) await assert.rejects(f.make().provision(), error => {
    assert.ok(f.keys.every(key => !JSON.stringify(error).includes(key)));
    return error.code === 'WALLET_ENV_OUTCOME_UNKNOWN' && error.ambiguous;
  });
  assert.equal(f.calls.filter(call => call.key === 'GAMEPLAY_WALLET_PRIVATE_KEY').length, 1);
  const unmasked = await setup(t, { unmasked: true });
  await assert.rejects(unmasked.make().provision(), error => error.code === 'WALLET_SECRET_NOT_MASKED');
});
