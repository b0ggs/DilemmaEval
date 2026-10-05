import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildInstallArtifact } from '../../src/maritime/install.mjs';
import { createRuntimeContinuity } from '../../src/maritime/continuity.mjs';
import { MaritimeAdapterError } from '../../src/maritime/transport.mjs';
import { buildControlledRuntimeEvidence, runtimeEvidenceFingerprint } from '../../src/readiness.mjs';
import { buildDiagnosticReceiptReadCommand } from '../../src/maritime/diagnostic-receipt.mjs';
import { executionPermitFingerprint } from '../../src/maritime/execution-permit.mjs';
import { config as baseline, operations, poke } from './fixtures.mjs';

// Public fixture artifacts, synthetic receipts and injected execution only.
const start = Date.parse('2026-10-02T12:00:00Z');
const hardStop = start + 3_600_000;
const runId = '01234567-89ab-4cde-8fab-0123456789ab';
const blockHash = `0x${'ab'.repeat(32)}`;
const instance = 'cd'.repeat(32);
const model = { model_endpoint: 'https://chatgpt.com/backend-api/codex', model: 'gpt-6.1-sol',
  reasoning_effort: 'low', max_output_tokens: 2048, automatic_fallback: false };
const config = { ...baseline, mode: 'live', stop_time: new Date(hardStop).toISOString(), roster: ['openclaw', 'hermes'].flatMap((team, t) =>
  Array.from({ length: 5 }, (_, index) => ({ seat_id: `${t ? 'hs' : 'oc'}-${index + 1}`, team, harness: team,
    agent_id: `${team}-fixture-${index + 1}`, maritime_agent: `${team}-fixture-${index + 1}`,
    wallet_address: `0x${String(t * 5 + index + 1).padStart(40, '0')}`, cause_id: t + 1 }))) };
const artifacts = await Promise.all(config.roster.map(seat => buildInstallArtifact({ config, seatId: seat.seat_id,
  persistentRoot: `/volume/${seat.seat_id}`, operationsManifest: operations })));
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function requestFor(seat, generation, key) {
  return { schema_version: 1, type: 'runtime-diagnostic', request_id: `${runId}:${seat.seat_id}:${generation}:${key}`,
    seat_id: seat.seat_id, team: seat.team, mode: key === 'gameplay_input' ? 'gameplay-input' : 'commit-input',
    chain_state: { chain_id: 84532, game_address: config.game_address.toLowerCase(), confirmed_block_number: '123', confirmed_block_hash: blockHash } };
}
function responseFor(request) {
  return { schema_version: 1, type: 'runtime-diagnostic-response', request_id: request.request_id,
    seat_id: request.seat_id, team: request.team, mode: request.mode, status: 'ready', checks: {
      stdin: true, wallet_identity: true, checkout: true, dependencies: true, wrapper: true,
      private_state: true, seat_lock: true, chain_id: true, contract_read: true } };
}
function evidenceFor() {
  return buildControlledRuntimeEvidence(config, { now: start, confirmedBlockNumber: '123', confirmedBlockHash: blockHash,
    producer: { producer_version: 2, diagnostic_run_id: runId, chain_id: 84532, game_address: config.game_address.toLowerCase(),
      game_code_hash: `0x${'bc'.repeat(32)}`, chain_defaults_fingerprint: 'de'.repeat(32), generation_scope: 'diagnostic-run-intent-v1',
      lifecycle_state_digest: 'ef'.repeat(32), remote_generation_attested: false, diagnostics_complete: true,
      ready_for_controlled_gameplay: true, continuity_policy: 'observed-runtime-continuity-v1' },
    seats: config.roster.map((seat, index) => ({ seat_id: seat.seat_id, agent_id: seat.agent_id, harness: seat.harness,
      wallet_address: seat.wallet_address, framework_status_verified: true, direct_runtime_inspection_verified: true,
      wallet_identity_verified: true, persistent_storage_verified: true, tool_execution_verified: true,
      gameplay_command: artifacts[index].gameplay_command, artifact_sha256: artifacts[index].artifact_sha256,
      activation_generation: index + 1, final_agent_status: 'sleeping', sleep_confirmed: true, lifecycle_ambiguous: false,
      model_profile: model, runtime_instance_fingerprint: instance,
      diagnostic_generations: { gameplay_input: index + 1, commit_input: index + 1 },
      diagnostics: Object.fromEntries(['gameplay_input', 'commit_input'].map(key => [key, responseFor(requestFor(seat, index + 1, key))])) })) });
}
function fixture({ mutate, hardStopAtMs = hardStop, time = start } = {}) {
  const inputs = { config: structuredClone(config), evidence: evidenceFor(), artifacts: structuredClone(artifacts), hardStopAtMs: hardStopAtMs ?? undefined };
  if (mutate) mutate(inputs);
  let clock = time;
  const continuity = createRuntimeContinuity({ ...inputs, now: () => clock });
  const calls = [], stages = [];
  const overrides = { agent: null, hash: null, direct: null, model: null, route: null, receipt: null, instance: null, stage: null };
  let instanceReads = 0;
  const forSeat = seat => {
    const artifact = artifacts.find(row => row.seat_id === seat.seat_id);
    const row = inputs.evidence.seats.find(row => row.seat_id === seat.seat_id);
    const receipts = new Map(['gameplay_input', 'commit_input'].map(key => {
      const request = requestFor(seat, row.activation_generation, key);
      return [buildDiagnosticReceiptReadCommand(artifact, request).at(-1), {
        schema_version: 1, type: 'runtime-diagnostic-receipt', request_sha256: digest(request), response: responseFor(request),
      }];
    }));
    const wrapped = value => ({ exitCode: 0, stdout: JSON.stringify(value), stderr: '' });
    return { seat, getAgent: async () => {
      calls.push({ kind: 'agent' });
      if (overrides.agent) return overrides.agent();
      return { id: seat.agent_id, framework: seat.harness, status: 'active' };
    }, execute: async command => {
      calls.push({ kind: 'exec', command });
      if (command[0] === 'sha256sum') return overrides.hash?.() ?? { exitCode: 0, stdout: artifact.files.map(file => `${file.sha256}  ${file.path}`).join('\n') + '\n', stderr: '' };
      if (command.at(-1).endsWith('/execution-permit.mjs')) {
        instanceReads++;
        return overrides.instance?.(instanceReads) ?? wrapped({ schema_version: 1, runtime_instance_fingerprint: instance });
      }
      if (command.at(-1) === '--inspect') return overrides.direct?.() ?? wrapped({ schema_version: 1, seat_id: seat.seat_id,
        wallet_address: seat.wallet_address, chain_id: 84532, persistent_storage_writable: true, gameplay_execution_proven: false });
      if (command.includes('--check-model')) return overrides.model?.() ?? wrapped({ schema_version: 1, seat_id: seat.seat_id,
        harness: seat.harness, configured: true, model: model.model, reasoning_effort: model.reasoning_effort,
        max_output_tokens: 2048, automatic_fallback: false, fallback_model: null, response_metadata_required: true });
      if (command.includes('--check-model-route')) return overrides.route?.() ?? wrapped({ schema_version: 1, seat_id: seat.seat_id, model_route_verified: true });
      if (command.at(-1).includes('/diagnostic-receipts/')) {
        const receipt = structuredClone(receipts.get(command.at(-1)));
        return overrides.receipt?.(receipt) ?? wrapped(receipt);
      }
      const spec = JSON.parse(command.at(-1)); stages.push(spec);
      return overrides.stage?.(spec) ?? wrapped({ schema_version: 1, staged: true, request_id: spec.request_id, permit_sha256: spec.permit_sha256 });
    } };
  };
  return { continuity, inputs, calls, stages, overrides, forSeat, setTime: value => { clock = value; }, wrapped: value => ({ exitCode: 0, stdout: JSON.stringify(value), stderr: '' }) };
}

test('all ten resumed seats verify original incarnation, public bytes, model, wallet and both original receipts without repair', async () => {
  const f = fixture();
  assert.equal(Object.isFrozen(f.continuity), true);
  assert.deepEqual(Object.keys(f.continuity).sort(), ['prepareAction', 'verify']);
  for (const seat of config.roster) assert.deepEqual(await f.continuity.verify(f.forSeat(seat)), { schema_version: 1, verified: true });
  assert.equal(f.stages.length, 0);
  assert.equal(f.calls.filter(call => call.kind === 'agent').length, 20);
  assert.equal(f.calls.filter(call => call.command?.at(-1).includes('/diagnostic-receipts/')).length, 20);
  assert.equal(f.calls.filter(call => call.command?.[0] === 'sha256sum').length, 20);
  assert.ok(f.calls.every(call => !JSON.stringify(call).includes('--configure')));
  assert.ok(f.calls.filter(call => call.command).every(call => !call.command.some(arg => /\/private(?:\/|$)/.test(arg))));
  assert.equal(f.calls[1].command[0], 'sha256sum');
  assert.ok(f.calls[2].command.at(-1).endsWith('/execution-permit.mjs'));
});

test('constructor rejects expired or mismatched evidence and artifact/config mutations before execution', () => {
  for (const mutate of [input => { input.evidence.seats[0].artifact_sha256 = '11'.repeat(32); },
    input => { input.artifacts[0].files[0].content += 'changed'; },
    input => { input.artifacts[0].inspect_command = ['node', '/wrong/player-cli.mjs', '/wrong/seat.json', '--inspect']; },
    input => { input.config.roster[0].agent_id = 'other-agent'; },
    input => { input.evidence.seats[0].diagnostic_generations.commit_input++; },
    input => { input.evidence.seats[0].diagnostics.gameplay_input.prompt = 'PRIVATE_TEST_TEXT'; },
    input => { input.artifacts.pop(); }]) {
    assert.throws(() => fixture({ mutate }), error => /^READINESS_(?:EVIDENCE|ARTIFACTS)_INVALID$/.test(error.code) && !error.message.includes('PRIVATE_TEST_TEXT') && !error.cause);
  }
  assert.throws(() => fixture({ time: start + 600_000 }), /READINESS_EVIDENCE_INVALID/);
});

test('cold starts, changed checks, missing receipts and lifecycle failures block before permits', async t => {
  const cases = [
    ['cold incarnation', f => { f.overrides.instance = () => f.wrapped({ schema_version: 1, runtime_instance_fingerprint: 'ee'.repeat(32) }); }, 'READINESS_MIXED_GENERATION'],
    ['restart during checks', f => { f.overrides.instance = read => f.wrapped({ schema_version: 1, runtime_instance_fingerprint: read === 1 ? instance : 'ee'.repeat(32) }); }, 'READINESS_MIXED_GENERATION'],
    ['public artifact corruption', f => { f.overrides.hash = () => ({ exitCode: 0, stdout: 'changed', stderr: '' }); }, 'READINESS_ARTIFACTS_INVALID'],
    ['wallet mismatch', f => { f.overrides.direct = () => f.wrapped({ schema_version: 1, seat_id: 'oc-1', wallet_address: config.roster[1].wallet_address, chain_id: 84532, persistent_storage_writable: true, gameplay_execution_proven: false }); }, 'READINESS_INSPECTION_FAILED'],
    ['private output', f => { f.overrides.route = () => f.wrapped({ schema_version: 1, seat_id: 'oc-1', model_route_verified: true, session: 'PRIVATE_TEST_TEXT' }); }, 'READINESS_MODEL_ROUTE_UNVERIFIED'],
    ['missing model', f => { f.overrides.model = () => f.wrapped({ configured: false }); }, 'READINESS_MODEL_INVALID'],
    ['missing receipt', f => { f.overrides.receipt = () => ({ exitCode: 1, stdout: '', stderr: '' }); }, 'READINESS_DIAGNOSTIC_RECEIPT_INVALID'],
    ['wrong receipt block', f => { f.overrides.receipt = receipt => f.wrapped({ ...receipt, request_sha256: 'aa'.repeat(32) }); }, 'READINESS_DIAGNOSTIC_RECEIPT_INVALID'],
    ['mixed receipt generation', f => { f.overrides.receipt = receipt => f.wrapped({ ...receipt, response: { ...receipt.response, request_id: 'another-generation' } }); }, 'READINESS_DIAGNOSTIC_RECEIPT_INVALID'],
    ['sleep during verification', f => { f.overrides.agent = () => ({ id: config.roster[0].agent_id, framework: 'openclaw', status: 'sleeping' }); }, 'READINESS_LIFECYCLE_UNCONFIRMED'],
    ['unknown provider outcome', f => { f.overrides.agent = () => { throw new Error('PRIVATE_TEST_TEXT'); }; }, 'READINESS_LIFECYCLE_UNCONFIRMED'],
  ];
  for (const [name, corrupt, code] of cases) await t.test(name, async () => {
    const f = fixture(); corrupt(f);
    await assert.rejects(f.continuity.prepareAction({ ...f.forSeat(config.roster[0]), request: poke('commit', config.roster[0]), deadlineAtMs: start + 60_000 }),
      error => error.code === code && !error.cause && !error.message.includes('PRIVATE_TEST_TEXT'));
    assert.equal(f.stages.length, 0);
  });
});

test('prepared action stages only an exact public permit bound to original evidence and capped deadline', async () => {
  const f = fixture(), seat = config.roster[0], request = poke('commit', seat);
  assert.deepEqual(await f.continuity.prepareAction({ ...f.forSeat(seat), request, deadlineAtMs: start + 60_000 }), { schema_version: 1, verified: true });
  assert.equal(f.stages.length, 1);
  const stage = f.stages[0], permit = JSON.parse(stage.permit_content), context = JSON.parse(stage.context_content);
  assert.equal(permit.expires_at_ms, start + 60_000); assert.equal(permit.hard_stop_at_ms, hardStop);
  assert.equal(permit.readiness_evidence_sha256, runtimeEvidenceFingerprint(f.inputs.evidence));
  assert.equal(permit.request_sha256, executionPermitFingerprint(request));
  assert.deepEqual(context, f.inputs.evidence);
  assert.ok(!/choice|salt|prompt|session|private_key/.test(stage.permit_content));
  assert.ok(!stage.permit_path.includes('/private/'));
});

test('active continuity survives creation TTL only within an explicitly supplied hard stop; new expired construction fails', async () => {
  const f = fixture(), args = f.forSeat(config.roster[0]);
  f.setTime(start + 700_000);
  assert.deepEqual(await f.continuity.verify(args), { schema_version: 1, verified: true });
  await f.continuity.prepareAction({ ...args, request: poke('commit', config.roster[0]), deadlineAtMs: hardStop + 60_000 });
  const permit = JSON.parse(f.stages.at(-1).permit_content);
  assert.equal(permit.expires_at_ms, start + 1_000_000);
  assert.equal(permit.hard_stop_at_ms, hardStop);
  assert.throws(() => createRuntimeContinuity({ ...f.inputs, now: () => start + 700_000 }), /READINESS_EVIDENCE_INVALID/);
  f.setTime(hardStop); await assert.rejects(f.continuity.verify(args), /READINESS_DEADLINE_EXPIRED/);
  const ordinary = fixture({ hardStopAtMs: null });
  ordinary.setTime(start + 600_000);
  await assert.rejects(ordinary.continuity.verify(ordinary.forSeat(config.roster[0])), /READINESS_DEADLINE_EXPIRED/);
});

test('missing deadlines, late operations and mismatched permit acknowledgements fail closed', async () => {
  const f = fixture(), args = f.forSeat(config.roster[0]), request = poke('commit', config.roster[0]);
  await assert.rejects(f.continuity.prepareAction({ ...args, request }), /READINESS_DEADLINE_EXPIRED/);
  assert.equal(f.calls.length, 0);
  f.overrides.stage = spec => f.wrapped({ schema_version: 1, staged: true, request_id: spec.request_id, permit_sha256: 'aa'.repeat(32) });
  await assert.rejects(f.continuity.prepareAction({ ...args, request, deadlineAtMs: start + 60_000 }), /READINESS_PERMIT_UNVERIFIED/);
  const late = fixture(); late.overrides.route = () => { late.setTime(start + 60_000); return late.wrapped({}); };
  await assert.rejects(late.continuity.prepareAction({ ...late.forSeat(config.roster[0]), request, deadlineAtMs: start + 60_000 }), /READINESS_DEADLINE_EXPIRED/);
  assert.equal(late.stages.length, 0);
});

test('constructor pins copies against caller mutation and noncooperative reads respect the deadline', async () => {
  const f = fixture(), args = f.forSeat(config.roster[0]);
  f.inputs.config.roster[0].agent_id = 'changed'; f.inputs.evidence.seats[0].runtime_instance_fingerprint = 'aa'.repeat(32);
  f.inputs.artifacts[0].files[0].sha256 = 'aa'.repeat(32);
  assert.deepEqual(await f.continuity.verify(args), { schema_version: 1, verified: true });
  const hung = fixture(); hung.overrides.agent = () => new Promise(() => {});
  await assert.rejects(hung.continuity.prepareAction({ ...hung.forSeat(config.roster[0]), request: poke('commit', config.roster[0]), deadlineAtMs: start + 20 }), /READINESS_DEADLINE_EXPIRED/);
  assert.equal(hung.stages.length, 0);
});


test('continuity reconstruction retains safe native causes through artifact and permit wrappers', async () => {
  for(const phase of ['agent','hash','model','stage']) {
    const f=fixture(),seat=config.roster[0];
    f.overrides[phase]=()=>{const error=new MaritimeAdapterError('MARITIME_HTTP_502',{ambiguous:true});
      error.message='private-continuity-fixture';error.cause={private_key:'private-continuity-fixture'};throw error;};
    const expected={agent:'READINESS_LIFECYCLE_UNCONFIRMED',hash:'READINESS_ARTIFACTS_INVALID',model:'READINESS_MODEL_INVALID',stage:'READINESS_PERMIT_UNVERIFIED'}[phase];
    await assert.rejects(f.continuity.prepareAction({...f.forSeat(seat),request:poke('commit',seat),deadlineAtMs:start+60_000}),error=>{
      assert.equal(error.code,expected);assert.equal(error.transport_code,'MARITIME_HTTP_502');
      assert.equal(error.diagnostic_code,'MARITIME_HTTP_502');
      assert.equal(error.ambiguous,undefined);assert.equal(error.retryable,undefined);assert.equal(error.cause,undefined);
      assert.doesNotMatch(JSON.stringify(error),/private-continuity|private_key/);return true;
    });
    assert.equal(f.stages.length,phase==='stage'?1:0);
  }
  const f=fixture();f.overrides.model=()=>{throw Object.assign(new Error('private-continuity-fixture'),{
    code:'MARITIME_HTTP_599',transport_code:'MARITIME_HTTP_502_private-fixture',diagnostic_code:'PLAYER_TOOL_FAILED_private-fixture'});};
  await assert.rejects(f.continuity.verify(f.forSeat(config.roster[0])),error=>{
    assert.equal(error.code,'READINESS_MODEL_INVALID');assert.equal(error.transport_code,undefined);assert.equal(error.diagnostic_code,undefined);
    assert.doesNotMatch(JSON.stringify(error),/private-fixture|HTTP_599/);return true;
  });
});
