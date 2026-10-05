#!/usr/bin/env node
// Executed ONLY inside the selected agent after the operator uploads the artifact.
import { access, chmod, chown, lstat, mkdir, open, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HERMES_RUNTIME_IDENTITY, runtimeIdentityForSettings } from './runtime-identity.mjs';
import { HERMES_OAUTH_PROFILE, updateHermesOAuthConfigText, inspectHermesOAuthConfigText } from './hermes-oauth.mjs';
import { OPENCLAW_OAUTH_PROFILE, updateOpenClawOAuthConfigText, inspectOpenClawOAuthConfigText } from './openclaw-oauth.mjs';

export const HERMES_TERMINAL_PASSTHROUGH_ENV = 'GAMEPLAY_WALLET_PRIVATE_KEY';
export const REQUIRED_MODEL_PROFILE = Object.freeze({
  model: 'gpt-6.1-sol', reasoning_effort: 'low', max_output_tokens: 2048,
  automatic_fallback: false, fallback_model: null, response_metadata_required: true
});

function command(program, args, cwd, env, capture = false) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(program, args, { cwd, env, stdio: ['ignore', capture ? 'pipe' : 'ignore', 'ignore'], shell: false });
    let output = '';
    if (capture) child.stdout.on('data', chunk => { output += chunk.toString(); if (output.length > 4096) child.kill('SIGKILL'); });
    child.once('error', () => reject(new Error('INSTALL_COMMAND_FAILED')));
    child.once('close', code => code === 0 ? resolvePromise(output.trim()) : reject(new Error('INSTALL_COMMAND_FAILED')));
  });
}

export const FOUNDRY_SCRIPT_MAPPINGS = Object.freeze({
  'query:summary': Object.freeze(['scripts-js/queryCli.js', 'summary']),
  'auth:status': Object.freeze(['scripts-js/authCli.js', 'status']),
  'game:join': Object.freeze(['scripts-js/gameCli.js', 'join']),
  'game:prepare-commit': Object.freeze(['scripts-js/gameCli.js', 'prepare-commit']),
  'game:commit': Object.freeze(['scripts-js/gameCli.js', 'commit']),
  'game:reveal': Object.freeze(['scripts-js/gameCli.js', 'reveal']),
  'game:claim': Object.freeze(['scripts-js/gameCli.js', 'claim']),
  'game:refund': Object.freeze(['scripts-js/gameCli.js', 'refund'])
});

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

/** A tiny yarn-compatible facade for only the operations allowed by the bridge. */
export function buildRestrictedYarnWrapper(repo, nodePath = process.execPath) {
  if (!isAbsolute(repo) || !isAbsolute(nodePath)) throw new TypeError('WRAPPER_PATH_INVALID');
  const foundry = join(repo, 'packages/foundry');
  const cases = Object.entries(FOUNDRY_SCRIPT_MAPPINGS).map(([script, [file, subcommand]]) =>
    `  ${script}) exec ${shellQuote(nodePath)} ${shellQuote(join(foundry, file))} ${shellQuote(subcommand)} "$@" ;;`).join('\n');
  return `#!/bin/sh
set -eu
if [ "$#" -lt 2 ]; then exit 64; fi
script=$1
shift
if [ "$1" != "--" ]; then exit 64; fi
shift
case "$script" in
${cases}
  *) exit 64 ;;
esac
`;
}

async function assertCleanCheckout(repo, env) {
  if (await command('git', ['status', '--porcelain', '--untracked-files=all'], repo, env, true) !== '') {
    throw new Error('INSTALL_CHECKOUT_DIRTY');
  }
}

function yamlList(value) {
  const source = value.trim();
  if (source === '[]') return [];
  if (!source.startsWith('[') || !source.endsWith(']')) throw new Error('HERMES_ENV_PASSTHROUGH_NOT_LIST');
  const inner = source.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(',').map(item => {
    const token = item.trim();
    const unquoted = (token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'")) ?
      token.slice(1, -1) : token;
    if (!/^[A-Z][A-Z0-9_]*$/.test(unquoted)) throw new Error('HERMES_ENV_PASSTHROUGH_INVALID');
    return unquoted;
  });
}

/** Conservatively edits the Hermes model mapping and terminal allowlist. */
export function updateHermesConfigText(text) {
  if (typeof text !== 'string' || text.includes('\0')) throw new TypeError('HERMES_CONFIG_INVALID');
  text = updateHermesOAuthConfigText(text);
  const finalNewline = text.endsWith('\n');
  const lines = text.split('\n');
  if (finalNewline) lines.pop();
  if (lines.length === 1 && lines[0] === '') lines.pop();
  if (lines.some(line => /^\s*\t|^ *\t/.test(line))) throw new Error('HERMES_CONFIG_TABS_REJECTED');
  const terminalKeys = lines.map((line, index) => ({ line, index })).filter(({ line }) => /^terminal\s*:/.test(line));
  if (terminalKeys.length > 1) throw new Error('HERMES_TERMINAL_CONFIG_DUPLICATE');
  if (terminalKeys.length === 0) {
    lines.push('terminal:', '  env_passthrough:', `    - ${HERMES_TERMINAL_PASSTHROUGH_ENV}`);
    return `${lines.join('\n')}\n`;
  }
  const terminalIndex = terminalKeys[0].index;
  if (!/^terminal:\s*(?:#.*)?$/.test(lines[terminalIndex])) throw new Error('HERMES_TERMINAL_CONFIG_NOT_MAPPING');
  let terminalEnd = lines.length;
  for (let index = terminalIndex + 1; index < lines.length; index++) {
    if (lines[index].trim() && !/^\s/.test(lines[index]) && !/^\s*#/.test(lines[index])) { terminalEnd = index; break; }
  }
  const passthroughKeys = [];
  for (let index = terminalIndex + 1; index < terminalEnd; index++) {
    if (/^\s+env_passthrough\s*:/.test(lines[index])) passthroughKeys.push(index);
  }
  if (passthroughKeys.length > 1) throw new Error('HERMES_ENV_PASSTHROUGH_DUPLICATE');
  if (passthroughKeys.length === 0) {
    lines.splice(terminalEnd, 0, '  env_passthrough:', `    - ${HERMES_TERMINAL_PASSTHROUGH_ENV}`);
    return `${lines.join('\n')}${finalNewline ? '\n' : ''}`;
  }
  const fieldIndex = passthroughKeys[0];
  const match = lines[fieldIndex].match(/^( +)env_passthrough\s*:\s*(.*)$/);
  if (!match) throw new Error('HERMES_ENV_PASSTHROUGH_INVALID');
  const indent = match[1];
  let tail = match[2].trim();
  if (tail.includes('#')) tail = tail.slice(0, tail.indexOf('#')).trim();
  let end = fieldIndex + 1;
  while (end < terminalEnd) {
    const line = lines[end];
    if (line.trim() && line.match(/^ */)[0].length <= indent.length) break;
    end++;
  }
  let names;
  if (tail) {
    if (end !== fieldIndex + 1 && lines.slice(fieldIndex + 1, end).some(line => line.trim() && !/^\s*#/.test(line))) {
      throw new Error('HERMES_ENV_PASSTHROUGH_INVALID');
    }
    names = yamlList(tail);
  } else {
    names = [];
    for (const line of lines.slice(fieldIndex + 1, end)) {
      if (!line.trim() || /^\s*#/.test(line)) continue;
      const item = line.match(/^\s+-\s+(?:"([A-Z][A-Z0-9_]*)"|'([A-Z][A-Z0-9_]*)'|([A-Z][A-Z0-9_]*))\s*(?:#.*)?$/);
      if (!item) throw new Error('HERMES_ENV_PASSTHROUGH_NOT_LIST');
      names.push(item[1] ?? item[2] ?? item[3]);
    }
  }
  const unique = [...new Set([...names, HERMES_TERMINAL_PASSTHROUGH_ENV])];
  const replacement = [`${indent}env_passthrough:`, ...unique.map(name => `${indent}  - ${name}`)];
  lines.splice(fieldIndex, end - fieldIndex, ...replacement);
  const result = `${lines.join('\n')}${finalNewline ? '\n' : ''}`;
  return result;
}

function hermesConfigPath(settings, environment = process.env) {
  const root = resolve(settings.persistent_root ?? '');
  const candidate = resolve(environment.HERMES_CONFIG ?? settings.hermes_config_path ?? '');
  if (!isAbsolute(settings.persistent_root ?? '') || !isAbsolute(candidate) ||
      (candidate !== root && !candidate.startsWith(`${root}/`)) || !candidate.endsWith('/config.yaml')) {
    throw new Error('HERMES_CONFIG_PATH_INVALID');
  }
  return candidate;
}

async function readHermesConfig(path) {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || await realpath(path) !== resolve(path)) {
      throw new Error('HERMES_CONFIG_FILE_INVALID');
    }
    return await readFile(path, 'utf8');
  } catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
}

async function verifiedHermesConfigMetadata(path, { lstatImpl, realpathImpl }) {
  const metadata = await lstatImpl(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || await realpathImpl(path) !== resolve(path)) {
    throw new Error('HERMES_CONFIG_FILE_INVALID');
  }
  return metadata;
}

export async function inspectHermesConfigOwnership(path, {
  lstatImpl = lstat, realpathImpl = realpath
} = {}) {
  if (!isAbsolute(path) || !path.endsWith('/config.yaml')) throw new TypeError('HERMES_CONFIG_PATH_INVALID');
  const metadata = await verifiedHermesConfigMetadata(path, { lstatImpl, realpathImpl });
  if ((metadata.mode & 0o7777) !== 0o600 || metadata.uid !== HERMES_RUNTIME_IDENTITY.uid ||
      metadata.gid !== HERMES_RUNTIME_IDENTITY.gid) throw new Error('HERMES_CONFIG_IDENTITY_INVALID');
  return { config_owner_configured: true, runtime_identity: { ...HERMES_RUNTIME_IDENTITY } };
}

/** Secures only the exact Hermes config file; no parent or sibling is mutated. */
export async function enforceHermesConfigOwnership(path, {
  chmodImpl = chmod, chownImpl = chown, lstatImpl = lstat, realpathImpl = realpath
} = {}) {
  if (!isAbsolute(path) || !path.endsWith('/config.yaml')) throw new TypeError('HERMES_CONFIG_PATH_INVALID');
  await verifiedHermesConfigMetadata(path, { lstatImpl, realpathImpl });
  await chmodImpl(path, 0o600);
  await chownImpl(path, HERMES_RUNTIME_IDENTITY.uid, HERMES_RUNTIME_IDENTITY.gid);
  return inspectHermesConfigOwnership(path, { lstatImpl, realpathImpl });
}

function privateStatePath(settings) {
  const root = settings?.persistent_root;
  const seat = settings?.seat_id;
  if (!isAbsolute(root ?? '') || root === '/' || resolve(root) !== root ||
      !/^[a-z0-9][a-z0-9-]{0,31}$/.test(seat ?? '')) throw new TypeError('INSTALL_STATE_DIRECTORY_INVALID');
  const expected = join(root, 'dilemma-conference', seat, 'private');
  if (!isAbsolute(settings.state_directory ?? '') || settings.state_directory !== expected) {
    throw new TypeError('INSTALL_STATE_DIRECTORY_INVALID');
  }
  return expected;
}

const HERMES_MINI_MARKER = '# DILEMMA_MARITIME_MINI_RESPONSES_V1';
const HERMES_MINI_ANCHOR = '        # Eagerly warm the transport cache so import errors surface at init,';

export function updateHermesMiniResponsesText(text) {
  if (typeof text !== 'string' || text.includes('\0')) throw new TypeError('HERMES_RUNTIME_SOURCE_INVALID');
  if (text.includes(HERMES_MINI_MARKER)) return text;
  if (text.split(HERMES_MINI_ANCHOR).length !== 2) throw new Error('HERMES_RUNTIME_SOURCE_VERSION_MISMATCH');
  const inserted = `${HERMES_MINI_ANCHOR}\n        ${HERMES_MINI_MARKER}\n        if self._base_url_hostname == "api.maritime.sh" and str(self.model).removeprefix("openai/") == "gpt-5.4-mini":\n            self.api_mode = "codex_responses"`;
  return text.replace(HERMES_MINI_ANCHOR, inserted);
}

export async function inspectHermesMiniResponses(settings) {
  const path = '/opt/hermes/run_agent.py';
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || await realpath(path) !== path) {
    throw new Error('HERMES_CONFIG_INSPECTION_INVALID');
  }
  try {
    const source = await readFile(path, 'utf8');
    if (updateHermesMiniResponsesText(source) !== source) throw new Error('missing patch');
  }
  catch { throw new Error('HERMES_CONFIG_INSPECTION_INVALID'); }
  return { hermes_mini_responses_configured: true };
}

async function verifiedStateMetadata(path, { lstatImpl, realpathImpl }) {
  const metadata = await lstatImpl(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpathImpl(path) !== resolve(path)) {
    throw new Error('INSTALL_STATE_DIRECTORY_UNSAFE');
  }
  return metadata;
}

function gameplayCommandPaths(settings, wrapper) {
  const root = settings?.persistent_root;
  const seat = settings?.seat_id;
  if (!isAbsolute(root ?? '') || root === '/' || resolve(root) !== root ||
      !/^[a-z0-9][a-z0-9-]{0,31}$/.test(seat ?? '')) throw new TypeError('INSTALL_BIN_DIRECTORY_INVALID');
  const directory = join(root, 'dilemma-conference', seat, 'bin');
  const executable = join(directory, 'yarn');
  if (settings.bin_directory !== directory || wrapper !== executable) {
    throw new TypeError('INSTALL_BIN_DIRECTORY_INVALID');
  }
  return { directory, executable };
}

async function verifiedGameplayMetadata(path, kind, { lstatImpl, realpathImpl }) {
  const metadata = await lstatImpl(path);
  const expected = kind === 'directory' ? metadata.isDirectory() : metadata.isFile();
  if (!expected || metadata.isSymbolicLink() || await realpathImpl(path) !== resolve(path)) {
    throw new Error('INSTALL_GAMEPLAY_COMMAND_UNSAFE');
  }
  return metadata;
}

/** Grants only the selected runtime identity access to the exact bin directory and wrapper. */
export async function prepareGameplayCommandAccess(settings, wrapper, {
  chmodImpl = chmod, chownImpl = chown, lstatImpl = lstat, realpathImpl = realpath
} = {}) {
  const identity = runtimeIdentityForSettings(settings);
  const { directory, executable } = gameplayCommandPaths(settings, wrapper);
  const directoryBefore = await verifiedGameplayMetadata(directory, 'directory', { lstatImpl, realpathImpl });
  const executableBefore = await verifiedGameplayMetadata(executable, 'file', { lstatImpl, realpathImpl });
  await chmodImpl(directory, 0o700);
  await chmodImpl(executable, 0o700);
  if (identity && (directoryBefore.uid !== identity.uid || directoryBefore.gid !== identity.gid)) {
    await chownImpl(directory, identity.uid, identity.gid);
  }
  if (identity && (executableBefore.uid !== identity.uid || executableBefore.gid !== identity.gid)) {
    await chownImpl(executable, identity.uid, identity.gid);
  }
  const directoryAfter = await verifiedGameplayMetadata(directory, 'directory', { lstatImpl, realpathImpl });
  const executableAfter = await verifiedGameplayMetadata(executable, 'file', { lstatImpl, realpathImpl });
  for (const metadata of [directoryAfter, executableAfter]) {
    if ((metadata.mode & 0o7777) !== 0o700 ||
        (identity && (metadata.uid !== identity.uid || metadata.gid !== identity.gid))) {
      throw new Error('INSTALL_GAMEPLAY_COMMAND_IDENTITY_INVALID');
    }
  }
  return { directory, executable, mode: '0700', ...(identity ? { runtime_identity: { ...identity } } : {}) };
}

/** Prepares only the exact seat-private directory; existing descendants are never chowned. */
export async function preparePrivateStateDirectory(settings, {
  mkdirImpl = mkdir, chmodImpl = chmod, chownImpl = chown,
  lstatImpl = lstat, realpathImpl = realpath
} = {}) {
  const identity = runtimeIdentityForSettings(settings);
  const path = privateStatePath(settings);
  await mkdirImpl(path, { recursive: true, mode: 0o700 });
  const before = await verifiedStateMetadata(path, { lstatImpl, realpathImpl });
  await chmodImpl(path, 0o700);
  if (identity && (before.uid !== identity.uid || before.gid !== identity.gid)) {
    await chownImpl(path, identity.uid, identity.gid);
  }
  const after = await verifiedStateMetadata(path, { lstatImpl, realpathImpl });
  if ((after.mode & 0o7777) !== 0o700 ||
      (identity && (after.uid !== identity.uid || after.gid !== identity.gid))) {
    throw new Error('INSTALL_STATE_DIRECTORY_IDENTITY_INVALID');
  }
  return { path, mode: '0700', ...(identity ? { runtime_identity: { ...identity } } : {}) };
}

export async function inspectHermesPrivateState(settings, {
  lstatImpl = lstat, realpathImpl = realpath
} = {}) {
  const identity = runtimeIdentityForSettings(settings);
  if (!identity) throw new TypeError('MARITIME_RUNTIME_IDENTITY_INVALID');
  const path = privateStatePath(settings);
  const metadata = await verifiedStateMetadata(path, { lstatImpl, realpathImpl });
  if ((metadata.mode & 0o7777) !== 0o700 || metadata.uid !== identity.uid || metadata.gid !== identity.gid) {
    throw new Error('INSTALL_STATE_DIRECTORY_IDENTITY_INVALID');
  }
  return { private_state_owner_configured: true, runtime_identity: { ...identity } };
}

export async function configureHermesTerminalEnvPassthrough(path, {
  enforceOwnershipImpl = enforceHermesConfigOwnership
} = {}) {
  if (!isAbsolute(path) || !path.endsWith('/config.yaml')) throw new TypeError('HERMES_CONFIG_PATH_INVALID');
  const before = await readHermesConfig(path);
  const after = updateHermesConfigText(before);
  if (after !== before) {
    const temporary = `${path}.${process.pid}.tmp`;
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(after, 'utf8'); await handle.sync(); await handle.close(); handle = undefined;
      await rename(temporary, path);
      const directory = await open(dirname(path), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    } finally {
      await handle?.close();
      await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  const ownership = await enforceOwnershipImpl(path);
  if (ownership?.config_owner_configured !== true || ownership.runtime_identity?.uid !== HERMES_RUNTIME_IDENTITY.uid ||
      ownership.runtime_identity?.gid !== HERMES_RUNTIME_IDENTITY.gid) throw new Error('HERMES_CONFIG_IDENTITY_INVALID');
  return { changed: after !== before, variable: HERMES_TERMINAL_PASSTHROUGH_ENV, ...ownership };
}

export async function inspectHermesTerminalEnvPassthrough(path, {
  inspectOwnershipImpl = inspectHermesConfigOwnership
} = {}) {
  const text = await readHermesConfig(path);
  if (updateHermesConfigText(text) !== text) throw new Error('HERMES_ENV_PASSTHROUGH_UNCONFIGURED');
  const ownership = await inspectOwnershipImpl(path);
  if (ownership?.config_owner_configured !== true || ownership.runtime_identity?.uid !== HERMES_RUNTIME_IDENTITY.uid ||
      ownership.runtime_identity?.gid !== HERMES_RUNTIME_IDENTITY.gid) throw new Error('HERMES_CONFIG_IDENTITY_INVALID');
  return { configured: true, variable: HERMES_TERMINAL_PASSTHROUGH_ENV, ...ownership };
}

/**
 * Applies only the Hermes terminal allowlist after the template has completed
 * its restart-time bootstrap. Runtime installation intentionally does not call
 * this: Maritime may rematerialize /opt/data/config.yaml during restart.
 */
export async function configureHermesHarness(settings) {
  if (settings?.harness !== 'hermes') throw new TypeError('INSTALL_HARNESS_INVALID');
  runtimeIdentityForSettings(settings);
  privateStatePath(settings);
  // Hermes can rematerialize its volume without the seat-private directory;
  // recreate only this validated path before the ownership inspection.
  await preparePrivateStateDirectory(settings);
  const path = hermesConfigPath(settings);
  await configureHermesTerminalEnvPassthrough(path);
  return { schema_version: 1, seat_id: settings.seat_id,
    ...await inspectHermesTerminalEnvPassthrough(path),
    ...await inspectHermesPrivateState(settings) };
}

export function updateOpenClawConfigText(text) {
  if (typeof text !== 'string') throw new Error('OPENCLAW_CONFIG_INVALID');
  return updateOpenClawOAuthConfigText(text.trim() ? text : '{}');
}

export function inspectOpenClawConfigText(text) {
  try { inspectOpenClawOAuthConfigText(text); }
  catch { throw new Error('MODEL_CONFIG_INVALID'); }
  return { ...REQUIRED_MODEL_PROFILE };
}

function openClawConfigPath(settings) {
  const root = resolve(settings?.persistent_root ?? '');
  const expected = join(root, '.openclaw', 'openclaw.json');
  if (!isAbsolute(settings?.persistent_root ?? '') || root === '/' || resolve(settings.openclaw_config_path ?? '') !== expected ||
      settings.openclaw_config_path !== expected) throw new Error('OPENCLAW_CONFIG_PATH_INVALID');
  return expected;
}

export async function configureModel(settings) {
  if (settings.harness === 'hermes') {
    const path = hermesConfigPath(settings);
    await configureHermesTerminalEnvPassthrough(path);
    return inspectModel(settings);
  }
  if (settings.harness === 'openclaw') {
    const path = openClawConfigPath(settings);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    let current = '';
    try {
      const metadata = await lstat(path);
      if (!metadata.isFile() || metadata.isSymbolicLink() || await realpath(path) !== path) {
        throw new Error('OPENCLAW_CONFIG_FILE_INVALID');
      }
      current = await readFile(path, 'utf8');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const next = updateOpenClawConfigText(current);
    if (next !== current) {
      const temporary = `${path}.${process.pid}.tmp`;
      let handle;
      try {
        handle = await open(temporary, 'wx', 0o600);
        await handle.writeFile(next, 'utf8'); await handle.sync(); await handle.close(); handle = undefined;
        await rename(temporary, path);
        const directory = await open(dirname(path), 'r');
        try { await directory.sync(); } finally { await directory.close(); }
      } finally {
        await handle?.close();
        await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
      }
    }
    return inspectModel(settings);
  }
  throw new TypeError('INSTALL_HARNESS_INVALID');
}
export async function inspectModel(settings) {
  let profile;
  if (settings.harness === 'openclaw') {
    profile = inspectOpenClawConfigText(await readFile(openClawConfigPath(settings), 'utf8'));
  } else if (settings.harness === 'hermes') {
    const text = await readFile(hermesConfigPath(settings), 'utf8');
    const updated = updateHermesConfigText(text);
    if (updated !== text) throw new Error('MODEL_CONFIG_INVALID');
    profile = REQUIRED_MODEL_PROFILE;
  } else throw new TypeError('INSTALL_HARNESS_INVALID');
  return { schema_version: 1, seat_id: settings.seat_id, harness: settings.harness,
    configured: true, ...profile };
}

/** Configuration/environment evidence only; this does not certify a native call. */
export async function inspectModelRoute(settings, { env = process.env, readFileImpl = readFile } = {}) {
  const endpoint = HERMES_OAUTH_PROFILE.endpoint;
  const reject = () => { throw new Error('READINESS_MODEL_ROUTE_UNVERIFIED'); };
  try {
    for (const key of ['OPENAI_API_KEY', 'CODEX_API_KEY']) {
      if (env[key] !== undefined && env[key] !== '') reject();
    }
    for (const key of ['OPENAI_BASE_URL', 'OPENAI_API_BASE']) {
      if (env[key] !== undefined && env[key] !== endpoint) reject();
    }
    if (settings.harness === 'openclaw') {
      const profile = inspectOpenClawOAuthConfigText(await readFileImpl(openClawConfigPath(settings), 'utf8'));
      if (profile.provider !== OPENCLAW_OAUTH_PROFILE.provider || profile.endpoint !== endpoint) reject();
    } else if (settings.harness === 'hermes') {
      const expectedEnv = { HERMES_INFERENCE_PROVIDER: HERMES_OAUTH_PROFILE.provider,
        HERMES_TUI_PROVIDER: HERMES_OAUTH_PROFILE.provider, HERMES_INFERENCE_MODEL: HERMES_OAUTH_PROFILE.model,
        HERMES_TUI_MODEL: HERMES_OAUTH_PROFILE.model, HERMES_CODEX_BASE_URL: endpoint };
      for (const [key, expected] of Object.entries(expectedEnv)) {
        if (env[key] !== undefined && env[key] !== expected) reject();
      }
      const profile = inspectHermesOAuthConfigText(await readFileImpl(hermesConfigPath(settings), 'utf8'));
      if (profile.provider !== HERMES_OAUTH_PROFILE.provider || profile.endpoint !== endpoint) reject();
    } else reject();
  } catch { reject(); }
  return { schema_version: 1, seat_id: settings.seat_id, model_route_verified: true };
}

export async function installRuntime(settingsPath) {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('NODE_22_REQUIRED');
  const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
  runtimeIdentityForSettings(settings);
  privateStatePath(settings);
  const repo = settings.game_repo;
  if (!isAbsolute(repo) || !isAbsolute(settings.bin_directory)) throw new Error('INSTALL_PATH_INVALID');
  const runtimeSource = JSON.parse(await readFile(new URL('../../../shared/runtime-source.json', import.meta.url), 'utf8'));
  const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
  env.YARN_ENABLE_SCRIPTS = 'false'; env.CI = '1';
  await mkdir(dirname(repo), { recursive: true, mode: 0o700 });
  let exists = true;
  try { await access(repo); } catch (error) { if (error.code === 'ENOENT') exists = false; else throw error; }
  if (!exists) {
    await command('git', ['clone', '--no-checkout', runtimeSource.game_repository, repo], dirname(repo), env);
    await command('git', ['checkout', '--detach', runtimeSource.game_revision], repo, env);
  }
  if (await realpath(repo) !== resolve(repo)) throw new Error('INSTALL_REPO_SYMLINK_REJECTED');
  try { await lstat(join(repo, 'packages/foundry/.env')); throw new Error('FOUNDRY_ENV_EXISTS'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Never reset, delete .env, or overwrite an existing checkout to make it pass.
  await assertCleanCheckout(repo, env);
  if (await command('git', ['rev-parse', 'HEAD'], repo, env, true) !== runtimeSource.game_revision) throw new Error('INSTALL_REVISION_MISMATCH');
  // Install only the Foundry JavaScript runtime. The root Yarn workspace also
  // installs the web application and exceeds the smallest Maritime VM budget.
  await command('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-package-lock', '--workspaces=false', '--no-audit', '--no-fund'],
    join(repo, 'packages/foundry'), env);
  try { await lstat(join(repo, 'packages/foundry/.env')); throw new Error('FOUNDRY_ENV_EXISTS'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (await command('git', ['rev-parse', 'HEAD'], repo, env, true) !== runtimeSource.game_revision) throw new Error('INSTALL_REVISION_MISMATCH');
  await assertCleanCheckout(repo, env);
  await mkdir(settings.bin_directory, { recursive: true, mode: 0o700 });
  // This wrapper keeps the bridge's argv surface unchanged while refusing the
  // many unrelated scripts exposed by the upstream workspace.
  const wrapper = join(settings.bin_directory, 'yarn');
  await writeFile(wrapper, buildRestrictedYarnWrapper(repo), { mode: 0o700 });
  await prepareGameplayCommandAccess(settings, wrapper);
  await preparePrivateStateDirectory(settings);
  if (!['hermes', 'openclaw'].includes(settings.harness)) throw new Error('INSTALL_HARNESS_INVALID');
  // The clone and npm tree are created through exec, outside the uploaded-file
  // flush. Commit this filesystem's writes before Maritime snapshots the VM.
  await command('sync', ['-f', settings.persistent_root], repo, env);
  return { schema_version: 1, seat_id: settings.seat_id, runtime_installed: true, gameplay_execution_proven: false,
    hermes_private_state_owner_configured: settings.harness === 'hermes',
    hermes_gameplay_command_owner_configured: settings.harness === 'hermes' };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const action = process.argv[2] === '--check-model-route' ? readFile(process.argv[3], 'utf8').then(text => JSON.parse(text)).then(inspectModelRoute) : process.argv[2] === '--check-model' ? readFile(process.argv[3], 'utf8').then(text => JSON.parse(text)).then(inspectModel) : process.argv[2] === '--configure-model' ? readFile(process.argv[3], 'utf8').then(text => JSON.parse(text)).then(configureModel) : process.argv[2] === '--check-hermes-config' ?
    readFile(process.argv[3], 'utf8').then(text => JSON.parse(text)).then(async settings => ({
      schema_version: 1, seat_id: settings.seat_id,
      ...await inspectHermesTerminalEnvPassthrough(hermesConfigPath(settings)),
      ...await inspectHermesPrivateState(settings)
    })) : process.argv[2] === '--configure-hermes-config' ?
      readFile(process.argv[3], 'utf8').then(text => JSON.parse(text)).then(configureHermesHarness) :
      installRuntime(process.argv[2]);
  action.then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(() => {
    process.stdout.write('{"ok":false,"error":{"code":"INSTALL_RUNTIME_FAILED"}}\n'); process.exitCode = 1;
  });
}
