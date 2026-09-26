import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRuntimeVerificationPrompt, validateRuntimeVerification } from '../../src/maritime/verify.mjs';

const seat = {
  seat_id: 'oc-1',
  harness: 'openclaw',
  wallet_address: '0x0000000000000000000000000000000000000001'
};
const inspection = {
  schema_version: 1,
  seat_id: 'oc-1',
  wallet_address: seat.wallet_address,
  chain_id: 84532,
  persistent_storage_writable: true,
  gameplay_execution_proven: false
};

function response(inspect) {
  return { schema_version: 1, type: 'conference-tool-verification', inspect };
}

test('Hermes verification prompt uses terminal and safely quotes the exact command', () => {
  const prompt = buildRuntimeVerificationPrompt({
    seat: { ...seat, harness: 'hermes' },
    artifact: { seat_id: seat.seat_id, inspect_command: ['node', '/opt/data/a b.mjs', '--inspect', "x'; echo INJECTED"] },
    recipe: { harness: 'hermes', bootstrap: { terminal_adapter: 'hermes-shell' } }
  });
  assert.match(prompt, /using your terminal:/);
  assert.match(prompt, /'x'\\''; echo INJECTED'/);
  assert.doesNotMatch(prompt, /JSON\s+argv/);
});

test('runtime verification accepts inspection fields in a different order', () => {
  const reordered = {
    gameplay_execution_proven: false,
    chain_id: 84532,
    wallet_address: seat.wallet_address,
    persistent_storage_writable: true,
    seat_id: 'oc-1',
    schema_version: 1
  };
  assert.equal(validateRuntimeVerification(response(reordered), {
    seat, agentId: 'agent-1', directInspection: { inspect_output: inspection }
  }).tool_execution_verified, true);
});

test('runtime verification rejects a changed inspection value', () => {
  const changed = { ...inspection, chain_id: 8453 };
  assert.throws(() => validateRuntimeVerification(response(changed), {
    seat, agentId: 'agent-1', directInspection: { inspect_output: inspection }
  }), /RUNTIME_VERIFICATION_INVALID/);
});
