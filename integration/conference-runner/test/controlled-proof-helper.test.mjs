import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createProofDispatchJournal,
  writeProofReport,
} from '../../../conference/operations/saved-helpers/proof-dispatch-journal.mjs';
import {
  createProofBindings,
  verifyProofBindings,
} from '../../../conference/operations/saved-helpers/proof-bindings.mjs';

const hash = number => `0x${number.toString(16).padStart(64, '0')}`;

test('proof bindings pin exact prepared config and readiness evidence digests', () => {
  const sourceConfig={run_id:'proof',chain_id:84532,roster:[{seat_id:'oc-1'}]};
  const preparedConfig={...sourceConfig,start_block:'100',stop_time:'2026-09-25T19:00:00.000Z'};
  const runtimeEvidence={schema_version:2,run_id:'proof',verified_at:'2026-09-25T18:00:00.000Z'};
  const bindings=createProofBindings({sourceConfig,preparedConfig,runtimeEvidence});
  assert.equal(verifyProofBindings(bindings,{sourceConfig,preparedConfig,runtimeEvidence}),bindings);
  assert.throws(()=>verifyProofBindings(bindings,{sourceConfig,
    preparedConfig:{...preparedConfig,stop_time:'2026-09-25T19:00:01.000Z'},runtimeEvidence}),/CHANGED/);
  assert.throws(()=>verifyProofBindings(bindings,{sourceConfig,preparedConfig,
    runtimeEvidence:{...runtimeEvidence,verified_at:'2026-09-25T18:00:01.000Z'}}),/CHANGED/);
});

test('Game 17 shape durably represents one transport failure and nine late successes', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'proof-dispatch-journal-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'proof.json');
  const report = { schema_version: 1, dispatches: [] };
  const stopController = new AbortController();
  const invocationChecks = [];
  let started = 0;
  let release;
  const allStarted = new Promise(resolve => { release = resolve; });
  const adapter = {
    async dispatch({ seat }) {
      const persisted = JSON.parse(await fs.readFile(filename, 'utf8'));
      invocationChecks.push(persisted.dispatches.some(row => row.seat_id === seat.seat_id && row.status === 'started'));
      started += 1;
      if (started === 10) release();
      await allStarted;
      if (seat.seat_id === 'oc-1') {
        throw Object.assign(new Error('provider said fixture-private-secret'), {
          code: 'ECONNRESET', ambiguous: true, provider_response: 'fixture-private-secret',
        });
      }
      await new Promise(resolve => setImmediate(resolve));
      return {
        status: 'submitted', transaction_hash: hash(started + Number(seat.seat_id.split('-')[1])),
        prompt: 'fixture-private-prompt', choice: 'steal', salt: 'fixture-private-salt',
      };
    },
  };
  const journal = createProofDispatchJournal({
    adapter, report, stopController,
    persist: () => writeProofReport(filename, report),
    now: (() => {
      let milliseconds = Date.parse('2026-09-25T16:00:00.000Z');
      return () => milliseconds++;
    })(),
  });

  const calls = Array.from({ length: 10 }, (_, index) => {
    const prefix = index < 5 ? 'oc' : 'hs';
    const seatNumber = index < 5 ? index + 1 : index - 4;
    const seatId = `${prefix}-${seatNumber}`;
    return journal.dispatch({
      seat: { seat_id: seatId, private_key: 'fixture-private-key' },
      request: {
        request_id: `conference:${(index + 1).toString(16).padStart(32, '0')}`, game_id: '17', round: 0,
        requested_action: 'join', prompt: 'fixture-private-prompt', choice: 'steal', salt: 'fixture-private-salt',
      },
      signal: new AbortController().signal,
    });
  });
  const outcomes = await Promise.allSettled(calls);
  await journal.flush();

  assert.equal(outcomes.filter(outcome => outcome.status === 'rejected').length, 1);
  assert.deepEqual(invocationChecks, Array(10).fill(true), 'each start is durable before its adapter begins');
  const evidence = JSON.parse(await fs.readFile(filename, 'utf8'));
  assert.equal(evidence.dispatches.length, 10);
  assert.equal(evidence.dispatches.filter(row => row.status === 'ambiguous').length, 1);
  assert.equal(evidence.dispatches.filter(row => row.status === 'submitted').length, 9);
  assert.ok(evidence.dispatches.every(row => row.started_at && row.finished_at));
  assert.ok(evidence.dispatches.every(row => Object.keys(row).every(key => [
    'started_at', 'finished_at', 'request_id', 'seat_id', 'operation', 'game_id', 'round',
    'status', 'transaction_hash', 'error_code', 'transport_code', 'diagnostic_code', 'has_team_message',
    'dispatch_diagnostics',
  ].includes(key))));
  assert.equal(journal.getFailure()?.seat_id, 'oc-1');
  assert.equal(stopController.signal.aborted, true);
  const serialized = JSON.stringify(evidence);
  for (const privateValue of ['fixture-private-secret', 'fixture-private-prompt', 'fixture-private-salt', 'fixture-private-key']) {
    assert.equal(serialized.includes(privateValue), false);
  }
});

test('records explicit pre-submit rejection and controlled post-submit cancellation without raw errors', async () => {
  const report = { dispatches: [] };
  const stopController = new AbortController();
  let persistCount = 0;
  const journal = createProofDispatchJournal({
    report, stopController, persist: async () => { persistCount += 1; },
    adapter: { dispatch: async ({ seat }) => {
      if (seat.seat_id === 'oc-1') throw Object.assign(new Error('private first failure'), {
        code: 'MARITIME_TIMEOUT', ambiguous: true,
      });
      if (seat.seat_id === 'oc-2') {
        await new Promise(resolve => stopController.signal.addEventListener('abort', resolve, { once: true }));
        throw Object.assign(new Error('private cancellation'), { code: 'MARITIME_TIMEOUT', ambiguous: true });
      }
      throw Object.assign(new Error('private queued expiry'), {
        code: 'MARITIME_DISPATCH_EXPIRED', ambiguous: false, retryable: true,
      });
    } },
  });
  const input = seat_id => ({
    seat: { seat_id },
    request: { request_id: `request:${seat_id}`, game_id: '17', round: 0, requested_action: 'join' },
  });

  const outcomes = await Promise.allSettled([
    journal.dispatch(input('oc-1')),
    journal.dispatch(input('oc-2')),
    journal.dispatch(input('oc-3')),
  ]);
  assert.ok(outcomes.every(outcome => outcome.status === 'rejected'));
  assert.deepEqual(report.dispatches.map(row => [row.seat_id, row.status]), [
    ['oc-1', 'ambiguous'],
    ['oc-2', 'cancelled-after-submit'],
    ['oc-3', 'rejected-before-submit'],
  ]);
  assert.equal(persistCount, 6, 'each start and terminal outcome is persisted');
  assert.equal(JSON.stringify(report).includes('private '), false);
});

test('dispatch journal retains allowlisted native metadata through fixed wrappers without exposing raw codes', async () => {
  const secret = 'fixture-private-provider-text';
  for (const [error, expectedTransport, expectedDiagnostic] of [
    [{ code: 'PROOF_AGENT_OPERATION_FAILED', transport_code: 'MARITIME_HTTP_502', diagnostic_code: 'MARITIME_REPLY_PROVIDER_ERROR' }, 'MARITIME_HTTP_502', 'MARITIME_REPLY_PROVIDER_ERROR'],
    [{ code: 'MARITIME_HTTP_502', transport_code: 'MARITIME_TIMEOUT' }, 'MARITIME_TIMEOUT', null],
    [{ code: 'MARITIME_HTTP_502' }, 'MARITIME_HTTP_502', null],
    [{ code: `MARITIME_HTTP_502_${secret}`, transport_code: `MARITIME_TIMEOUT_${secret}`, diagnostic_code: `MARITIME_REPLY_PROVIDER_ERROR_${secret}` }, undefined, null],
  ]) {
    const report = { dispatches: [] }, stopController = new AbortController();
    const journal = createProofDispatchJournal({ report, stopController, persist: async () => {},
      adapter: { dispatch: async () => { throw Object.assign(new Error(secret), error, { ambiguous: true, retryable: true, raw_response: secret }); } } });
    await assert.rejects(journal.dispatch({ seat: { seat_id: 'oc-1' }, request: {
      request_id: `conference:${'a'.repeat(32)}`, game_id: '19', round: 3, type: 'discussion'
    } }));
    const row = report.dispatches[0];
    assert.equal(row.status, 'ambiguous'); assert.equal(row.error_code, 'MARITIME_OPERATION_FAILED');
    assert.equal(row.transport_code, expectedTransport); assert.equal(row.diagnostic_code, expectedDiagnostic);
    assert.equal(stopController.signal.aborted, true);
    assert.equal(journal.getFailure().transport_code, expectedTransport);
    assert.ok(!JSON.stringify(report).includes(secret)); assert.ok(!JSON.stringify(report).includes('raw_response'));
  }
});

test('normalizes every adapter response to a terminal proof status', async () => {
  for (const [adapterStatus, proofStatus] of [
    ['submitted', 'submitted'],
    ['observed', 'observed'],
    ['skipped', 'skipped'],
    ['error', 'agent-error'],
  ]) {
    const report = { dispatches: [] };
    const journal = createProofDispatchJournal({
      report,
      stopController: new AbortController(),
      persist: async () => {},
      adapter: { dispatch: async () => ({
        status: adapterStatus,
        error: adapterStatus === 'error'
          ? { code: 'PLAYER_TOOL_FAILED', message: 'private provider details' }
          : undefined,
        team_message: adapterStatus === 'observed' ? 'public team message not copied into proof' : undefined,
      }) },
    });
    await journal.dispatch({
      seat: { seat_id: 'hs-1' },
      request: { request_id: `response:${adapterStatus}`, game_id: '17', round: 1, type: 'discussion' },
    });
    assert.equal(report.dispatches[0].status, proofStatus);
    assert.equal(report.dispatches[0].has_team_message, adapterStatus === 'observed');
    assert.equal(JSON.stringify(report).includes('private provider details'), false);
    assert.equal(JSON.stringify(report).includes('public team message not copied into proof'), false);
  }
});
