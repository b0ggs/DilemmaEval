import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { deriveEthereumAddress } from '../../game-bridge/src/index.js';

const PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/;
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const COORDINATOR_KEYS = new Set([
  'MARITIME_API_KEY',
  'TELEGRAM_BOT_TOKEN',
  'DILEMMA_LAUNCHER_TOKEN',
  'DILEMMA_PHASE_TOKEN'
]);

async function assertPrivatePath(path, mode, label) {
  const resolved = await realpath(path);
  const information = await lstat(resolved);
  if (!information.isFile() && !information.isDirectory()) throw new Error(`${label}_TYPE_INVALID`);
  if ((information.mode & 0o777) !== mode) throw new Error(`${label}_PERMISSIONS_INVALID`);
  return resolved;
}

function parseEnvironment(source) {
  const values = {};
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || !ENV_NAME.test(match[1]) || !COORDINATOR_KEYS.has(match[1]) || Object.hasOwn(values, match[1])) {
      throw new Error('COORDINATOR_ENV_INVALID');
    }
    const quoted = /^(?:"([\s\S]*)"|'([\s\S]*)')$/.exec(match[2]);
    values[match[1]] = quoted ? (quoted[1] ?? quoted[2]) : match[2];
  }
  if (typeof values.MARITIME_API_KEY !== 'string' || !values.MARITIME_API_KEY || /[\r\n]/.test(values.MARITIME_API_KEY)) {
    throw new Error('MARITIME_API_KEY_MISSING');
  }
  return Object.freeze(values);
}

export async function loadCoordinatorSecrets(path) {
  const resolved = await assertPrivatePath(path, 0o600, 'COORDINATOR_ENV');
  return parseEnvironment(await readFile(resolved, 'utf8'));
}

function walletFilename(seat) {
  const match = /^(?:oc|hs)-([1-9]|10)$/.exec(seat.seat_id);
  if (!match || !['openclaw', 'hermes'].includes(seat.harness) || seat.team !== seat.harness) {
    throw new Error('PLAYER_WALLET_SEAT_INVALID');
  }
  return `${seat.harness}-${match[1]}.json`;
}

async function readSeatWallet(directory, seat) {
  const path = join(directory, walletFilename(seat));
  const resolved = await realpath(path);
  if (basename(resolved) !== basename(path)) throw new Error('PLAYER_WALLET_PATH_INVALID');
  const information = await stat(resolved);
  if (!information.isFile() || (information.mode & 0o777) !== 0o600) throw new Error('PLAYER_WALLET_PERMISSIONS_INVALID');
  const value = JSON.parse(await readFile(resolved, 'utf8'));
  const expected = ['address', 'private_key', 'seat_id', 'team'];
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join('\0') !== expected.join('\0') || value.seat_id !== `${seat.harness}-${seat.seat_id.split('-')[1]}` ||
      value.team !== seat.team || typeof value.private_key !== 'string' || !PRIVATE_KEY.test(value.private_key) ||
      typeof value.address !== 'string' || value.address.toLowerCase() !== seat.wallet_address.toLowerCase() ||
      deriveEthereumAddress(value.private_key).toLowerCase() !== seat.wallet_address.toLowerCase()) {
    throw new Error('PLAYER_WALLET_IDENTITY_INVALID');
  }
  return value.private_key;
}

export async function createPlayerSecretProvider({ config, walletDirectory }) {
  const directory = await assertPrivatePath(walletDirectory, 0o700, 'PLAYER_WALLET_DIRECTORY');
  const seats = new Map(config.roster.map((seat) => [seat.seat_id, structuredClone(seat)]));
  if (seats.size !== config.roster.length) throw new Error('PLAYER_WALLET_ROSTER_INVALID');
  // Validate all selected files before the workflow can mutate Maritime.
  for (const seat of seats.values()) await readSeatWallet(directory, seat);
  return async (seatId) => {
    const seat = seats.get(seatId);
    if (!seat) throw new Error('PLAYER_WALLET_SEAT_UNKNOWN');
    return readSeatWallet(directory, seat);
  };
}
