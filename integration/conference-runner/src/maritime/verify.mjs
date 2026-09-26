const PRIVATE_KEY_TEXT = /(?:0[xX])?[0-9a-fA-F]{64}/;

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function buildRuntimeVerificationPrompt({ seat, artifact, recipe }) {
  if (!seat || artifact?.seat_id !== seat.seat_id || recipe?.harness !== seat.harness) {
    throw new TypeError('RUNTIME_VERIFICATION_INPUT_INVALID');
  }
  const command = recipe.harness === 'hermes'
    ? artifact.inspect_command.map(shellQuote).join(' ')
    : JSON.stringify(artifact.inspect_command);
  const adapter = recipe.harness === 'hermes' ? 'terminal' : recipe.bootstrap.terminal_adapter;
  return [
    'Perform one DilemmaEval tool-availability check. This check must not submit or sign a transaction.',
    `Invoke this exact installed inspect command using your ${adapter}: ${command}.`,
    'Parse its one-line JSON stdout. Return only JSON with schema_version 1, type "conference-tool-verification", and inspect set to that exact parsed stdout object.',
    'Do not add model, network-policy, environment, strategy, or secret claims. Do not print environment values.'
  ].join('\n');
}

export function validateRuntimeVerification(value, { seat, agentId, directInspection }) {
  const inspectKeys = ['schema_version', 'seat_id', 'wallet_address', 'chain_id', 'persistent_storage_writable', 'gameplay_execution_proven'];
  const expected = directInspection?.inspect_output;
  if (!exactKeys(value, ['schema_version', 'type', 'inspect']) || value.schema_version !== 1 ||
      value.type !== 'conference-tool-verification' || !exactKeys(value.inspect, inspectKeys) ||
      !expected || inspectKeys.some((key) => value.inspect[key] !== expected[key]) || value.inspect.seat_id !== seat.seat_id ||
      value.inspect.wallet_address?.toLowerCase() !== seat.wallet_address.toLowerCase() || value.inspect.chain_id !== 84532 ||
      value.inspect.persistent_storage_writable !== true || value.inspect.gameplay_execution_proven !== false ||
      PRIVATE_KEY_TEXT.test(JSON.stringify(value))) throw new TypeError('RUNTIME_VERIFICATION_INVALID');
  return Object.freeze({
    seat_id: seat.seat_id,
    agent_id: agentId,
    harness: seat.harness,
    wallet_address: seat.wallet_address.toLowerCase(),
    tool_execution_verified: true,
    model_profile_verified: false,
    model_endpoint: null,
    model: null,
    model_verification_source: null,
    spectator_access_blocked: false,
    access_verification_source: null
  });
}

export function createMaritimeRuntimeVerifier({ maritime } = {}) {
  if (typeof maritime?.agents?.chat !== 'function') throw new TypeError('MARITIME_CHAT_REQUIRED');
  return Object.freeze({
    async verify({ seat, agentId, artifact, recipe, directInspection }) {
      let reply;
      try { reply = await maritime.agents.chat(agentId, buildRuntimeVerificationPrompt({ seat, artifact, recipe })); }
      catch { throw new Error('RUNTIME_VERIFICATION_UNAVAILABLE'); }
      if (reply?.error || typeof reply?.response !== 'string' || reply.response.length < 2 || reply.response.length > 16_384 ||
          PRIVATE_KEY_TEXT.test(reply.response)) throw new Error('RUNTIME_VERIFICATION_INVALID');
      let value;
      try { value = JSON.parse(reply.response); }
      catch { throw new Error('RUNTIME_VERIFICATION_INVALID'); }
      return validateRuntimeVerification(value, { seat, agentId, directInspection });
    }
  });
}
