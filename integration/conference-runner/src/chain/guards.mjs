import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { getAddress } from 'ethers';
import { REPOSITORY_ROOT, prepareRuntimeDirectory } from '../config.mjs';

const runtimeSource = JSON.parse(await readFile(new URL('../../../shared/runtime-source.json', import.meta.url), 'utf8'));
export const PINNED_DEPLOYMENT = Object.freeze(runtimeSource.network);

export function assertSignerDeployment(config, deployment = PINNED_DEPLOYMENT) {
  if (config.chain_id !== 84532 || deployment.chain_id !== 84532) throw new Error('BASE_SEPOLIA_REQUIRED');
  for (const field of ['game_address', 'auth_adapter_address', 'identity_registry_address', 'expected_owner']) {
    if (getAddress(config[field]) !== getAddress(deployment[field])) throw new Error('SIGNER_PINNED_DEPLOYMENT_MISMATCH');
  }
}

const signingKeys = ['GAMEPLAY_WALLET_PRIVATE_KEY', 'PHASE_ADVANCER_PRIVATE_KEY', 'OWNER_PRIVATE_KEY', 'CONFERENCE_OWNER_PRIVATE_KEY', 'DILEMMA_LAUNCHER_PRIVATE_KEY', 'DILEMMA_PHASE_PRIVATE_KEY'];
export function assertSignerEnvironment(role, env = process.env) {
  const selected = ['operator', 'launcher'].includes(role) ? 'DILEMMA_LAUNCHER_PRIVATE_KEY' : role === 'phase-executor' ? 'DILEMMA_PHASE_PRIVATE_KEY' : null;
  for (const field of signingKeys) if (field !== selected && env[field]) throw new Error('CROSS_ROLE_SIGNER_ENVIRONMENT_FORBIDDEN');
  return selected;
}

export async function prepareSignerDirectory(directory) {
  if (!path.isAbsolute(directory)) throw new Error('ABSOLUTE_SIGNER_DIRECTORY_REQUIRED');
  const repo = await realpath(REPOSITORY_ROOT);
  const contains = (parent, child) => { const relative = path.relative(parent, child); return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)); };
  // Resolve the nearest existing ancestor before mkdir, so a symlinked parent
  // cannot cause even an empty new directory to be created inside the checkout.
  let ancestor = path.resolve(directory);
  const missing = [];
  let actual;
  for (;;) {
    try { actual = path.join(await realpath(ancestor), ...missing); break; } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      missing.unshift(path.basename(ancestor));
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
  if (contains(repo, actual) || contains(actual, repo)) throw new Error('SIGNER_DIRECTORY_MUST_BE_OUTSIDE_REPOSITORY');
  return prepareRuntimeDirectory(directory);
}
