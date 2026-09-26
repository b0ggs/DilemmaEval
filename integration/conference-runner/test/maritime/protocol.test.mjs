import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDiscussionRequest, validateDiscussionResponse, discussionToLogResponse } from '../../src/maritime/index.mjs';
import { discussion, discussionReply } from './fixtures.mjs';

test('explicit discussion validates and maps only for team-log ingestion', () => {
  const request = discussion();
  const response = discussionReply(request, { team_message: 'I will consider the current round.' });
  assert.equal(validateDiscussionRequest(request), request);
  assert.equal(validateDiscussionResponse(response, request), response);
  const log = discussionToLogResponse(response, request);
  assert.equal(log.phase, 'commit'); assert.equal(log.team_message, response.team_message);
  assert.equal(log.type, undefined); assert.equal(log.transaction_hash, undefined);
});

test('discussion rejects transaction, mismatched identity, secrets and excess text', () => {
  const request = discussion();
  for (const extra of [{ transaction_hash: `0x${'a'.repeat(64)}` }, { status: 'submitted' },
    { seat_id: 'oc-2' }, { team: 'hermes' }, { team_message: 'x'.repeat(201) },
    { team_message: `salt=${'a'.repeat(64)}` }]) {
    assert.throws(() => validateDiscussionResponse(discussionReply(request, extra), request));
  }
});

test('discussion blocks opposing team input and coordinator move selection', () => {
  const request = discussion();
  const other = { schema_version: 1, game_id: '7', round: 1, phase: 'commit', team: 'hermes', seat_id: 'hs-1',
    sequence: 1, received_at: '2026-09-24T12:00:00Z', request_id: 'other', message: 'opposing text' };
  assert.throws(() => validateDiscussionRequest({ ...request, team_chat: { through_sequence: 1, messages: [other] } }));
  assert.throws(() => validateDiscussionRequest({ ...request, chain_state: { choice: 'share' } }));
});
