import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDiscussionRequest, validateDiscussionResponse, validateGameplayResponse, discussionToLogResponse,
  validateRuntimeDiagnosticRequest, validateRuntimeDiagnosticInput,
  validateRuntimeDiagnosticResponse } from '../../src/maritime/index.mjs';
import { config, roster, discussion, discussionReply, poke, reply } from './fixtures.mjs';

const diagnostic = (mode = 'gameplay-input') => ({ schema_version: 1, type: 'runtime-diagnostic',
  request_id: `diagnostic:${mode}`, seat_id: roster[0].seat_id, team: roster[0].team, mode,
  chain_state: { chain_id: 84532, game_address: config.game_address,
    confirmed_block_number: '123', confirmed_block_hash: `0x${'a'.repeat(64)}` } });
const diagnosticReply = request => ({ schema_version: 1, type: 'runtime-diagnostic-response',
  request_id: request.request_id, seat_id: request.seat_id, team: request.team, mode: request.mode, status: 'ready',
  checks: { stdin: true, wallet_identity: true, checkout: true, dependencies: true, wrapper: true,
    private_state: true, seat_lock: true, chain_id: true, contract_read: true } });

test('explicit discussion validates and maps only for team-log ingestion', () => {
  const request = discussion();
  const response = discussionReply(request, { team_message: 'I will consider the current round.' });
  assert.equal(validateDiscussionRequest(request), request);
  assert.equal(validateDiscussionResponse(response, request), response);
  const log = discussionToLogResponse(response, request);
  assert.equal(log.phase, 'commit'); assert.equal(log.team_message, response.team_message);
  assert.equal(log.type, undefined); assert.equal(log.transaction_hash, undefined);
});

test('discussion rejects transaction, mismatched identity and secrets', () => {
  const request = discussion();
  for (const extra of [{ transaction_hash: `0x${'a'.repeat(64)}` }, { status: 'submitted' },
    { seat_id: 'oc-2' }, { team: 'hermes' }, { team_message: null },
    { team_message: `salt=${'a'.repeat(64)}` }]) {
    assert.throws(() => validateDiscussionResponse(discussionReply(request, extra), request));
  }
});

test('discussion and gameplay preserve long agent messages without a character cap', () => {
  for (const message of ['x'.repeat(201), '🙂'.repeat(10000)]) {
    const request = discussion();
    const response = discussionReply(request, { team_message: message });
    assert.equal(validateDiscussionResponse(response, request).team_message, message);
    assert.equal(discussionToLogResponse(response, request).team_message, message);
    const gameplay = poke();
    assert.equal(validateGameplayResponse(reply(gameplay, { team_message: message }), gameplay).team_message, message);
    request.team_chat = { through_sequence: 1, messages: [{ schema_version: 1,
      game_id: request.game_id, round: request.round, phase: 'commit', team: request.team,
      seat_id: request.seat_id, sequence: 1, received_at: '2026-09-24T12:00:00Z',
      request_id: 'prior-discussion', message }] };
    assert.equal(validateDiscussionRequest(request), request);
  }
});

test('discussion blocks opposing team input and coordinator move selection', () => {
  const request = discussion();
  const other = { schema_version: 1, game_id: '7', round: 1, phase: 'commit', team: 'hermes', seat_id: 'hs-1',
    sequence: 1, received_at: '2026-09-24T12:00:00Z', request_id: 'other', message: 'opposing text' };
  assert.throws(() => validateDiscussionRequest({ ...request, team_chat: { through_sequence: 1, messages: [other] } }));
  assert.throws(() => validateDiscussionRequest({ ...request, chain_state: { choice: 'share' } }));
});

test('runtime diagnostic accepts only exact public request, input, and successful response shapes', () => {
  for (const mode of ['gameplay-input', 'commit-input']) {
    const request = diagnostic(mode);
    const input = { request, ...(mode === 'commit-input' ? { choice: 'catch' } : {}) };
    assert.equal(validateRuntimeDiagnosticRequest(request), request);
    assert.equal(validateRuntimeDiagnosticInput(input), input);
    assert.equal(validateRuntimeDiagnosticResponse(diagnosticReply(request), request).status, 'ready');
  }
});

test('runtime diagnostic rejects choice leakage, wrong placement, identity drift, failed checks, and extra fields', () => {
  const gameplay = diagnostic();
  const commit = diagnostic('commit-input');
  for (const input of [{ request: gameplay, choice: 'share' }, { request: commit },
    { request: commit, choice: 'other' }, { request: { ...commit, choice: 'steal' }, choice: 'steal' }]) {
    assert.throws(() => validateRuntimeDiagnosticInput(input));
  }
  for (const request of [{ ...gameplay, extra: true }, { ...gameplay, team: 'hermes' },
    { ...gameplay, chain_state: { ...gameplay.chain_state, confirmed_block_number: '01' } },
    { ...gameplay, chain_state: { ...gameplay.chain_state, confirmed_block_hash: '0x00' } }]) {
    assert.throws(() => validateRuntimeDiagnosticRequest(request));
  }
  const response = diagnosticReply(gameplay);
  for (const changed of [{ ...response, choice: 'share' }, { ...response, status: 'error' },
    { ...response, mode: 'commit-input' },
    { ...response, checks: { ...response.checks, contract_read: false } },
    { ...response, checks: { ...response.checks, extra: true } }]) {
    assert.throws(() => validateRuntimeDiagnosticResponse(changed, gameplay));
  }
});
