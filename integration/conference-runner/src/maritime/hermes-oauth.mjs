import { isAbsolute, normalize } from 'node:path';
import { HERMES_RUNTIME_IDENTITY } from './runtime-identity.mjs';

// Hermes v2026.5.16 owns its tool loop with this provider. Do not select the
// optional codex_app_server runtime: that would hand tools to another harness.
export const HERMES_OAUTH_PROFILE = Object.freeze({
  provider: 'openai-codex',
  endpoint: 'https://chatgpt.com/backend-api/codex',
  model: 'gpt-6.1-sol',
  auth_mode: 'chatgpt',
  api_mode: 'codex_responses',
  reasoning_effort: 'low',
  max_output_tokens: 2048,
  automatic_fallback: false,
  fallback_model: null,
  response_metadata_required: true
});

const MODEL_FIELDS = Object.freeze({
  provider: '"openai-codex"',
  base_url: '"https://chatgpt.com/backend-api/codex"',
  default: '"gpt-6.1-sol"',
  model: '"gpt-6.1-sol"',
  api_mode: '"codex_responses"',
  openai_runtime: '"auto"',
  reasoning_effort: '"low"',
  max_tokens: '2048'
});
const SELECTED_KEY_OVERRIDES = new Set(['api_key', 'api', 'key_env', 'api_key_env']);

function fail() { throw new Error('HERMES_OAUTH_CONFIG_INVALID'); }
function blank(line) { return !line.trim() || /^\s*#/.test(line); }

function keyOf(source) {
  const key = source.trim();
  if (/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key)) return key;
  if (/^"[A-Za-z_][A-Za-z0-9_.-]*"$/.test(key) || /^'[A-Za-z_][A-Za-z0-9_.-]*'$/.test(key)) {
    return key.slice(1, -1);
  }
  fail();
}

// This deliberately accepts only a single block mapping at the root. It does
// not try to parse all YAML: unrelated nested values are retained byte for byte.
// Unsupported root/managed-map syntax fails before any caller writes a file.
function parse(text) {
  if (typeof text !== 'string' || text.includes('\0') || text.includes('\r') || /(^|\n) *\t/.test(text)) fail();
  const newline = text.endsWith('\n');
  const lines = text ? text.split('\n') : [];
  if (newline) lines.pop();
  const fields = [];
  const seen = new Set();
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (blank(line) || /^ /.test(line)) continue;
    const match = line.match(/^([^:]+):(?:\s|$)(.*)$/);
    if (!match) fail();
    const key = keyOf(match[1]);
    if (seen.has(key)) fail();
    seen.add(key);
    if (fields.length) fields.at(-1).end = index;
    fields.push({ key, start: index, end: lines.length, tail: match[2] });
  }
  if (lines.some((line, index) => !blank(line) && /^ /.test(line) && (!fields.length || index < fields[0].start))) fail();
  return { lines, fields, newline };
}

function children(lines, field) {
  if (!/^\s*(?:#.*)?$/.test(field.tail)) fail();
  const entries = [];
  const seen = new Set();
  for (let index = field.start + 1; index < field.end; index++) {
    const line = lines[index];
    if (blank(line)) continue;
    const match = line.match(/^  ([^ :][^:]*):(?:\s|$)(.*)$/);
    if (match) {
      const key = keyOf(match[1]);
      if (seen.has(key)) fail();
      seen.add(key);
      if (entries.length) entries.at(-1).end = index;
      entries.push({ key, start: index, end: field.end, tail: match[2] });
    } else if (!/^ {3,}\S/.test(line) || !entries.length) fail();
  }
  return entries;
}

function replaceMapping(lines, field, values, removed = new Set()) {
  if (!field) {
    lines.push(`${values.name}:`, ...Object.entries(values.fields).map(([key, value]) => `  ${key}: ${value}`));
    return;
  }
  const entries = children(lines, field);
  const output = [lines[field.start]];
  const missing = new Set(Object.keys(values.fields));
  let cursor = field.start + 1;
  for (const entry of entries) {
    output.push(...lines.slice(cursor, entry.start));
    if (Object.hasOwn(values.fields, entry.key)) {
      // Replacing a scalar with a nested value is ambiguous and may conceal
      // duplicate/merged configuration. Reject instead of erasing descendants.
      if (lines.slice(entry.start + 1, entry.end).some(line => !blank(line))) fail();
      output.push(`  ${entry.key}: ${values.fields[entry.key]}`);
      output.push(...lines.slice(entry.start + 1, entry.end));
      missing.delete(entry.key);
    } else if (!removed.has(entry.key)) {
      output.push(...lines.slice(entry.start, entry.end));
    } else {
      if (lines.slice(entry.start + 1, entry.end).some(line => !blank(line))) fail();
      // Credentials stay private; no value is parsed, returned, or logged.
      output.push(...lines.slice(entry.start + 1, entry.end));
    }
    cursor = entry.end;
  }
  output.push(...lines.slice(cursor, field.end));
  output.push(...[...missing].map(key => `  ${key}: ${values.fields[key]}`));
  lines.splice(field.start, field.end - field.start, ...output);
}

function replaceRoot(text, name, value) {
  const parsed = parse(text);
  const field = parsed.fields.find(row => row.key === name);
  if (!field) parsed.lines.push(`${name}: ${value}`);
  else {
    // A configured fallback list is intentionally disabled. Preserve comments
    // while removing the selected routing value, including block-list entries.
    const comments = parsed.lines.slice(field.start + 1, field.end).filter(line => /^\s*#/.test(line));
    parsed.lines.splice(field.start, field.end - field.start, `${name}: ${value}`, ...comments);
  }
  return `${parsed.lines.join('\n')}\n`;
}

/** Edits only selected model/agent routing and the two supported fallback keys. */
export function updateHermesOAuthConfigText(text) {
  let parsed = parse(text);
  replaceMapping(parsed.lines, parsed.fields.find(row => row.key === 'model'), { name: 'model', fields: MODEL_FIELDS }, SELECTED_KEY_OVERRIDES);
  let result = `${parsed.lines.join('\n')}\n`;
  parsed = parse(result);
  replaceMapping(parsed.lines, parsed.fields.find(row => row.key === 'agent'), {
    name: 'agent', fields: { reasoning_effort: '"low"' }
  });
  result = `${parsed.lines.join('\n')}\n`;
  result = replaceRoot(result, 'fallback_providers', '[]');
  return replaceRoot(result, 'fallback_model', 'null');
}

/** Configuration evidence only; this never certifies a login or native call. */
export function inspectHermesOAuthConfigText(text) {
  if (updateHermesOAuthConfigText(text) !== text) fail();
  return { configured: true, ...HERMES_OAUTH_PROFILE,
    oauth_verified: false, native_call_verified: false };
}

/**
 * Validate sanitized metadata for every entry of the native selected-provider
 * pool, including exhausted entries that could return to rotation later.
 * Presence/type metadata does not certify the grant or an inference call.
 */
export function inspectHermesOAuthPoolMetadata(value) {
  const invalid = () => { throw new Error('HERMES_OAUTH_POOL_UNVERIFIED'); };
  const exact = (object, keys) => object && typeof object === 'object' && !Array.isArray(object) &&
    Object.keys(object).sort().join(',') === [...keys].sort().join(',');
  if (!exact(value, ['schema_version', 'provider', 'all_entries_observed', 'entries']) ||
      value.schema_version !== 1 || value.provider !== HERMES_OAUTH_PROFILE.provider ||
      value.all_entries_observed !== true || !Array.isArray(value.entries) ||
      value.entries.length === 0 || value.entries.length > 100) invalid();
  for (const entry of value.entries) {
    if (!exact(entry, ['auth_type', 'access_token_present', 'refresh_token_present', 'endpoint_verified']) ||
        entry.auth_type !== 'oauth' || entry.access_token_present !== true ||
        entry.refresh_token_present !== true || entry.endpoint_verified !== true) invalid();
  }
  return { provider: HERMES_OAUTH_PROFILE.provider, pool_oauth_only: true,
    entry_count: value.entries.length, oauth_entry_count: value.entries.length,
    api_key_entry_count: 0, credential_present: true,
    oauth_verified: false, native_call_verified: false };
}

/** Pinned native device-code login, retaining the existing volume and identity. */
export function buildHermesOAuthLoginCommand(settings) {
  if (settings?.harness !== 'hermes' || !/^hs-[1-5]$/.test(settings.seat_id ?? '') ||
      settings.runtime_identity?.uid !== HERMES_RUNTIME_IDENTITY.uid ||
      settings.runtime_identity?.gid !== HERMES_RUNTIME_IDENTITY.gid ||
      Object.keys(settings.runtime_identity ?? {}).sort().join(',') !== 'gid,uid' ||
      !isAbsolute(settings.persistent_root ?? '') || settings.persistent_root === '/' ||
      normalize(settings.persistent_root) !== settings.persistent_root ||
      settings.persistent_root.includes('\0') || settings.persistent_root !== '/opt/data') {
    throw new TypeError('HERMES_OAUTH_LOGIN_SETTINGS_INVALID');
  }
  // Python is part of Hermes' pinned runtime. Drop privilege before Hermes
  // creates auth.json; never import/read an operator or another seat's tokens.
  // The pinned CLI honors active_profile even when HERMES_HOME is the root.
  // Explicit default selects this seat's root without changing sticky state.
  const script = [
    'import os, sys',
    'if os.geteuid() == 0:',
    '    os.setgroups([])',
    '    os.setgid(10000)',
    '    os.setuid(10000)',
    'if os.geteuid() != 10000 or os.getegid() != 10000:',
    '    sys.exit(64)',
    'native_cli = "/opt/hermes/.venv/bin/hermes"',
    'if not os.path.isfile(native_cli) or not os.access(native_cli, os.X_OK):',
    '    sys.exit(66)',
    'os.umask(0o077)',
    'env = dict(os.environ)',
    'env["HOME"] = "/opt/data"',
    'env["HERMES_HOME"] = "/opt/data"',
    'os.chdir("/opt/data")',
    'os.execve(native_cli, [native_cli, "--profile", "default", "auth", "add", "openai-codex", "--type", "oauth", "--label", sys.argv[1]], env)'
  ].join('\n');
  return ['python3', '-c', script, `dilemma-conference-${settings.seat_id}`];
}

// The supported native plugin observes the existing Hermes-owned /chat loop.
// No prompt, token, session ID, response content or private-body digest escapes.
const HERMES_PRODUCTION_PLUGIN = String.raw`
import os,json,pathlib,stat,time,hashlib,hmac,threading
ENDPOINT="https://chatgpt.com/backend-api/codex"
MODEL="gpt-6.1-sol"
ROOT=pathlib.Path("/opt/data/.conference-production-oauth")
ACTIVE=None
LOCK=threading.RLock()
CURRENT=None
SOURCE_OK=False
SCOPE_LOCK=None
class GuardError(RuntimeError): pass
def reject(): raise GuardError("HERMES_PRODUCTION_CALL_BLOCKED")
def unique(pairs):
    result={}
    for key,value in pairs:
        if key in result: reject()
        result[key]=value
    return result
def private_read(path,max_size=1048576):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        row=os.fstat(fd)
        if not stat.S_ISREG(row.st_mode) or row.st_uid!=10000 or row.st_gid!=10000 or stat.S_IMODE(row.st_mode)!=0o600 or row.st_size>max_size: reject()
        raw=os.read(fd,max_size+1)
        if len(raw)>max_size: reject()
        return raw
    finally: os.close(fd)
def directory(path,create=False,exclusive=False):
    if create:
        try: os.mkdir(path,0o700)
        except FileExistsError:
            if exclusive: reject()
    row=os.lstat(path)
    if not stat.S_ISDIR(row.st_mode) or row.st_uid!=10000 or row.st_gid!=10000 or stat.S_IMODE(row.st_mode)!=0o700: reject()
    return path
def save(path,value,exclusive=False):
    target=path if exclusive else pathlib.Path(str(path)+".tmp")
    fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,"w") as stream:
        json.dump(value,stream,separators=(",",":"));stream.flush();os.fsync(stream.fileno())
    if not exclusive: os.replace(target,path)
    fd=os.open(path.parent,os.O_RDONLY)
    try: os.fsync(fd)
    finally: os.close(fd)
def birth(): return int(pathlib.Path("/proc/self/stat").read_text().rsplit(")",1)[1].split()[19])
def live(): return ACTIVE is not None and int(time.time()*1000)<ACTIVE["deadline_at_ms"]
def source_verified(pins):
    for relative,expected in pins.items():
        fd=os.open(pathlib.Path("/opt/hermes",relative),os.O_RDONLY|os.O_NOFOLLOW)
        try:
            row=os.fstat(fd)
            raw=os.read(fd,2097153)
            if not stat.S_ISREG(row.st_mode) or len(raw)>2097152 or hashlib.sha256(raw).hexdigest()!=expected: return False
        finally: os.close(fd)
    return True
def oauth_member(authorization):
    stored=json.loads(private_read(pathlib.Path("/opt/data/auth.json")),object_pairs_hook=unique)
    if not isinstance(stored,dict): return False
    pools=stored.get("credential_pool",{});providers=stored.get("providers",{})
    if not isinstance(pools,dict) or not isinstance(providers,dict): return False
    rows=pools.get("openai-codex",[])
    if not isinstance(rows,list) or len(rows)>100: return False
    rows=list(rows)
    singleton=providers.get("openai-codex",{})
    if not isinstance(singleton,dict) or not isinstance(singleton.get("tokens",{}),dict): return False
    tokens=singleton.get("tokens",{})
    if tokens.get("access_token"):
        rows.append({"auth_type":"oauth","access_token":tokens.get("access_token"),"refresh_token":tokens.get("refresh_token")})
    if not 1<=len(rows)<=100: return False
    match=False
    for row in rows:
        if not isinstance(row,dict): return False
        access=row.get("access_token");refresh=row.get("refresh_token");base=row.get("base_url")
        if row.get("auth_type")!="oauth" or not isinstance(access,str) or not access.strip() or not isinstance(refresh,str) or not refresh.strip() or base not in (None,"",ENDPOINT,ENDPOINT+"/"): return False
        if isinstance(authorization,str) and hmac.compare_digest(authorization,"Bearer "+access): match=True
    return match
def route(view):
    return view.get("provider")=="openai-codex" and view.get("model")==MODEL and view.get("api_mode")=="codex_responses" and view.get("base_url")==ENDPOINT
def prompt_request(prompt,seat):
    if not isinstance(prompt,str) or prompt.count("\nREQUEST_JSON\n")!=1: reject()
    request=json.loads(prompt.split("\nREQUEST_JSON\n",1)[1],object_pairs_hook=unique)
    if not isinstance(request,dict) or request.get("seat_id")!=seat or request.get("schema_version",request.get("response_schema_version"))!=1 or request.get("chain_state",{}).get("chain_id")!=84532: reject()
    request_id=request.get("request_id")
    import re
    if not isinstance(request_id,str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9:._-]{0,511}",request_id): reject()
    if request.get("type") not in ("runtime-diagnostic","discussion") and not (request.get("type") is None and request.get("requested_action") in ("join","commit","reveal","claim")): reject()
    return request_id
def text_matches(messages,prompt):
    if not isinstance(messages,list): return False
    for item in messages:
        if not isinstance(item,dict) or item.get("role")!="user": continue
        content=item.get("content")
        if isinstance(content,str) and prompt in content: return True
        if isinstance(content,list) and any(isinstance(part,dict) and part.get("type") in ("input_text","text") and isinstance(part.get("text"),str) and prompt in part.get("text") for part in content): return True
    return False
def continuation(messages):
    return isinstance(messages,list) and any(isinstance(row,dict) and (row.get("type")=="function_call_output" or row.get("role")=="tool") for row in messages)
def wire_allowed(view,prompt,member,consumed,now,deadline):
    return (now<deadline and consumed is False and member is True and view.get("method")=="POST" and view.get("url")==ENDPOINT+"/responses" and view.get("model")==MODEL and view.get("stream") is True and view.get("store") is False and view.get("reasoning_effort")=="low" and text_matches(view.get("input"),prompt))
def persist(current): save(current["path"]/"receipt.json",current["receipt"])
def block_current():
    # A rejected later callback cannot invalidate a completed physical call.
    # It still raises before forward; only unfinished/uncertain work is blocked.
    if CURRENT is not None and CURRENT["receipt"]["status"]!="verified":
        CURRENT["receipt"].update({"status":"blocked","oauth_verified":False,"native_call_verified":False})
        try: persist(CURRENT)
        except Exception: pass
def pre_api_request(**view):
    global CURRENT
    with LOCK:
        try:
            if not live() or not SOURCE_OK or not route(view): reject()
            count=view.get("api_call_count")
            if type(count) is not int or not 1<=count<=100: reject()
            request_id=prompt_request(view.get("user_message"),ACTIVE["seat_id"])
            identity=(view.get("task_id"),view.get("session_id"))
            if not isinstance(identity[0],str) or not identity[0] or not isinstance(identity[1],str): reject()
            if CURRENT is not None and CURRENT["receipt"]["public_request_id"]==request_id:
                previous=CURRENT["receipt"]["calls"][-1]
                if CURRENT["identity"]!=identity or CURRENT["receipt"]["status"]!="inflight" or previous["response_completed_verified"] is not True or previous["assistant_tool_call_count"]<1 or count!=previous["api_call_count"]+1 or not continuation(view.get("request_messages")): reject()
            else:
                if CURRENT is not None and CURRENT["receipt"]["status"]!="verified": reject()
                if count!=1: reject()
                # The public request identity is safe to hash; private inputs are never hashed.
                path=directory(pathlib.Path(ACTIVE["scope"])/"requests"/hashlib.sha256(request_id.encode()).hexdigest(),True,True)
                receipt={"schema_version":1,"seat_id":ACTIVE["seat_id"],"operation_id":ACTIVE["operation_id"],"public_request_id":request_id,"deadline_at_ms":ACTIVE["deadline_at_ms"],"process_id":os.getpid(),"process_birth_tick":birth(),"source_integrity_verified":True,"native_hook_bound_verified":True,"status":"inflight","calls":[],"oauth_verified":False,"native_call_verified":False,"wire_max_output_tokens_enforced":False}
                CURRENT={"path":path,"receipt":receipt,"identity":identity}
            CURRENT["prompt"]=view["user_message"]
            CURRENT["consumed"]=False
            CURRENT["wire_response_id"]=None
            CURRENT["wire_terminal_id"]=None
            CURRENT["receipt"]["calls"].append({"api_call_count":count,"physical_requests":0,"request_route_verified":False,"request_model_verified":False,"credential_oauth_member_verified":False,"wire_reasoning_effort_verified":False,"http_status_verified":False,"response_model_verified":False,"response_completed_verified":False,"wire_response_model_verified":False,"wire_response_completed_verified":False,"wire_response_identity_verified":False,"same_call_identity_verified":False,"assistant_tool_call_count":0,"started_at_ms":int(time.time()*1000),"completed_at_ms":None})
            persist(CURRENT)
        except Exception:
            block_current()
            reject()
def post_api_request(**view):
    with LOCK:
        try:
            if not live() or CURRENT is None or not SOURCE_OK or not route(view) or CURRENT["receipt"]["status"]!="inflight": reject()
            call=CURRENT["receipt"]["calls"][-1]
            raw=view.get("response")
            tools=view.get("assistant_tool_call_count")
            if CURRENT["identity"]!=(view.get("task_id"),view.get("session_id")) or call["api_call_count"]!=view.get("api_call_count") or CURRENT["consumed"] is not True or call["http_status_verified"] is not True or type(tools) is not int or not 0<=tools<=100: reject()
            if any(call.get(key) is not True for key in ("wire_response_model_verified","wire_response_completed_verified","wire_response_identity_verified")) or view.get("response_model")!=MODEL or getattr(raw,"model",None)!=MODEL or getattr(raw,"status",None)!="completed" or getattr(raw,"id",None)!=CURRENT["wire_terminal_id"]: reject()
            call.update({"response_model_verified":True,"response_completed_verified":True,"same_call_identity_verified":True,"assistant_tool_call_count":tools,"completed_at_ms":int(time.time()*1000)})
            if tools==0:
                CURRENT["receipt"].update({"status":"verified","oauth_verified":True,"native_call_verified":True})
            persist(CURRENT)
        except Exception:
            block_current()
            reject()
def raw_sse_frame(owner,frame):
    data=[]
    for line in frame.splitlines():
        if line.startswith(b"data:"): data.append(line[5:].lstrip(b" "))
    if not data or b"\n".join(data)==b"[DONE]": return
    value=json.loads(b"\n".join(data),object_pairs_hook=unique)
    if not isinstance(value,dict): reject()
    kind=value.get("type")
    if kind not in ("response.created","response.completed","response.incomplete","response.failed","response.cancelled"): return
    response=value.get("response")
    if not isinstance(response,dict): reject()
    identifier=response.get("id")
    if not isinstance(identifier,str) or not identifier or len(identifier)>512: reject()
    if kind=="response.created":
        if owner["wire_response_id"] is not None: reject()
        owner["wire_response_id"]=identifier
        return
    call=owner["receipt"]["calls"][-1]
    if kind!="response.completed" or response.get("model")!=MODEL or response.get("status")!="completed" or owner["wire_response_id"]!=identifier or owner["wire_terminal_id"] is not None: reject()
    owner["wire_terminal_id"]=identifier
    call.update({"wire_response_model_verified":True,"wire_response_completed_verified":True,"wire_response_identity_verified":True})
    persist(owner)

def observe_stream(response,owner,httpx):
    original=response.stream
    class ObservedStream(httpx.SyncByteStream):
        def __iter__(self):
            buffer=b""
            try:
                for chunk in original:
                    if not isinstance(chunk,bytes): reject()
                    # SSE separators can be split across native transport chunks.
                    buffer+=chunk
                    if len(buffer)>2097152: reject()
                    while True:
                        separator=buffer.find(b"\n\n")
                        crlf=buffer.find(b"\r\n\r\n")
                        if crlf>=0 and (separator<0 or crlf<separator): separator=crlf;width=4
                        else: width=2
                        if separator<0: break
                        frame=buffer[:separator];buffer=buffer[separator+width:]
                        with LOCK:
                            if CURRENT is not owner or not live(): reject()
                            raw_sse_frame(owner,frame)
                    yield chunk
                if buffer.strip() or owner["wire_terminal_id"] is None: reject()
            except Exception:
                with LOCK: block_current()
                reject()
        def close(self): return original.close()
    response.stream=ObservedStream()
    return response

def enable_plugin(text):
    import yaml
    node=yaml.compose(text)
    if not isinstance(node,yaml.MappingNode): raise ValueError()
    def child(mapping,key):
        found=[(name,value) for name,value in mapping.value if name.value==key]
        if len(found)>1: raise ValueError()
        if found:
            name,value=found[0]
            # Aliased nodes retain the target's marks and could edit another
            # stanza; reject managed aliases rather than rewriting the target.
            if value.start_mark.index<name.end_mark.index: raise ValueError()
            return value
        return None
    block=child(node,"plugins")
    name="dilemma-conference-oauth"
    if block is None: text+='\nplugins:\n  enabled: ["'+name+'"]\n'
    else:
        if not isinstance(block,yaml.MappingNode) or block.flow_style or text[block.start_mark.index:].lstrip().startswith("&"): raise ValueError()
        disabled=child(block,"disabled")
        if disabled is not None and name in yaml.safe_load(text[disabled.start_mark.index:disabled.end_mark.index]): raise ValueError()
        enabled=child(block,"enabled")
        if enabled is None:
            text=text[:block.end_mark.index]+'  enabled: ["'+name+'"]\n'+text[block.end_mark.index:]
        else:
            managed=text[enabled.start_mark.index:enabled.end_mark.index]
            if any(isinstance(token,(yaml.tokens.AnchorToken,yaml.tokens.AliasToken)) for token in yaml.scan(managed)): raise ValueError()
            names=yaml.safe_load(managed)
            if not isinstance(names,list) or any(not isinstance(item,str) for item in names) or len(names)!=len(set(names)): raise ValueError()
            if name not in names:
                if enabled.flow_style:
                    if enabled.start_mark.line!=enabled.end_mark.line: raise ValueError()
                    insert=enabled.end_mark.index-1
                    text=text[:insert]+(', ' if names else '')+json.dumps(name)+text[insert:]
                else:
                    if not enabled.value: raise ValueError()
                    last=enabled.value[-1]
                    insert=text.find('\n',last.end_mark.index)
                    if insert<0: insert=len(text);text+='\n'
                    else: insert+=1
                    indent=' '*enabled.value[0].start_mark.column
                    # Sequence scalar mark follows '- '; retain its indentation.
                    text=text[:insert]+indent[:-2]+'- '+json.dumps(name)+'\n'+text[insert:]
    return text

def inference_request(request):
    url=str(request.url)
    try: body=json.loads(request.content,object_pairs_hook=unique)
    except Exception: body=None
    model_route=url.split("?",1)[0].rstrip("/").endswith(("/responses","/chat/completions","/completions","/messages"))
    refresh=isinstance(body,dict) and body.get("grant_type")=="refresh_token"
    if refresh or url.startswith("https://auth.openai.com/oauth/token"): reject()
    return model_route or isinstance(body,dict) and "model" in body

def register(ctx):
    global ACTIVE,SOURCE_OK,SCOPE_LOCK
    import httpx,importlib.metadata
    original=httpx.Client._send_single_request
    original_async=httpx.AsyncClient._send_single_request
    def guarded_send(client,request):
        if not inference_request(request): return original(client,request)
        with LOCK:
            try:
                if not live() or not SOURCE_OK or CURRENT is None or CURRENT["receipt"]["status"]!="inflight": reject()
                body=json.loads(request.content,object_pairs_hook=unique)
                if not isinstance(body,dict): reject()
                view={"method":request.method,"url":str(request.url),"model":body.get("model"),"input":body.get("input"),"stream":body.get("stream"),"store":body.get("store"),"reasoning_effort":(body.get("reasoning") or {}).get("effort") if isinstance(body.get("reasoning"),dict) else None}
                if not wire_allowed(view,CURRENT["prompt"],oauth_member(request.headers.get("authorization","")),CURRENT["consumed"],int(time.time()*1000),ACTIVE["deadline_at_ms"]): reject()
                CURRENT["consumed"]=True
                call=CURRENT["receipt"]["calls"][-1]
                call.update({"physical_requests":1,"request_route_verified":True,"request_model_verified":True,"credential_oauth_member_verified":True,"wire_reasoning_effort_verified":True})
                # Durable consumption precedes the only physical transport forward.
                persist(CURRENT)
                owner=CURRENT
            except Exception:
                block_current();reject()
        try: response=original(client,request)
        except Exception:
            with LOCK: block_current()
            reject()
        with LOCK:
            if CURRENT is not owner: block_current();reject()
            call["http_status_verified"]=response.status_code==200
            persist(CURRENT)
            if not call["http_status_verified"]: block_current();reject()
        return observe_stream(response,owner,httpx)
    async def deny_async(client,request):
        if not inference_request(request): return await original_async(client,request)
        reject()
    # Native hooks are best effort. A failed/missing hook still cannot forward.
    httpx.Client._send_single_request=guarded_send
    httpx.AsyncClient._send_single_request=deny_async
    try:
        if os.geteuid()!=10000 or os.getegid()!=10000 or os.getenv("HOME")!="/opt/data" or os.getenv("HERMES_HOME")!="/opt/data": reject()
        ACTIVE=json.loads(private_read(ROOT/"active.json"),object_pairs_hook=unique)
        if not live() or not source_verified(ACTIVE["native_source_pins"]): reject()
        if any(os.getenv(key) for key in ("OPENAI_API_KEY","CODEX_API_KEY","OPENAI_BASE_URL","OPENAI_API_BASE","HERMES_DUMP_REQUESTS","HERMES_DUMP_REQUEST_STDOUT")): reject()
        import yaml
        class UniqueLoader(yaml.SafeLoader): pass
        def mapping(loader,node,deep=False):
            return unique([(loader.construct_object(key,deep=deep),loader.construct_object(value,deep=deep)) for key,value in node.value])
        UniqueLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,mapping)
        config=yaml.load(private_read(pathlib.Path("/opt/data/config.yaml")),Loader=UniqueLoader)
        model=config.get("model",{})
        expected={"provider":"openai-codex","base_url":ENDPOINT,"model":MODEL,"default":MODEL,"api_mode":"codex_responses","openai_runtime":"auto","reasoning_effort":"low","max_tokens":2048}
        if any(model.get(key)!=value for key,value in expected.items()) or any(key in model for key in ("api_key","api","key_env","api_key_env")) or config.get("fallback_providers")!=[] or config.get("fallback_model") is not None or config.get("agent",{}).get("reasoning_effort")!="low": reject()
        from openai._base_client import SyncHttpxClientWrapper
        if importlib.metadata.version("httpx")!="0.28.1" or importlib.metadata.version("openai")!="2.24.0" or SyncHttpxClientWrapper._send_single_request is not guarded_send: reject()
        for name,pin in (("httpx._client","c43f941baefe58c91e96d00039e1868fe719d91453026d7db1647194563bff8d"),("openai._base_client","383b1acf9de56a41533ca7fd1a39836f68a396f212b938a9c75f68a71c895347")):
            import importlib
            path=pathlib.Path(importlib.import_module(name).__file__)
            if not path.resolve().is_relative_to(pathlib.Path("/opt/hermes/.venv")) or hashlib.sha256(path.read_bytes()).hexdigest()!=pin: reject()
        scope=directory(pathlib.Path(ACTIVE["scope"]))
        import fcntl
        SCOPE_LOCK=os.open(scope/".native-process.lock",os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
        row=os.fstat(SCOPE_LOCK)
        if not stat.S_ISREG(row.st_mode) or row.st_uid!=10000 or row.st_gid!=10000 or stat.S_IMODE(row.st_mode)!=0o600: reject()
        # Hold through native process lifetime; sequential /chat CLIs can reuse
        # the window, competing native processes cannot infer concurrently.
        fcntl.flock(SCOPE_LOCK,fcntl.LOCK_EX|fcntl.LOCK_NB)
        processes=directory(scope/"processes")
        ctx.register_hook("pre_api_request",pre_api_request)
        ctx.register_hook("post_api_request",post_api_request)
        SOURCE_OK=True
        save(processes/(str(os.getpid())+"-"+str(birth())+".json"),{"schema_version":1,"process_id":os.getpid(),"process_birth_tick":birth(),"source_integrity_verified":True,"native_hook_bound_verified":True},True)
    except Exception:
        SOURCE_OK=False
        reject()
`;

const HERMES_PRODUCTION_INSTALL = String.raw`
import os,sys,json,pathlib,hashlib,io,contextlib
output={"schema_version":1,"status":"blocked","error_code":"HERMES_PRODUCTION_OBSERVER_UNVERIFIED","oauth_verified":False,"native_call_verified":False}
with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
    try:
        values=json.loads(sys.argv[1]);source=sys.argv[2]
        helper={"__name__":"conference_observer_install"};exec(source,helper)
        if os.geteuid()!=10000 or os.getegid()!=10000 or not helper["source_verified"](values["native_source_pins"]): raise ValueError()
        if not int(__import__("time").time()*1000)<values["deadline_at_ms"]: raise ValueError()
        root=helper["directory"](helper["ROOT"],True)
        seat=helper["directory"](root/values["seat_id"],True)
        scope=helper["directory"](seat/values["operation_id"],True,True)
        helper["directory"](scope/"requests",True);helper["directory"](scope/"processes",True)
        values["scope"]=str(scope)
        helper["save"](scope/"operation.json",values,True)
        plugins=pathlib.Path("/opt/data/plugins")
        try: os.mkdir(plugins,0o700)
        except FileExistsError: pass
        row=os.lstat(plugins)
        if not __import__("stat").S_ISDIR(row.st_mode) or row.st_uid!=10000 or row.st_gid!=10000: raise ValueError()
        plugin=helper["directory"](plugins/"dilemma-conference-oauth",True)
        manifest='name: dilemma-conference-oauth\nversion: "1.0.0"\nkind: standalone\nprovides_hooks: [pre_api_request, post_api_request]\n'
        for name,content in (("__init__.py",source),("plugin.yaml",manifest)):
            path=plugin/name
            try: existing=helper["private_read"](path).decode()
            except FileNotFoundError: existing=None
            if existing is not None and existing!=content: raise ValueError()
            if existing is None:
                fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
                with os.fdopen(fd,"w") as stream: stream.write(content);stream.flush();os.fsync(stream.fileno())
        import yaml
        config_path=pathlib.Path("/opt/data/config.yaml")
        text=helper["private_read"](config_path).decode()
        text=helper["enable_plugin"](text)
        if text!=helper["private_read"](config_path).decode():
            tmp=pathlib.Path(str(config_path)+".conference-oauth.tmp")
            fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
            with os.fdopen(fd,"w") as stream: stream.write(text);stream.flush();os.fsync(stream.fileno())
            os.replace(tmp,config_path)
        helper["save"](root/"active.json",values)
        output={"schema_version":1,"status":"prepared","seat_id":values["seat_id"],"operation_id":values["operation_id"],"deadline_at_ms":values["deadline_at_ms"],"source_integrity_verified":True,"plugin_source_sha256":hashlib.sha256(source.encode()).hexdigest(),"process_refresh_required":True,"oauth_verified":False,"native_call_verified":False}
    except Exception: pass
print(json.dumps(output,separators=(",",":")),flush=True)
`;

const HERMES_PRODUCTION_READ = String.raw`
import os,sys,json,pathlib,hashlib,time,io,contextlib
output={"schema_version":1,"status":"blocked","error_code":"HERMES_PRODUCTION_RECEIPT_UNVERIFIED","oauth_verified":False,"native_call_verified":False}
with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
    try:
        values=json.loads(sys.argv[1]);helper={"__name__":"conference_observer_read"};exec(sys.argv[2],helper)
        if os.geteuid()!=10000 or os.getegid()!=10000 or int(time.time()*1000)>=values["deadline_at_ms"]: raise ValueError()
        if helper["private_read"](pathlib.Path("/opt/data/plugins/dilemma-conference-oauth/__init__.py")).decode()!=sys.argv[2]: raise ValueError()
        scope=helper["directory"](helper["ROOT"]/values["seat_id"]/values["operation_id"])
        original=json.loads(helper["private_read"](scope/"operation.json"),object_pairs_hook=helper["unique"])
        if any(original.get(key)!=values[key] for key in ("seat_id","operation_id","deadline_at_ms","native_source_pins")) or not helper["source_verified"](values["native_source_pins"]): raise ValueError()
        path=helper["directory"](scope/"requests"/hashlib.sha256(values["public_request_id"].encode()).hexdigest())
        receipt=json.loads(helper["private_read"](path/"receipt.json"),object_pairs_hook=helper["unique"])
        expected={"schema_version","seat_id","operation_id","public_request_id","deadline_at_ms","process_id","process_birth_tick","source_integrity_verified","native_hook_bound_verified","status","calls","oauth_verified","native_call_verified","wire_max_output_tokens_enforced"}
        if set(receipt)!=expected or receipt.get("schema_version")!=1 or type(receipt.get("process_id")) is not int or receipt["process_id"]<1 or type(receipt.get("process_birth_tick")) is not int or receipt["process_birth_tick"]<1 or any(receipt.get(key)!=values[key] for key in ("seat_id","operation_id","public_request_id","deadline_at_ms")): raise ValueError()
        activation=json.loads(helper["private_read"](scope/"processes"/(str(receipt["process_id"])+"-"+str(receipt["process_birth_tick"])+".json")),object_pairs_hook=helper["unique"])
        if set(activation)!={"schema_version","process_id","process_birth_tick","source_integrity_verified","native_hook_bound_verified"} or activation["schema_version"]!=1 or any(activation[key]!=receipt[key] for key in ("process_id","process_birth_tick")) or activation["source_integrity_verified"] is not True or activation["native_hook_bound_verified"] is not True: raise ValueError()
        calls=receipt["calls"]
        keys={"api_call_count","physical_requests","request_route_verified","request_model_verified","credential_oauth_member_verified","wire_reasoning_effort_verified","http_status_verified","response_model_verified","response_completed_verified","wire_response_model_verified","wire_response_completed_verified","wire_response_identity_verified","same_call_identity_verified","assistant_tool_call_count","started_at_ms","completed_at_ms"}
        flags=keys-{"api_call_count","physical_requests","assistant_tool_call_count","started_at_ms","completed_at_ms"}
        if receipt["status"]!="verified" or receipt["oauth_verified"] is not True or receipt["native_call_verified"] is not True or receipt["source_integrity_verified"] is not True or receipt["native_hook_bound_verified"] is not True or receipt["wire_max_output_tokens_enforced"] is not False or not isinstance(calls,list) or not 1<=len(calls)<=100: raise ValueError()
        for index,call in enumerate(calls):
            if not isinstance(call,dict) or set(call)!=keys or type(call["api_call_count"]) is not int or call["api_call_count"]!=index+1 or type(call["physical_requests"]) is not int or call["physical_requests"]!=1 or any(call[key] is not True for key in flags): raise ValueError()
            if type(call["started_at_ms"]) is not int or type(call["completed_at_ms"]) is not int or not call["started_at_ms"]<=call["completed_at_ms"]<values["deadline_at_ms"] or type(call["assistant_tool_call_count"]) is not int or not 0<=call["assistant_tool_call_count"]<=100: raise ValueError()
            if index<len(calls)-1 and call["assistant_tool_call_count"]<1 or index==len(calls)-1 and call["assistant_tool_call_count"]!=0: raise ValueError()
        output={**receipt,"provider":"openai-codex","endpoint":"https://chatgpt.com/backend-api/codex","requested_model":"gpt-6.1-sol","returned_model":"gpt-6.1-sol","auth_mode":"chatgpt","api_mode":"codex_responses","physical_requests":len(calls),"fallback_absent_verified":True,"configured_reasoning_effort":"low","configured_max_output_tokens":2048}
    except Exception: pass
print(json.dumps(output,separators=(",",":")),flush=True)
`;

const HERMES_PRODUCTION_REQUIRED_SOURCES = Object.freeze([
  'hermes_cli/auth.py', 'hermes_cli/config.py', 'hermes_cli/runtime_provider.py',
  'agent/credential_pool.py', 'hermes_cli/plugins.py', 'run_agent.py'
]);

function productionObserverSettings({ settings, operationId, deadlineAtMs, publicRequestId }, read = false) {
  if (settings?.harness !== 'hermes' || !/^hs-[1-5]$/.test(settings.seat_id ?? '') ||
      settings.persistent_root !== '/opt/data' || settings.runtime_identity?.uid !== 10000 ||
      settings.runtime_identity?.gid !== 10000 ||
      Object.keys(settings.runtime_identity ?? {}).sort().join(',') !== 'gid,uid' ||
      !new RegExp(`^hermes-production-${settings?.seat_id}-[a-z0-9_-]{6,80}$`).test(operationId ?? '') ||
      !Number.isSafeInteger(deadlineAtMs) || deadlineAtMs <= Date.now() || deadlineAtMs > Date.now() + 180 * 60 * 1000 ||
      !settings.native_source_pins || typeof settings.native_source_pins !== 'object' || Array.isArray(settings.native_source_pins) ||
      HERMES_PRODUCTION_REQUIRED_SOURCES.some(name => !Object.hasOwn(settings.native_source_pins, name)) ||
      Object.entries(settings.native_source_pins).some(([name, pin]) =>
        !/^(?:[A-Za-z0-9_]+\/)*[A-Za-z0-9_]+\.py$/.test(name) || !/^[a-f0-9]{64}$/.test(pin)) ||
      Object.keys(settings.native_source_pins).length > 30 ||
      read && (typeof publicRequestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,511}$/.test(publicRequestId))) {
    throw new TypeError('HERMES_PRODUCTION_OBSERVER_SETTINGS_INVALID');
  }
  return { seat_id: settings.seat_id, operation_id: operationId, deadline_at_ms: deadlineAtMs,
    native_source_pins: { ...settings.native_source_pins }, ...(read ? { public_request_id: publicRequestId } : {}) };
}

function hermesProductionCommand(script, values) {
  const launch = [
    'import os,sys',
    'if os.geteuid()==0:',
    '    os.setgroups([]); os.setgid(10000); os.setuid(10000)',
    'if os.geteuid()!=10000 or os.getegid()!=10000: sys.exit(64)',
    'native_python="/opt/hermes/.venv/bin/python"',
    'if not os.path.isfile(native_python) or not os.access(native_python,os.X_OK): sys.exit(66)',
    'os.umask(0o077)',
    'env=dict(os.environ)',
    'env.update({"HOME":"/opt/data","HERMES_HOME":"/opt/data","PYTHONDONTWRITEBYTECODE":"1"})',
    'os.chdir("/opt/data")',
    'os.execve(native_python,[native_python,"-B","-c",sys.argv[1],sys.argv[2],sys.argv[3]],env)'
  ].join('\n');
  return ['python3', '-c', launch, script, JSON.stringify(values), HERMES_PRODUCTION_PLUGIN];
}

/** Prepare the native user plugin; the lead refreshes the existing process. */
export function buildHermesProductionObserverCommand(input) {
  return hermesProductionCommand(HERMES_PRODUCTION_INSTALL, productionObserverSettings(input));
}

/** Read fixed metadata for the exact production /chat request; never reruns it. */
export function buildHermesProductionReceiptReadCommand(input) {
  return hermesProductionCommand(HERMES_PRODUCTION_READ, productionObserverSettings(input, true));
}
