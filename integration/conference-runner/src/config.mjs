import { readFile, realpath, mkdir } from 'node:fs/promises';
import { isAbsolute, resolve, relative, sep, dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const source = JSON.parse(await readFile(new URL('../../shared/runtime-source.json', import.meta.url), 'utf8'));
const address = /^0x[\da-fA-F]{40}$/;
const uint = /^(0|[1-9]\d*)$/;
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const allowed = new Set(['schema_version','run_id','mode','chain_id','rpc_url','game_address','auth_adapter_address','identity_registry_address','expected_owner','start_block','start_time','stop_time','intermission_ms','poll_interval_ms','confirmations','roster','telegram','agent_timeout_ms','adapter_timeout_ms','spectator_timeout_ms']);

export function validateConfig(input, { allowIncomplete = false } = {}) {
  const c = structuredClone(input);
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error('CONFIG_OBJECT_REQUIRED');
  if (Object.keys(c).some(k => !allowed.has(k))) throw new Error('CONFIG_UNRECOGNIZED_FIELD');
  if (c.schema_version !== 1 || c.chain_id !== 84532 || !['fixture','live'].includes(c.mode)) throw new Error('CONFIG_NETWORK_OR_VERSION');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(c.run_id)) throw new Error('CONFIG_RUN_ID');
  for (const k of ['game_address','auth_adapter_address','identity_registry_address','expected_owner']) {
    if (!address.test(c[k]) || c[k].toLowerCase() !== source.network[k].toLowerCase()) throw new Error('CONFIG_PINNED_ADDRESS_MISMATCH');
  }
  const rpc = new URL(c.rpc_url);
  if (rpc.protocol !== 'https:' || rpc.username || rpc.password || rpc.hash) throw new Error('CONFIG_RPC_HTTPS_REQUIRED');
  if (!uint.test(c.start_block)) throw new Error('CONFIG_START_BLOCK');
  if (![c.start_time,c.stop_time].every(t => typeof t === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(t) && Number.isFinite(Date.parse(t))) || Date.parse(c.stop_time) <= Date.parse(c.start_time)) throw new Error('CONFIG_RUN_WINDOW');
  for (const [key, min, max] of [['intermission_ms',0,3600000],['poll_interval_ms',50,60000],['confirmations',1,100]]) {
    if (!Number.isSafeInteger(c[key]) || c[key] < min || c[key] > max) throw new Error('CONFIG_TIMING');
  }
  for (const key of ['agent_timeout_ms','adapter_timeout_ms','spectator_timeout_ms']) if (c[key] !== undefined && (!Number.isSafeInteger(c[key]) || c[key]<1 || c[key]>300000)) throw new Error('CONFIG_TIMEOUT');
  if (!Array.isArray(c.roster) || c.roster.length < 2 || c.roster.length > 20) throw new Error('CONFIG_ROSTER_SIZE');
  const seen = {seat_id:new Set(),wallet_address:new Set(),agent_id:new Set(),maritime_agent:new Set()};
  for (const s of c.roster) {
    if (Object.keys(s).some(k => !['seat_id','team','harness','agent_id','maritime_agent','wallet_address','cause_id'].includes(k))) throw new Error('CONFIG_SEAT_FIELD');
    if (!['openclaw','hermes'].includes(s.team) || s.harness !== s.team || !(s.team === 'openclaw' ? /^oc-(?:[1-9]|10)$/ : /^hs-(?:[1-9]|10)$/).test(s.seat_id)) throw new Error('CONFIG_SEAT_TEAM');
    if (!address.test(s.wallet_address) || !Number.isSafeInteger(s.cause_id) || s.cause_id<1 || s.cause_id>65535) throw new Error('CONFIG_SEAT_WALLET_OR_CAUSE');
    if (!(allowIncomplete && s.agent_id === null) && !uuid.test(s.agent_id)) throw new Error('CONFIG_AGENT_ID_REQUIRED');
    if (typeof s.maritime_agent !== 'string' || !/^[a-zA-Z0-9._-]{1,100}$/.test(s.maritime_agent)) throw new Error('CONFIG_AGENT_NAME');
    for (const key of Object.keys(seen)) {
      if (s[key] === null && allowIncomplete) continue;
      const value = s[key].toLowerCase();
      if (seen[key].has(value)) throw new Error('CONFIG_DUPLICATE_IDENTITY');
      seen[key].add(value);
    }
  }
  if (!['openclaw','hermes'].every(t => c.roster.some(s => s.team===t))) throw new Error('CONFIG_BOTH_TEAMS_REQUIRED');
  if (!c.telegram || Object.keys(c.telegram).some(k=>!['openclaw','hermes'].includes(k))) throw new Error('CONFIG_TELEGRAM');
  for (const team of ['openclaw','hermes']) {
    const channel=c.telegram[team];
    if (!channel || Object.keys(channel).some(k=>!['chat_id','invite_url'].includes(k))) throw new Error('CONFIG_TELEGRAM');
    if (channel.chat_id!==null && !/^-\d+$/.test(channel.chat_id)) throw new Error('CONFIG_TELEGRAM_GROUP');
    if (channel.invite_url!==null && !/^https:\/\/t\.me\/[a-zA-Z0-9_+/-]+$/.test(channel.invite_url)) throw new Error('CONFIG_TELEGRAM_LINK');
  }
  return c;
}

export async function loadConfig(path, options) {
  const input = JSON.parse(await readFile(path, 'utf8'));
  if (options?.debug) return (await import('./debug.mjs')).validateDebugConfig(input);
  return validateConfig(input, options);
}

export async function prepareRuntimeDirectory(directory) {
  if (!isAbsolute(directory)) throw new Error('RUNTIME_ABSOLUTE_PATH_REQUIRED');
  // Check the lexical path before creation, then resolve symlinks before writing state.
  const repo=await realpath(REPOSITORY_ROOT);
  const contains=(parent,child)=>{const r=relative(parent,child); return r==='' || (!r.startsWith(`..${sep}`) && r!=='..' && !isAbsolute(r));};
  if (contains(repo,resolve(directory)) || contains(resolve(directory),repo)) throw new Error('RUNTIME_MUST_BE_OUTSIDE_REPOSITORY');
  let parent=resolve(directory);const suffix=[];
  while(true){
    try{parent=await realpath(parent);break;}
    catch(error){if(error.code!=='ENOENT')throw error;suffix.unshift(basename(parent));const next=dirname(parent);if(next===parent)throw error;parent=next;}
  }
  const destination=join(parent,...suffix);
  if(contains(repo,destination)||contains(destination,repo))throw new Error('RUNTIME_MUST_BE_OUTSIDE_REPOSITORY');
  await mkdir(directory,{recursive:true,mode:0o700});
  const actual=await realpath(directory);
  if(contains(repo,actual)||contains(actual,repo)) throw new Error('RUNTIME_MUST_BE_OUTSIDE_REPOSITORY');
  return actual;
}

export function assertCoordinatorEnvironment(env=process.env) {
  for(const key of ['GAMEPLAY_WALLET_PRIVATE_KEY','PHASE_ADVANCER_PRIVATE_KEY','OWNER_PRIVATE_KEY','CONFERENCE_OWNER_PRIVATE_KEY','DILEMMA_LAUNCHER_PRIVATE_KEY','DILEMMA_PHASE_PRIVATE_KEY']) {
    if(env[key]) throw new Error('COORDINATOR_SIGNER_ENVIRONMENT_FORBIDDEN');
  }
}
