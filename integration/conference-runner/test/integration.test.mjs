import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,readFile,symlink,access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fixtureConfig,createFixtureAdapters } from '../src/fixture.mjs';
import { validateConfig,prepareRuntimeDirectory,assertCoordinatorEnvironment } from '../src/config.mjs';
import { createConferenceRunner } from '../src/runner/index.mjs';
import { buildPublicState } from '../src/public-state.mjs';
import { assessChainReadiness,assessControlledChainReadiness,validateControlledRuntimeEvidence,validateRuntimeEvidence,
  buildControlledRuntimeEvidence,rosterFingerprint,configFingerprint,runtimeEvidenceFingerprint,
  TRANSPORT_FINGERPRINT,RUNTIME_EVIDENCE_MAX_AGE_MS } from '../src/readiness.mjs';
import { createOperatorAdapters } from '../src/operator.mjs';
import { playerFundingBudget } from '../src/player-funding.mjs';

function fixtureSeat(team,index) {
  const identity=team==='openclaw' ? index : 10+index;
  return {
    seat_id:`${team==='openclaw'?'oc':'hs'}-${index}`,
    team,
    harness:team,
    agent_id:`00000000-0000-0000-0000-${identity.toString(16).padStart(12,'0')}`,
    maritime_agent:`${team}-fixture-${index}`,
    wallet_address:`0x${identity.toString(16).padStart(40,'0')}`,
    cause_id:team==='openclaw' ? 1 : 2
  };
}

function fixtureRoster(openclawCount,hermesCount) {
  return [
    ...Array.from({length:openclawCount},(_,index)=>fixtureSeat('openclaw',index+1)),
    ...Array.from({length:hermesCount},(_,index)=>fixtureSeat('hermes',index+1))
  ];
}

test('launch and advance use one operator endpoint and authentication token',async()=>{
  const calls=[];
  const token='fixture-operator-token-123456';
  const adapters=createOperatorAdapters({token,fetchImpl:async(url,options)=>{
    calls.push({url:String(url),authorization:options.headers.authorization,body:JSON.parse(options.body)});
    return {ok:true,json:async()=>({status:'accepted'})};
  }});
  const create={action_id:'launch',source_block_number:'10'};
  const advance={action_id:'advance',source_block_number:'11'};
  assert.deepEqual(await adapters.launcher.create(create),{status:'accepted'});
  assert.deepEqual(await adapters.phaseExecutor.advance(advance),{status:'accepted'});
  assert.deepEqual(calls,[
    {url:'http://127.0.0.1:8791/create',authorization:`Bearer ${token}`,body:create},
    {url:'http://127.0.0.1:8791/advance',authorization:`Bearer ${token}`,body:advance}
  ]);
});

test('assembled fixture runs repeated three-seat games through discussion, restart, results and claims',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'conference-integrated-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  let time=Date.parse('2026-09-24T15:00:00Z');const now=()=>time;
  const config=validateConfig(await fixtureConfig({now:time}));
  const adapters=createFixtureAdapters({config,now});
  let runner=createConferenceRunner({config,runtimeDir:dir,...adapters,now});
  await runner.initialize();
  for(let i=0;i<30;i++){
    await runner.tick();time+=1000;
    if(i===3){await runner.close();runner=createConferenceRunner({config,runtimeDir:dir,...adapters,now});await runner.initialize();}
  }
  const internal=runner.getState();const state=buildPublicState({config,state:internal,now:time});
  assert.ok(state.counts.completed>=2,JSON.stringify(internal.health));
  assert.equal(state.mode,'fixture');assert.equal(state.roster.length,3);
  assert.equal(state.counts.cancelled,0);
  assert.ok(state.messages.openclaw.length>0);assert.ok(state.messages.hermes.length>0);
  assert.ok(state.earnings.every(p=>BigInt(p.awarded_wei)>0n));
  assert.ok(state.earnings.every(p=>BigInt(p.claimed_wei)<=BigInt(p.awarded_wei)));
  assert.match(state.latest_result.transaction_url,/^https:\/\/sepolia\.basescan\.org\/tx\/0x/);
  assert.equal(internal.health.length,0,JSON.stringify(internal.health));
  await runner.close();
});

test('public projection excludes old games, deduplicates receipts and separates awards from claims',async()=>{
  const config=await fixtureConfig();const wallet=config.roster[0].wallet_address;
  const hash=`0x${'ab'.repeat(32)}`;
  const e=(id,game_id,kind,data={})=>({id,game_id,kind,data,block_number:'10',transaction_hash:hash,log_index:0});
  const complete=e('end','2','completed',{awards:[{wallet_address:wallet,award_wei:'100'}]});
  const internal={game_ids:['2'],events:[e('old','1','completed'),complete,complete,e('claim','2','claimed',{wallet_address:wallet,amount_wei:'100'}),e('cancel','3','cancelled')],messages:{openclaw:[],hermes:[]},health:[{code:'RPC_FAILURE',error:'secret'}],private_key:'never public',updated_at:new Date().toISOString()};
  const state=buildPublicState({config,state:internal});
  assert.deepEqual(state.counts,{completed:1,cancelled:0});
  assert.equal(state.earnings[0].awarded_wei,'100');assert.equal(state.earnings[0].claimed_wei,'100');
  assert.ok(!JSON.stringify(state).includes('secret'));assert.ok(!JSON.stringify(state).includes('private_key'));
  assert.deepEqual(state.health.issues,['chain-unavailable']);
});

test('configuration pins chain and roster identity, permits a controlled shared room, and separates signers',async()=>{
  const c=await fixtureConfig();assert.equal(validateConfig(c).roster.length,3);
  for(const mutate of [x=>x.chain_id=8453,x=>x.roster[1].wallet_address=x.roster[0].wallet_address,x=>x.roster[1].agent_id=x.roster[0].agent_id,x=>x.roster[0].team='hermes',x=>x.owner_private_key='hidden']){
    const changed=structuredClone(c);mutate(changed);assert.throws(()=>validateConfig(changed));
  }
  const shared=structuredClone(c);shared.telegram.hermes.chat_id=shared.telegram.openclaw.chat_id='-123';
  assert.equal(validateConfig(shared).telegram.hermes.chat_id,'-123');
  assert.throws(()=>assertCoordinatorEnvironment({DILEMMA_LAUNCHER_PRIVATE_KEY:'any'}),/FORBIDDEN/);
  await assert.rejects(prepareRuntimeDirectory(path.resolve('.')),/OUTSIDE/);
  const example=JSON.parse(await readFile(new URL('../../../conference/config.example.json',import.meta.url),'utf8'));
  assert.throws(()=>validateConfig(example),/AGENT_ID/);
  assert.ok(validateConfig(example,{allowIncomplete:true}).roster.every(({agent_id})=>agent_id===null));
});

test('configuration accepts a unique 10 OpenClaw plus 10 Hermes roster',async()=>{
  const c=await fixtureConfig();
  c.roster=fixtureRoster(10,10);
  const validated=validateConfig(c);
  assert.equal(validated.roster.length,20);
  assert.equal(validated.roster.filter(({team})=>team==='openclaw').length,10);
  assert.equal(validated.roster.filter(({team})=>team==='hermes').length,10);
  assert.equal(validated.roster[9].seat_id,'oc-10');
  assert.equal(validated.roster[19].seat_id,'hs-10');
});

test('configuration rejects an eleventh team seat, more than 20 seats, missing teams and duplicate identities',async()=>{
  const c=await fixtureConfig();
  for(const [roster,code] of [
    [fixtureRoster(11,1),/CONFIG_SEAT_TEAM/],
    [fixtureRoster(1,11),/CONFIG_SEAT_TEAM/],
    [[...fixtureRoster(10,10),fixtureSeat('openclaw',11)],/CONFIG_ROSTER_SIZE/],
    [fixtureRoster(2,0),/CONFIG_BOTH_TEAMS_REQUIRED/],
    [fixtureRoster(1,0),/CONFIG_ROSTER_SIZE/]
  ]) {
    assert.throws(()=>validateConfig({...c,roster}),code);
  }
  for(const field of ['seat_id','wallet_address','agent_id','maritime_agent']) {
    const roster=fixtureRoster(2,1);
    roster[1][field]=roster[0][field];
    assert.throws(()=>validateConfig({...c,roster}),/CONFIG_DUPLICATE_IDENTITY/);
  }
});

test('runtime path refuses a symlink into the repository before creating descendants',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'conference-path-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const repo=new URL('../../../',import.meta.url).pathname;
  await symlink(repo,path.join(dir,'repo'));
  const child=path.join(dir,'repo','must-not-create-runtime');
  await assert.rejects(prepareRuntimeDirectory(child),/OUTSIDE/);
  await assert.rejects(access(child),{code:'ENOENT'});
});

test('live readiness rejects historical 32-seat config and unverified harness evidence',async()=>{
  const config=await fixtureConfig();
  assert.ok(assessChainReadiness(config,{chain_id:84532,config:{minPlayers:'32',maxPlayers:'32'},players:[]}).issues.includes('DEFAULT_minPlayers_MISMATCH'));
  assert.throws(()=>validateRuntimeEvidence(config,{schema_version:1,run_id:config.run_id,roster_fingerprint:rosterFingerprint(config),verified_at:new Date().toISOString(),game_code_hash:`0x${'ab'.repeat(32)}`,seats:[]}),/TOOL_EXECUTION/);
});

function diagnostic(seat,mode,index) {
  return {schema_version:1,type:'runtime-diagnostic-response',request_id:`diagnostic:${seat.seat_id}:${mode}:${index}`,
    seat_id:seat.seat_id,team:seat.team,mode,status:'ready',checks:{stdin:true,wallet_identity:true,checkout:true,
      dependencies:true,wrapper:true,private_state:true,seat_lock:true,chain_id:true,contract_read:true}};
}

function controlledEvidence(config, now=Date.parse('2026-09-25T18:00:00.000Z')) {
  const verifiedAt=now-1000;
  return {schema_version:2,run_id:config.run_id,roster_fingerprint:rosterFingerprint(config),
    config_fingerprint:configFingerprint(config),transport_fingerprint:TRANSPORT_FINGERPRINT,
    verified_at:new Date(verifiedAt).toISOString(),expires_at:new Date(verifiedAt+RUNTIME_EVIDENCE_MAX_AGE_MS).toISOString(),
    confirmed_block_number:'47290000',confirmed_block_hash:`0x${'cd'.repeat(32)}`,
    sdk:{package:'maritime-sdk',version:'0.6.0',maxRetries:0},ready_for_controlled_gameplay:true,
    seats:config.roster.map((seat,index)=>({seat_id:seat.seat_id,agent_id:seat.agent_id,harness:seat.harness,
      wallet_address:seat.wallet_address.toLowerCase(),framework_status_verified:true,direct_runtime_inspection_verified:true,
      wallet_identity_verified:true,persistent_storage_verified:true,tool_execution_verified:true,
      gameplay_command:['node',`/volume/${seat.seat_id}/player-cli.mjs`,`/volume/${seat.seat_id}/seat.json`],
      artifact_sha256:'ab'.repeat(32),activation_generation:index,final_agent_status:'sleeping',sleep_confirmed:true,
      lifecycle_ambiguous:false,model_profile:{model_endpoint:'https://api.maritime.sh/api/llm/v1',model:'gpt-5.4-mini',
        reasoning_effort:'low',max_output_tokens:2048,automatic_fallback:false},
      diagnostics:{gameplay_input:diagnostic(seat,'gameplay-input',index),commit_input:diagnostic(seat,'commit-input',index)},
      persistent_bundles_verified:false,model_profile_verified:true,spectator_access_blocked:false}))};
}

test('legacy controlled evidence is accepted only through explicit fixture compatibility',async()=>{
  const config=await fixtureConfig();const now=Date.parse('2026-09-25T18:00:00.000Z');const evidence=controlledEvidence(config,now);
  assert.throws(()=>validateControlledRuntimeEvidence(config,evidence,{now}),/PRODUCER_REQUIRED/);
  assert.equal(validateControlledRuntimeEvidence(config,evidence,{now,allowLegacyFixtures:true}),evidence);
  assert.throws(()=>validateRuntimeEvidence(config,evidence),/IDENTITY_MISMATCH/);
});

test('controlled evidence builder binds public diagnostics to the current config and transport',async()=>{
  const config=await fixtureConfig();const now=Date.parse('2026-09-25T18:00:00.000Z');
  const seed=controlledEvidence(config,now);
  const evidence=buildControlledRuntimeEvidence(config,{confirmedBlockNumber:seed.confirmed_block_number,
    confirmedBlockHash:seed.confirmed_block_hash,seats:seed.seats,now,allowLegacyFixtures:true});
  assert.equal(evidence.verified_at,new Date(now).toISOString());
  assert.equal(evidence.expires_at,new Date(now+RUNTIME_EVIDENCE_MAX_AGE_MS).toISOString());
  assert.equal(evidence.config_fingerprint,configFingerprint(config));
  assert.equal(evidence.transport_fingerprint,TRANSPORT_FINGERPRINT);
  assert.equal(validateControlledRuntimeEvidence(config,evidence,{now,allowLegacyFixtures:true}),evidence);
  const reordered=Object.fromEntries(Object.entries(evidence).reverse());
  assert.equal(runtimeEvidenceFingerprint(reordered),runtimeEvidenceFingerprint(evidence));
  assert.throws(()=>buildControlledRuntimeEvidence(config,{confirmedBlockNumber:seed.confirmed_block_number,
    confirmedBlockHash:seed.confirmed_block_hash,seats:[...seed.seats,{...seed.seats[0]}],now,allowLegacyFixtures:true}),/SEAT_IDENTITY/);
});

test('controlled rehearsal rejects incomplete proof, unpinned SDK, unsafe commands and seat identity drift',async()=>{
  const config=await fixtureConfig();const now=Date.parse('2026-09-25T18:00:00.000Z');
  for(const mutate of [
    evidence=>evidence.ready_for_controlled_gameplay=false,
    evidence=>evidence.seats[0].direct_runtime_inspection_verified=false,
    evidence=>delete evidence.seats[0].persistent_storage_verified,
    evidence=>evidence.sdk.version='latest',
    evidence=>evidence.seats[0].gameplay_command=['node','/volume/private/player-cli.mjs','/volume/seat.json'],
    evidence=>evidence.seats[0].wallet_address=config.roster[1].wallet_address,
    evidence=>evidence.seats[0].agent_id=config.roster[1].agent_id
  ]) {const evidence=controlledEvidence(config,now);mutate(evidence);assert.throws(()=>validateControlledRuntimeEvidence(config,evidence,{now,allowLegacyFixtures:true}));}
});

test('controlled rehearsal requires fresh exact-path diagnostics from one safe lifecycle generation',async()=>{
  const config=await fixtureConfig();const now=Date.parse('2026-09-25T18:00:00.000Z');
  for(const [mutate,code] of [
    [e=>e.expires_at=new Date(now).toISOString(),/EXPIRED/],
    [e=>e.verified_at=new Date(now+1).toISOString(),/EXPIRED/],
    [e=>e.transport_fingerprint='00'.repeat(32),/IDENTITY/],
    [e=>e.config_fingerprint='00'.repeat(32),/IDENTITY/],
    [e=>e.seats[0].diagnostics.commit_input.status='error',/DIAGNOSTIC/],
    [e=>e.seats[0].diagnostics.commit_input.choice='steal',/PRIVATE_FIELD/],
    [e=>e.seats[0].diagnostics.commit_input.commit_choice='steal',/PRIVATE_FIELD/],
    [e=>e.seats[0].raw_provider_response={ok:true},/PRIVATE_FIELD/],
    [e=>e.seats[0].diagnostics.commit_input.request_id=e.seats[0].diagnostics.gameplay_input.request_id,/IDENTITY_REUSED/],
    [e=>e.seats[0].sleep_confirmed=false,/LIFECYCLE/],
    [e=>e.seats[0].lifecycle_ambiguous=true,/LIFECYCLE/]
  ]) {const evidence=controlledEvidence(config,now);mutate(evidence);assert.throws(()=>validateControlledRuntimeEvidence(config,evidence,{now,allowLegacyFixtures:true}),code);}
});

test('controlled chain readiness permits only bounded longer rehearsal windows',async()=>{
  const config=await fixtureConfig();
  const report={chain_id:84532,config:{entryFeeWei:'100000000000000',creatorFeeBps:'100',causeFeeBps:'100',
    joinDurationSeconds:'60',commitDurationBlocks:'60',revealDurationBlocks:'40',minPlayers:'3',maxPlayers:'3',maxCauses:'2'},
    player_funding:playerFundingBudget('100000000000000','5000000'),
    players:config.roster.map(seat=>({seat_id:seat.seat_id,wallet_address:seat.wallet_address,admitted:true,cause_whitelisted:true,balance_wei:'15000000000000000'}))};
  assert.equal(assessControlledChainReadiness(config,report).ready,true);
  const maximum=structuredClone(report);Object.assign(maximum.config,{joinDurationSeconds:'600',commitDurationBlocks:'300',revealDurationBlocks:'180'});
  assert.equal(assessControlledChainReadiness(config,maximum).ready,true);
  assert.equal(assessChainReadiness(config,maximum).ready,false);
  for(const [key,value] of [['joinDurationSeconds','59'],['joinDurationSeconds','601'],['commitDurationBlocks','59'],['commitDurationBlocks','301'],['revealDurationBlocks','39'],['revealDurationBlocks','181']]){
    const outside=structuredClone(report);outside.config[key]=value;assert.equal(assessControlledChainReadiness(config,outside).ready,false,`${key}=${value}`);
  }
  // Live Game 9: enough for entry and an ethers 6 estimate, but insufficient
  // for the pinned ethers 5 transaction's 1.5 gwei priority-fee reservation.
  const underfunded=structuredClone(report);
  underfunded.players[0].balance_wei='243262320002148';
  for (const assess of [assessChainReadiness, assessControlledChainReadiness]) {
    const result=assess(config,underfunded);
    assert.equal(result.ready,false);
    assert.ok(result.issues.includes(`${underfunded.players[0].seat_id}:INSUFFICIENT_BALANCE`));
  }
  const missingFee=structuredClone(report);delete missingFee.player_funding;
  assert.ok(assessControlledChainReadiness(config,missingFee).issues.includes('PLAYER_FEE_BUDGET_UNAVAILABLE'));
  const coordinatorFee=structuredClone(report);
  coordinatorFee.player_funding.max_fee_per_gas_wei='11000000';
  assert.ok(assessControlledChainReadiness(config,coordinatorFee).issues.includes('PLAYER_FEE_BUDGET_UNAVAILABLE'));
});
