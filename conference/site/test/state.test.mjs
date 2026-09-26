import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFixture } from './fixture.mjs';
import { validateState, rosterCounts, phaseActivity, formatWei, safeLink, resultLink, freshness, phaseDeadline, nextGameLabel } from '../state.mjs';

test('public state is schema and network bound', () => {
  assert.equal(validateState(createFixture()).mode, 'fixture');
  for (const override of [{ chain_id: 8453 }, { schema_version: 2 }, { mode: 'replay' }, { updated_at: 'bad' }, { counts: { completed: -1, cancelled: 0 } }, { current_game: { phase: 'unknown' } }]) {
    assert.throws(() => validateState({ ...createFixture(), ...override }));
  }
});

test('roster split changes without a hardcoded three-seat display', () => {
  const roster = createFixture().roster;
  assert.deepEqual(rosterCounts(roster), { openclaw: 2, hermes: 1, total: 3 });
  assert.deepEqual(rosterCounts([...roster, { team: 'hermes' }]), { openclaw: 2, hermes: 2, total: 4 });
});

test('commit denominator uses living seats and reveal denominator uses committed seats', () => {
  const game = { ...createFixture().current_game, alive_count: 3, committed_count: 2, revealed_count: 1 };
  const activity = phaseActivity(game, 10);
  assert.equal(activity.count, 2);
  assert.equal(activity.total, 3);
  assert.ok(Math.abs(activity.percentage - 200 / 3) < 0.000001);
  assert.deepEqual(phaseActivity({ ...game, phase: 'reveal' }, 10), { label: 'Reveals confirmed', count: 1, total: 2, percentage: 50 });
  assert.equal(phaseActivity({ ...game, phase: 'join' }, 4).total, 4);
  assert.equal(phaseActivity({ ...game, committed_count: 0, phase: 'reveal' }, 4).percentage, 0);
});

test('wei values never use lossy floating point or combine awards and claims', () => {
  assert.equal(formatWei('980000000000000'), '0.00098');
  assert.equal(formatWei('10000000000000000000000000000001'), '10000000000000');
  assert.equal(formatWei('1234567890123456789'), '1.234567');
  assert.equal(formatWei('1'), '<0.000001');
  assert.equal(formatWei('0'), '0');
  assert.equal(formatWei(undefined), '—');
  assert.equal(formatWei('-1'), '—');
});

test('links admit only intended HTTPS Telegram and Base Sepolia destinations', () => {
  assert.equal(safeLink('https://t.me/+exampleInvite', 'telegram'), 'https://t.me/+exampleInvite');
  for (const value of ['javascript:alert(1)', 'https://evil.test/', 'https://t.me.evil.test/foo', 'https://person@t.me/foo', 'https://t.me:444/foo', 'http://t.me/foo']) {
    assert.equal(safeLink(value, 'telegram'), null);
  }
  assert.equal(safeLink('https://basescan.org/address/0x' + '1'.repeat(40), 'contract'), null);
  assert.equal(safeLink(createFixture().links.contract, 'contract'), createFixture().links.contract);
});

test('result links require a terminal result and its exact transaction hash', () => {
  const result = createFixture().latest_result;
  assert.equal(resultLink(result), result.transaction_url);
  assert.equal(resultLink({ ...result, transaction_url: createFixture().links.contract }), null);
  assert.equal(resultLink({ ...result, transaction_hash: `0x${'b'.repeat(64)}` }), null);
  assert.equal(resultLink({ ...result, outcome: 'playing' }), null);
});

test('fixture, stale, network-error and degraded statuses never claim healthy live updates', () => {
  const now = Date.now();
  const fixture = createFixture(now);
  assert.equal(freshness(fixture, now).kind, 'fixture');
  assert.equal(freshness(fixture, now + 21_000).kind, 'stale');
  assert.equal(freshness(fixture, now, true).kind, 'error');
  assert.equal(freshness({ ...fixture, mode: 'live' }, now).kind, 'live');
  assert.equal(freshness({ ...fixture, mode: 'live', health: { ok: false } }, now).kind, 'degraded');
  assert.equal(freshness({ ...fixture, updated_at: new Date(now + 31_000).toISOString() }, now).kind, 'stale');
});

test('deadlines stay block based and preserve strict greater-than boundary', () => {
  assert.equal(phaseDeadline({ unit: 'block', current: '200', deadline: '200' }), '0 blocks to deadline · block 200');
  assert.match(phaseDeadline({ unit: 'block', current: '201', deadline: '200' }), /^Deadline passed/);
  assert.equal(phaseDeadline({ unit: 'timestamp', current: '1000', deadline: '1010' }), '10s to join deadline · chain time');
});

test('intermission countdown is independent of completed result and stops at cutoff', () => {
  const now = Date.now();
  const state = { ...createFixture(now), status: 'intermission', next_game_at: new Date(now + 20_000).toISOString() };
  assert.equal(nextGameLabel(state, now), 'Next game in 20s');
  assert.equal(nextGameLabel(state, now + 20_000), 'Next game starting');
  assert.equal(nextGameLabel({ ...state, status: 'stopped' }, now), 'New games stopped');
});
