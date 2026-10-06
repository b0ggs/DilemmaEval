// Fixed labels only: provider messages can include credentials and signed data.
const codes = new Set(['SIGNER_EXECUTION_EXPIRED', 'FUTURE_SOURCE_BLOCK', 'GAME_ALREADY_ACTIVE',
  'INVALID_DEFAULT_CONFIG', 'FEE_BPS_MUST_BE_PRESERVED', 'ACTIVE_GAME_CHANGED', 'SOURCE_BLOCK_REORGED',
  'PHASE_NOT_ELIGIBLE', 'UNTRACKED_PENDING_SIGNER_NONCE', 'SIGNER_UNRESOLVED_OPERATION',
  'UNSAFE_POPULATED_TRANSACTION', 'BROADCAST_HASH_MISMATCH', 'WRONG_CHAIN', 'CHAIN_REORG_DURING_READ',
  'CONFIRMED_BLOCK_UNAVAILABLE', 'BLOCK_UNAVAILABLE', 'INVALID_SIGNER_RESPONSE', 'INVALID_SIGNER_REFERENCE',
  'RPC_TIMEOUT', 'RPC_NETWORK_ERROR', 'RPC_ERROR', 'RPC_REQUEST_TOO_LARGE', 'TRANSACTION_REVERTED', 'NONCE_CONFLICT',
  'INSUFFICIENT_FUNDS', 'OPERATION_ABORTED', 'OPERATION_FAILED']);
const stages = new Set(['readSnapshot', 'readEvents', 'readBlockHash', 'preflight', 'phase_check',
  'nonce_check', 'prepare_transaction', 'sign', 'broadcast', 'confirmation', 'signer_request']);

export function chainFailureCode(error) {
  if (codes.has(error?.code)) return error.code;
  if (codes.has(error?.message)) return error.message;
  if (error?.code === 'SERVER_ERROR' && error?.response?.statusCode === 413) return 'RPC_REQUEST_TOO_LARGE';
  return new Map(Object.entries({ TIMEOUT: 'RPC_TIMEOUT', NETWORK_ERROR: 'RPC_NETWORK_ERROR', SERVER_ERROR: 'RPC_ERROR',
    CALL_EXCEPTION: 'TRANSACTION_REVERTED', NONCE_EXPIRED: 'NONCE_CONFLICT',
    REPLACEMENT_UNDERPRICED: 'NONCE_CONFLICT', INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
    TimeoutError: 'RPC_TIMEOUT', AbortError: 'OPERATION_ABORTED' })).get(error?.code ?? error?.name) ?? 'OPERATION_FAILED';
}

export function safeChainDiagnostic(value) {
  if (!value || !stages.has(value.stage) || !codes.has(value.code) ||
      !Number.isSafeInteger(value.elapsed_ms) || value.elapsed_ms < 0) return undefined;
  return { stage: value.stage, code: value.code, elapsed_ms: value.elapsed_ms };
}
