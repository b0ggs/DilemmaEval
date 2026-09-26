import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deriveEthereumAddress } from '../../game-bridge/src/index.js';
import { createPlayerSecretProvider, loadCoordinatorSecrets } from '../src/live-secrets.mjs';

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'conference-live-secrets-'));
  const wallets = join(directory, 'wallets');
  await chmod(directory, 0o700); await mkdir(wallets, { mode: 0o700 });
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, wallets };
}

test('loads only the private coordinator environment without returning unknown fields', async (t) => {
  const { directory } = await setup(t);
  const path = join(directory, 'coordinator.env');
  await writeFile(path, 'MARITIME_API_KEY=fixture-key\nTELEGRAM_BOT_TOKEN="bot-value"\n', { mode: 0o600 });
  const result = await loadCoordinatorSecrets(path);
  assert.deepEqual(result, { MARITIME_API_KEY: 'fixture-key', TELEGRAM_BOT_TOKEN: 'bot-value' });
  await writeFile(path, 'MARITIME_API_KEY=fixture-key\nOWNER_PRIVATE_KEY=forbidden\n', { mode: 0o600 });
  await assert.rejects(loadCoordinatorSecrets(path), /COORDINATOR_ENV_INVALID/);
});

test('validates every selected wallet before yielding only its assigned key', async (t) => {
  const { wallets } = await setup(t);
  const keys = [`0x${'0'.repeat(63)}1`, `0x${'0'.repeat(63)}2`];
  const roster = [
    { seat_id: 'oc-1', team: 'openclaw', harness: 'openclaw', wallet_address: deriveEthereumAddress(keys[0]) },
    { seat_id: 'hs-10', team: 'hermes', harness: 'hermes', wallet_address: deriveEthereumAddress(keys[1]) }
  ];
  for (let index = 0; index < roster.length; index++) {
    const seat = roster[index];
    const name = `${seat.harness}-${seat.seat_id.split('-')[1]}.json`;
    await writeFile(join(wallets, name), `${JSON.stringify({ seat_id: name.slice(0, -5), team: seat.team,
      address: seat.wallet_address, private_key: keys[index] })}\n`, { mode: 0o600 });
  }
  const provider = await createPlayerSecretProvider({ config: { roster }, walletDirectory: wallets });
  assert.equal(await provider('oc-1'), keys[0]);
  assert.equal(await provider('hs-10'), keys[1]);
  await assert.rejects(provider('oc-2'), /UNKNOWN/);
});

test('rejects an address/key mismatch before returning a provider', async (t) => {
  const { wallets } = await setup(t);
  const key = `0x${'0'.repeat(63)}1`;
  await writeFile(join(wallets, 'openclaw-1.json'), `${JSON.stringify({ seat_id: 'openclaw-1', team: 'openclaw',
    address: `0x${'9'.repeat(40)}`, private_key: key })}\n`, { mode: 0o600 });
  await assert.rejects(createPlayerSecretProvider({ config: { roster: [{ seat_id: 'oc-1', team: 'openclaw', harness: 'openclaw',
    wallet_address: deriveEthereumAddress(key) }] }, walletDirectory: wallets }), /IDENTITY_INVALID/);
});
