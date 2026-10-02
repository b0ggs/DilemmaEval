import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readFile, readlink, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPublicGameplayRequest } from './protocol.mjs';
import { inspectModel, inspectModelRoute } from './install-runtime.mjs';
import { deriveEthereumAddress } from '../../../game-bridge/src/index.js';

const HEX = /^[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const MAX_PERMIT_MS = 300_000;
const MODEL = Object.freeze({ model_endpoint:'https://api.maritime.sh/api/llm/v1', model:'gpt-5.4-mini',
  reasoning_effort:'low', max_output_tokens:2048, automatic_fallback:false });
const KEYS = ['schema_version','type','request_id','request_sha256','seat_id','agent_id','team','harness',
  'wallet_address','chain_id','game_address','game_id','round','phase','requested_action','readiness_evidence_sha256',
  'artifact_sha256','artifact_manifest','runtime_instance_fingerprint','model_profile','issued_at_ms','expires_at_ms','hard_stop_at_ms'];
const fail = () => { throw Object.assign(new Error('PLAYER_EXECUTION_PERMIT_INVALID'),{code:'PLAYER_EXECUTION_PERMIT_INVALID'}); };
const exact = (value,keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
}
export const executionPermitFingerprint = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const requestFilename = requestId => `${createHash('sha256').update(requestId).digest('hex')}.json`;

/** Guest execution-state observation. Snapshot resume can preserve it; this is
 * deliberately not a provider lifecycle attestation or monotonic remote epoch. */
export async function readRuntimeInstanceFingerprint({readFileImpl=readFile,readlinkImpl=readlink}={}) {
  try {
    const boot=(await readFileImpl('/proc/sys/kernel/random/boot_id','utf8')).trim();
    const stat=await readFileImpl('/proc/1/stat','utf8');
    const start=stat.slice(stat.lastIndexOf(')')+2).split(' ')[19];
    // The executing Hermes UID can inspect its own namespace without ptrace
    // access to root-owned PID 1. PID 1 still supplies the guest start time.
    const ns=await readlinkImpl('/proc/self/ns/pid');
    if (!/^[0-9a-f-]{36}$/.test(boot) || !/^1 \(/.test(stat) || !/^[0-9]+$/.test(start ?? '') || !/^pid:\[[0-9]+\]$/.test(ns)) fail();
    return createHash('sha256').update(JSON.stringify([boot,start,ns])).digest('hex');
  } catch { fail(); }
}

function safeEvidence(value,key='') {
  const normalized=key.toLowerCase().replace(/[^a-z0-9]/g,'');
  if (['choice','salt','prompt','session','privatekey','environment','rawreply','providerresponse','providererror','rawerror','privatepath','secret']
    .some(fragment=>normalized.includes(fragment))) fail();
  if (typeof value==='string' && /(?:^|\s)Bearer\s+\S+|\b(?:mk|sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{8,}/i.test(value)) fail();
  if (Array.isArray(value)) for(const child of value)safeEvidence(child);
  else if(value&&typeof value==='object')for(const [childKey,child]of Object.entries(value))safeEvidence(child,childKey);
}

function contextSeat(context,permit) {
  safeEvidence(context);
  if (context?.schema_version!==2 || context.producer_version!==2 ||
      context.continuity_policy!=='observed-runtime-continuity-v1' || context.ready_for_controlled_gameplay!==true ||
      context.remote_generation_attested!==false || context.chain_id!==84532 || context.game_address!==permit.game_address ||
      context.diagnostics_complete!==true || !Array.isArray(context.seats) ||
      executionPermitFingerprint(context)!==permit.readiness_evidence_sha256 ||
      !Number.isFinite(Date.parse(context.verified_at)) || Date.parse(context.verified_at)>permit.issued_at_ms ||
      !Number.isFinite(Date.parse(context.expires_at)) || Date.parse(context.expires_at)<=Date.parse(context.verified_at)) fail();
  const rows=context.seats.filter(row=>row?.seat_id===permit.seat_id&&row.agent_id===permit.agent_id);
  const row=rows[0];
  if(rows.length!==1||row.harness!==permit.harness||row.wallet_address?.toLowerCase()!==permit.wallet_address||
      row.artifact_sha256!==permit.artifact_sha256||row.runtime_instance_fingerprint!==permit.runtime_instance_fingerprint||
      executionPermitFingerprint(row.model_profile)!==executionPermitFingerprint(permit.model_profile)||
      row.tool_execution_verified!==true||row.lifecycle_ambiguous!==false)fail();
  return row;
}

function validatePermit(permit,base) {
  if(!exact(permit,KEYS)||permit.schema_version!==1||permit.type!=='player-execution-permit'||
      typeof permit.request_id!=='string'||!/^[A-Za-z0-9:._-]{1,256}$/.test(permit.request_id)||
      !/^(?:oc|hs)-(?:[1-9]|10)$/.test(permit.seat_id)||!['openclaw','hermes'].includes(permit.harness)||
      permit.team!==permit.harness||!permit.seat_id.startsWith(permit.team==='openclaw'?'oc-':'hs-')||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(permit.agent_id)||!ADDRESS.test(permit.wallet_address)||
      permit.chain_id!==84532||!ADDRESS.test(permit.game_address)||!/^[1-9][0-9]*$/.test(permit.game_id)||
      !Number.isSafeInteger(permit.round)||permit.round<0||!['join','commit','reveal','claim'].includes(permit.phase)||
      permit.requested_action!==permit.phase||
      ['request_sha256','readiness_evidence_sha256','artifact_sha256','runtime_instance_fingerprint'].some(key=>!HEX.test(permit[key]??''))||
      !exact(permit.model_profile,Object.keys(MODEL))||Object.entries(MODEL).some(([key,value])=>permit.model_profile[key]!==value)||
      !['issued_at_ms','expires_at_ms','hard_stop_at_ms'].every(key=>Number.isSafeInteger(permit[key])&&permit[key]>0)||
      permit.expires_at_ms<=permit.issued_at_ms||permit.expires_at_ms-permit.issued_at_ms>MAX_PERMIT_MS||
      permit.expires_at_ms>permit.hard_stop_at_ms||!Array.isArray(permit.artifact_manifest)||
      permit.artifact_manifest.length<1||permit.artifact_manifest.length>100)fail();
  const seen=new Set(),publicFiles=new Set(['seat.json','PLAYER-INSTRUCTIONS.md','HARNESS-RECIPE.json'].map(name=>join(base,name)));
  for(const row of permit.artifact_manifest) {
    if(!exact(row,['path','sha256'])||typeof row.path!=='string'||!isAbsolute(row.path)||resolve(row.path)!==row.path||
        /[\0\r\n]/.test(row.path)||!(row.path.startsWith(`${base}/code/`)||publicFiles.has(row.path))||
        !HEX.test(row.sha256??'')||seen.has(row.path))fail();
    seen.add(row.path);
  }
  if(!seen.has(join(base,'seat.json'))||!seen.has(join(base,'code/integration/conference-runner/src/maritime/execution-permit.mjs'))||
      createHash('sha256').update(JSON.stringify(permit.artifact_manifest)).digest('hex')!==permit.artifact_sha256)fail();
}

export function buildExecutionPermit({config,evidence,artifact,request,expiresAtMs,hardStopAtMs=expiresAtMs,nowMs=Date.now()}={}) {
  try {
    assertPublicGameplayRequest(request);
    const seat=config.roster.find(row=>row.seat_id===request.seat_id);
    const matches=evidence.seats.filter(row=>row.seat_id===request.seat_id&&row.agent_id===seat?.agent_id);
    const row=matches[0],base=dirname(artifact.gameplay_command[2]);
    if(config.chain_id!==84532||!seat||matches.length!==1||seat.team!==request.team||artifact.seat_id!==seat.seat_id||
        artifact.agent_id!==seat.agent_id||artifact.harness!==seat.harness||!Number.isSafeInteger(nowMs)||
        nowMs>=expiresAtMs||nowMs>=hardStopAtMs||
        evidence.run_id!==config.run_id||evidence.config_fingerprint!==executionPermitFingerprint(config))fail();
    const permit={schema_version:1,type:'player-execution-permit',request_id:request.request_id,
      request_sha256:executionPermitFingerprint(request),seat_id:seat.seat_id,agent_id:seat.agent_id,
      team:seat.team,harness:seat.harness,wallet_address:seat.wallet_address.toLowerCase(),chain_id:84532,
      game_address:config.game_address.toLowerCase(),game_id:request.game_id,round:request.round,phase:request.phase,
      requested_action:request.requested_action,readiness_evidence_sha256:executionPermitFingerprint(evidence),
      artifact_sha256:artifact.artifact_sha256,artifact_manifest:artifact.files.map(({path,sha256})=>({path,sha256})),
      runtime_instance_fingerprint:row.runtime_instance_fingerprint,model_profile:structuredClone(row.model_profile),
      issued_at_ms:nowMs,expires_at_ms:expiresAtMs,hard_stop_at_ms:hardStopAtMs};
    validatePermit(permit,base);contextSeat(evidence,permit);
    const settings=JSON.parse(artifact.files.find(file=>file.path===join(base,'seat.json')).content);
    if(settings.execution_permit_required!==true)fail();
    return {permit,context:structuredClone(evidence)};
  } catch {fail();}
}

// Serialized by buildExecutionPermitStageCommand; all dependencies are local
// imports so the exact same safe staging code runs in the selected sandbox.
export async function stageExecutionPermit(spec,{fsImpl}={}) {
  try {
  const fs=fsImpl??await import('node:fs/promises');
  const {constants}=await import('node:fs');
  const {createHash}=await import('node:crypto');
  const {dirname,join,resolve}=await import('node:path');
  const fail=()=>{throw new Error('PLAYER_EXECUTION_PERMIT_INVALID');};
  const digest=text=>createHash('sha256').update(text).digest('hex');
  if(!spec||resolve(spec.base)!==spec.base||await fs.realpath(spec.base)!==spec.base||
      spec.settings_path!==join(spec.base,'seat.json')||
      spec.permit_path!==join(spec.base,'execution-permits',`${digest(spec.request_id)}.json`)||
      !/^[0-9a-f]{64}$/.test(spec.evidence_sha256)||
      spec.context_path!==join(spec.base,'execution-permits','contexts',`${spec.evidence_sha256}.json`)||
      digest(spec.permit_content)!==spec.permit_content_sha256||digest(spec.context_content)!==spec.context_content_sha256)fail();
  const meta=await fs.lstat(spec.settings_path);
  if(!meta.isFile()||meta.isSymbolicLink()||await fs.realpath(spec.settings_path)!==spec.settings_path)fail();
  const settings=JSON.parse(await fs.readFile(spec.settings_path,'utf8'));
  if(settings.seat_id!==spec.seat_id||settings.harness!==spec.harness||settings.execution_permit_required!==true)fail();
  const identity=settings.harness==='hermes'?settings.runtime_identity:{uid:0,gid:0};
  if(!['openclaw','hermes'].includes(settings.harness)||identity?.uid!==(settings.harness==='hermes'?10000:0)||identity?.gid!==identity.uid)fail();
  const directories=[join(spec.base,'execution-permits'),join(spec.base,'execution-permits','contexts')];
  for(const directory of directories) {
    try{await fs.mkdir(directory,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
    const meta=await fs.lstat(directory);
    if(!meta.isDirectory()||meta.isSymbolicLink()||await fs.realpath(directory)!==directory)fail();
    if(meta.uid!==identity.uid||meta.gid!==identity.gid)await fs.chown(directory,identity.uid,identity.gid);
    await fs.chmod(directory,0o700);
  }
  for(const [path,content]of [[spec.context_path,spec.context_content],[spec.permit_path,spec.permit_content]]) {
    let handle;
    try {
      try{handle=await fs.open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);await handle.writeFile(content);}
      catch(error){if(handle||error.code!=='EEXIST')throw error;handle=await fs.open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
        if(await handle.readFile('utf8')!==content)fail();}
      const meta=await handle.stat();
      if(!meta.isFile()||meta.nlink!==1)fail();
      if(meta.uid!==identity.uid||meta.gid!==identity.gid)await handle.chown(identity.uid,identity.gid);
      await handle.chmod(0o600);await handle.sync();
    }finally{await handle?.close();}
  }
  for(const directory of [...directories].reverse().concat(spec.base)){
    const handle=await fs.open(directory,constants.O_RDONLY|constants.O_NOFOLLOW);
    try{await handle.sync();}finally{await handle.close();}
  }
  return {schema_version:1,staged:true,request_id:spec.request_id,permit_sha256:spec.permit_sha256};
  } catch { throw Object.assign(new Error('PLAYER_EXECUTION_PERMIT_INVALID'),{code:'PLAYER_EXECUTION_PERMIT_INVALID'}); }
}

export function buildExecutionPermitStageCommand({artifact,permit:envelope}={}) {
  try {
    const {permit,context}=envelope,base=dirname(artifact.gameplay_command[2]);
    validatePermit(permit,base);contextSeat(context,permit);
    if(artifact.seat_id!==permit.seat_id||artifact.agent_id!==permit.agent_id||artifact.artifact_sha256!==permit.artifact_sha256)fail();
    const permitContent=`${JSON.stringify(canonical(permit))}\n`,contextContent=`${JSON.stringify(canonical(context))}\n`;
    const spec={base,settings_path:join(base,'seat.json'),seat_id:permit.seat_id,harness:permit.harness,request_id:permit.request_id,
      permit_path:join(base,'execution-permits',requestFilename(permit.request_id)),
      context_path:join(base,'execution-permits','contexts',`${permit.readiness_evidence_sha256}.json`),
      evidence_sha256:permit.readiness_evidence_sha256,permit_content:permitContent,context_content:contextContent,
      permit_content_sha256:createHash('sha256').update(permitContent).digest('hex'),
      context_content_sha256:createHash('sha256').update(contextContent).digest('hex'),permit_sha256:executionPermitFingerprint(permit)};
    return ['node','--input-type=module','-e',`(${stageExecutionPermit.toString()})(JSON.parse(process.argv[1])).then(value=>process.stdout.write(JSON.stringify(value))).catch(()=>{process.stdout.write('{"ok":false,"error":{"code":"PLAYER_EXECUTION_PERMIT_INVALID"}}');process.exitCode=1;});`,JSON.stringify(spec)];
  }catch{fail();}
}

async function checkedRead(path,{openImpl=open,lstatImpl=lstat,realpathImpl=realpath}={},maximum=1_048_576,restricted=false) {
  if(await realpathImpl(dirname(path))!==dirname(path))fail();
  const parent=await lstatImpl(dirname(path));
  if(!parent.isDirectory()||parent.isSymbolicLink()||restricted&&(parent.mode&0o777)!==0o700)fail();
  const before=await lstatImpl(path);
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1)fail();
  const handle=await openImpl(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const meta=await handle.stat();
    if(!meta.isFile()||meta.nlink!==1||meta.size>maximum||restricted&&(meta.mode&0o777)!==0o600)fail();
    return await handle.readFile('utf8');
  }finally{await handle.close();}
}

/** Called inside the player's seat lock before creating gameplay state, and
 * immediately before each player operation. No coordinator key is needed. */
export async function verifyExecutionPermit({settings,request,env=process.env,now=Date.now,
  runtimeFingerprintReader=readRuntimeInstanceFingerprint,inspectModelImpl=inspectModel,
  inspectModelRouteImpl=inspectModelRoute,fsImpl={},expectedEvidenceSha256,
  expectedArtifactSha256}={}) {
  try {
    assertPublicGameplayRequest(request);
    const base=dirname(settings.state_directory??'');
    if(settings.execution_permit_required!==true||!isAbsolute(base)||resolve(base)!==base||
        settings.state_directory!==join(base,'private'))fail();
    const permit=JSON.parse(await checkedRead(join(base,'execution-permits',requestFilename(request.request_id)),fsImpl,1_048_576,true));
    validatePermit(permit,base);
    const time=typeof now==='function'?now():now;
    if(!Number.isSafeInteger(time)||time<permit.issued_at_ms||time>=permit.expires_at_ms||time>=permit.hard_stop_at_ms||
        expectedEvidenceSha256!==undefined&&permit.readiness_evidence_sha256!==expectedEvidenceSha256||
        expectedArtifactSha256!==undefined&&permit.artifact_sha256!==expectedArtifactSha256)fail();
    const seat=settings.roster.find(row=>row.seat_id===settings.seat_id);
    if(!seat||permit.request_sha256!==executionPermitFingerprint(request)||permit.request_id!==request.request_id||
        permit.seat_id!==seat.seat_id||permit.agent_id!==seat.agent_id||permit.harness!==settings.harness||
        permit.team!==seat.team||permit.wallet_address!==seat.wallet_address.toLowerCase()||
        permit.chain_id!==settings.chain_id||permit.game_address!==settings.game_address.toLowerCase()||
        ['game_id','round','phase','requested_action'].some(key=>permit[key]!==request[key]))fail();
    if(deriveEthereumAddress(env.GAMEPLAY_WALLET_PRIVATE_KEY).toLowerCase()!==permit.wallet_address)fail();
    const context=JSON.parse(await checkedRead(join(base,'execution-permits','contexts',`${permit.readiness_evidence_sha256}.json`),fsImpl,1_048_576,true));
    contextSeat(context,permit);
    for(const file of permit.artifact_manifest) {
      const content=await checkedRead(file.path,fsImpl,2_097_152);
      if(createHash('sha256').update(content).digest('hex')!==file.sha256)fail();
      if(file.path===join(base,'seat.json')&&executionPermitFingerprint(JSON.parse(content))!==executionPermitFingerprint(settings))fail();
    }
    // Verify the executing module itself is the manifested copy, not an
    // unrelated local module invoked with someone else's staged settings.
    if(fsImpl.enforceExecutingModule!==false&&!permit.artifact_manifest.some(file=>file.path===fileURLToPath(import.meta.url)))fail();
    const model=await inspectModelImpl(settings);
    if(!exact(model,['schema_version','seat_id','harness','configured','model','reasoning_effort','max_output_tokens',
      'automatic_fallback','fallback_model','response_metadata_required'])||model.schema_version!==1||model.seat_id!==seat.seat_id||
        model.harness!==seat.harness||model.configured!==true||model.model!==MODEL.model||model.reasoning_effort!==MODEL.reasoning_effort||
        model.max_output_tokens!==MODEL.max_output_tokens||model.automatic_fallback!==false||model.fallback_model!==null||
        model.response_metadata_required!==true)fail();
    const route=await inspectModelRouteImpl(settings,{env});
    if(!exact(route,['schema_version','seat_id','model_route_verified'])||route.schema_version!==1||route.seat_id!==seat.seat_id||route.model_route_verified!==true)fail();
    if(await runtimeFingerprintReader()!==permit.runtime_instance_fingerprint)fail();
    const finished=typeof now==='function'?now():now;
    if(finished<permit.issued_at_ms||finished>=permit.expires_at_ms||finished>=permit.hard_stop_at_ms)fail();
    return {schema_version:1,verified:true,request_id:request.request_id,permit_sha256:executionPermitFingerprint(permit)};
  }catch{fail();}
}
