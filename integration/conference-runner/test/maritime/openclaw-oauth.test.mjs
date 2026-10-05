import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  OPENCLAW_OAUTH_PROFILE, updateOpenClawOAuthConfigText, inspectOpenClawOAuthConfigText,
  buildOpenClawOAuthLoginCommand, validateOpenClawOAuthStatus, buildOpenClawOAuthInspectionCommand,
  buildOpenClawProductionObserverCommand, buildOpenClawProductionReceiptReadCommand, buildOpenClawProductionActivationReadCommand
} from '../../src/maritime/openclaw-oauth.mjs';

const model = 'openai/gpt-6.1-sol';
const profileId = 'openai:conference-chatgpt';
const settings = { harness: 'openclaw', seat_id: 'oc-1', persistent_root: '/data',
  openclaw_config_path: '/data/.openclaw/openclaw.json' };
const nowMs = 1000000;
function status() {
  const profile = { profileId, provider: 'openai', type: 'oauth', source: 'store',
    status: 'expiring', expiresAt: nowMs + 3600000 };
  return { configPath: settings.openclaw_config_path, defaultModel: model, resolvedDefault: model, fallbacks: [],
    auth: { providers: [{ provider: 'openai', effective: { kind: 'profiles', detail: 'native profiles fixture' },
      profiles: { count: 1, oauth: 1, token: 0, apiKey: 0, labels: ['private label fixture'] } }],
    unusableProfiles: [], oauth: { profiles: [profile], providers: [
      { provider: 'openai', status: 'expiring', effectiveProfiles: [structuredClone(profile)] }
    ] } } };
}
function validate(value, options = {}) {
  return validateOpenClawOAuthStatus(value, { env: {}, nowMs, runtimeVersion: '2026.7.1', settings, ...options });
}

test('OAuth edit preserves player tools, workspace, signing env and unrelated native state', () => {
  const before = {
    agents: { defaults: { workspace: '/volume/dilemma-conference/oc-1', model: { primary: 'openai/gpt-5.4-mini',
      fallbacks: ['openai/gpt-5.5'] }, models: { 'other/model': { alias: 'other' } }, sandbox: { mode: 'off' } },
      list: [{ id: 'main', name: 'Player' }] },
    tools: { exec: { security: 'full' } }, sessions: { history: 'preserved' },
    env: { GAMEPLAY_WALLET_PRIVATE_KEY: 'fixture-player-key', OPENAI_API_KEY: 'fixture-proxy-key',
      vars: { GAMEPLAY_WALLET_PRIVATE_KEY: 'fixture-player-key', OPENAI_BASE_URL: 'https://api.maritime.sh/api/llm/v1',
        UNRELATED: 'keep' } },
    models: { providers: { other: { baseUrl: 'https://unrelated.example', models: [] }, openai: {
      baseUrl: 'https://api.maritime.sh/api/llm/v1', api: 'openai-completions', apiKey: 'fixture-proxy-key',
      headers: { Authorization: 'fixture' }, localService: { command: 'fixture' }, timeoutSeconds: 120,
      models: [{ id: 'gpt-5.4-mini', name: 'Old catalog row', extra: 'keep' }]
    } } },
    auth: { profiles: { 'other:fixture': { provider: 'other', mode: 'api_key' } }, order: { other: ['other:fixture'] } }
  };
  const after = JSON.parse(updateOpenClawOAuthConfigText(JSON.stringify(before)));
  for (const key of ['tools', 'sessions']) assert.deepEqual(after[key], before[key]);
  assert.deepEqual(after.agents.list, before.agents.list);
  assert.equal(after.agents.defaults.workspace, before.agents.defaults.workspace);
  assert.deepEqual(after.agents.defaults.sandbox, before.agents.defaults.sandbox);
  assert.deepEqual(after.agents.defaults.models['other/model'], before.agents.defaults.models['other/model']);
  assert.equal(after.env.GAMEPLAY_WALLET_PRIVATE_KEY, before.env.GAMEPLAY_WALLET_PRIVATE_KEY);
  assert.deepEqual(after.env.vars, { GAMEPLAY_WALLET_PRIVATE_KEY: 'fixture-player-key', UNRELATED: 'keep' });
  assert.deepEqual(after.models.providers.other, before.models.providers.other);
  assert.deepEqual(after.models.providers.openai.models, before.models.providers.openai.models);
  assert.equal(after.models.providers.openai.timeoutSeconds, 120);
  assert.deepEqual(after.auth.profiles['other:fixture'], before.auth.profiles['other:fixture']);
  assert.deepEqual(after.auth.order.other, before.auth.order.other);
  assert.deepEqual(inspectOpenClawOAuthConfigText(JSON.stringify(after)), {
    configured: true, ...OPENCLAW_OAUTH_PROFILE, oauth_verified: false, actual_model_call_verified: false
  });
  assert.equal(updateOpenClawOAuthConfigText(JSON.stringify(after)), `${JSON.stringify(after, null, 2)}\n`);
});

test('selected model transport stays OAuth on the OpenClaw embedded harness', () => {
  const before = { models: { providers: { openai: { models: [{ id: 'gpt-6.1-sol', name: 'live catalog fixture',
    reasoning: true, input: ['text'], contextWindow: 50000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    maxTokens: 2048, api: 'openai-completions', baseUrl: 'https://api.maritime.sh/api/llm/v1',
    agentRuntime: { id: 'codex' }, headers: { Authorization: 'fixture' } }] } } } };
  const value = JSON.parse(updateOpenClawOAuthConfigText(JSON.stringify(before)));
  const row = value.models.providers.openai.models[0];
  assert.equal(row.api, 'openai-chatgpt-responses');
  assert.equal(row.baseUrl, 'https://chatgpt.com/backend-api/codex');
  assert.deepEqual(row.agentRuntime, { id: 'openclaw' });
  assert.equal(row.contextWindow, before.models.providers.openai.models[0].contextWindow);
  assert.equal('headers' in row, false);
  assert.deepEqual(value.auth.order.openai, [profileId]);
  assert.deepEqual(value.auth.profiles[profileId], { provider: 'openai', mode: 'oauth' });
  assert.equal('agentRuntime' in value.agents.defaults, false);
  assert.deepEqual(value.agents.defaults.models[model].agentRuntime, { id: 'openclaw' });
});

test('route inspection rejects proxy, API key, model fallback and changed runtime', () => {
  for (const mutate of [
    value => { value.models.providers.openai.baseUrl = 'https://api.maritime.sh/api/llm/v1'; },
    value => { value.models.providers.openai.api = 'openai-responses'; },
    value => { value.models.providers.openai.apiKey = 'fixture'; },
    value => { value.models.providers.openai.headers = {}; },
    value => { value.models.providers.openai.agentRuntime.id = 'codex'; },
    value => { value.agents.defaults.models[model].agentRuntime.id = 'codex'; },
    value => { value.agents.defaults.model.fallbacks.push('openai/gpt-5.5'); },
    value => { value.auth.order.openai.push('openai:api-key'); },
    value => { value.env = { OPENAI_API_KEY: 'fixture' }; }
  ]) {
    const value = JSON.parse(updateOpenClawOAuthConfigText('{}'));
    mutate(value);
    assert.throws(() => inspectOpenClawOAuthConfigText(JSON.stringify(value)), /OPENCLAW_OAUTH_CONFIG_UNVERIFIED/);
  }
});

test('native status does not declare an actual model call and discards sensitive metadata', () => {
  const value = status();
  value.auth.oauth.profiles[0].label = 'private account label fixture';
  value.auth.oauth.profiles[0].access = 'fixture never returned';
  const evidence = validate(value);
  assert.equal(evidence.oauth_verified, true);
  assert.equal(evidence.actual_model_call_verified, false);
  assert.equal(evidence.native_gateway_environment_verified, false);
  assert.equal(evidence.inspection_env_api_fallback_absent, true);
  assert.equal('api_fallback_absent' in evidence, false);
  assert.doesNotMatch(JSON.stringify(evidence), /label|fixture|access|expiresAt/);
});

test('native OAuth proof fails closed for missing, expired, disabled or alternative auth', () => {
  for (const mutate of [
    value => { value.auth.oauth.profiles = []; },
    value => { value.auth.oauth.profiles[0].expiresAt = nowMs; },
    value => { value.auth.oauth.profiles[0].status = 'expired'; },
    value => { value.auth.oauth.profiles[0].type = 'api_key'; },
    value => { value.auth.unusableProfiles = [{ profileId, kind: 'disabled' }]; },
    value => { value.auth.oauth.providers[0].effectiveProfiles.push({ profileId: 'openai:api-key', type: 'api_key' }); },
    value => { delete value.auth.oauth.providers[0].effectiveProfiles; }
  ]) {
    const value = status(); mutate(value);
    assert.throws(() => validate(value), /OPENCLAW_OAUTH_AUTH_UNVERIFIED/);
  }
  const invalidProvider = status(); invalidProvider.auth.oauth.providers[0].status = 'missing';
  assert.throws(() => validate(invalidProvider), /OPENCLAW_OAUTH_AUTH_UNVERIFIED/);
});

test('CLI-hydrated .env, models.json or synthetic auth cannot hide behind a clear inspection env', () => {
  for (const key of ['env', 'modelsJson', 'syntheticAuth']) {
    const value = status(); value.auth.providers[0][key] = { value: 'fixture-redacted', source: 'fixture' };
    assert.throws(() => validate(value), /OPENCLAW_OAUTH_API_FALLBACK_PRESENT/);
  }
  const value = status(); value.auth.providers[0].effective.kind = 'env';
  assert.throws(() => validate(value), /OPENCLAW_OAUTH_API_FALLBACK_PRESENT/);
});

test('unidentified per-agent overrides remain unchanged and block configuration', () => {
  for (const entry of [{ id: 'main', model: 'openai/gpt-5.4-mini' }, { id: 'main', agentRuntime: { id: 'codex' } }]) {
    const text = JSON.stringify({ agents: { list: [entry] } });
    assert.throws(() => updateOpenClawOAuthConfigText(text), /OPENCLAW_OAUTH_AGENT_OVERRIDE_UNVERIFIED/);
    const configured = JSON.parse(updateOpenClawOAuthConfigText('{}'));
    configured.agents.list = [entry];
    assert.throws(() => inspectOpenClawOAuthConfigText(JSON.stringify(configured)), /OPENCLAW_OAUTH_AGENT_OVERRIDE_UNVERIFIED/);
    assert.deepEqual(JSON.parse(text).agents.list[0], entry);
  }
  const legacyDefault = '{"agents":{"defaults":{"agentRuntime":{"id":"openclaw"}}}}';
  assert.throws(() => updateOpenClawOAuthConfigText(legacyDefault), /OPENCLAW_OAUTH_AGENT_OVERRIDE_UNVERIFIED/);
});

test('effective process API-key and proxy route fallback are refused before native work', () => {
  for (const env of [ { OPENAI_API_KEY: 'fixture' }, { CODEX_API_KEY: 'fixture' },
    { OPENAI_BASE_URL: 'https://api.maritime.sh/api/llm/v1' }, { OPENAI_API_BASE: 'https://api.openai.com/v1' } ]) {
    assert.throws(() => validate(status(), { env }), /OPENCLAW_OAUTH_API_FALLBACK_PRESENT/);
  }
  const value = status(); value.resolvedDefault = 'openai/gpt-5.4-mini';
  assert.throws(() => validate(value), /OPENCLAW_OAUTH_NATIVE_MODEL_UNVERIFIED/);
  assert.throws(() => validate(status(), { runtimeVersion: undefined }), /OPENCLAW_OAUTH_NATIVE_VERSION_UNVERIFIED/);
  assert.throws(() => validate(status(), { runtimeVersion: '2026.10.1' }), /OPENCLAW_OAUTH_NATIVE_VERSION_UNVERIFIED/);
  assert.throws(() => validate(status(), { env: undefined }), /OPENCLAW_OAUTH_AUTH_UNVERIFIED/);
});

test('login and inspection stay bound to an existing OpenClaw runtime without reset or harness replacement', () => {
  assert.deepEqual(buildOpenClawOAuthLoginCommand(settings), [
    'openclaw', 'models', 'auth', 'login', '--provider', 'openai', '--device-code', '--profile-id', profileId
  ]);
  assert.throws(() => buildOpenClawOAuthLoginCommand({ ...settings, harness: 'hermes' }), /RUNTIME_IDENTITY_INVALID/);
  assert.throws(() => buildOpenClawOAuthLoginCommand({ ...settings, seat_id: 'oc-6' }), /RUNTIME_IDENTITY_INVALID/);
  assert.throws(() => buildOpenClawOAuthLoginCommand({ ...settings, openclaw_config_path: '/other/openclaw.json' }), /RUNTIME_IDENTITY_INVALID/);
  assert.throws(() => buildOpenClawOAuthLoginCommand({ ...settings, persistent_root: '/data\0' }), /RUNTIME_IDENTITY_INVALID/);
  assert.throws(() => buildOpenClawOAuthLoginCommand({ ...settings, persistent_root: '/volume',
    openclaw_config_path: '/volume/.openclaw/openclaw.json' }), /RUNTIME_IDENTITY_INVALID/);
  const command = buildOpenClawOAuthInspectionCommand({ settings,
    modulePath: '/data/dilemma-conference/oc-1/code/integration/conference-runner/src/maritime/openclaw-oauth.mjs' });
  assert.equal(command[0], 'node');
  assert.match(command[3], /models','status','--json/);
  assert.doesNotMatch(command[3], /--probe|models.*set|auth.*login/);
  assert.throws(() => buildOpenClawOAuthInspectionCommand({ settings, modulePath: '/other/openclaw-oauth.mjs' }), /RUNTIME_IDENTITY_INVALID/);
  const value = status(); value.configPath = '/other/openclaw.json';
  assert.throws(() => validate(value), /RUNTIME_IDENTITY_INVALID/);
});

test('malformed selected config is rejected with fixed public codes', () => {
  for (const text of ['bad', '[]', '{"agents":[]}', '{"models":{"providers":{"openai":{"models":"bad"}}}}',
    '{"env":{"vars":[]}}']) assert.throws(() => updateOpenClawOAuthConfigText(text), /OPENCLAW_OAUTH_CONFIG_INVALID/);
});

function inspectionFixture(change = {}) {
  const command = buildOpenClawOAuthInspectionCommand({ settings,
    modulePath: '/data/dilemma-conference/oc-1/code/integration/conference-runner/src/maritime/openclaw-oauth.mjs' });
  const nativeStatus = status();
  nativeStatus.auth.oauth.profiles[0].expiresAt = Date.now() + 3600000;
  nativeStatus.auth.oauth.providers[0].effectiveProfiles[0].expiresAt = Date.now() + 3600000;
  const fixture = { version: 'OpenClaw 2026.7.1\n', package: { name: 'openclaw', version: '2026.7.1' },
    config: updateOpenClawOAuthConfigText('{}'), status: nativeStatus, env: {}, ...change };
  const shims = `
const fixture=JSON.parse(process.argv[3]),calls=[];
for(const key of ['OPENAI_API_KEY','CODEX_API_KEY','OPENAI_BASE_URL','OPENAI_API_BASE',
 'OPENCLAW_PROFILE','OPENCLAW_AGENT_DIR','OPENCLAW_OAUTH_DIR','OPENCLAW_HOME'])delete process.env[key];
Object.assign(process.env,fixture.env);
const realpath=async path=>path===process.execPath?'/native/node':fixture.realpath?.[path]??path;
const lstat=async path=>({isFile:()=>fixture.badFile!==path,isSymbolicLink:()=>fixture.symlink===path,
 size:fixture.zeroFile===path?0:100,mode:fixture.writable===path?0o100666:0o100644});
const readFile=async path=>path==='/app/package.json'?JSON.stringify(fixture.package):fixture.config;
const execFile=(node,args,options,callback)=>{
 calls.push({node,args,home:options.env.HOME,state:options.env.OPENCLAW_STATE_DIR,
  config:options.env.OPENCLAW_CONFIG_PATH,cwd:options.cwd,timeout:options.timeout});
 callback(null,{stdout:args[1]==='--version'?fixture.version:JSON.stringify(fixture.status),stderr:''});
};
`;
  const source = command[3].replace("import { execFile } from 'node:child_process';", '')
    .replace("import { readFile, lstat, realpath } from 'node:fs/promises';", '');
  const localModule = fileURLToPath(new URL('../../src/maritime/openclaw-oauth.mjs', import.meta.url));
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', shims + source +
    '\nprocess.stderr.write(JSON.stringify(calls));', localModule, JSON.stringify(settings), JSON.stringify(fixture)],
  { encoding: 'utf8', timeout: 15000 });
  return { status: result.status, output: result.stdout, calls: JSON.parse(result.stderr || '[]') };
}

test('inspection parses the exact observed prefixed version and uses the pinned native entry point and state', () => {
  const result = inspectionFixture();
  assert.equal(result.status, 0);
  const evidence = JSON.parse(result.output);
  assert.equal(evidence.inspection_cli_version_verified, true);
  assert.equal(evidence.actual_model_call_verified, false);
  assert.equal(evidence.native_gateway_environment_verified, false);
  assert.deepEqual(result.calls, [
    { node: '/native/node', args: ['/app/openclaw.mjs', '--version'], home: '/data',
      state: '/data/.openclaw', config: settings.openclaw_config_path, cwd: '/data', timeout: 30000 },
    { node: '/native/node', args: ['/app/openclaw.mjs', 'models', 'status', '--json'], home: '/data',
      state: '/data/.openclaw', config: settings.openclaw_config_path, cwd: '/data', timeout: 30000 }
  ]);
  assert.equal(inspectionFixture({ version: 'OpenClaw 2026.7.1\r\n' }).status, 0);
});

test('inspection rejects wrong versions, substring banners and extra native output before status', () => {
  for (const version of ['2026.7.1\n', 'OpenClaw 2026.10.1\n', 'OpenClaw 2026.7.10\n',
    'banner\nOpenClaw 2026.7.1\n', 'OpenClaw 2026.7.1 (private fixture)\n',
    'OpenClaw 2026.7.1\nprivate-token-fixture\n', ' OpenClaw 2026.7.1\n', 'OpenClaw 2026.7.1\n\n',
    'OpenClaw 2026.7.1\0']) {
    const result = inspectionFixture({ version });
    assert.equal(result.status, 1);
    assert.equal(result.output, '');
    assert.equal(result.calls.length, 1);
  }
});

test('native package, files and state overrides fail closed before inspection subprocesses', () => {
  for (const change of [{ package: { name: 'foreign', version: '2026.7.1' } },
    { package: { name: 'openclaw', version: '2026.10.1' } }, { badFile: '/app/openclaw.mjs' },
    { symlink: '/app/openclaw.mjs' }, { writable: '/native/node' },
    { writable: '/app/package.json' }, { zeroFile: settings.openclaw_config_path },
    { realpath: { [settings.openclaw_config_path]: '/other/private-config' } },
    { env: { OPENCLAW_PROFILE: 'other' } }, { env: { OPENCLAW_AGENT_DIR: '/other' } },
    { env: { OPENCLAW_HOME: '/other' } }, { env: { OPENCLAW_OAUTH_DIR: '/other' } }]) {
    const result = inspectionFixture(change);
    assert.equal(result.status, 1);
    assert.equal(result.output, '');
    assert.deepEqual(result.calls, []);
  }
  const fallback = inspectionFixture({ env: { OPENAI_API_KEY: 'private-token-fixture' } });
  assert.equal(fallback.status, 1);
  assert.equal(fallback.output, '');
});


const observerInput = { settings, operationId: 'openclaw-production-oc-1-fixture', deadlineAtMs: Date.now() + 3600000 };
const publicRequestId = 'readiness:oc-1:generation:gameplay_input';
test('production observer uses native Gateway service and inert source-bound commands', () => {
  const command = buildOpenClawProductionObserverCommand(observerInput);
  const read = buildOpenClawProductionReceiptReadCommand({ ...observerInput, publicRequestId });
  assert.equal(command[0], 'node');
  assert.match(command[5], /api\.registerService/);
  assert.match(command[5], /ensureAuthProfileStore/);
  assert.match(command[5], /q\.headers\.get\('authorization'\)/);
  assert.match(command[5], /response\.completed/);
  assert.doesNotMatch(command[3], /gateway.*restart|execFile|fetch\(|agent.*--local/);
  assert.doesNotMatch(read[3], /physical_request_sha256:c|response_id_sha256:c/);
  for (const source of [command[3], command[5], read[3]]) {
    const syntax = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: source, encoding: 'utf8' });
    assert.equal(syntax.status, 0, syntax.stderr);
  }
  for (const change of [{ operationId: '../other' }, { operationId: 'with space' }, { deadlineAtMs: NaN },
    { settings: { ...settings, seat_id: 'oc-6' } }]) {
    assert.throws(() => buildOpenClawProductionObserverCommand({ ...observerInput, ...change }), /INPUT_INVALID|IDENTITY_INVALID/);
  }
  assert.throws(() => buildOpenClawProductionReceiptReadCommand(observerInput), /INPUT_INVALID/);
});

test('emitted native plugin manifest selects the observer service at Gateway startup', () => {
  const command = buildOpenClawProductionObserverCommand(observerInput);
  const literal = command[3].match(/\['openclaw\.plugin\.json',JSON\.stringify\((\{[\s\S]*?\})\)\]/)?.[1];
  assert.ok(literal, 'preparation writes the native plugin manifest');
  const manifest = Function(`return (${literal});`)();
  assert.equal(manifest.id, 'conference-oauth-observer');
  assert.deepEqual(manifest.activation, { onStartup: true });
  assert.deepEqual(manifest.configSchema, { type: 'object', additionalProperties: false, properties: {} });
  // The native startup selector uses this explicit declaration. Enabling a
  // plugin entry alone does not select its registerService callback.
  const startupIds = [manifest].filter(value => value.activation?.onStartup === true).map(value => value.id);
  assert.deepEqual(startupIds, ['conference-oauth-observer']);
});

function productionWireFixture(change = {}) {
  const command = buildOpenClawProductionObserverCommand(observerInput), plugin = command[5];
  const fixture = { bodies: ['first', 'continuation'], returnedModel: 'gpt-6.1-sol', toolsFirst: true,
    finalStatus: 'completed', authorization: 'Bearer private-access-fixture', nativeEnv: {}, ...change };
  const prefix = `
const fixture=JSON.parse(process.argv[1]),files=new Map(),descriptors=new Map();let nextfd=10,physical=0,service,generation=0;
const cfg=JSON.parse(${JSON.stringify(updateOpenClawOAuthConfigText('{}'))});
for(const k of ['OPENAI_API_KEY','CODEX_API_KEY','OPENAI_BASE_URL','OPENAI_API_BASE','OPENCLAW_PROFILE','OPENCLAW_AGENT_DIR','OPENCLAW_OAUTH_DIR','OPENCLAW_STATE_DIR','OPENCLAW_CONFIG_PATH'])delete process.env[k];
process.env.HOME='/data';Object.assign(process.env,fixture.nativeEnv);
const nativeProfile={type:'oauth',provider:'openai',access:'private-access-fixture',refresh:'private-refresh-fixture',
 accountId:'private-account-fixture',expires:Date.now()+7200000,...fixture.profile};
const store={profiles:{'openai:conference-chatgpt':nativeProfile,...fixture.extraProfiles},
 order:{openai:fixture.authOrder??['openai:conference-chatgpt']}};
const sdk={listUsableProviderAuthProfileIds:()=>({agentDir:'/data/.openclaw/agents/main/agent'}),
 ensureAuthProfileStore:()=>store,resolveOpenAICodexAuthIdentity:()=>({accountId:'private-account-fixture'})};
const fs={constants:{O_WRONLY:1,O_CREAT:2,O_NOFOLLOW:4},readFileSync:(path,encoding)=>{
 if(path.endsWith('/receipt.json')&&!files.has(path)){const e=Error('NOT_FOUND');e.code='ENOENT';throw e;}
 let v=path==='/proc/self/stat'?'123 (openclaw-gateway) '+Array.from({length:20},(_,i)=>i===19?String(500+generation):'0').join(' '):
 path==='/proc/self/cmdline'?(fixture.cmdline??'openclaw-gateway')+'\\0':
 path.endsWith('/openclaw.json')?JSON.stringify(cfg):files.get(path)??'public-native-source-fixture';
 return encoding?v:Buffer.from(v);
},writeFileSync:(path,value,options)=>{
 path=typeof path==='number'?descriptors.get(path):path;
 if(options?.flag==='wx'&&files.has(path))throw Error('EXISTS');files.set(path,String(value));
},openSync:(path)=>{const fd=nextfd++;descriptors.set(fd,path);return fd;},
 ftruncateSync:()=>{},fsyncSync:()=>{},closeSync:()=>{}};
const require=Object.assign(name=>name==='/app/package.json'?{name:'openclaw',version:'2026.7.1'}:undici,
 {resolve:()=>'/app/provider-auth.js'});
const original=async()=>{
 physical++;if(fixture.stopInFlight)service.stop();const id='raw-response-'+physical,tools=physical===1&&fixture.toolsFirst;
 const output=tools?[{type:'function_call',call_id:'native-call-1',name:'exec',arguments:'private-arguments-fixture'}]:[{type:'message',content:[{type:'output_text',text:'private-output-fixture'}]}];
 const model=fixture.returnedModel;
 const created={type:'response.created',response:{id,model}},terminal={type:fixture.terminalType??'response.completed',
 response:{id:fixture.mismatchedId?'other-response':id,model,status:fixture.finalStatus,output}};
 const events=fixture.missingTerminal?[created]:[created,terminal];
 // Build actual protocol bytes independently of the generated plugin's
 // string escapes so a decoder/fixture escaping error cannot mask itself.
 const eol=fixture.literalEscaped?String.fromCharCode(92,110):fixture.crlf?String.fromCharCode(13,10):String.fromCharCode(10);
 const frame=e=>(fixture.multiline?JSON.stringify(e,null,2).split(String.fromCharCode(10)).map(line=>'data: '+line).join(eol):'data: '+JSON.stringify(e))+eol+eol;
 return new Response(events.map(frame).join(''),{status:fixture.httpStatus??200,headers:{'content-type':fixture.contentType??'text/event-stream'}});
};
const undici={fetch:original};globalThis.fetch=original;
`;
  const source = plugin.replace("import fs from 'node:fs';", '')
    .replace("import { createRequire } from 'node:module';", '')
    .replace(",require=createRequire('/app/package.json')", '')
    .replace("const helper=await import(pathToFileURL(o.module_path).href);", "const helper={inspectOpenClawOAuthConfigText:()=>{}};")
    .replace("const sdk=await import(pathToFileURL(sdkPath).href);", '')
    .replace('export default ', 'const nativePlugin=');
  const suffix = `
try{
 nativePlugin.register({registerService:s=>service=s});await service.start({stateDir:'/data/.openclaw',config:cfg});
 for(const kind of fixture.bodies){
  const request=fixture.join?{request_id:${JSON.stringify(publicRequestId)},seat_id:'oc-1',requested_action:'join',response_schema_version:1,chain_state:{chain_id:84532}}:
   {schema_version:1,type:'runtime-diagnostic',request_id:${JSON.stringify(publicRequestId)},seat_id:'oc-1',mode:'gameplay-input',chain_state:{chain_id:84532}};
  if(kind==='different-public')request.request_id+=':different';
  const payload={model:fixture.requestedModel??'gpt-6.1-sol',stream:true,reasoning:{effort:'low'},
   input:[{role:'user',content:[{type:'input_text',text:'Public diagnostic\\nREQUEST_JSON\\n'+JSON.stringify(request)}]}]};
  if(kind==='continuation')payload.input.push({type:'function_call_output',call_id:fixture.wrongToolOutput?'different-call':'native-call-1',output:'private-tool-output-fixture'});
  await globalThis.fetch(fixture.url??'https://chatgpt.com/backend-api/codex/responses',
   {method:'POST',headers:{Authorization:fixture.authorization},body:JSON.stringify(payload)});
 }
}catch{}
if(fixture.restart){try{
 service.stop();globalThis.fetch=original;undici.fetch=original;generation++;nativePlugin.register({registerService:s=>service=s});
 await service.start({stateDir:'/data/.openclaw',config:cfg});
 const request={schema_version:1,type:'runtime-diagnostic',request_id:${JSON.stringify(publicRequestId)}+(fixture.repeatPublicId?'':':next'),seat_id:'oc-1',mode:'commit-input',chain_state:{chain_id:84532}};
 const payload={model:'gpt-6.1-sol',stream:true,input:[{role:'user',content:[{type:'input_text',text:'Public diagnostic\\nREQUEST_JSON\\n'+JSON.stringify(request)}]}]};
 await globalThis.fetch('https://chatgpt.com/backend-api/codex/responses',{method:'POST',headers:{Authorization:fixture.authorization},body:JSON.stringify(payload)});
}catch{}}
if(fixture.retryAfterStop){try{await globalThis.fetch('https://chatgpt.com/backend-api/codex/responses',
 {method:'POST',headers:{Authorization:fixture.authorization},body:'{}'});}catch{}}
const receipt=JSON.parse(files.get(o.directory+'/receipt.json')??'{}');
process.stdout.write(JSON.stringify({physical,receipt}));
`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', prefix + source + suffix, JSON.stringify(fixture)],
    { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  return { ...JSON.parse(result.stdout), output: result.stdout };
}

test('native production observer allows completed tool continuation and proves raw OAuth Sol', () => {
  const result = productionWireFixture();
  assert.equal(result.physical, 2);
  assert.equal(result.receipt.blocked, false);
  assert.equal(result.receipt.calls.length, 2);
  assert.equal(result.receipt.calls[0].native_turn_completed, false);
  assert.equal(result.receipt.calls[1].native_turn_completed, true);
  assert.ok(result.receipt.calls.every(c => c.oauth_verified && c.returned_model_verified && c.completed));
  assert.doesNotMatch(result.output, /private-access|private-refresh|private-account|private-output|private-arguments|private-tool-output/);
});

test('native production observer rejects wrong wire auth, model, environment and profile fallback before physical send', () => {
  for (const change of [{ authorization: 'Bearer API-key-fixture' }, { requestedModel: 'gpt-5.4-mini' },
    { nativeEnv: { OPENAI_API_KEY: 'private-fallback-fixture' } },
    { nativeEnv: { OPENAI_BASE_URL: 'https://api.maritime.sh/api/llm/v1' } },
    { authOrder: ['other:profile', 'openai:conference-chatgpt'] }, { profile: { type: 'api_key' } },
    { extraProfiles: { 'openai:other': { provider: 'openai', type: 'api_key' } } },
    { url: 'https://api.maritime.sh/api/llm/v1/chat/completions' }, { cmdline: '/app/openclaw.mjs models status' }]) {
    const result = productionWireFixture(change);
    assert.equal(result.physical, 0, JSON.stringify(change));
    assert.doesNotMatch(result.output, /private-fallback|API-key-fixture/);
  }
});

test('raw returned model and completion evidence are required and uncertainty cannot be replayed', () => {
  for (const change of [{ returnedModel: 'gpt-5.4-mini' }, { returnedModel: null }, { missingTerminal: true },
    { mismatchedId: true }, { finalStatus: 'incomplete' }, { httpStatus: 500 },
    { bodies: ['first', 'first'] }, { wrongToolOutput: true }]) {
    const result = productionWireFixture(change);
    assert.equal(result.physical, 1, JSON.stringify(change));
    assert.equal(result.receipt.blocked, true);
    assert.ok(result.receipt.calls.length <= 1);
  }
});


test('production process lifecycle retains completed calls and refuses unknown or consumed requests', () => {
  const clean = productionWireFixture({ bodies: ['first'], toolsFirst: false, restart: true });
  assert.equal(clean.physical, 2);
  assert.equal(clean.receipt.activations.length, 2);
  assert.equal(clean.receipt.calls.length, 2);
  assert.notEqual(clean.receipt.calls[0].gateway_start_ticks, clean.receipt.calls[1].gateway_start_ticks);
  const duplicate = productionWireFixture({ bodies: ['first'], toolsFirst: false, restart: true, repeatPublicId: true });
  assert.equal(duplicate.physical, 1);
  assert.equal(duplicate.receipt.blocked, true);
  const unknown = productionWireFixture({ bodies: ['first'], missingTerminal: true, restart: true });
  assert.equal(unknown.physical, 1);
  assert.equal(unknown.receipt.activations.length, 1);
  assert.equal(unknown.receipt.blocked, true);
});

test('observer state is outside player-private journals and model configuration preserves plugin bytes', () => {
  const command = buildOpenClawProductionObserverCommand(observerInput);
  const options = JSON.parse(command[4]);
  assert.equal(options.directory, '/data/.conference-production-oauth/oc-1/openclaw-production-oc-1-fixture');
  const prepared = JSON.parse(updateOpenClawOAuthConfigText('{}'));
  prepared.plugins = { load: { paths: [options.directory] }, entries: { 'conference-oauth-observer': { enabled: true } } };
  prepared.agents.defaults.models[model].params.transport = 'sse';
  const text = JSON.stringify(prepared, null, 2) + '\n';
  assert.equal(updateOpenClawOAuthConfigText(text), text);
  const result = productionWireFixture();
  assert.ok(result.receipt.calls.every(c => !Object.hasOwn(c, 'physical_request_sha256')));
  const activation = buildOpenClawProductionActivationReadCommand(observerInput);
  const syntax = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: activation[3], encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
});


function productionReadFixture(change = {}, activation = false) {
  const input = { ...observerInput, ...(change.deadlineAtMs ? { deadlineAtMs: change.deadlineAtMs } : {}) };
  const prepare = buildOpenClawProductionObserverCommand(input), opts = JSON.parse(prepare[4]);
  const command = activation ? buildOpenClawProductionActivationReadCommand(input) :
    buildOpenClawProductionReceiptReadCommand({ ...input, publicRequestId });
  const hash = value => createHash('sha256').update(value).digest('hex');
  const fixed = 'public-source-fixture', at = Date.now();
  const receipt = { schema_version: 1, seat_id: 'oc-1', operation_id: opts.operation_id,
    deadline_at_ms: opts.deadline_at_ms, gateway_pid: 9876, gateway_start_ticks: '500', gateway_started_at_ms: at - 100,
    gateway_stopped: false, native_gateway_environment_verified: true, blocked: false,
    plugin_sha256: hash(prepare[5]), helper_sha256: hash(fixed), native_entrypoint_sha256: hash(fixed),
    native_auth_sdk_sha256: hash(fixed), config_sha256: hash(fixed),
    activations: [{ pid: 9876, start_ticks: '500', started_at_ms: at - 100 }],
    calls: activation ? [] : [{ public_request_id: publicRequestId, gateway_pid: 9876, gateway_start_ticks: '500',
      completed: true, native_turn_completed: true, returned_model_verified: true, oauth_verified: true,
      oauth_profile_exclusive: true, api_fallback_absent: true, endpoint_verified: true,
      requested_model: 'gpt-6.1-sol', returned_model: 'gpt-6.1-sol', started_at_ms: at - 50, completed_at_ms: at - 25,
      response_id_sha256: hash('response-public-fixture') }], ...change.receipt };
  if (change.call) Object.assign(receipt.calls[0], change.call);
  const fixture = { receipt, opts, plugin: prepare[5], fixed, env: 'HOME=/data\0', ...change };
  const prefix = `
const f=JSON.parse(process.argv[4]),fs={
 lstatSync:p=>({isFile:()=>true,isSymbolicLink:()=>false,size:100,mode:0o100600}),realpathSync:p=>p,
 readFileSync:(p,encoding)=>{
 let v=p.endsWith('/operation.json')?JSON.stringify(f.opts):p.endsWith('/receipt.json')?JSON.stringify(f.receipt):
 p.endsWith('/index.mjs')?f.plugin:p.endsWith('/environ')?f.env:
 p.endsWith('/stat')?'9876 (openclaw-gateway) '+Array.from({length:20},(_,i)=>i===19?(f.birth??'500'):'0').join(' '):
 p.endsWith('/cmdline')?'openclaw-gateway\\0':f.fixed;
 return encoding?v:Buffer.from(v);
 }};
const createRequire=()=>Object.assign(p=>({name:'openclaw',version:'2026.7.1'}),{resolve:()=>'/app/provider-auth.js'});
`;
  const source = command[3].replace("import fs from 'node:fs';", '')
    .replace("import { createRequire } from 'node:module';", '');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', prefix + source,
    ...command.slice(4), JSON.stringify(fixture)], { encoding: 'utf8', timeout: 15000 });
  return { status: result.status, output: result.stdout };
}

test('production receipt reader verifies same request, live process and fixed sanitized output', () => {
  const positive = productionReadFixture();
  assert.equal(positive.status, 0);
  const receipt = JSON.parse(positive.output);
  assert.equal(receipt.public_request_id, publicRequestId);
  assert.equal(receipt.actual_model_call_verified, true);
  assert.equal(receipt.calls.length, 1);
  assert.doesNotMatch(positive.output, /physical_request_sha256|private-access|response-public-fixture/);
  const active = productionReadFixture({}, true);
  assert.equal(active.status, 0);
  assert.equal(JSON.parse(active.output).actual_model_call_verified, false);
  assert.equal(JSON.parse(active.output).observer_active, true);
  for (const change of [{ birth: '501' }, { env: 'HOME=/data\0OPENAI_API_KEY=private-fallback-fixture\0' },
    { receipt: { blocked: true } }, { call: { completed: false } }, { call: { native_turn_completed: false } },
    { call: { returned_model: 'gpt-5.4-mini' } }, { call: { public_request_id: 'different-request' } },
    { receipt: { helper_sha256: 'private-unsafe-fixture' } }, { deadlineAtMs: Date.now() - 1000 }]) {
    const result = productionReadFixture(change);
    assert.equal(result.status, 1, JSON.stringify(change));
    assert.equal(result.output, '');
  }
});


test('native production join uses the existing gameplay envelope and shared grant refresh is refused', () => {
  const join = productionWireFixture({ bodies: ['first'], toolsFirst: false, join: true });
  assert.equal(join.physical, 1);
  assert.equal(join.receipt.calls[0].request_type, 'gameplay');
  assert.equal(join.receipt.calls[0].completed, true);
  for (const url of ['https://auth.openai.com/oauth/token', 'https://auth0.openai.com/oauth/token']) {
    const refresh = productionWireFixture({ url });
    assert.equal(refresh.physical, 0);
    assert.equal(refresh.receipt.blocked, true);
  }
  const expiring = productionWireFixture({ profile: { expires: observerInput.deadlineAtMs + 60000 } });
  assert.equal(expiring.physical, 0);
  assert.equal(expiring.receipt.blocked, true);
});


test('stopping an active production request retains the physical fuse through native retries', () => {
  const result = productionWireFixture({ bodies: ['first'], stopInFlight: true, retryAfterStop: true });
  assert.equal(result.physical, 1);
  assert.equal(result.receipt.gateway_stopped, true);
  assert.equal(result.receipt.blocked, true);
  assert.equal(result.receipt.calls[0].completed, false);
});


test('a different public request cannot interrupt an unfinished native tool turn', () => {
  const result = productionWireFixture({ bodies: ['first', 'different-public'] });
  assert.equal(result.physical, 1);
  assert.equal(result.receipt.blocked, true);
  assert.equal(result.receipt.calls.length, 1);
});

test('production SSE decodes real LF and CRLF frames through a completed tool continuation', () => {
  for (const change of [{}, { crlf: true }, { multiline: true }, { crlf: true, multiline: true }]) {
    const result = productionWireFixture(change);
    assert.equal(result.physical, 2, JSON.stringify(change));
    assert.equal(result.receipt.blocked, false, JSON.stringify(change));
    assert.ok(result.receipt.calls.every(c => c.completed && c.returned_model_verified && c.returned_model === 'gpt-6.1-sol'));
    assert.equal(result.receipt.calls.at(-1).native_turn_completed, true);
  }
});

test('literal escaped SSE and failed terminal events stay uncertain with one physical send', () => {
  for (const change of [{ literalEscaped: true }, { terminalType: 'response.failed' }, { terminalType: 'response.incomplete' }, { terminalType: 'error' }]) {
    const result = productionWireFixture(change);
    assert.equal(result.physical, 1, JSON.stringify(change));
    assert.equal(result.receipt.blocked, true);
    assert.equal(result.receipt.calls[0].completed, false);
    assert.equal(result.receipt.calls[0].returned_model_verified, false);
  }
});

test('native refusal phases classify bounded response facts and preserve the first cause', () => {
  const cases = [
    [{ httpStatus: 500 }, 'upstream-response'],
    [{ contentType: 'application/json' }, 'upstream-response'],
    [{ literalEscaped: true }, 'sse-json'],
    [{ returnedModel: 'gpt-5.4-mini' }, 'response-model'],
    [{ terminalType: 'response.failed' }, 'response-event'],
    [{ missingTerminal: true }, 'response-completion'],
    [{ mismatchedId: true }, 'response-completion'],
    [{ finalStatus: 'incomplete' }, 'response-completion']
  ];
  for (const [change, phase] of cases) {
    const result = productionWireFixture({ ...change, retryAfterStop: true });
    assert.equal(result.physical, 1, JSON.stringify(change));
    assert.equal(result.receipt.refusal_phase, phase);
    assert.equal(result.receipt.calls[0].refusal_phase, phase);
    assert.ok(Number.isInteger(result.receipt.calls[0].upstream_status));
    assert.equal(typeof result.receipt.calls[0].upstream_sse, 'boolean');
    assert.doesNotMatch(result.output, /private-access|private-refresh|private-account|private-output|private-arguments|private-tool-output|raw-response/);
  }
  const valid = productionWireFixture();
  assert.ok(valid.receipt.calls.every(c => c.upstream_status === 200 && c.upstream_sse === true && c.stream_completion === 'verified' && c.created_events === 1 && c.terminal_events === 1 && c.returned_model_matches === true));
  assert.equal(Object.hasOwn(valid.receipt, 'refusal_phase'), false);
  const stopped = productionWireFixture({ bodies: ['first'], stopInFlight: true, retryAfterStop: true });
  assert.equal(stopped.receipt.refusal_phase, 'stopped');
});
