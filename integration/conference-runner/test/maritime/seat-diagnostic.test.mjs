import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fixtureConfig } from '../../src/fixture.mjs';
import { buildInstallArtifact } from '../../src/maritime/install.mjs';
import { runSeatDiagnostic, nativeCommandResult } from '../../src/maritime/seat-diagnostic.mjs';

test('one-seat diagnosis reads the native receipt after a failed chat and keeps its named cause without replay', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'seat-diagnostic-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = await fixtureConfig({ teamSizes: { openclaw: 5, hermes: 5 } });
  const seat = config.roster.find(row => row.seat_id === 'oc-1');
  const artifact = await buildInstallArtifact({ config, seatId: seat.seat_id, persistentRoot: '/data',
    operationsManifest: { schema_version: 1, network: 'base-sepolia', chain_id: 84532,
      phase_advancer: { role: 'phase-advancer', wallet_address: config.expected_owner, is_player_seat: false,
        erc8004_registered: false }, gas_ceiling_wei: '1000000000000000' } });
  const calls = []; let active = false, chats = 0, receiptRead = false;
  const json = value => new Response(JSON.stringify(value));
  const fetchImpl = async (url, options) => {
    calls.push(new URL(url).pathname);
    if (url.endsWith('/api/agents')) return json(config.roster.map(row => ({ id: row.agent_id, framework: row.harness,
      status: row.agent_id === seat.agent_id && active ? 'active' : 'sleeping' })));
    if (url.endsWith('/start') || url.endsWith('/reload-env')) { active = true; return json({ id: seat.agent_id, framework: seat.harness, status: 'active' }); }
    if (url.endsWith('/sleep')) { active = false; return json({ id: seat.agent_id, framework: seat.harness, status: 'sleeping' }); }
    if (url.endsWith('/exec')) {
      const command = JSON.parse(options.body).command;
      if (command.at(-1) === 'receipt') {
        receiptRead = true;
        return json({ exitCode: 1, stdout: '{"ok":false,"error":{"code":"OPENCLAW_RECEIPT_REFUSED_RESPONSE_COMPLETION"}}', stderr: '' });
      }
      return json({ exitCode: 0, stdout: JSON.stringify({ schema_version: 1, observer_active: true, seat_id: seat.seat_id }), stderr: '' });
    }
    return json({ id: seat.agent_id, framework: seat.harness, status: active ? 'active' : 'sleeping' });
  };
  const now = Date.now();
  const input = { config, artifacts: [artifact], seatId: seat.seat_id, runtimeDir: path.join(root, 'attempt'),
    apiKey: 'fixture-credential', fetchImpl, deadlineAtMs: now + 120000, cleanupDeadlineAtMs: now + 180000,
    pause: async () => {}, chain: { preflight: async () => ({ block_number: '10', block_hash: `0x${'a'.repeat(64)}` }) },
    adapterFactory: () => ({ diagnose: async args => {
      chats++; assert.equal(args.seat.seat_id, 'oc-1');
      throw Object.assign(new Error('unpublished provider text'), { code: 'MARITIME_DIAGNOSTIC_RESPONSE_INVALID', ambiguous: true });
    } }) };
  const report = await runSeatDiagnostic(input);
  assert.equal(chats, 1); assert.equal(receiptRead, true);
  assert.equal(report.failure.code, 'OPENCLAW_RECEIPT_REFUSED_RESPONSE_COMPLETION');
  assert.equal(report.sleep_confirmed, true); assert.equal(report.account_awake, 0);
  assert.doesNotMatch(JSON.stringify(report), /unpublished|fixture-credential/);
  await assert.rejects(runSeatDiagnostic(input), /EEXIST/);
  assert.equal(chats, 1);
});

test('native command errors expose only recognized first-cause codes', () => {
  assert.throws(() => nativeCommandResult({ exitCode: 1,
    stdout: '{"ok":false,"error":{"code":"OPENCLAW_RECEIPT_REQUEST_MISSING"}}' }), /OPENCLAW_RECEIPT_REQUEST_MISSING/);
  assert.throws(() => nativeCommandResult({ exitCode: 1,
    stdout: '{"ok":false,"error":{"code":"UNPUBLISHED_PROVIDER_TEXT"}}' }), /MARITIME_DIAGNOSTIC_RESPONSE_INVALID/);
});
