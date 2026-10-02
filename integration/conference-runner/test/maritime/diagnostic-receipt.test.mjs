import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {diagnosticReceiptPath,writeDiagnosticReceipt,validateDiagnosticReceipt,
  buildDiagnosticReceiptReadCommand} from '../../src/maritime/diagnostic-receipt.mjs';
import {buildRuntimeDiagnosticArtifact,stagePublicRequest} from '../../src/maritime/transport.mjs';
import {inspectModelRoute,updateOpenClawConfigText} from '../../src/maritime/install-runtime.mjs';
import {config,roster} from './fixtures.mjs';

function diagnostic(seat=roster[0]) {
  return {schema_version:1,type:'runtime-diagnostic',request_id:`receipt-fixture:${seat.seat_id}`,seat_id:seat.seat_id,
    team:seat.team,mode:'commit-input',chain_state:{chain_id:84532,game_address:config.game_address,
      confirmed_block_number:'123',confirmed_block_hash:`0x${'ab'.repeat(32)}`}};
}
function response(request) {
  return {schema_version:1,type:'runtime-diagnostic-response',request_id:request.request_id,seat_id:request.seat_id,
    team:request.team,mode:request.mode,status:'ready',checks:{stdin:true,wallet_identity:true,checkout:true,
      dependencies:true,wrapper:true,private_state:true,seat_lock:true,chain_id:true,contract_read:true}};
}
async function directory(t) {
  const root=await fs.realpath(await fs.mkdtemp(join(tmpdir(),'diagnostic-receipt-')));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;
}

test('diagnostic receipt records only public request and checked response, is exclusive and independently readable',async t=>{
  const root=await directory(t),request=diagnostic(),reply=response(request);
  const settings={seat_id:request.seat_id,state_directory:join(root,'private')};
  const receipt=await writeDiagnosticReceipt(settings,request,reply);
  const file=diagnosticReceiptPath(settings,request),contents=await fs.readFile(file,'utf8');
  assert.equal(validateDiagnosticReceipt(receipt,request,reply),receipt);
  assert.doesNotMatch(contents,/choice|salt|prompt|session|private_key|stdin_sha|input_sha/);
  await assert.rejects(writeDiagnosticReceipt(settings,request,reply),/EEXIST/);
  assert.equal(await fs.readFile(file,'utf8'),contents);
  const command=buildDiagnosticReceiptReadCommand({seat_id:request.seat_id,
    gameplay_command:['node',join(root,'player-cli.mjs'),join(root,'seat.json')]},request);
  const read=spawnSync(command[0],command.slice(1),{encoding:'utf8'});
  assert.equal(read.status,0);assert.deepEqual(JSON.parse(read.stdout),receipt);assert.equal(read.stderr,'');
  assert.deepEqual(await fs.readdir(root),['diagnostic-receipts']);
  assert.throws(()=>validateDiagnosticReceipt({...receipt,salt:'fixture'},request,reply));
  assert.throws(()=>validateDiagnosticReceipt(receipt,{...request,request_id:'different-fixture'},reply));
});

test('diagnostic receipt rejects public-directory symlinks and invalid response before creating a success record',async t=>{
  const root=await directory(t),other=join(root,'other');await fs.mkdir(other);
  const request=diagnostic(),settings={seat_id:request.seat_id,state_directory:join(root,'private')};
  await fs.symlink(other,join(root,'diagnostic-receipts'));
  await assert.rejects(writeDiagnosticReceipt(settings,request,response(request)),/RECEIPT_INVALID/);
  assert.deepEqual(await fs.readdir(other),[]);
  await assert.rejects(writeDiagnosticReceipt(settings,request,{...response(request),checks:{}}));
});

test('operator staging prepares Hermes diagnostic receipt directory for UID10000 without touching private files',async t=>{
  const root=await directory(t),seat=roster[2],settingsPath=join(root,'seat.json');
  await fs.writeFile(settingsPath,JSON.stringify({seat_id:seat.seat_id,harness:seat.harness,runtime_identity:{uid:10000,gid:10000}}));
  await fs.mkdir(join(root,'private'));await fs.writeFile(join(root,'private','preserved'),'fixture');
  const ownership=[];
  const fsImpl={...fs,chown:async(path,uid,gid)=>{ownership.push({path,uid,gid});},open:async(...args)=>{
    const handle=await fs.open(...args);handle.chown=async(uid,gid)=>{ownership.push({path:args[0],uid,gid});};return handle;
  }};
  const artifact=buildRuntimeDiagnosticArtifact(diagnostic(seat),{gameplay_command:['node',join(root,'player-cli.mjs'),settingsPath]},seat.harness);
  await stagePublicRequest(artifact,{fsImpl});
  assert.ok(ownership.some(row=>row.path===join(root,'diagnostic-receipts')&&row.uid===10000&&row.gid===10000));
  assert.ok(ownership.every(row=>!row.path.startsWith(join(root,'private'))));
  assert.equal((await fs.stat(join(root,'diagnostic-receipts'))).mode&0o777,0o700);
  assert.equal(await fs.readFile(join(root,'private','preserved'),'utf8'),'fixture');
});

test('selected runtime route must match actual config and native environment without exposing either',async()=>{
  const endpoint='https://api.maritime.sh/api/llm/v1';
  for(const harness of ['openclaw','hermes']) {
    const seat_id=harness==='openclaw'?'oc-1':'hs-1';
    const settings={harness,seat_id,persistent_root:'/volume',openclaw_config_path:'/volume/.openclaw/openclaw.json',
      hermes_config_path:'/volume/config.yaml',runtime_identity:{uid:10000,gid:10000}};
    const make=route=>harness==='openclaw'?JSON.stringify({...JSON.parse(updateOpenClawConfigText('{}')),
      models:{providers:{openai:{baseUrl:route}}}}):`model:\n  provider: "openai"\n  base_url: "${route}"\n`;
    assert.deepEqual(await inspectModelRoute(settings,{env:{OPENAI_BASE_URL:endpoint},readFileImpl:async()=>make(endpoint)}),
      {schema_version:1,seat_id,model_route_verified:true});
    for(const [text,env] of [[make('https://different.invalid'),{}],[make(endpoint),{OPENAI_BASE_URL:'https://different.invalid'}],
      [harness==='hermes'?`${make(endpoint)}  base_url: "${endpoint}"\n`:'{}',{}]]) {
      await assert.rejects(inspectModelRoute(settings,{env,readFileImpl:async()=>text}),error=>
        error.message==='READINESS_MODEL_ROUTE_UNVERIFIED'&&!error.cause);
    }
  }
});
