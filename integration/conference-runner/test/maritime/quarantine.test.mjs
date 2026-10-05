import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fixtureConfig } from '../../src/fixture.mjs';
import { createSeatQuarantine } from '../../src/maritime/quarantine.mjs';

test('unknown seats survive a new adapter/attempt and cannot release on nonce or an early sleep read', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'seat-quarantine-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = await fixtureConfig({ teamSizes: { openclaw: 5, hermes: 5 } });
  let now = 100;
  const seat = config.roster[0], requestId = 'conference:12345678901234567890123456789012';
  const store = await createSeatQuarantine({ directory, config, now: () => now });
  await store.begin(seat, requestId);
  const resumed = await createSeatQuarantine({ directory, config: { ...config, run_id: 'new-attempt' }, now: () => now });
  await assert.rejects(resumed.assertAvailable(seat), /MARITIME_SEAT_QUARANTINED/);
  assert.deepEqual(await resumed.reservedAgentIds(), [seat.agent_id]);
  await assert.rejects(resumed.resolve({ seat, requestId, status: 'sleeping', latestNonce: 1, pendingNonce: 1 }), /QUARANTINE_INVALID/);
  now = 200;
  await assert.rejects(resumed.resolve({ seat, requestId, status: 'sleeping', jobEndedAtMs: 150, sleepingObservedAtMs: 140 }), /QUARANTINE_INVALID/);
  await resumed.resolve({ seat, requestId, status: 'sleeping', jobEndedAtMs: 150, sleepingObservedAtMs: 160 });
  await resumed.assertAvailable(seat);
  assert.deepEqual(await resumed.reservedAgentIds(), []);
  await resumed.begin(seat, 'next-request');
  await assert.rejects(resumed.resolve({ seat, requestId: 'next-request', status: 'active',
    jobEndedAtMs: 200, sleepingObservedAtMs: 210 }), /QUARANTINE_INVALID/);
  now = 220;
  await resumed.resolve({ seat, requestId: 'next-request', status: 'stopped',
    jobEndedAtMs: 200, sleepingObservedAtMs: 210 });
  await resumed.assertAvailable(seat);
});
