import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  HERMES_OAUTH_PROFILE,
  buildHermesOAuthLoginCommand,
  buildHermesProductionObserverCommand,
  buildHermesProductionReceiptReadCommand,
  inspectHermesOAuthConfigText,
  inspectHermesOAuthPoolMetadata,
  updateHermesOAuthConfigText
} from '../../src/maritime/hermes-oauth.mjs';

const settings = { harness: 'hermes', seat_id: 'hs-1', persistent_root: '/opt/data', runtime_identity: { uid: 10000, gid: 10000 } };

test('Hermes OAuth edits selected route while preserving harness, wallets and unrelated YAML', () => {
  const untouched = 'terminal:\n  env_passthrough:\n    - GAMEPLAY_WALLET_PRIVATE_KEY\n  cwd: /opt/data/dilemma-conference/hs-1\n  custom: {nested: [a, b]}\nmemory:\n  enabled: true\n';
  const text = '# existing Hermes config\nmodel:\n  provider: openai\n  base_url: https://api.maritime.sh/api/llm/v1\n  default: gpt-5.4-mini\n  model: gpt-5.4-mini\n  api_key: private-placeholder\n  key_env: OPENAI_API_KEY\n  custom_model_option:\n    retained: true\nagent:\n  max_turns: 20\n  reasoning_effort: high\n' + untouched;
  const configured = updateHermesOAuthConfigText(text);
  assert.ok(configured.includes(untouched));
  assert.ok(configured.includes('  custom_model_option:\n    retained: true\n'));
  assert.ok(configured.includes('  max_turns: 20\n'));
  assert.equal(configured.includes('private-placeholder'), false);
  assert.equal(configured.includes('api.maritime.sh'), false);
  assert.equal(configured.includes('OPENAI_API_KEY'), false);
  assert.equal(updateHermesOAuthConfigText(configured), configured);
  assert.deepEqual(inspectHermesOAuthConfigText(configured), {
    configured: true, ...HERMES_OAUTH_PROFILE,
    oauth_verified: false, native_call_verified: false
  });
});

test('Hermes OAuth disables both supported fallback formats', () => {
  const text = 'fallback_providers:\n  # old selected fallback\n  - provider: openai\n    model: gpt-5.4-mini\n    api_key: fallback-private-placeholder\nfallback_model: {provider: openrouter, model: paid}\nchannels:\n  telegram:\n    enabled: false\n';
  const configured = updateHermesOAuthConfigText(text);
  assert.ok(configured.includes('fallback_providers: []\n'));
  assert.ok(configured.includes('fallback_model: null\n'));
  assert.ok(configured.includes('  # old selected fallback\n'));
  assert.ok(configured.includes('channels:\n  telegram:\n    enabled: false\n'));
  assert.equal(configured.includes('fallback-private-placeholder'), false);
  assert.equal(inspectHermesOAuthConfigText(configured).automatic_fallback, false);
  assert.throws(() => inspectHermesOAuthConfigText(configured.replace('fallback_model: null', 'fallback_model: {provider: openai, model: paid}')), /HERMES_OAUTH_CONFIG_INVALID/);
});

test('Hermes OAuth rejects ambiguous configuration before mutation', () => {
  const bad = [
    'model: {}\n',
    'model:\n  provider: openai\n  provider: openai-codex\n',
    'model:\n  provider: openai\n"model":\n  provider: openai-codex\n',
    'model:\n  <<: *inherited\n',
    'model:\n  provider:\n    nested: openai\n',
    'model:\n    provider: openai\n',
    'model:\n  api_key:\n    nested: secret\n',
    'agent:\n  reasoning_effort: low\n  reasoning_effort: high\n',
    'fallback_model: null\nfallback_model: {}\n',
    '---\nmodel:\n  provider: openai\n',
    'defaults: &model\n  provider: openai\n<<: *model\n',
    'model:\n\tprovider: openai\n',
    'model:\n  provider: openai\0\n'
  ];
  for (const text of bad) assert.throws(() => updateHermesOAuthConfigText(text), { message: 'HERMES_OAUTH_CONFIG_INVALID' });
});

test('Hermes OAuth configuration cannot certify an unchanged API route or model', () => {
  const text = updateHermesOAuthConfigText('');
  const inspected = inspectHermesOAuthConfigText(text);
  assert.equal(inspected.configured, true);
  assert.equal(inspected.oauth_verified, false);
  assert.equal(inspected.native_call_verified, false);
  for (const [before, after] of [
    ['"openai-codex"', '"openai"'],
    ['"https://chatgpt.com/backend-api/codex"', '"https://api.maritime.sh/api/llm/v1"'],
    ['default: "gpt-6.1-sol"', 'default: "gpt-5.4-mini"'],
    ['"codex_responses"', '"chat_completions"'],
    ['openai_runtime: "auto"', 'openai_runtime: "codex_app_server"'],
    ['max_tokens: 2048', 'max_tokens: 4096'],
    ['fallback_providers: []', 'fallback_providers: [{provider: openai, model: paid}]']
  ]) assert.throws(() => inspectHermesOAuthConfigText(text.replace(before, after)), /HERMES_OAUTH_CONFIG_INVALID/);
  assert.throws(() => inspectHermesOAuthConfigText(text.replace('model:\n', 'model:\n  api_key: hidden\n')), /HERMES_OAUTH_CONFIG_INVALID/);
});

test('Hermes OAuth login selects the seat root despite sticky profiles and preserves private identity without reading keys', () => {
  const command = buildHermesOAuthLoginCommand(settings);
  assert.deepEqual(command.slice(0, 2), ['python3', '-c']);
  assert.equal(command[3], 'dilemma-conference-hs-1');
  assert.match(command[2], /os.setgid\(10000\)/);
  assert.match(command[2], /os.setuid\(10000\)/);
  assert.match(command[2], /os.umask\(0o077\)/);
  assert.match(command[2], /env\["HERMES_HOME"\] = "\/opt\/data"/);
  assert.match(command[2], /native_cli = "\/opt\/hermes\/\.venv\/bin\/hermes"/);
  assert.match(command[2], /if not os.path.isfile\(native_cli\) or not os.access\(native_cli, os.X_OK\):\n    sys.exit\(66\)/);
  assert.match(command[2], /os.execve\(native_cli, \[native_cli, "--profile", "default", "auth", "add", "openai-codex", "--type", "oauth"/);
  assert.doesNotMatch(command[2], /os.execvp|os.execvpe|shutil.which|PATH/);
  assert.doesNotMatch(command[2], /open\(|read|auth\.json|\.codex|codex login|GAMEPLAY_WALLET_PRIVATE_KEY|print\(/);
  for (const change of [
    { harness: 'openclaw' }, { seat_id: 'hs-6' }, { persistent_root: '/' }, { persistent_root: '/opt/data/../data' },
    { persistent_root: '/data' }, { runtime_identity: { uid: 0, gid: 0 } },
    { runtime_identity: { uid: 10000, gid: 10000, extra: true } }
  ]) assert.throws(() => buildHermesOAuthLoginCommand({ ...settings, ...change }), /HERMES_OAUTH_LOGIN_SETTINGS_INVALID/);
});

test('Hermes OAuth pool gate checks every rotation entry and never certifies a grant or call', () => {
  const entry = { auth_type: 'oauth', access_token_present: true, refresh_token_present: true, endpoint_verified: true };
  const observed = { schema_version: 1, provider: 'openai-codex', all_entries_observed: true, entries: [{ ...entry }, { ...entry }] };
  assert.deepEqual(inspectHermesOAuthPoolMetadata(observed), {
    provider: 'openai-codex', pool_oauth_only: true, entry_count: 2,
    oauth_entry_count: 2, api_key_entry_count: 0, credential_present: true,
    oauth_verified: false, native_call_verified: false
  });
  for (const change of [
    { entries: [] }, { provider: 'openai' }, { all_entries_observed: false },
    { entries: [entry, { ...entry, auth_type: 'api_key' }] },
    { entries: [entry, { ...entry, auth_type: 'unknown' }] },
    { entries: [entry, { ...entry, endpoint_verified: false }] },
    { entries: [{ ...entry, access_token_present: false }] },
    { entries: [{ ...entry, refresh_token_present: false }] },
    { entries: [{ ...entry, access_token: 'must-not-accept-secret-payload' }] },
    { extra: 'must-not-accept-arbitrary-output' }
  ]) assert.throws(() => inspectHermesOAuthPoolMetadata({ ...observed, ...change }), { message: 'HERMES_OAUTH_POOL_UNVERIFIED' });
});

const productionSources = ['hermes_cli/auth.py', 'hermes_cli/config.py', 'hermes_cli/runtime_provider.py',
  'agent/credential_pool.py', 'hermes_cli/plugins.py', 'run_agent.py'];
const productionInput = () => ({
  settings: { ...settings, native_source_pins: Object.fromEntries(productionSources.map(name => [name, 'a'.repeat(64)])) },
  operationId: 'hermes-production-hs-1-fixture-20261004', deadlineAtMs: Date.now() + 60_000
});
function pythonFixture(script, ...args) {
  const result = spawnSync('python3', ['-c', script, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  return JSON.parse(result.stdout);
}
function pluginFixture(script, value) {
  return pythonFixture('import sys,json\nns={"__name__":"fixture"}\nexec(sys.argv[1],ns)\n' + script,
    buildHermesProductionObserverCommand(productionInput())[5], JSON.stringify(value));
}

test('production builders preserve native harness and require explicit fresh source/window bindings', () => {
  const input = productionInput();
  const install = buildHermesProductionObserverCommand(input);
  const read = buildHermesProductionReceiptReadCommand({ ...input, publicRequestId: 'fixture:diagnostic:hs-1' });
  assert.deepEqual(install.slice(0, 2), ['python3', '-c']);
  assert.deepEqual(JSON.parse(install[4]), {
    seat_id: 'hs-1', operation_id: input.operationId, deadline_at_ms: input.deadlineAtMs,
    native_source_pins: input.settings.native_source_pins
  });
  assert.equal(JSON.parse(read[4]).public_request_id, 'fixture:diagnostic:hs-1');
  assert.match(install[2], /os.setgroups\(\[\]\); os.setgid\(10000\); os.setuid\(10000\)/);
  assert.match(install[2], /\/opt\/hermes\/\.venv\/bin\/python/);
  assert.match(install[3], /dilemma-conference-oauth/);
  assert.match(install[5], /ctx.register_hook\("pre_api_request",pre_api_request\)/);
  assert.match(install[5], /ctx.register_hook\("post_api_request",post_api_request\)/);
  assert.doesNotMatch(install[5], /run_conversation\(|responses\.create\(|responses\.stream\(|run_agent.*O_WRONLY|print\(|access_token.*(?:sha256|digest)|session_id.*(?:sha256|digest)/);
  assert.doesNotMatch(read[3], /original\(|execve\(|run_conversation\(|auth\[|str\(err|traceback/);
  for (const change of [{ operationId: '../auth.json' }, { operationId: 'hermes-production-hs-2-fixture-20261004' },
    { deadlineAtMs: Date.now() - 1 }, { deadlineAtMs: Date.now() + 181 * 60_000 },
    { settings: { ...input.settings, native_source_pins: {} } },
    { settings: { ...input.settings, native_source_pins: { ...input.settings.native_source_pins, '../auth.json': 'a'.repeat(64) } } },
    { settings: { ...input.settings, native_source_pins: { ...input.settings.native_source_pins, 'run_agent.py': 'secret-placeholder' } } },
    { settings: { ...input.settings, runtime_identity: { uid: 0, gid: 0 } } }]) {
    assert.throws(() => buildHermesProductionObserverCommand({ ...input, ...change }), /HERMES_PRODUCTION_OBSERVER_SETTINGS_INVALID/);
  }
  for (const publicRequestId of ['../auth.json', 'x\nsecret', '', 'x'.repeat(513)]) {
    assert.throws(() => buildHermesProductionReceiptReadCommand({ ...input, publicRequestId }), /HERMES_PRODUCTION_OBSERVER_SETTINGS_INVALID/);
  }
  assert.deepEqual(pythonFixture('import sys,json\nfor source in sys.argv[1:]: compile(source,"fixture","exec")\nprint("true")',
    install[2], install[3], install[5], read[3]), true);
});

test('production plugin adds only native enablement while preserving unrelated config byte formatting', () => {
  const source = 'model:\n  model: gpt-6.1-sol\nplugins:\n  # keep plugins comment\n  enabled: ["existing"] # keep enabled comment\n  entries:\n    existing:\n      arbitrary: retained\nterminal:\n  cwd: /opt/data\n';
  const block = 'plugins:\n  enabled:\n    - existing # keep inline comment\n  disabled: [unrelated]\n  entries:\n    existing: {nested: retained}\nterminal:\n  cwd: /opt/data\n';
  const values = pluginFixture('values=json.loads(sys.argv[2])\nresult=[]\nfor text in values:\n try: result.append(ns["enable_plugin"](text))\n except Exception: result.append(None)\nprint(json.dumps(result))', [source, block, 'plugins:\n  entries:\n    existing: {nested: retained}\nterminal:\n  cwd: /opt/data\n',
    'plugins:\n  enabled: []\n  disabled: [dilemma-conference-oauth]\n',
    'plugins: {enabled: []}\n', 'plugins:\n  enabled: [existing, existing]\n', 'plugins:\n  enabled: []\n  enabled: []\n']);
  assert.equal(values[0], source.replace('["existing"]', '["existing", "dilemma-conference-oauth"]'));
  assert.equal(values[1], block.replace('    - existing # keep inline comment\n', '    - existing # keep inline comment\n    - "dilemma-conference-oauth"\n'));
  assert.equal(values[2], 'plugins:\n  entries:\n    existing: {nested: retained}\n  enabled: ["dilemma-conference-oauth"]\nterminal:\n  cwd: /opt/data\n');
  assert.deepEqual(values.slice(3), [null, null, null, null]);
  const again = pluginFixture('text=json.loads(sys.argv[2])\nprint(json.dumps(ns["enable_plugin"](text)))', values[0]);
  assert.equal(again, values[0]);
});

test('production wire fixtures accept native tool capability and reject drift, secret source, replay and expiry', () => {
  const prompt = 'protocol\nREQUEST_JSON\n{"schema_version":1,"type":"runtime-diagnostic","request_id":"fixture:1","seat_id":"hs-1","chain_state":{"chain_id":84532}}';
  const view = { method: 'POST', url: 'https://chatgpt.com/backend-api/codex/responses', model: 'gpt-6.1-sol',
    stream: true, store: false, reasoning_effort: 'low', input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }], tools: [{ name: 'terminal' }] };
  const base = { view, prompt, member: true, consumed: false, now: 5, deadline: 10 };
  const rows = [base, ...[{ consumed: true }, { member: false }, { now: 10 },
    ...[{ method: 'GET' }, { url: 'https://api.maritime.sh/api/llm/v1/chat/completions' }, { model: 'gpt-5.4-mini' },
      { stream: false }, { store: true }, { reasoning_effort: 'high' }, { input: [{ role: 'assistant', content: prompt }] },
      { input: [{ role: 'user', content: 'different-request' }] }].map(change => ({ view: { ...view, ...change } }))].map(change => ({ ...base, ...change }))];
  const result = pluginFixture('print(json.dumps([ns["wire_allowed"](**row) for row in json.loads(sys.argv[2])]))', rows);
  assert.deepEqual(result, [true, ...rows.slice(1).map(() => false)]);
});

test('production OAuth membership privately checks complete native store including hidden API rotation entries', () => {
  const row = { auth_type: 'oauth', access_token: 'fixture-private-access', refresh_token: 'fixture-private-refresh' };
  const stores = [
    { credential_pool: { 'openai-codex': [row] } },
    { providers: { 'openai-codex': { tokens: { access_token: row.access_token, refresh_token: row.refresh_token } } } },
    { credential_pool: { 'openai-codex': [row, { ...row, auth_type: 'api_key' }] } },
    { credential_pool: { 'openai-codex': [{ ...row, base_url: 'https://api.openai.com/v1' }] } },
    { credential_pool: { 'openai-codex': [{ ...row, refresh_token: '' }] } }, {},
    { credential_pool: { 'openai-codex': [row] }, providers: { 'openai-codex': { tokens: [] } } }
  ];
  const values = pluginFixture('values=json.loads(sys.argv[2])\nresult=[]\nfor store in values:\n ns["private_read"]=lambda path:json.dumps(store).encode()\n result.append(ns["oauth_member"]("Bearer fixture-private-access"))\nprint(json.dumps(result))', stores);
  assert.deepEqual(values, [true, true, false, false, false, false, false]);
  assert.equal(JSON.stringify(values).includes('fixture-private'), false);
});

const nativeHookHarness = String.raw`
import types,copy
forwarded=[];writes=[];paths=set()
class Client:
    def _send_single_request(self,request):
        assert request.url=="https://rpc.example/" or writes[-1][1]["calls"][-1]["physical_requests"]==1
        forwarded.append(str(request.url))
        payload=b'data: {"type":"response.created","response":{"id":"resp_fixture_1"}}\n\ndata: {"type":"response.completed","response":{"id":"resp_fixture_1","model":"gpt-6.1-sol","status":"completed","output":[{"content":"fixture-private-response"}]}}\n\n'
        class Stream:
            def __iter__(self):
                for index in range(0,len(payload),17): yield payload[index:index+17]
            def close(self): pass
        return types.SimpleNamespace(status_code=200,stream=Stream())
class AsyncClient:
    async def _send_single_request(self,request): return types.SimpleNamespace(status_code=200)
sys.modules["httpx"]=types.SimpleNamespace(Client=Client,AsyncClient=AsyncClient,SyncByteStream=object)
try: ns["register"](None)
except ns["GuardError"]: pass
now=int(ns["time"].time()*1000)
ns["ACTIVE"]={"seat_id":"hs-1","operation_id":"hermes-production-hs-1-fixture-20261004","deadline_at_ms":now+60000,"scope":"/fixture"}
ns["SOURCE_OK"]=True
ns["birth"]=lambda:17
ns["save"]=lambda path,value,exclusive=False:writes.append((str(path),copy.deepcopy(value)))
def directory(path,create=False,exclusive=False):
    if exclusive and str(path) in paths: ns["reject"]()
    if create: paths.add(str(path))
    return path
ns["directory"]=directory
ns["oauth_member"]=lambda auth: auth=="Bearer fixture-private-access"
def prompt(request_id="fixture:diagnostic:1"):
    return 'protocol\nREQUEST_JSON\n'+json.dumps({"schema_version":1,"type":"runtime-diagnostic","request_id":request_id,"seat_id":"hs-1","chain_state":{"chain_id":84532}})
def pre(count=1,request_id="fixture:diagnostic:1",**changes):
    view={"provider":"openai-codex","model":"gpt-6.1-sol","api_mode":"codex_responses","base_url":ns["ENDPOINT"],"task_id":"fixture-task","session_id":"fixture-private-session","api_call_count":count,"user_message":prompt(request_id),"request_messages":[{"type":"function_call_output","call_id":"fixture-tool","output":"fixture-private-tool-output"}]}
    view.update(changes);ns["pre_api_request"](**view)
def request(url=None,body=None,auth="Bearer fixture-private-access"):
    return types.SimpleNamespace(method="POST",url=url or ns["ENDPOINT"]+"/responses",content=json.dumps(body or {"model":"gpt-6.1-sol","stream":True,"store":False,"reasoning":{"effort":"low"},"input":[{"role":"user","content":[{"type":"input_text","text":prompt()}]}],"tools":[{"name":"terminal"}]}).encode(),headers={"authorization":auth})
def send(**changes):
    response=Client()._send_single_request(request(**changes))
    list(response.stream)
    return response
def post(count=1,tools=0,**changes):
    view={"provider":"openai-codex","model":"gpt-6.1-sol","api_mode":"codex_responses","base_url":ns["ENDPOINT"],"task_id":"fixture-task","session_id":"fixture-private-session","api_call_count":count,"response_model":"gpt-6.1-sol","response":types.SimpleNamespace(id="resp_fixture_1",model="gpt-6.1-sol",status="completed"),"assistant_tool_call_count":tools}
    view.update(changes);ns["post_api_request"](**view)
def blocked(fn):
    try: fn();return False
    except ns["GuardError"]: return True
`;
function hookFixture(script) { return pluginFixture(nativeHookHarness + '\n' + script, null); }

test('production native guard certifies same-call raw metadata across legitimate tool continuations', () => {
  const result = hookFixture('pre();send();post(tools=1)\npre(count=2);send();post(count=2)\nreceipt=ns["CURRENT"]["receipt"]\nprint(json.dumps({"receipt":receipt,"forwarded":len(forwarded),"secret_leaked":any("fixture-private" in json.dumps(value) for path,value in writes)}))');
  assert.equal(result.receipt.status, 'verified');
  assert.equal(result.receipt.oauth_verified, true);
  assert.equal(result.receipt.native_call_verified, true);
  assert.equal(result.forwarded, 2);
  assert.equal(result.secret_leaked, false);
  assert.equal(result.receipt.calls.length, 2);
  assert.deepEqual(result.receipt.calls.map(call => call.assistant_tool_call_count), [1, 0]);
  for (const call of result.receipt.calls) {
    assert.equal(call.physical_requests, 1);
    for (const key of ['request_route_verified', 'request_model_verified', 'credential_oauth_member_verified',
      'wire_reasoning_effort_verified', 'http_status_verified', 'response_model_verified',
      'response_completed_verified', 'wire_response_model_verified', 'wire_response_completed_verified', 'wire_response_identity_verified', 'same_call_identity_verified']) assert.equal(call[key], true);
  }
  assert.equal(result.receipt.wire_max_output_tokens_enforced, false);
});

test('production native transport never forwards retry, uncertain continuation or process replay', () => {
  for (const script of [
    'pre();send();denied=blocked(lambda:send())',
    'pre();send();denied=blocked(lambda:pre(count=2))',
    'pre();send();post();ns["CURRENT"]=None;denied=blocked(lambda:pre())',
    'pre();send();post(tools=1);denied=blocked(lambda:pre(count=2,request_messages=[]))',
    'pre();send();denied=blocked(lambda:post(session_id="different-session"))',
    'pre();send();denied=blocked(lambda:post(response=types.SimpleNamespace(model="gpt-5.4-mini",status="completed")))',
    'pre();send();denied=blocked(lambda:post(response=types.SimpleNamespace(model="gpt-6.1-sol",status="incomplete")))'
  ]) {
    const result = hookFixture(script + '\nprint(json.dumps({"denied":denied,"forwarded":len(forwarded),"verified":ns["CURRENT"] is not None and ns["CURRENT"]["receipt"]["native_call_verified"]}))');
    assert.deepEqual(result, { denied: true, forwarded: 1, verified: false });
  }
});

test('production completed receipts stay byte-identical when unrelated callbacks and replays are denied', () => {
  for (const rejected of [
    'lambda:pre(user_message="fixture background review",task_id="different-task",session_id="different-session")',
    'lambda:pre(count=3)',
    'lambda:pre()',
    'lambda:send()',
    'lambda:post(count=2,session_id="different-session")'
  ]) {
    const result = hookFixture('pre();send();post(tools=1)\npre(count=2);send();post(count=2)\nbefore=json.dumps(ns["CURRENT"]["receipt"],separators=(",",":"))\nwrite_count=len(writes)\ndenied=blocked(' + rejected + ')\nprint(json.dumps({"denied":denied,"forwarded":len(forwarded),"unchanged":before==json.dumps(ns["CURRENT"]["receipt"],separators=(",",":")),"writes_unchanged":len(writes)==write_count,"verified":ns["CURRENT"]["receipt"]["native_call_verified"],"request_directories":len(paths)}))');
    assert.deepEqual(result, { denied: true, forwarded: 2, unchanged: true,
      writes_unchanged: true, verified: true, request_directories: 1 });
  }
});

test('production unrelated rejection still blocks an unfinished tool continuation', () => {
  const result = hookFixture('pre();send();post(tools=1)\ndenied=blocked(lambda:pre(user_message="fixture background review",task_id="different-task",session_id="different-session"))\nprint(json.dumps({"denied":denied,"forwarded":len(forwarded),"status":ns["CURRENT"]["receipt"]["status"],"verified":ns["CURRENT"]["receipt"]["native_call_verified"],"request_directories":len(paths)}))');
  assert.deepEqual(result, { denied: true, forwarded: 1, status: 'blocked',
    verified: false, request_directories: 1 });
});

test('production source, route, bearer and deadline drift fail before forward while RPC remains usable', () => {
  for (const script of [
    'pre();ns["SOURCE_OK"]=False;denied=blocked(lambda:send())',
    'pre();ns["ACTIVE"]["deadline_at_ms"]=now-1;denied=blocked(lambda:send())',
    'pre();denied=blocked(lambda:send(auth="Bearer fixture-api-credit-key"))',
    'pre();denied=blocked(lambda:send(url="https://api.openai.com/v1/responses"))',
    'denied=blocked(lambda:pre(provider="openai"))',
    'denied=blocked(lambda:pre(user_message=prompt().replace("84532","1")))'
  ]) {
    const result = hookFixture(script + '\nprint(json.dumps({"denied":denied,"forwarded":len(forwarded)}))');
    assert.deepEqual(result, { denied: true, forwarded: 0 });
  }
  const rpc = hookFixture('Client()._send_single_request(request(url="https://rpc.example/",body={"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}))\nprint(json.dumps({"forwarded":forwarded}))');
  assert.deepEqual(rpc, { forwarded: ['https://rpc.example/'] });
  const refresh = hookFixture('denied=blocked(lambda:Client()._send_single_request(request(url="https://auth.openai.com/oauth/token",body={"grant_type":"refresh_token","refresh_token":"fixture-private-refresh"})))\nprint(json.dumps({"denied":denied,"forwarded":len(forwarded)}))');
  assert.deepEqual(refresh, { denied: true, forwarded: 0 });
});

test('production raw SSE verification rejects normalized self-report, mismatched IDs and incomplete terminals', () => {
  for (const script of [
    'pre();send();denied=blocked(lambda:post(response=types.SimpleNamespace(id="different-response",model="gpt-6.1-sol",status="completed")))',
    'pre();send();ns["CURRENT"]["receipt"]["calls"][-1]["wire_response_model_verified"]=False;denied=blocked(lambda:post())'
  ]) {
    const result = hookFixture(script + '\nprint(json.dumps({"denied":denied,"forwarded":len(forwarded),"verified":ns["CURRENT"]["receipt"]["native_call_verified"]}))');
    assert.deepEqual(result, { denied: true, forwarded: 1, verified: false });
  }
  const values = pluginFixture(String.raw`
class Stream:
    def __init__(self,payload):self.payload=payload
    def __iter__(self):
        for index in range(0,len(self.payload),3):yield self.payload[index:index+3]
    def close(self): pass
import types
ns["ACTIVE"]={"deadline_at_ms":int(ns["time"].time()*1000)+60000}
ns["persist"]=lambda owner:None
results=[]
for payload in json.loads(sys.argv[2]):
    owner={"wire_response_id":None,"wire_terminal_id":None,"receipt":{"status":"inflight","calls":[{}]}}
    ns["CURRENT"]=owner
    response=types.SimpleNamespace(stream=Stream(payload.encode()))
    try:
        observed=ns["observe_stream"](response,owner,types.SimpleNamespace(SyncByteStream=object))
        output=b"".join(observed.stream)
        results.append({"verified":owner["wire_terminal_id"] is not None,"bytes_unchanged":output==payload.encode()})
    except ns["GuardError"]: results.append({"blocked":True})
print(json.dumps(results))`, [
    'data: {"type":"response.created","response":{"id":"r1"}}\r\n\r\ndata: {"type":"response.completed","response":{"id":"r1","model":"gpt-6.1-sol","status":"completed"}}\r\n\r\n',
    'data: {"type":"response.created","response":{"id":"r1"}}\n\ndata: {"type":"response.completed","response":{"id":"r1","status":"completed"}}\n\n',
    'data: {"type":"response.created","response":{"id":"r1"}}\n\ndata: {"type":"response.completed","response":{"id":"r2","model":"gpt-6.1-sol","status":"completed"}}\n\n',
    'data: {"type":"response.created","response":{"id":"r1"}}\n\ndata: {"type":"response.incomplete","response":{"id":"r1","model":"gpt-6.1-sol","status":"incomplete"}}\n\n',
    'data: {"type":"response.created","response":{"id":"r1"}}\n\n',
    'data: {"type":"response.completed","response":{"id":"r1","model":"gpt-6.1-sol","status":"completed"}}\n\n',
    'data: {"type":"response.created","response":{"id":"r1"}}\n\ndata: {"type":"response.completed","response":{"id":"r1","model":"gpt-6.1-sol","model":"paid","status":"completed"}}\n\n'
  ]);
  assert.deepEqual(values, [{ verified: true, bytes_unchanged: true }, ...values.slice(1).map(() => ({ blocked: true }))]);
});

test('production source integrity rejects altered source before any model call', () => {
  const result = pluginFixture(String.raw`
import tempfile,pathlib,hashlib
with tempfile.TemporaryDirectory() as root:
    path=pathlib.Path(root)/"public.py"
    raw=b"# public fixture source\n";path.write_bytes(raw)
    pin=hashlib.sha256(raw).hexdigest()
    expected={str(path):pin}
    before=ns["source_verified"](expected)
    path.write_bytes(raw+b"# changed\n")
    after=ns["source_verified"](expected)
    print(json.dumps({"before":before,"after":after}))`, null);
  assert.deepEqual(result, { before: true, after: false });
});

test('production receipt reader binds activation and rejects malformed metadata without echoing it', () => {
  const seed = hookFixture('pre();send();post()\nprint(json.dumps(ns["CURRENT"]["receipt"]))');
  const input = { ...productionInput(), publicRequestId: seed.public_request_id };
  seed.operation_id = input.operationId;
  seed.deadline_at_ms = input.deadlineAtMs;
  const command = buildHermesProductionReceiptReadCommand(input);
  const helper = String.raw`
import os,json,pathlib
os.geteuid=lambda:10000;os.getegid=lambda:10000
ROOT=pathlib.Path("/opt/data/.conference-production-oauth")
fixture=json.loads(__import__("sys").argv[3])
values=json.loads(__import__("sys").argv[1])
def unique(pairs):
    result={}
    for key,value in pairs:
        if key in result:raise ValueError()
        result[key]=value
    return result
def directory(path,*args):return path
def source_verified(pins):return fixture.get("source_ok",True)
def private_read(path):
    if str(path).endswith("__init__.py"):return __import__("sys").argv[2].encode()
    if str(path).endswith("operation.json"):return json.dumps(values).encode()
    if str(path).endswith("receipt.json"):return json.dumps(fixture["receipt"]).encode()
    activation={"schema_version":1,"process_id":fixture["receipt"]["process_id"],"process_birth_tick":fixture["receipt"]["process_birth_tick"],"source_integrity_verified":True,"native_hook_bound_verified":True}
    activation.update(fixture.get("activation",{}))
    return json.dumps(activation).encode()
`;
  function read(receipt, changes = {}) {
    return pythonFixture('import sys\nscript=sys.argv[1]\nsys.argv=["fixture",sys.argv[2],sys.argv[3],sys.argv[4]]\nexec(script,{"__name__":"fixture"})',
      command[3], command[4], helper, JSON.stringify({ receipt, ...changes }));
  }
  const valid = read(seed);
  assert.equal(valid.status, 'verified');
  assert.equal(valid.oauth_verified, true);
  assert.equal(valid.physical_requests, 1);
  assert.equal(valid.returned_model, 'gpt-6.1-sol');
  const blocked = { schema_version: 1, status: 'blocked', error_code: 'HERMES_PRODUCTION_RECEIPT_UNVERIFIED', oauth_verified: false, native_call_verified: false };
  for (const changed of [
    { ...seed, unexpected: 'fixture-private-receipt' },
    { ...seed, process_id: 'fixture-private-process' },
    { ...seed, status: 'inflight' },
    { ...seed, public_request_id: 'different-request' },
    { ...seed, calls: [{ ...seed.calls[0], wire_response_model_verified: false }] },
    { ...seed, calls: [{ ...seed.calls[0], completed_at_ms: null }] },
    { ...seed, calls: [{ ...seed.calls[0], assistant_tool_call_count: 1 }] },
    { ...seed, calls: [{ ...seed.calls[0], physical_requests: true }] }
  ]) assert.deepEqual(read(changed), blocked);
  assert.deepEqual(read(seed, { activation: { process_birth_tick: seed.process_birth_tick + 1 } }), blocked);
  assert.deepEqual(read(seed, { source_ok: false }), blocked);
});


test('production enablement rejects managed aliases while preserving unrelated anchors', () => {
  const unrelated = 'defaults: &unchanged\n  nested: [retained]\nplugins:\n  enabled: [existing]\n  entries:\n    existing: *unchanged\nterminal:\n  env_passthrough: [GAMEPLAY_WALLET_PRIVATE_KEY]\n';
  const values = pluginFixture('result=[]\nfor text in json.loads(sys.argv[2]):\n try: result.append(ns["enable_plugin"](text))\n except Exception: result.append(None)\nprint(json.dumps(result))', [
    unrelated,
    'unrelated: &external [existing]\nplugins:\n  enabled: *external\n',
    'unrelated: &external [existing]\nplugins:\n  enabled: [*external]\n',
    'plugins: &managed\n  enabled: []\n',
    'plugins:\n  enabled: &managed []\n'
  ]);
  assert.equal(values[0], unrelated.replace('enabled: [existing]', 'enabled: [existing, "dilemma-conference-oauth"]'));
  assert.deepEqual(values.slice(1), [null, null, null, null]);
});
