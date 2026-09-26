import {
  assertNoSensitiveMaterial, assertResponseIdentity, validateAgentResponse, validatePoke
} from '../../../maritime-transport/src/validation.mjs';

const REQUEST_KEYS = ['schema_version', 'type', 'request_id', 'game_id', 'round', 'phase', 'seat_id', 'team', 'chain_state', 'team_chat', 'max_message_chars'];
const RESPONSE_KEYS = ['schema_version', 'type', 'request_id', 'game_id', 'round', 'phase', 'seat_id', 'team', 'status'];

function exact(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      required.some(key => !Object.hasOwn(value, key)) ||
      Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) {
    throw new TypeError('CONFERENCE_ENVELOPE_INVALID');
  }
}

export function assertPublicGameplayRequest(request) {
  validatePoke(request);
  rejectDecisionMaterial(request.chain_state);
  for (const message of request.team_chat.messages) assertMessage(message.message);
  return request;
}

function rejectDecisionMaterial(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (['choice', 'choicecode', 'selectedchoice', 'move', 'preparedcommit', 'preparedcommitbundle'].includes(normalized)) {
      throw new TypeError('PLAYER_LOCAL_MATERIAL_REJECTED');
    }
    rejectDecisionMaterial(child);
  }
}

function assertMessage(message, maximum = 200) {
  if (typeof message !== 'string' || Array.from(message).length > maximum ||
      /\b(?:reveal[ _-]?)?salt\b\s*[:=]/i.test(message)) {
    throw new TypeError('TEAM_MESSAGE_INVALID');
  }
  assertNoSensitiveMaterial({ team_message: message });
}

function discussionPoke(request) {
  return {
    request_id: request.request_id, game_id: request.game_id, round: request.round,
    phase: request.phase, seat_id: request.seat_id, team: request.team,
    chain_state: request.chain_state, team_chat: request.team_chat,
    requested_action: 'commit', response_schema_version: 1
  };
}

export function validateDiscussionRequest(request) {
  exact(request, REQUEST_KEYS);
  if (request.schema_version !== 1 || request.type !== 'discussion' ||
      request.phase !== 'commit' || request.max_message_chars !== 200) {
    throw new TypeError('DISCUSSION_REQUEST_INVALID');
  }
  assertNoSensitiveMaterial(request);
  assertPublicGameplayRequest(discussionPoke(request));
  return request;
}

export function validateDiscussionResponse(response, request) {
  exact(response, RESPONSE_KEYS, ['team_message']);
  if (response.schema_version !== 1 || response.type !== 'discussion-response' ||
      response.phase !== 'commit' || !['observed', 'skipped', 'error'].includes(response.status) ||
      !['openclaw', 'hermes'].includes(response.team) ||
      !response.seat_id?.startsWith(response.team === 'openclaw' ? 'oc-' : 'hs-')) {
    throw new TypeError('DISCUSSION_RESPONSE_INVALID');
  }
  const mapped = legacyResponse(response);
  validateAgentResponse(mapped);
  assertNoSensitiveMaterial(response);
  if (Object.hasOwn(response, 'team_message')) assertMessage(response.team_message);
  if (response.status !== 'observed' && response.team_message) {
    throw new TypeError('DISCUSSION_MESSAGE_REQUIRES_OBSERVED');
  }
  if (request) {
    validateDiscussionRequest(request);
    assertResponseIdentity(discussionPoke(request), mapped);
    if (response.team !== request.team) throw new TypeError('DISCUSSION_TEAM_MISMATCH');
  }
  return response;
}

function legacyResponse(response) {
  return {
    schema_version: 1, request_id: response.request_id, game_id: response.game_id,
    round: response.round, phase: 'commit', seat_id: response.seat_id, status: response.status,
    ...(Object.hasOwn(response, 'team_message') ? { team_message: response.team_message } : {})
  };
}

// The phase is a TeamLogStore compatibility tag only; this never authorizes a commit.
export function discussionToLogResponse(response, request) {
  validateDiscussionResponse(response, request);
  return legacyResponse(response);
}

export function validateGameplayResponse(response, request) {
  assertResponseIdentity(request, response);
  if (Object.hasOwn(response, 'team_message')) assertMessage(response.team_message);
  if (response.status === 'submitted' && !response.transaction_hash) {
    throw new TypeError('SUBMITTED_RESPONSE_REQUIRES_HASH');
  }
  return response;
}
