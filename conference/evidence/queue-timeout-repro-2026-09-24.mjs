// Regression proof: real runner/adapter, synthetic fetch and chain, no live calls.
import { mkdtemp, rm } from 'node:fs/promises';
import { fixtureConfig,createFixtureAdapters } from '../../integration/conference-runner/src/fixture.mjs';
import { createConferenceRunner } from '../../integration/conference-runner/src/runner/index.mjs';
import { createMaritimeAdapter } from '../../integration/conference-runner/src/maritime/transport.mjs';
const directory=await mkdtemp('/private/tmp/dilemma-queue-audit-');
const time=Date.now(),now=()=>time;
const config=await fixtureConfig({now:time,runId:'local-queue-audit'});
config.agent_timeout_ms=50;
const fixture=createFixtureAdapters({config,now});
const started=new Map(),calls=[],pending=[];
const runtimeEvidence={schema_version:1,run_id:config.run_id,seats:config.roster.map(s=>({seat_id:s.seat_id,agent_id:s.agent_id,gameplay_command:['node',`/fixture/${s.seat_id}/player-cli.mjs`,`/fixture/${s.seat_id}/seat.json`]}))};
const adapter=createMaritimeAdapter({config,apiKey:'fixture-only',runtimeEvidence,oneAwake:true,wakeDelayMs:60,timeoutMs:50,fetchImpl:async(url,options)=>{
 let body={};
 if(url.endsWith('/exec'))body={exitCode:0,stdout:JSON.stringify({schema_version:1,seat_id:'hs-1',configured:true,variable:'GAMEPLAY_WALLET_PRIVATE_KEY',config_owner_configured:true,private_state_owner_configured:true,runtime_identity:{uid:10000,gid:10000}})};
 if(url.endsWith('/chat')){
  const request=JSON.parse(JSON.parse(options.body).message.split('REQUEST_JSON\n')[1]);
  calls.push({seat_id:request.seat_id,elapsed_since_dispatch_ms:Date.now()-started.get(request.seat_id),outer_timeout_ms:50});
  body={response:JSON.stringify({schema_version:1,request_id:request.request_id,game_id:request.game_id,round:request.round,phase:request.phase,seat_id:request.seat_id,status:'observed'})};
 }
 return new Response(JSON.stringify(body),{status:200});
}});
const agents={dispatch(args){started.set(args.seat.seat_id,Date.now());const p=adapter.dispatch(args);pending.push(p);return p;}};
const runner=createConferenceRunner({config,runtimeDir:directory,...fixture,agents,now});
try{
 await runner.initialize();await runner.tick();await runner.tick();
 await Promise.allSettled(pending);
 const report={mode:'local-fixture-only-no-network',actual_runner_and_maritime_adapter:true,agent_timeout_ms:50,wake_delay_ms:60,calls,expired_dispatches_reached_chat:calls.filter(x=>x.elapsed_since_dispatch_ms>x.outer_timeout_ms).length,health:runner.getState().health};
 const text=JSON.stringify(report,null,2)+'\n';console.log(text);
 const safelyExpired=report.health.filter(issue=>issue.code==='AGENT_DISPATCH_EXPIRED').length;
 if(report.expired_dispatches_reached_chat!==0||calls.length!==0||safelyExpired!==config.roster.length)process.exitCode=2;
}finally{await runner.close();await rm(directory,{recursive:true,force:true});}
