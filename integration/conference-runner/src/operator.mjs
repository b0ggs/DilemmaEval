import { createLauncherClient, createPhaseExecutorClient } from './chain/index.mjs';

// Both actions share the operator's signing queue, journal and wallet nonce.
export function createOperatorAdapters({ url = 'http://127.0.0.1:8791', token, fetchImpl }) {
  const options = { url, token, fetchImpl };
  return {
    launcher: createLauncherClient(options),
    phaseExecutor: createPhaseExecutorClient(options)
  };
}
