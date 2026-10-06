import {
  assertNoSensitiveMaterial, assertResponseIdentity, validateAgentResponse, validatePoke, publicTransactionHashes
} from '../../../maritime-transport/src/validation.mjs';

const REQUEST_KEYS = ['schema_version', 'type', 'request_id', 'game_id', 'round', 'phase', 'seat_id', 'team', 'chain_state', 'team_chat'];
const RESPONSE_KEYS = ['schema_version', 'type', 'request_id', 'game_id', 'round', 'phase', 'seat_id', 'team', 'status'];
const DIAGNOSTIC_REQUEST_KEYS = ['schema_version', 'type', 'request_id', 'seat_id', 'team', 'mode', 'chain_state'];
const DIAGNOSTIC_CHAIN_KEYS = ['chain_id', 'game_address', 'confirmed_block_number', 'confirmed_block_hash'];
const DIAGNOSTIC_RESPONSE_KEYS = ['schema_version', 'type', 'request_id', 'seat_id', 'team', 'mode', 'status', 'checks'];
const DIAGNOSTIC_CHECK_KEYS = ['stdin', 'wallet_identity', 'checkout', 'dependencies', 'wrapper',
  'private_state', 'seat_lock', 'chain_id', 'contract_read'];
const DIAGNOSTIC_MODES = ['gameplay-input', 'commit-input'];
const SEAT = /^(?:oc|hs)-(?:[1-9]|10)$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
export const PLAYER_INPUT_MAX_BYTES = 131_072;

/** Inference-only selection. Accepted words and delivery history stay intact. */
export function fitPlayerRequestContext(request) {
  const selected = structuredClone(request);
  selected.team_chat = { through_sequence: 0, messages: [] };
  // Reserve the longest legal choice even before the player makes it.
  const bytes = () => Buffer.byteLength(JSON.stringify({ request: selected, choice: 'catch' }), 'utf8');
  if (bytes() > PLAYER_INPUT_MAX_BYTES) throw Object.assign(new Error('PLAYER_INPUT_TOO_LARGE'), {
    code: 'PLAYER_INPUT_TOO_LARGE', ambiguous: false, retryable: false
  });
  for (const message of [...request.team_chat.messages].reverse()) {
    const previous = selected.team_chat;
    const messages = [structuredClone(message), ...previous.messages];
    selected.team_chat = { through_sequence: messages.at(-1).sequence, messages };
    if (bytes() > PLAYER_INPUT_MAX_BYTES) selected.team_chat = previous;
  }
  selected.type === 'discussion' ? validateDiscussionRequest(selected) : assertPublicGameplayRequest(selected);
  return selected;
}

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
  for (const message of request.team_chat.messages) assertMessage(message.message, publicTransactionHashes(request));
  return request;
}

export function validateRuntimeDiagnosticRequest(request) {
  exact(request, DIAGNOSTIC_REQUEST_KEYS);
  exact(request?.chain_state, DIAGNOSTIC_CHAIN_KEYS);
  if (request.schema_version !== 1 || request.type !== 'runtime-diagnostic' ||
      typeof request.request_id !== 'string' || !request.request_id || request.request_id.length > 256 ||
      /[\0\r\n]/.test(request.request_id) || !SEAT.test(request.seat_id ?? '') ||
      !['openclaw', 'hermes'].includes(request.team) ||
      !request.seat_id.startsWith(request.team === 'openclaw' ? 'oc-' : 'hs-') ||
      !DIAGNOSTIC_MODES.includes(request.mode) || request.chain_state.chain_id !== 84532 ||
      !ADDRESS.test(request.chain_state.game_address ?? '') ||
      !/^(?:0|[1-9][0-9]*)$/.test(request.chain_state.confirmed_block_number ?? '') ||
      !HASH.test(request.chain_state.confirmed_block_hash ?? '')) {
    throw new TypeError('RUNTIME_DIAGNOSTIC_REQUEST_INVALID');
  }
  assertNoSensitiveMaterial(request);
  return request;
}

export function validateRuntimeDiagnosticInput(input) {
  exact(input, ['request'], input?.request?.mode === 'commit-input' ? ['choice'] : []);
  validateRuntimeDiagnosticRequest(input.request);
  if (input.request.mode === 'commit-input') {
    if (!Object.hasOwn(input, 'choice') || !['share', 'steal', 'catch'].includes(input.choice)) {
      throw new TypeError('RUNTIME_DIAGNOSTIC_CHOICE_INVALID');
    }
  } else if (Object.hasOwn(input, 'choice')) {
    throw new TypeError('RUNTIME_DIAGNOSTIC_CHOICE_FORBIDDEN');
  }
  return input;
}

export function validateRuntimeDiagnosticResponse(response, request) {
  exact(response, DIAGNOSTIC_RESPONSE_KEYS);
  exact(response?.checks, DIAGNOSTIC_CHECK_KEYS);
  if (response.schema_version !== 1 || response.type !== 'runtime-diagnostic-response' ||
      typeof response.request_id !== 'string' || !response.request_id || response.request_id.length > 256 ||
      /[\0\r\n]/.test(response.request_id) || response.status !== 'ready' || !DIAGNOSTIC_MODES.includes(response.mode) ||
      !SEAT.test(response.seat_id ?? '') || !['openclaw', 'hermes'].includes(response.team) ||
      !response.seat_id.startsWith(response.team === 'openclaw' ? 'oc-' : 'hs-') ||
      DIAGNOSTIC_CHECK_KEYS.some(key => response.checks[key] !== true)) {
    throw new TypeError('RUNTIME_DIAGNOSTIC_RESPONSE_INVALID');
  }
  assertNoSensitiveMaterial(response);
  if (request) {
    validateRuntimeDiagnosticRequest(request);
    for (const field of ['request_id', 'seat_id', 'team', 'mode']) {
      if (response[field] !== request[field]) throw new TypeError('RUNTIME_DIAGNOSTIC_RESPONSE_IDENTITY_MISMATCH');
    }
  }
  return response;
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

function assertMessage(message, publicHashes) {
  if (typeof message !== 'string' ||
      /\b(?:reveal[ _-]?)?salt\b\s*[:=]/i.test(message)) {
    throw new TypeError('TEAM_MESSAGE_INVALID');
  }
  assertNoSensitiveMaterial({ team_message: message }, 'response', publicHashes);
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
      request.phase !== 'commit') {
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
  const hashes = publicTransactionHashes(request);
  validateAgentResponse(mapped, hashes);
  assertNoSensitiveMaterial(response, 'response', hashes);
  if (Object.hasOwn(response, 'team_message')) assertMessage(response.team_message, hashes);
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
  if (Object.hasOwn(response, 'team_message')) assertMessage(response.team_message,
    new Set([...publicTransactionHashes(request), ...publicTransactionHashes(response)]));
  if (response.status === 'submitted' && !response.transaction_hash) {
    throw new TypeError('SUBMITTED_RESPONSE_REQUIRES_HASH');
  }
  return response;
}
