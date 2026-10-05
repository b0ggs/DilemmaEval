import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureConfig } from '../src/fixture.mjs';
import { buildInstallArtifact } from '../src/maritime/install.mjs';
import { createDebugContinuity } from '../src/debug.mjs';
import { executionPermitFingerprint } from '../src/maritime/execution-permit.mjs';
import { validateControlledRuntimeEvidence } from '../src/readiness.mjs';
import { poke } from './maritime/fixtures.mjs';

test('debug checks the live runtime and model/route and stages an existing player permit without receipts', async () => {
  const config = await fixtureConfig({ teamSizes: { openclaw: 5, hermes: 5 } });
  config.mode = 'live'; config.purpose = 'debug';
  const operations = { schema_version: 1, network: 'base-sepolia', chain_id: 84532,
    phase_advancer: { role: 'phase-advancer', wallet_address: config.expected_owner, is_player_seat: false,
      erc8004_registered: false }, gas_ceiling_wei: '1000000000000000' };
  const artifacts = await Promise.all(config.roster.map(seat => buildInstallArtifact({ config, seatId: seat.seat_id,
    persistentRoot: seat.harness === 'openclaw' ? '/data' : '/opt/data', operationsManifest: operations })));
  const seat = config.roster[0], artifact = artifacts[0], now = Date.now(), calls = [];
  let route = true, staged;
  const execute = async command => {
    calls.push(command);
    let value;
    if (command[0] === 'sha256sum') return { exitCode: 0, stdout: artifact.files.map(file => `${file.sha256}  ${file.path}`).join('\n') };
    if (command[3]?.includes('readRuntimeInstanceFingerprint')) value = { fingerprint: 'ab'.repeat(32) };
    else if (command.at(-1) === '--inspect') value = { schema_version: 1, seat_id: seat.seat_id, chain_id: 84532,
      wallet_address: seat.wallet_address, persistent_storage_writable: true, gameplay_execution_proven: false };
    else if (command.includes('--check-model')) value = { schema_version: 1, seat_id: seat.seat_id, harness: seat.harness,
      configured: true, model: 'gpt-6.1-sol', reasoning_effort: 'low', max_output_tokens: 2048,
      automatic_fallback: false, fallback_model: null, response_metadata_required: true };
    else if (command.includes('--check-model-route')) value = { schema_version: 1, seat_id: seat.seat_id, model_route_verified: route };
    else {
      staged = JSON.parse(command.at(-1));
      value = { schema_version: 1, staged: true, request_id: staged.request_id,
        permit_sha256: executionPermitFingerprint(JSON.parse(staged.permit_content)) };
    }
    return { exitCode: 0, stdout: JSON.stringify(value) };
  };
  const continuity = createDebugContinuity({ config, artifacts, hardStopAtMs: now + 600000, now: () => now });
  const getAgent = async () => ({ id: seat.agent_id, framework: seat.harness, status: 'active' });
  const request = poke('join', seat);
  await continuity.prepareAction({ seat, request, execute, getAgent, deadlineAtMs: now + 60000 });
  const context = JSON.parse(staged.context_content), permit = JSON.parse(staged.permit_content);
  assert.equal(context.purpose, 'debug');
  assert.equal(permit.runtime_instance_fingerprint, 'ab'.repeat(32));
  assert.equal(permit.type, 'player-execution-permit');
  assert.ok(calls.every(command => !JSON.stringify(command).includes('readDiagnosticReceipt')));
  assert.throws(() => validateControlledRuntimeEvidence(config, context), /RUNTIME_DEBUG_EVIDENCE_REJECTED/);
  route = false;
  await assert.rejects(continuity.verify({ seat, execute, getAgent }), /READINESS_MODEL_ROUTE_UNVERIFIED/);
});
