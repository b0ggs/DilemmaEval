import { isAbsolute, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

// Schema verified against OpenClaw v2026.7.1, the image in Maritime's guide.
// Do not apply this to an unobserved native version or call it live evidence.
// Upstream: docs/providers/openai.md; extensions/openai/{base-url,
// openai-chatgpt-provider}.ts; src/config/types.models.ts; src/agents/model-auth.ts.
export const OPENCLAW_OAUTH_PROFILE = Object.freeze({
  provider: 'openai', endpoint: 'https://chatgpt.com/backend-api/codex',
  api: 'openai-chatgpt-responses', auth_mode: 'oauth', runtime: 'openclaw',
  auth_profile_id: 'openai:conference-chatgpt', model: 'gpt-6.1-sol',
  reasoning_effort: 'low', max_output_tokens: 2048,
  automatic_fallback: false, fallback_model: null, response_metadata_required: true
});

const MODEL_REF = `openai/${OPENCLAW_OAUTH_PROFILE.model}`;
const CREDENTIAL_ENV = ['OPENAI_API_KEY', 'CODEX_API_KEY'];
const ROUTE_ENV = ['OPENAI_BASE_URL', 'OPENAI_API_BASE'];
const fail = code => { throw new Error(code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.hasOwn(value, key);
function parse(text) {
  let value;
  try { value = JSON.parse(text); } catch { fail('OPENCLAW_OAUTH_CONFIG_INVALID'); }
  if (!object(value)) fail('OPENCLAW_OAUTH_CONFIG_INVALID');
  return value;
}
function section(value, key) {
  if (value[key] === undefined) value[key] = {};
  if (!object(value[key])) fail('OPENCLAW_OAUTH_CONFIG_INVALID');
  return value[key];
}
function stripSelectedAuthAndTransport(value) {
  for (const key of ['apiKey', 'headers', 'localService']) delete value[key];
  value.baseUrl = OPENCLAW_OAUTH_PROFILE.endpoint;
  value.api = OPENCLAW_OAUTH_PROFILE.api;
  value.agentRuntime = { id: 'openclaw' };
}
function rejectUnresolvedAgentOverrides(value) {
  // Pinned schema rejects this retired global field; current runtime policy
  // belongs to the selected per-model entry or provider/model catalog row.
  if (value.agents?.defaults?.agentRuntime !== undefined) fail('OPENCLAW_OAUTH_AGENT_OVERRIDE_UNVERIFIED');
  const entries = value.agents?.list;
  if (entries === undefined) return;
  if (!Array.isArray(entries) || entries.some(entry => !object(entry))) fail('OPENCLAW_OAUTH_CONFIG_INVALID');
  // Without the observed native chat-routing identity, modifying any explicit
  // per-agent override could change an unrelated agent. Leave it untouched and
  // refuse until the lead can identify the existing game's native agent.
  if (entries.some(entry => entry.model !== undefined || entry.agentRuntime !== undefined)) {
    fail('OPENCLAW_OAUTH_AGENT_OVERRIDE_UNVERIFIED');
  }
}

/** Pure configuration edit. Credentials remain in the native private store.
 * Does not log in, replace model catalog metadata, edit wallets or migrate the
 * harness. Process-environment fallback still requires separate verification. */
export function updateOpenClawOAuthConfigText(text) {
  const value = parse(text);
  rejectUnresolvedAgentOverrides(value);
  const defaults = section(section(value, 'agents'), 'defaults');
  if (defaults.model !== undefined && typeof defaults.model !== 'string' && !object(defaults.model)) {
    fail('OPENCLAW_OAUTH_CONFIG_INVALID');
  }
  defaults.model = { ...(object(defaults.model) ? defaults.model : {}), primary: MODEL_REF, fallbacks: [] };
  defaults.thinkingDefault = 'low';
  const aliases = section(defaults, 'models');
  const selected = section(aliases, MODEL_REF);
  selected.agentRuntime = { id: 'openclaw' };
  const params = section(selected, 'params');
  params.maxTokens = 2048;
  // These legacy global token-limit fields are already excluded by our runtime.
  if (object(defaults.params)) delete defaults.params.maxTokens;
  delete defaults.maxOutputTokens;

  const provider = section(section(section(value, 'models'), 'providers'), 'openai');
  stripSelectedAuthAndTransport(provider);
  provider.auth = 'oauth';
  provider.authHeader = true;
  if (provider.models !== undefined) {
    if (!Array.isArray(provider.models) || provider.models.some(row => !object(row))) fail('OPENCLAW_OAUTH_CONFIG_INVALID');
    // Preserve other catalog rows. Never invent access/capability/context data.
    for (const row of provider.models.filter(row => row.id === OPENCLAW_OAUTH_PROFILE.model)) {
      stripSelectedAuthAndTransport(row);
    }
  }
  const auth = section(value, 'auth');
  section(auth, 'profiles')[OPENCLAW_OAUTH_PROFILE.auth_profile_id] = { provider: 'openai', mode: 'oauth' };
  section(auth, 'order').openai = [OPENCLAW_OAUTH_PROFILE.auth_profile_id];

  // Only model-route env fields change. Player signing and unrelated auth stay.
  if (value.env !== undefined) {
    if (!object(value.env) || (value.env.vars !== undefined && !object(value.env.vars))) fail('OPENCLAW_OAUTH_CONFIG_INVALID');
    for (const target of [value.env, value.env.vars].filter(object)) {
      for (const key of [...CREDENTIAL_ENV, ...ROUTE_ENV]) delete target[key];
    }
  }
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Checks configuration only; a successful result does not attest an OAuth
 * login, a model entitlement or an actual native model request. */
export function inspectOpenClawOAuthConfigText(text) {
  const value = parse(text), defaults = value.agents?.defaults, provider = value.models?.providers?.openai;
  rejectUnresolvedAgentOverrides(value);
  const invalid = () => fail('OPENCLAW_OAUTH_CONFIG_UNVERIFIED');
  if (defaults?.model?.primary !== MODEL_REF || !Array.isArray(defaults.model.fallbacks) || defaults.model.fallbacks.length ||
      defaults.thinkingDefault !== 'low' || defaults.models?.[MODEL_REF]?.agentRuntime?.id !== 'openclaw' ||
      defaults.models?.[MODEL_REF]?.params?.maxTokens !== 2048 ||
      own(defaults, 'maxOutputTokens') || defaults.params?.maxTokens !== undefined ||
      !object(provider) || provider.baseUrl !== OPENCLAW_OAUTH_PROFILE.endpoint || provider.api !== OPENCLAW_OAUTH_PROFILE.api ||
      provider.auth !== 'oauth' || provider.authHeader !== true || provider.agentRuntime?.id !== 'openclaw' ||
      ['apiKey', 'headers', 'localService'].some(key => own(provider, key))) invalid();
  const profile = value.auth?.profiles?.[OPENCLAW_OAUTH_PROFILE.auth_profile_id];
  if (profile?.provider !== 'openai' || profile.mode !== 'oauth' ||
      JSON.stringify(value.auth?.order?.openai) !== JSON.stringify([OPENCLAW_OAUTH_PROFILE.auth_profile_id])) invalid();
  if (provider.models !== undefined) {
    if (!Array.isArray(provider.models) || provider.models.some(row => !object(row))) invalid();
    const selectedRows = provider.models.filter(row => row.id === OPENCLAW_OAUTH_PROFILE.model);
    if (selectedRows.length > 1 || selectedRows.some(row => row.baseUrl !== OPENCLAW_OAUTH_PROFILE.endpoint ||
      row.api !== OPENCLAW_OAUTH_PROFILE.api || row.agentRuntime?.id !== 'openclaw' ||
      ['apiKey', 'headers', 'localService'].some(key => own(row, key)))) invalid();
  }
  for (const target of [value.env, value.env?.vars].filter(object)) {
    if ([...CREDENTIAL_ENV, ...ROUTE_ENV].some(key => own(target, key))) invalid();
  }
  return { configured: true, ...OPENCLAW_OAUTH_PROFILE, oauth_verified: false, actual_model_call_verified: false };
}

function validateSettings(settings) {
  const root = settings?.persistent_root;
  if (settings?.harness !== 'openclaw' || !/^oc-[1-5]$/.test(settings?.seat_id ?? '') ||
      root !== '/data' || root.includes('\0') ||
      settings.openclaw_config_path !== join(root, '.openclaw', 'openclaw.json')) {
    fail('OPENCLAW_OAUTH_RUNTIME_IDENTITY_INVALID');
  }
  return settings;
}

/** Execute ONLY in that existing agent's interactive Maritime Terminal. The
 * user completes the one-time browser/device sign-in. No force/reset/default
 * model flag is included; the native CLI owns storage and token refresh. */
export function buildOpenClawOAuthLoginCommand(settings) {
  validateSettings(settings);
  return ['openclaw', 'models', 'auth', 'login', '--provider', 'openai', '--device-code',
    '--profile-id', OPENCLAW_OAUTH_PROFILE.auth_profile_id];
}

/** Validate native CLI health metadata in memory. Never return account labels,
 * paths, provider prose or credential values. A status read is not an actual
 * model call; the existing native chat diagnostics must supply that evidence. */
export function validateOpenClawOAuthStatus(status, { env, nowMs = Date.now(), runtimeVersion, settings } = {}) {
  if (runtimeVersion !== '2026.7.1') fail('OPENCLAW_OAUTH_NATIVE_VERSION_UNVERIFIED');
  if (!Number.isSafeInteger(nowMs) || nowMs < 1 || !object(env)) fail('OPENCLAW_OAUTH_AUTH_UNVERIFIED');
  if (settings) {
    validateSettings(settings);
    if (status?.configPath !== settings.openclaw_config_path) fail('OPENCLAW_OAUTH_RUNTIME_IDENTITY_INVALID');
  }
  if (CREDENTIAL_ENV.some(key => typeof env[key] === 'string' && env[key].trim()) ||
      ROUTE_ENV.some(key => env[key] !== undefined && env[key] !== OPENCLAW_OAUTH_PROFILE.endpoint)) {
    fail('OPENCLAW_OAUTH_API_FALLBACK_PRESENT');
  }
  if (status?.defaultModel !== MODEL_REF || status.resolvedDefault !== MODEL_REF ||
      !Array.isArray(status.fallbacks) || status.fallbacks.length) fail('OPENCLAW_OAUTH_NATIVE_MODEL_UNVERIFIED');
  const profiles = status.auth?.oauth?.profiles, providers = status.auth?.oauth?.providers;
  if (!Array.isArray(profiles) || !Array.isArray(providers) || !Array.isArray(status.auth?.unusableProfiles) ||
      !Array.isArray(status.auth?.providers)) {
    fail('OPENCLAW_OAUTH_AUTH_UNVERIFIED');
  }
  // The CLI can hydrate its own .env or models.json after this observer starts.
  // Inspect its native overview too; parent process.env is insufficient.
  const overviews = status.auth.providers.filter(row => row?.provider === 'openai');
  if (overviews.length !== 1 || overviews[0].effective?.kind !== 'profiles' ||
      ['env', 'modelsJson', 'syntheticAuth'].some(key => own(overviews[0], key))) {
    fail('OPENCLAW_OAUTH_API_FALLBACK_PRESENT');
  }
  const matches = profiles.filter(row => row?.profileId === OPENCLAW_OAUTH_PROFILE.auth_profile_id);
  const providerMatches = providers.filter(row => row?.provider === 'openai');
  const usable = row => row?.profileId === OPENCLAW_OAUTH_PROFILE.auth_profile_id && row.provider === 'openai' &&
    row.type === 'oauth' && row.source === 'store' && ['ok', 'expiring'].includes(row.status) &&
    Number.isSafeInteger(row.expiresAt) && row.expiresAt > nowMs &&
    (row.reasonCode === undefined || row.reasonCode === 'ok');
  if (matches.length !== 1 || !usable(matches[0]) || providerMatches.length !== 1 ||
      !['ok', 'expiring'].includes(providerMatches[0].status) ||
      !Array.isArray(providerMatches[0].effectiveProfiles) || providerMatches[0].effectiveProfiles.length !== 1 ||
      !usable(providerMatches[0].effectiveProfiles[0]) ||
      status.auth.unusableProfiles.some(row => row?.profileId === OPENCLAW_OAUTH_PROFILE.auth_profile_id)) {
    fail('OPENCLAW_OAUTH_AUTH_UNVERIFIED');
  }
  return { oauth_verified: true, oauth_profile_exclusive: true, inspection_env_api_fallback_absent: true,
    inspection_cli_api_fallback_absent: true,
    inspection_cli_version_verified: true, native_model_selected: true,
    native_gateway_environment_verified: false, actual_model_call_verified: false };
}

/** Bounded local native inspection inside the existing remote runtime. The
 * subprocess stdout/stderr stays in memory and only fixed evidence escapes.
 * This builds a command; it does not wake or execute anything. */
export function buildOpenClawOAuthInspectionCommand({ settings, modulePath } = {}) {
  validateSettings(settings);
  if (typeof modulePath !== 'string' || !isAbsolute(modulePath) || resolve(modulePath) !== modulePath ||
      modulePath !== join(settings.persistent_root, 'dilemma-conference', settings.seat_id, 'code',
        'integration', 'conference-runner', 'src', 'maritime', 'openclaw-oauth.mjs')) {
    fail('OPENCLAW_OAUTH_RUNTIME_IDENTITY_INVALID');
  }
  const source = `
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, lstat, realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
try {
 const s=JSON.parse(process.argv[2]);
 const m=await import(pathToFileURL(process.argv[1]).href);
 const node=await realpath(process.execPath),cli='/app/openclaw.mjs',packagePath='/app/package.json';
 for(const path of [node,cli,packagePath]) {
  const entry=await lstat(path);
  if(!entry.isFile()||entry.isSymbolicLink()||await realpath(path)!==path||entry.size<1||entry.size>209715200||(entry.mode&0o022))throw 0;
 }
 const pkg=JSON.parse(await readFile(packagePath,'utf8'));
 if(pkg.name!=='openclaw'||pkg.version!=='2026.7.1')throw 0;
 const stat=await lstat(s.openclaw_config_path);
 if(!stat.isFile()||stat.isSymbolicLink()||await realpath(s.openclaw_config_path)!==s.openclaw_config_path||stat.size<1||stat.size>1048576)throw 0;
 const profile=m.inspectOpenClawOAuthConfigText(await readFile(s.openclaw_config_path,'utf8'));
 if(['OPENCLAW_PROFILE','OPENCLAW_AGENT_DIR','OPENCLAW_OAUTH_DIR'].some(key=>process.env[key])||
   (process.env.OPENCLAW_HOME&&process.env.OPENCLAW_HOME!=='/data'))throw 0;
 const env={...process.env,HOME:'/data',OPENCLAW_STATE_DIR:'/data/.openclaw',OPENCLAW_CONFIG_PATH:s.openclaw_config_path};
 const run=promisify(execFile),opts={timeout:30000,maxBuffer:262144,encoding:'utf8',env,cwd:'/data'};
 const stdout=(await run(node,[cli,'--version'],opts)).stdout;
 // Pinned native CLI prints this complete line; reject banners, suffixes,
 // alternate versions and substring matches rather than normalizing them.
 const versionMatch=/^OpenClaw (2026\\.7\\.1)(?:\\r?\\n)?$/.exec(stdout);
 if(!versionMatch||versionMatch[0]!==stdout)throw 0;
 const version=versionMatch[1];
 const status=JSON.parse((await run(node,[cli,'models','status','--json'],opts)).stdout);
 const evidence=m.validateOpenClawOAuthStatus(status,{env,runtimeVersion:version,settings:s});
 process.stdout.write(JSON.stringify({schema_version:1,seat_id:s.seat_id,harness:'openclaw',...profile,...evidence}));
} catch {process.exitCode=1;}
`;
  return ['node', '--input-type=module', '-e', source, modulePath, JSON.stringify({
    harness: settings.harness, seat_id: settings.seat_id, persistent_root: settings.persistent_root,
    openclaw_config_path: settings.openclaw_config_path
  })];
}


const PRODUCTION_OBSERVER_ID = 'conference-oauth-observer';
function productionObserverOptions({ settings, operationId, deadlineAtMs, publicRequestId } = {}, receipt = false) {
  validateSettings(settings);
  if (typeof operationId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(operationId) ||
      !Number.isSafeInteger(deadlineAtMs) || deadlineAtMs < 1 ||
      receipt && (typeof publicRequestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,239}$/.test(publicRequestId))) {
    fail('OPENCLAW_OAUTH_OBSERVER_INPUT_INVALID');
  }
  const base = join(settings.persistent_root, 'dilemma-conference', settings.seat_id);
  return { seat_id: settings.seat_id, operation_id: operationId, deadline_at_ms: deadlineAtMs,
    config_path: settings.openclaw_config_path,
    module_path: join(base, 'code', 'integration', 'conference-runner', 'src', 'maritime', 'openclaw-oauth.mjs'),
    directory: join(settings.persistent_root, '.conference-production-oauth', settings.seat_id, operationId),
    ...(receipt ? { public_request_id: publicRequestId } : {}) };
}

// A native Gateway service, not a local CLI inference. The only persisted
// values are bounded public IDs, hashes, fixed booleans and process identity.
// The request/body, OAuth bearer/account and response content stay in memory.
// A fresh operation directory and one physical-send fuse per body prevent
// replay after uncertainty while allowing completed tool-call continuations.
// Serialized request digests stay in memory; durable fuse names bind only to
// the public request ID and ordinal. Only a clean completed activation may
// restart; incomplete/blocked calls and consumed public IDs remain refused.
function openClawProductionPluginSource(options) {
  return `
import fs from 'node:fs';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const o=${JSON.stringify(options)},require=createRequire('/app/package.json');
const hash=value=>createHash('sha256').update(value).digest('hex');
const refused=()=>new Error('OPENCLAW_OAUTH_PRODUCTION_OBSERVER_REFUSED');
const identity=()=>{
 const stat=fs.readFileSync('/proc/self/stat','utf8');
 const birth=stat.slice(stat.lastIndexOf(')')+2).split(' ')[19];
 const argv=fs.readFileSync('/proc/self/cmdline','utf8').split('\\0');
 if(!/^[0-9]+$/.test(birth)||!argv.some(a=>a==='openclaw-gateway'||a==='gateway'))throw refused();
 return {pid:process.pid,start_ticks:birth};
};
const processEnv=()=>{
 if(['OPENAI_API_KEY','CODEX_API_KEY','OPENCLAW_PROFILE','OPENCLAW_AGENT_DIR','OPENCLAW_OAUTH_DIR'].some(k=>process.env[k])||
 ['OPENAI_BASE_URL','OPENAI_API_BASE'].some(k=>process.env[k]!==undefined&&process.env[k]!=='https://chatgpt.com/backend-api/codex')||
 process.env.HOME!=='/data'||process.env.OPENCLAW_STATE_DIR&&process.env.OPENCLAW_STATE_DIR!=='/data/.openclaw'||
 process.env.OPENCLAW_CONFIG_PATH&&process.env.OPENCLAW_CONFIG_PATH!==o.config_path)throw refused();
};
const requestIdentity=payload=>{
 const messages=payload.input;
 if(!Array.isArray(messages))throw refused();
 const user=[...messages].reverse().find(m=>m?.role==='user');
 const text=typeof user?.content==='string'?user.content:Array.isArray(user?.content)?user.content.filter(c=>typeof c?.text==='string').map(c=>c.text).join('\\n'):'';
 const marker='\\nREQUEST_JSON\\n',pos=text.lastIndexOf(marker);
 if(pos<0)throw refused();
 const q=JSON.parse(text.slice(pos+marker.length).trim().split('\\n')[0]);
 const gameplay=q?.type===undefined&&q.response_schema_version===1&&['join','commit','reveal','claim'].includes(q.requested_action);
 if((!gameplay&&(q?.schema_version!==1||!['runtime-diagnostic','discussion'].includes(q.type)))||q.seat_id!==o.seat_id||
 !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,239}$/.test(q.request_id??''))throw refused();
 if(q.type==='runtime-diagnostic'&&(!['gameplay-input','commit-input'].includes(q.mode)||q.chain_state?.chain_id!==84532))throw refused();
 if(q.type!=='runtime-diagnostic'&&q.chain_state?.chain_id!==84532&&q.chain_id!==84532)throw refused();
 return {id:q.request_id,kind:gameplay?'gameplay':q.type,mode:q.mode??null};
};
async function collect(body){
 let size=0;const chunks=[];
 for await(const chunk of body){if((size+=chunk.byteLength)>2097152)throw refused();chunks.push(Buffer.from(chunk));}
 return Buffer.concat(chunks);
}
export default {id:'${PRODUCTION_OBSERVER_ID}',register(api){
 let stopReceipt;
 api.registerService({id:'${PRODUCTION_OBSERVER_ID}',async start(ctx){
  const pid=identity();processEnv();
  if(ctx.stateDir!=='/data/.openclaw'||Date.now()>=o.deadline_at_ms||require('/app/package.json').name!=='openclaw'||
   require('/app/package.json').version!=='2026.7.1')throw refused();
  const helper=await import(pathToFileURL(o.module_path).href);
  helper.inspectOpenClawOAuthConfigText(JSON.stringify(ctx.config));
  const sdkPath=require.resolve('openclaw/plugin-sdk/provider-auth');
  const sdk=await import(pathToFileURL(sdkPath).href);
  const cfg=JSON.parse(fs.readFileSync(o.config_path,'utf8'));
  helper.inspectOpenClawOAuthConfigText(JSON.stringify(cfg));
  const {agentDir}=sdk.listUsableProviderAuthProfileIds({provider:'openai',cfg,includeExternalCliAuth:false,allowKeychainPrompt:false});
  if(!agentDir)throw refused();
  let previous;
  try{previous=JSON.parse(fs.readFileSync(o.directory+'/receipt.json','utf8'));}catch(error){if(error?.code!=='ENOENT')throw refused();}
  const r={schema_version:1,seat_id:o.seat_id,operation_id:o.operation_id,deadline_at_ms:o.deadline_at_ms,
   gateway_pid:pid.pid,gateway_start_ticks:pid.start_ticks,gateway_started_at_ms:Date.now(),
   plugin_sha256:hash(fs.readFileSync(o.directory+'/index.mjs')),helper_sha256:hash(fs.readFileSync(o.module_path)),
   native_entrypoint_sha256:hash(fs.readFileSync('/app/openclaw.mjs')),native_auth_sdk_sha256:hash(fs.readFileSync(sdkPath)),
   config_sha256:hash(fs.readFileSync(o.config_path)),native_gateway_environment_verified:true,blocked:false,
   gateway_stopped:false,activations:[],calls:[]};
  if(previous){
   if(previous.schema_version!==1||previous.seat_id!==o.seat_id||previous.operation_id!==o.operation_id||
    previous.deadline_at_ms!==o.deadline_at_ms||previous.blocked!==false||!Array.isArray(previous.calls)||
    previous.calls.length>64||!Array.isArray(previous.activations)||previous.activations.length>=64||
    previous.calls.some(c=>c.completed!==true)||previous.calls.length&&previous.calls.at(-1).native_turn_completed!==true||
    ['plugin_sha256','helper_sha256','config_sha256','native_entrypoint_sha256','native_auth_sdk_sha256'].some(k=>previous[k]!==r[k]))throw refused();
   if(previous.gateway_stopped!==true){
    try{const old=fs.readFileSync('/proc/'+previous.gateway_pid+'/stat','utf8');
     if(old.slice(old.lastIndexOf(')')+2).split(' ')[19]===previous.gateway_start_ticks)throw refused();
    }catch(error){if(error?.code!=='ENOENT')throw refused();}
   }
   r.calls=previous.calls;r.activations=previous.activations;
  }
  fs.writeFileSync(o.directory+'/activation-'+pid.pid+'-'+pid.start_ticks,JSON.stringify(pid),{mode:0o600,flag:'wx'});
  r.activations.push({pid:pid.pid,start_ticks:pid.start_ticks,started_at_ms:r.gateway_started_at_ms});
  const persist=()=>{
   const fd=fs.openSync(o.directory+'/receipt.json',fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_NOFOLLOW,0o600);
   try{fs.ftruncateSync(fd,0);fs.writeFileSync(fd,JSON.stringify(r)+'\\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
   const dir=fs.openSync(o.directory,fs.constants.O_RDONLY);try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
  };
  stopReceipt=()=>{r.gateway_stopped=true;if(active){r.blocked=true;r.refusal_phase??='stopped';}abort.abort();persist();};
  let active=false;const pending=new Map(),seenBodies=new Set(),abort=new AbortController();
  // Persist only fixed phases and bounded response facts. Native retries may
  // not overwrite the first cause or release any physical-send fuse.
  const block=(phase='admission',row)=>{r.blocked=true;r.refusal_phase??=phase;
   if(row)row.refusal_phase??=r.refusal_phase;persist();abort.abort();throw refused();};
  const wrap=original=>async(input,init)=>{
   let row,phase='request';
   try{
    const q=new Request(input instanceof Request?input.clone():input,init);
    // Non-provider fetches keep their native behavior; inference on another
    // OpenAI/proxy route is refused instead of becoming an auth fallback.
    const url=new URL(q.url);
    // One approved grant is copied into the existing native stores. Token
    // rotation must be resolved by the lead rather than racing these copies.
    if(['auth.openai.com','auth0.openai.com'].includes(url.hostname)&&url.pathname==='/oauth/token')return block('oauth-refresh');
    if(q.url!=='https://chatgpt.com/backend-api/codex/responses'){
     if(url.hostname==='chatgpt.com'&&url.pathname.startsWith('/backend-api/codex')||
       ['api.openai.com','api.maritime.sh'].includes(url.hostname)&&/\\/(responses|chat\\/completions|completions)(?:\\/|$)/.test(url.pathname))return block('provider-route');
     return original(input,init);
    }
    if(r.gateway_stopped||r.blocked||active||Date.now()>=o.deadline_at_ms||r.calls.length>=64||q.method!=='POST')return block();
    active=true;phase='environment';processEnv();
    phase='config';
    const live=JSON.parse(fs.readFileSync(o.config_path,'utf8'));
    helper.inspectOpenClawOAuthConfigText(JSON.stringify(live));
    if(hash(fs.readFileSync(o.config_path))!==r.config_sha256)throw refused();
    phase='oauth';const store=sdk.ensureAuthProfileStore(agentDir,{config:live,readOnly:true,syncExternalCli:false,allowKeychainPrompt:false});
    const p=store.profiles['openai:conference-chatgpt'];
    const selected=Object.entries(store.profiles).filter(([,v])=>v?.provider==='openai');
    if(selected.length!==1||selected[0][0]!=='openai:conference-chatgpt'||
     JSON.stringify(store.order?.openai)!=='["openai:conference-chatgpt"]'||p?.type!=='oauth'||p.provider!=='openai'||
     typeof p.access!=='string'||!p.access||typeof p.refresh!=='string'||!p.refresh||!(Number.isSafeInteger(p.expires)&&p.expires>o.deadline_at_ms+300000)||
     q.headers.get('authorization')!=='Bearer '+p.access||!p.accountId||
     q.headers.get('chatgpt-account-id')!==null&&q.headers.get('chatgpt-account-id')!==p.accountId||
     sdk.resolveOpenAICodexAuthIdentity({access:p.access}).accountId!==p.accountId)throw refused();
    phase='request-body';let bytes=await collect(q.body);const encoding=q.headers.get('content-encoding');
    if(encoding==='zstd')bytes=zlib.zstdDecompressSync(bytes,{maxOutputLength:2097152});else if(encoding&&encoding!=='identity')throw refused();
    const payload=JSON.parse(bytes.toString('utf8'));phase='request-identity';const request=requestIdentity(payload);
    phase='request-model';
    if(payload.model!=='gpt-6.1-sol'||payload.stream!==true||
      payload.reasoning?.effort!==undefined&&payload.reasoning.effort!=='low')throw refused();
    phase='tool-continuation';const last=r.calls.at(-1);
    if(last&&last.native_turn_completed!==true&&last.public_request_id!==request.id)throw refused();
    const prior=pending.get(request.id);
    if(prior?.length){
     const outputs=payload.input.filter(x=>x?.type==='function_call_output').map(x=>x.call_id);
     if(!prior.every(id=>outputs.includes(id)))throw refused();
    }else if(r.calls.some(c=>c.public_request_id===request.id))throw refused();
    if(r.gateway_stopped||r.blocked||Date.now()>=o.deadline_at_ms)throw refused();
    phase='physical-fuse';const digest=hash(bytes);if(seenBodies.has(digest))throw refused();seenBodies.add(digest);
    // Persist public-ID admission before the physical send. Request body
    // digests are in-memory only. An ambiguous response never frees the
    // fuse, including after a Gateway restart or native automatic retry.
    fs.writeFileSync(o.directory+'/wire-'+hash(request.id)+'-'+r.calls.length,JSON.stringify(pid),{mode:0o600,flag:'wx'});
    row={public_request_id:request.id,request_type:request.kind,diagnostic_mode:request.mode,
     gateway_pid:pid.pid,gateway_start_ticks:pid.start_ticks,
     started_at_ms:Date.now(),oauth_verified:true,
     oauth_profile_exclusive:true,api_fallback_absent:true,requested_model:'gpt-6.1-sol',
     endpoint_verified:true,completed:false,returned_model_verified:false};
    r.calls.push(row);persist();
    phase='upstream-send';const response=await original(input,{...init,redirect:'error',signal:AbortSignal.any([q.signal,abort.signal,
      AbortSignal.timeout(o.deadline_at_ms-Date.now())])});
    phase='upstream-response';
    row.upstream_status=Number.isInteger(response.status)&&response.status>=100&&response.status<=599?response.status:0;
    row.upstream_sse=response.headers.get('content-type')?.split(';')[0].trim()==='text/event-stream';
    if(r.gateway_stopped||r.blocked||response.status!==200||!row.upstream_sse)throw refused();
    phase='stream-read';row.stream_completion='pending';persist();
    const raw=(await collect(response.clone().body)).toString('utf8').replace(/\\r\\n/g,'\\n');
    row.stream_completion='read';row.created_events=0;row.terminal_events=0;row.returned_model_matches=true;
    let created,terminal,createdCount=0,terminalCount=0;phase='sse-json';
    for(const packet of raw.split('\\n\\n')){
     const data=packet.split('\\n').filter(x=>x.startsWith('data:')).map(x=>x.slice(5).trimStart()).join('\\n');
     if(!data||data==='[DONE]')continue;const event=JSON.parse(data);
     phase='response-model';if(event.response?.model!==undefined&&event.response.model!=='gpt-6.1-sol'){row.returned_model_matches=false;throw refused();}
     phase='response-event';if(['response.failed','response.incomplete','error'].includes(event.type)){row.stream_completion='failed-event';throw refused();}
     if(event.type==='response.created'){created=event.response;createdCount++;row.created_events=Math.min(createdCount,65);}
     if(event.type==='response.completed'){terminal=event.response;terminalCount++;row.terminal_events=Math.min(terminalCount,65);}
     phase='sse-json';
    }
    phase='response-completion';row.created_and_terminal_id_match=typeof created?.id==='string'&&!!created.id&&created.id===terminal?.id;
    row.terminal_status_completed=terminal?.status==='completed';row.terminal_output_array=Array.isArray(terminal?.output);
    row.returned_model_matches=row.returned_model_matches&&terminal?.model==='gpt-6.1-sol';
    if(createdCount!==1||terminalCount!==1||typeof created?.id!=='string'||!created.id||created.id!==terminal?.id||
      terminal.model!=='gpt-6.1-sol'||terminal.status!=='completed'||!Array.isArray(terminal.output))throw refused();
    phase='response-tools';const tools=terminal.output.filter(x=>x?.type==='function_call');
    if(tools.some(x=>typeof x.call_id!=='string'||!x.call_id))throw refused();
    pending.set(request.id,tools.map(x=>x.call_id));
    Object.assign(row,{stream_completion:'verified',completed:true,native_turn_completed:tools.length===0,returned_model_verified:true,returned_model:'gpt-6.1-sol',
      response_id_sha256:hash(created.id),completed_at_ms:Date.now()});persist();
    active=false;return response;
   }catch{return block(phase,row);}
  };
  const originalFetch=globalThis.fetch,undici=require('undici'),originalUndici=undici.fetch,originalWebSocket=globalThis.WebSocket;
  const guardedFetch=wrap(originalFetch),guardedUndici=wrap(originalUndici);
  globalThis.fetch=guardedFetch;undici.fetch=guardedUndici;
  // SSE carries the raw returned model. Reject WS construction before wire;
  // the selected native transport is configured to SSE during preparation.
  const guardedWebSocket=class extends (originalWebSocket??class{}){constructor(url,...args){
   const target=new URL(String(url));
   if(['chatgpt.com','api.openai.com','api.maritime.sh'].includes(target.hostname))return block('websocket');
   super(url,...args);
  }};globalThis.WebSocket=guardedWebSocket;
  // Keep the guard installed for this process lifetime. A stopped native
  // request may still attempt its provider retry; it must never reach wire.
  persist();
 },stop(){stopReceipt?.();}});
}};
`;
}

/** Stages the bounded native Gateway service only. The lead must use the
 * existing supported production refresh path and independently inspect its
 * actual PID/source-bound receipt before sending useful /chat diagnostics.
 * This command never starts a Gateway or performs inference. */
export function buildOpenClawProductionObserverCommand(input = {}) {
  const options = productionObserverOptions(input);
  const plugin = openClawProductionPluginSource(options);
  const source = `
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
try{
 const o=JSON.parse(process.argv[1]),plugin=process.argv[2];
 if(Date.now()>=o.deadline_at_ms||o.deadline_at_ms>Date.now()+14400000)throw 0;
 const m=await import(pathToFileURL(o.module_path).href),path=o.config_path;
 const st=fs.lstatSync(path);
 if(!st.isFile()||st.isSymbolicLink()||fs.realpathSync(path)!==path)throw 0;
 const cfg=JSON.parse(fs.readFileSync(path,'utf8'));m.inspectOpenClawOAuthConfigText(JSON.stringify(cfg));
 const p=cfg.plugins??={};
 if(typeof p!=='object'||Array.isArray(p)||p.enabled===false||p.deny?.includes('${PRODUCTION_OBSERVER_ID}')||
 p.entries?.['${PRODUCTION_OBSERVER_ID}']!==undefined)throw 0;
 if(p.allow!==undefined&&(!Array.isArray(p.allow)||p.allow.some(x=>typeof x!=='string')))throw 0;
 p.load??={};p.entries??={};
 if(typeof p.load!=='object'||Array.isArray(p.load)||typeof p.entries!=='object'||Array.isArray(p.entries)||
 p.load.paths!==undefined&&!Array.isArray(p.load.paths))throw 0;
 p.load.paths??=[];p.load.paths.push(o.directory);
 if(p.allow!==undefined&&!p.allow.includes('${PRODUCTION_OBSERVER_ID}'))p.allow.push('${PRODUCTION_OBSERVER_ID}');
 p.entries['${PRODUCTION_OBSERVER_ID}']={enabled:true};
 // The native provider supports this parameter. Preserve every other model,
 // tool, wallet and unrelated plugin setting.
 cfg.agents.defaults.models['openai/gpt-6.1-sol'].params.transport='sse';
 const parent=o.directory.slice(0,o.directory.lastIndexOf('/'));
 fs.mkdirSync(parent,{mode:0o700,recursive:true});
 for(let part='/data';;){const s=fs.lstatSync(part);if(!s.isDirectory()||s.isSymbolicLink())throw 0;
  if(part===parent)break;part=parent.slice(0,parent.indexOf('/',part.length+1)===-1?undefined:parent.indexOf('/',part.length+1));}
 fs.mkdirSync(o.directory,{mode:0o700});fs.chownSync(o.directory,st.uid,st.gid);
 const op=fs.openSync(o.directory+'/operation.json',fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.fchownSync(op,st.uid,st.gid);fs.writeFileSync(op,JSON.stringify(o));fs.fsyncSync(op);}finally{fs.closeSync(op);}
 for(const [name,content]of [['index.mjs',plugin],['openclaw.plugin.json',JSON.stringify({id:'${PRODUCTION_OBSERVER_ID}',
  name:'Conference OAuth observer',activation:{onStartup:true},configSchema:{type:'object',additionalProperties:false,properties:{}}})],
  ['package.json',JSON.stringify({name:'conference-oauth-observer',version:'1.0.0',type:'module',openclaw:{extensions:['./index.mjs']}})]]){
  const fd=fs.openSync(o.directory+'/'+name,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{fs.fchownSync(fd,st.uid,st.gid);fs.writeFileSync(fd,content);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 }
 const updated=JSON.stringify(cfg,null,2)+'\\n',tmp=path+'.conference-oauth-observer-'+o.operation_id;
 const fd=fs.openSync(tmp,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,st.mode&0o777);
 try{fs.fchownSync(fd,st.uid,st.gid);fs.writeFileSync(fd,updated);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 fs.renameSync(tmp,path);
 process.stdout.write(JSON.stringify({schema_version:1,seat_id:o.seat_id,operation_id:o.operation_id,
  observer_prepared:true,plugin_sha256:createHash('sha256').update(plugin).digest('hex'),
  native_gateway_environment_verified:false,actual_model_call_verified:false,production_refresh_required:true}));
}catch{process.exitCode=1;}
`;
  return ['node', '--input-type=module', '-e', source, JSON.stringify(options), plugin];
}

/** Read the bounded fixed receipt privately, rebind it to the live Gateway and
 * current public source/config, then emit only the same-call allowlist. No
 * history, credentials, request/response body or arbitrary error text escapes. */
function buildOpenClawProductionReadCommand(input = {}, activationOnly = false) {
  const o = productionObserverOptions(input, !activationOnly);
  const expectedPluginHash = createHash('sha256').update(openClawProductionPluginSource(productionObserverOptions(input))).digest('hex');
  const source = `
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
try{
 const require=createRequire('/app/package.json');
 const o=JSON.parse(process.argv[1]),activationOnly=process.argv[3]==='activation',
 hash=value=>createHash('sha256').update(value).digest('hex');
 const paths=['operation.json','receipt.json','index.mjs'];
 for(const name of paths){const p=o.directory+'/'+name,s=fs.lstatSync(p);
  if(!s.isFile()||s.isSymbolicLink()||fs.realpathSync(p)!==p||s.size<1||s.size>1048576||(s.mode&0o077))throw 0;}
 const op=JSON.parse(fs.readFileSync(o.directory+'/operation.json','utf8'));
 for(const k of ['seat_id','operation_id','deadline_at_ms','config_path','module_path','directory'])if(op[k]!==o[k])throw 0;
 const r=JSON.parse(fs.readFileSync(o.directory+'/receipt.json','utf8'));
 if(Date.now()>=o.deadline_at_ms||r.schema_version!==1||r.seat_id!==o.seat_id||r.operation_id!==o.operation_id||
 r.deadline_at_ms!==o.deadline_at_ms||r.blocked!==false||r.native_gateway_environment_verified!==true||
 !Number.isSafeInteger(r.gateway_pid)||r.gateway_pid<1||r.gateway_stopped!==false||
 !Array.isArray(r.activations)||!r.activations.length||r.activations.length>64||!Array.isArray(r.calls)||r.calls.length>64||
 r.plugin_sha256!==process.argv[2]||hash(fs.readFileSync(o.directory+'/index.mjs'))!==r.plugin_sha256||
 hash(fs.readFileSync(o.module_path))!==r.helper_sha256||hash(fs.readFileSync(o.config_path))!==r.config_sha256||
 hash(fs.readFileSync('/app/openclaw.mjs'))!==r.native_entrypoint_sha256||
 hash(fs.readFileSync(require.resolve('openclaw/plugin-sdk/provider-auth')))!==r.native_auth_sdk_sha256||
 require('/app/package.json').name!=='openclaw'||require('/app/package.json').version!=='2026.7.1'||
 r.calls.some(c=>c.completed!==true)||r.calls.length&&r.calls.at(-1).native_turn_completed!==true)throw 0;
 const proc='/proc/'+r.gateway_pid,stat=fs.readFileSync(proc+'/stat','utf8');
 if(stat.slice(stat.lastIndexOf(')')+2).split(' ')[19]!==r.gateway_start_ticks)throw 0;
 const argv=fs.readFileSync(proc+'/cmdline','utf8').split('\\0');
 if(!argv.some(a=>a==='openclaw-gateway'||a==='gateway'))throw 0;
 const env=Object.fromEntries(fs.readFileSync(proc+'/environ','utf8').split('\\0').filter(x=>x.includes('=')).map(x=>
  [x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
 if(['OPENAI_API_KEY','CODEX_API_KEY','OPENCLAW_PROFILE','OPENCLAW_AGENT_DIR','OPENCLAW_OAUTH_DIR'].some(k=>env[k])||
 ['OPENAI_BASE_URL','OPENAI_API_BASE'].some(k=>env[k]!==undefined&&env[k]!=='https://chatgpt.com/backend-api/codex')||
 env.HOME!=='/data'||env.OPENCLAW_STATE_DIR&&env.OPENCLAW_STATE_DIR!=='/data/.openclaw'||
 env.OPENCLAW_CONFIG_PATH&&env.OPENCLAW_CONFIG_PATH!==o.config_path)throw 0;
 if(activationOnly){
  process.stdout.write(JSON.stringify({schema_version:1,seat_id:o.seat_id,operation_id:o.operation_id,observer_active:true,
   gateway_pid:r.gateway_pid,gateway_start_ticks:r.gateway_start_ticks,plugin_sha256:r.plugin_sha256,
   helper_sha256:r.helper_sha256,native_entrypoint_sha256:r.native_entrypoint_sha256,native_auth_sdk_sha256:r.native_auth_sdk_sha256,
   config_sha256:r.config_sha256,native_gateway_environment_verified:true,actual_model_call_verified:false}));
 }else{
 const rows=r.calls.filter(c=>c.public_request_id===o.public_request_id);
 if(!rows.length||rows.at(-1).native_turn_completed!==true||rows.some(c=>c.completed!==true||c.returned_model_verified!==true||c.oauth_verified!==true||
 c.oauth_profile_exclusive!==true||c.api_fallback_absent!==true||c.endpoint_verified!==true||
 c.requested_model!=='gpt-6.1-sol'||c.returned_model!=='gpt-6.1-sol'||
 !Number.isSafeInteger(c.started_at_ms)||!r.activations.some(a=>a.pid===c.gateway_pid&&a.start_ticks===c.gateway_start_ticks&&
  Number.isSafeInteger(a.started_at_ms)&&a.started_at_ms<=c.started_at_ms)||
 !Number.isSafeInteger(c.completed_at_ms)||c.completed_at_ms<c.started_at_ms||c.completed_at_ms>=o.deadline_at_ms||
 !/^[a-f0-9]{64}$/.test(c.response_id_sha256)))throw 0;
 process.stdout.write(JSON.stringify({schema_version:1,seat_id:o.seat_id,operation_id:o.operation_id,
 public_request_id:o.public_request_id,gateway_pid:r.gateway_pid,gateway_start_ticks:r.gateway_start_ticks,
 plugin_sha256:r.plugin_sha256,helper_sha256:r.helper_sha256,native_entrypoint_sha256:r.native_entrypoint_sha256,
 native_auth_sdk_sha256:r.native_auth_sdk_sha256,config_sha256:r.config_sha256,
 native_gateway_environment_verified:true,oauth_verified:true,oauth_profile_exclusive:true,api_fallback_absent:true,
 requested_model:'gpt-6.1-sol',returned_model:'gpt-6.1-sol',actual_model_call_verified:true,
 calls:rows.map(c=>({gateway_pid:c.gateway_pid,gateway_start_ticks:c.gateway_start_ticks,
  started_at_ms:c.started_at_ms,completed_at_ms:c.completed_at_ms,
  completed:true,oauth_verified:true,requested_model:'gpt-6.1-sol',returned_model:'gpt-6.1-sol'}))}));
}
}catch{process.exitCode=1;}
`;
  return ['node', '--input-type=module', '-e', source, JSON.stringify(o), expectedPluginHash, activationOnly ? 'activation' : 'receipt'];
}


/** Confirms that the refreshed production Gateway loaded the observer before
 * any useful /chat request. This receipt read performs no inference. */
export function buildOpenClawProductionActivationReadCommand(input = {}) {
  return buildOpenClawProductionReadCommand(input, true);
}

export function buildOpenClawProductionReceiptReadCommand(input = {}) {
  return buildOpenClawProductionReadCommand(input, false);
}
