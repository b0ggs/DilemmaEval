import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildInstallArtifact} from '../../src/maritime/install.mjs';
import {createPlayerRuntime} from '../../src/maritime/player-runtime.mjs';
import {updateOpenClawConfigText} from '../../src/maritime/install-runtime.mjs';
import {deriveEthereumAddress} from '../../../game-bridge/src/index.js';
import {buildExecutionPermit,buildExecutionPermitStageCommand,executionPermitFingerprint,
  stageExecutionPermit,readRuntimeInstanceFingerprint} from '../../src/maritime/execution-permit.mjs';
import {RUNTIME_INSTANCE_COMMAND} from '../../src/maritime/readiness-run.mjs';
import {config as baseline,operations,poke} from './fixtures.mjs';

const model={model_endpoint:'https://chatgpt.com/backend-api/codex',model:'gpt-6.1-sol',reasoning_effort:'low',
  max_output_tokens:2048,automatic_fallback:false};
const instance='ab'.repeat(32),cold='cd'.repeat(32);
const walletKey=`0x${'1'.repeat(64)}`;

async function fixture(t,{harness='openclaw',age=1000}={}) {
  const directory=await fs.realpath(await fs.mkdtemp(join(tmpdir(),'execution-permit-fixture-')));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const seatId=harness==='openclaw'?'oc-1':'hs-1',now=Date.now();
  const config={...baseline,mode:'live',stop_time:new Date(now-1).toISOString(),roster:baseline.roster.map(seat=>
    seat.seat_id===seatId?{...seat,wallet_address:deriveEthereumAddress(walletKey)}:seat)};
  const seat=config.roster.find(row=>row.seat_id===seatId);
  const artifact=await buildInstallArtifact({config,seatId,persistentRoot:directory,operationsManifest:operations});
  for(const file of artifact.files){await fs.mkdir(dirname(file.path),{recursive:true});await fs.writeFile(file.path,file.content);}
  const settings=JSON.parse(artifact.files.find(file=>file.path===artifact.gameplay_command[2]).content);
  if(harness==='openclaw') {
    const route=JSON.parse(updateOpenClawConfigText('{}'));
    await fs.mkdir(dirname(settings.openclaw_config_path),{recursive:true});
    await fs.writeFile(settings.openclaw_config_path,JSON.stringify(route));
  }
  const evidence={schema_version:2,producer_version:2,run_id:config.run_id,chain_id:84532,
    continuity_policy:'observed-runtime-continuity-v1',
    game_address:config.game_address.toLowerCase(),config_fingerprint:executionPermitFingerprint(config),
    diagnostics_complete:true,ready_for_controlled_gameplay:true,remote_generation_attested:false,
    verified_at:new Date(now-age).toISOString(),expires_at:new Date(now-age+600_000).toISOString(),
    seats:[{seat_id:seatId,agent_id:seat.agent_id,harness,wallet_address:seat.wallet_address.toLowerCase(),
      artifact_sha256:artifact.artifact_sha256,runtime_instance_fingerprint:instance,model_profile:model,
      tool_execution_verified:true,lifecycle_ambiguous:false}]};
  const request=poke('join',seat);
  const envelope=buildExecutionPermit({config,evidence,artifact,request,expiresAtMs:now+60_000,hardStopAtMs:now+120_000,nowMs:now});
  const command=buildExecutionPermitStageCommand({artifact,permit:envelope}),spec=JSON.parse(command.at(-1));
  const ownership=[];
  // Real no-follow file operations; UID changes are simulated on non-root local
  // hosts while recording the exact requested OpenClaw/Hermes ownership.
  const stageFs={...fs,chown:async(path,uid,gid)=>ownership.push({path,uid,gid}),open:async(...args)=>{
    const handle=await fs.open(...args);handle.chown=async(uid,gid)=>ownership.push({path:args[0],uid,gid});return handle;
  }};
  const deployed=await import(pathToFileURL(join(dirname(artifact.gameplay_command[1]),'execution-permit.mjs')).href);
  const verify=(extra={})=>deployed.verifyExecutionPermit({settings,request,env:{GAMEPLAY_WALLET_PRIVATE_KEY:walletKey},
    now:()=>now+10,runtimeFingerprintReader:async()=>instance,...extra});
  return {directory,config,seat,artifact,settings,evidence,request,envelope,spec,command,ownership,stageFs,now,deployed,verify,
    stage:()=>stageExecutionPermit(spec,{fsImpl:stageFs})};
}

test('runtime fingerprint matches coordinator boot/start/namespace digest and hides malformed/read failures',async()=>{
  const boot='12345678-1234-1234-1234-123456789abc',start='123456',ns='pid:[456]';
  const stat=`1 (name with ) and spaces) S ${Array(18).fill('0').join(' ')} ${start} 0`;
  const reads=[];
  const injected={readFileImpl:async(path)=>{reads.push(path);return path.endsWith('boot_id')?`${boot}\n`:stat;},
    readlinkImpl:async(path)=>{
      reads.push(path);
      if(path==='/proc/1/ns/pid')throw Object.assign(new Error('fixture root PID1 ptrace permission denied'),{code:'EACCES'});
      assert.equal(path,'/proc/self/ns/pid');return ns;
    }};
  assert.equal(await readRuntimeInstanceFingerprint(injected),createHash('sha256').update(JSON.stringify([boot,start,ns])).digest('hex'));
  assert.deepEqual(reads,['/proc/sys/kernel/random/boot_id','/proc/1/stat','/proc/self/ns/pid']);
  // Exercise the actual coordinator command against the same simulated procfs
  // permissions; only imports are supplied by this local fixture instead.
  let output='';
  const processFixture={stdout:{write:value=>{output+=value;}}};
  const code=RUNTIME_INSTANCE_COMMAND[3].split('\n').filter(line=>!line.startsWith('import ')).join('\n');
  await new Function('readFile','readlink','createHash','process',`return (async()=>{${code}})()`)(
    injected.readFileImpl,injected.readlinkImpl,createHash,processFixture);
  assert.equal(processFixture.exitCode,undefined);
  assert.deepEqual(JSON.parse(output),{schema_version:1,
    runtime_instance_fingerprint:createHash('sha256').update(JSON.stringify([boot,start,ns])).digest('hex')});
  for(const readFileImpl of [async()=>{throw new Error('unpublished provider failure');},async()=> 'malformed']) {
    await assert.rejects(readRuntimeInstanceFingerprint({...injected,readFileImpl}),error=>error.message==='PLAYER_EXECUTION_PERMIT_INVALID'&&!error.cause);
  }
  await assert.rejects(readRuntimeInstanceFingerprint({...injected,readlinkImpl:async()=>{
    throw Object.assign(new Error('unpublished self namespace permission failure'),{code:'EACCES'});
  }}),error=>error.message==='PLAYER_EXECUTION_PERMIT_INVALID'&&!error.cause);
});

test('live artifacts require execution permits and ship guard sources; fixture artifacts remain explicit legacy',async t=>{
  const f=await fixture(t);
  assert.equal(f.settings.execution_permit_required,true);
  assert.ok(f.artifact.files.some(file=>file.path.endsWith('/execution-permit.mjs')));
  const fixtureArtifact=await buildInstallArtifact({config:baseline,seatId:'oc-1',persistentRoot:'/volume',operationsManifest:operations});
  assert.equal(JSON.parse(fixtureArtifact.files.find(file=>file.path.endsWith('/seat.json')).content).execution_permit_required,false);
  assert.doesNotMatch(JSON.stringify(f.envelope),/choice|salt|prompt|session|private_key|GAMEPLAY_WALLET_PRIVATE_KEY/);
});

test('exclusive public permit and evidence context stage once, same bytes replay safely, conflicts never overwrite',async t=>{
  const f=await fixture(t,{harness:'hermes'});
  const expected={schema_version:1,staged:true,request_id:f.request.request_id,permit_sha256:executionPermitFingerprint(f.envelope.permit)};
  assert.deepEqual(await f.stage(),expected);assert.deepEqual(await f.stage(),expected);
  assert.equal((await fs.stat(f.spec.permit_path)).mode&0o777,0o600);
  assert.equal((await fs.stat(dirname(f.spec.permit_path))).mode&0o777,0o700);
  assert.equal((await fs.stat(f.spec.context_path)).mode&0o777,0o600);
  assert.ok(f.ownership.some(row=>row.uid===10000&&row.gid===10000&&row.path===dirname(f.spec.permit_path)));
  assert.ok(f.ownership.every(row=>row.path!==f.settings.state_directory&&!row.path.startsWith(`${f.settings.state_directory}/`)));
  const before=await fs.readFile(f.spec.permit_path,'utf8');
  const changed=buildExecutionPermit({...f,expiresAtMs:f.now+59_000,hardStopAtMs:f.now+120_000,nowMs:f.now});
  const other=JSON.parse(buildExecutionPermitStageCommand({artifact:f.artifact,permit:changed}).at(-1));
  await assert.rejects(stageExecutionPermit(other,{fsImpl:f.stageFs}),/PERMIT_INVALID/);
  assert.equal(await fs.readFile(f.spec.permit_path,'utf8'),before);
});

test('same observed snapshot verifies with original evidence beyond creation TTL but fresh action expiry/hardstop',async t=>{
  const f=await fixture(t,{age:700_000});await f.stage();
  assert.deepEqual(await f.verify(),{schema_version:1,verified:true,request_id:f.request.request_id,
    permit_sha256:executionPermitFingerprint(f.envelope.permit)});
  // config.stop_time is only a stop-new-games cutoff; this action's separately
  // pinned hard stop can legitimately extend through current-game settlement.
  assert.ok(Date.parse(f.config.stop_time)<f.envelope.permit.expires_at_ms);
  await assert.rejects(f.verify({now:()=>f.envelope.permit.expires_at_ms}),/PERMIT_INVALID/);
  await assert.rejects(f.verify({now:()=>f.now-1}),/PERMIT_INVALID/);
});

test('missing permit/context, cold runtime, wrong request/evidence/wallet, source drift and modes all fail closed',async t=>{
  const f=await fixture(t);await assert.rejects(f.verify(),/PERMIT_INVALID/);await f.stage();
  for(const extra of [
    {runtimeFingerprintReader:async()=>cold},
    {request:{...f.request,round:f.request.round+1}},
    {expectedEvidenceSha256:'ef'.repeat(32)},
    {expectedArtifactSha256:'ef'.repeat(32)},
    {env:{GAMEPLAY_WALLET_PRIVATE_KEY:`0x${'2'.repeat(64)}`}},
    {env:{GAMEPLAY_WALLET_PRIVATE_KEY:walletKey,OPENAI_BASE_URL:'https://wrong-route.invalid'}},
    {inspectModelImpl:async()=>({})},
    {inspectModelRouteImpl:async()=>({schema_version:1,seat_id:f.seat.seat_id,model_route_verified:false})}
  ])await assert.rejects(f.verify(extra),error=>error.message==='PLAYER_EXECUTION_PERMIT_INVALID'&&!error.cause);
  const original=await fs.readFile(f.spec.context_path,'utf8');
  await fs.rm(f.spec.context_path);await assert.rejects(f.verify(),/PERMIT_INVALID/);
  await fs.writeFile(f.spec.context_path,original,{mode:0o600});
  const code=f.artifact.files.find(file=>file.path.endsWith('/player-cli.mjs'));
  await fs.writeFile(code.path,`${code.content}\n// source drift`);await assert.rejects(f.verify(),/PERMIT_INVALID/);
  await fs.writeFile(code.path,code.content);
  const modelOriginal=await fs.readFile(f.settings.openclaw_config_path,'utf8');
  const altered=JSON.parse(modelOriginal);altered.agents.defaults.model.primary='openai/other-model';
  await fs.writeFile(f.settings.openclaw_config_path,JSON.stringify(altered));await assert.rejects(f.verify(),/PERMIT_INVALID/);
  await fs.writeFile(f.settings.openclaw_config_path,modelOriginal);
  await fs.chmod(f.spec.permit_path,0o644);await assert.rejects(f.verify(),/PERMIT_INVALID/);
});

test('tampered public permit or context, leaked fields and invalid deadlines never authorize execution',async t=>{
  const f=await fixture(t);await f.stage();
  const original=await fs.readFile(f.spec.permit_path,'utf8');
  for(const mutate of [permit=>permit.runtime_instance_fingerprint=cold,permit=>permit.game_id='8',
    permit=>permit.readiness_evidence_sha256='de'.repeat(32),permit=>permit.prompt='unpublished fixture',
    permit=>permit.hard_stop_at_ms=permit.issued_at_ms]) {
    const permit=JSON.parse(original);mutate(permit);await fs.writeFile(f.spec.permit_path,JSON.stringify(permit));
    await assert.rejects(f.verify(),/PERMIT_INVALID/);
  }
  for(const options of [{expiresAtMs:f.now},{expiresAtMs:f.now+300_001},{expiresAtMs:f.now+1000,hardStopAtMs:f.now+500}]) {
    assert.throws(()=>buildExecutionPermit({...f,nowMs:f.now,...options}),/PERMIT_INVALID/);
  }
  assert.throws(()=>buildExecutionPermit({...f,evidence:{...f.evidence,private_key:'unpublished fixture'},nowMs:f.now,
    expiresAtMs:f.now+1000}),/PERMIT_INVALID/);
  for(const changes of [{ready_for_controlled_gameplay:false},{producer_version:1},
    {continuity_policy:'unsupported'},{remote_generation_attested:true}]) {
    assert.throws(()=>buildExecutionPermit({...f,evidence:{...f.evidence,...changes},nowMs:f.now,
      expiresAtMs:f.now+1000}),/PERMIT_INVALID/);
  }
});

test('symlinked permit or evidence context is rejected without reading the target',async t=>{
  const f=await fixture(t);await f.stage();
  const outside=join(f.directory,'unrelated-fixture');await fs.writeFile(outside,'unpublished fixture');
  await fs.rm(f.spec.permit_path);await fs.symlink(outside,f.spec.permit_path);
  await assert.rejects(f.verify(),/PERMIT_INVALID/);
  await assert.rejects(f.stage(),/ELOOP|PERMIT_INVALID/);
  assert.equal(await fs.readFile(outside,'utf8'),'unpublished fixture');
});

test('cold guest after coordinator probe stops inside seat lock with zero gameplay bridges, journals or bundles',async t=>{
  const f=await fixture(t);await f.stage();let guards=0,bridges=0;
  const runtime=createPlayerRuntime({settings:f.settings,env:{GAMEPLAY_WALLET_PRIVATE_KEY:walletKey},
    bridgeFactory:()=>{bridges++;assert.fail('cold guest must stop before bridge construction');},
    executionPermitVerifier:async args=>{guards++;assert.ok((await fs.stat(join(f.settings.state_directory,'seat.lock'))).isFile());
      return f.deployed.verifyExecutionPermit({...args,now:()=>f.now+10,runtimeFingerprintReader:async()=>cold});}});
  await assert.rejects(runtime.execute({request:f.request}),/PERMIT_INVALID/);
  assert.equal(guards,1);assert.equal(bridges,0);assert.deepEqual(await fs.readdir(f.settings.state_directory),[]);
});

test('successful guarded join repeats from the durable response without another bridge or signature',async t=>{
  const f=await fixture(t);await f.stage();let guards=0,signs=0;
  const runtime=createPlayerRuntime({settings:f.settings,env:{GAMEPLAY_WALLET_PRIVATE_KEY:walletKey},
    executionPermitVerifier:async args=>{guards++;return f.deployed.verifyExecutionPermit({...args,now:()=>f.now+10,
      runtimeFingerprintReader:async()=>instance});},bridgeFactory:()=>({player:{run:async()=>{
      signs++;return {exit_code:0,error:null,parsed:{txHash:`0x${'a'.repeat(64)}`,chainId:84532,gameId:f.request.game_id,
        wallet:f.seat.wallet_address,game:f.config.game_address}};}}})});
  const result=await runtime.execute({request:f.request});assert.equal(result.status,'submitted');
  assert.deepEqual(await runtime.execute({request:f.request}),result);
  assert.equal(signs,1);assert.equal(guards,3);
});

test('runtime is checked again before prepare_commit and before final submission',async t=>{
  for(const changeAt of [2,3]) {
    const f=await fixture(t);f.request=poke('commit',f.seat);
    const envelope=buildExecutionPermit({...f,expiresAtMs:f.now+60_000,hardStopAtMs:f.now+120_000,nowMs:f.now});
    const spec=JSON.parse(buildExecutionPermitStageCommand({artifact:f.artifact,permit:envelope}).at(-1));
    await stageExecutionPermit(spec,{fsImpl:f.stageFs});
    let checks=0,prepares=0,submits=0;
    const runtime=createPlayerRuntime({settings:f.settings,env:{GAMEPLAY_WALLET_PRIVATE_KEY:walletKey},
      executionPermitVerifier:args=>f.deployed.verifyExecutionPermit({...args,now:()=>f.now+10,
        runtimeFingerprintReader:async()=>++checks>=changeAt?cold:instance}),bridgeFactory:()=>({player:{run:async(operation,options)=>{
        if(operation!=='prepare_commit'){submits++;assert.fail('cold guest cannot submit');}
        prepares++;await fs.writeFile(options.out,JSON.stringify({schemaVersion:'prisoners-daolemma/commit-bundle-v0',chainId:84532,
          game:f.config.game_address,gameId:f.request.game_id,round:f.request.round,wallet:f.seat.wallet_address,
          choice:options.choice,salt:`0x${'b'.repeat(64)}`,commitment:`0x${'c'.repeat(64)}`}));
        return {exit_code:0,error:null};}}})});
    await assert.rejects(runtime.execute({request:f.request,choice:'share'}),/PERMIT_INVALID/);
    assert.equal(prepares,changeAt===2?0:1);assert.equal(submits,0);assert.equal(checks,changeAt);
  }
});
