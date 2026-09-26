import { readFile, writeFile, mkdir, open } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { loadCoordinatorSecrets } from '/Users/wade/Documents/DilemmaEval/integration/conference-runner/src/live-secrets.mjs';
import { validateConfig } from '/Users/wade/Documents/DilemmaEval/integration/conference-runner/src/config.mjs';
import { createChainReader, makeProvider } from '/Users/wade/Documents/DilemmaEval/integration/conference-runner/src/chain/reader.mjs';
import { createOperatorAdapters } from '/Users/wade/Documents/DilemmaEval/integration/conference-runner/src/operator.mjs';
import { createMaritimeAdapter } from '/Users/wade/Documents/DilemmaEval/integration/conference-runner/src/maritime/transport.mjs';
import { safePlayerErrorCode } from '/Users/wade/Documents/DilemmaEval/integration/conference-runner/src/maritime/diagnostics.mjs';
import { createTelegramMirror } from '/Users/wade/Documents/DilemmaEval/integration/conference-runner/src/telegram/index.mjs';
import { createConferenceRunner } from '/Users/wade/Documents/DilemmaEval/integration/conference-runner/src/runner/index.mjs';
import { createSpectatorServer } from '/Users/wade/Documents/DilemmaEval/integration/conference-runner/src/server.mjs';
import { buildPublicState } from '/Users/wade/Documents/DilemmaEval/integration/conference-runner/src/public-state.mjs';
import { assessControlledChainReadiness, validateControlledRuntimeEvidence } from '/Users/wade/Documents/DilemmaEval/integration/conference-runner/src/readiness.mjs';
const root='/Users/wade/Documents/DilemmaEval';
const directory=process.env.PROOF_DIRECTORY??'/private/tmp/hermes-one-game-2026-09-24';
const evidencePath=process.env.PROOF_EVIDENCE??root+'/conference/evidence/hermes-controlled-game-2026-09-24.json';
const sourceConfigPath=process.env.PROOF_CONFIG??root+'/conference/evidence/live-proof-r8-attempt-4.config.json';
const runtimeEvidencePath=process.env.PROOF_RUNTIME_EVIDENCE??'/Users/wade/.local/state/dilemmaeval-conference/converge-rehearsal-2026-09-24-r8/maritime-launch/runtime-evidence.json';
const expectedSeats=Number(process.env.PROOF_EXPECTED_SEATS??3);
const maxAwake=Number(process.env.PROOF_MAX_AWAKE??1);
const absoluteDeadline=process.env.PROOF_DEADLINE_AT===undefined?null:Date.parse(process.env.PROOF_DEADLINE_AT);
const launchCutoff=process.env.PROOF_STOP_NEW_GAMES_AT===undefined?absoluteDeadline:Date.parse(process.env.PROOF_STOP_NEW_GAMES_AT);
if((absoluteDeadline!==null&&!Number.isFinite(absoluteDeadline))||(launchCutoff!==null&&!Number.isFinite(launchCutoff))||(absoluteDeadline!==null&&launchCutoff>absoluteDeadline))throw new Error('PROOF_DEADLINE_INVALID');
if(!Number.isInteger(expectedSeats)||expectedSeats<2||expectedSeats>20||!Number.isInteger(maxAwake)||maxAwake<1||maxAwake>expectedSeats)throw new Error('PROOF_CAPACITY_INVALID');
const configPath=directory+'/config.json';
const json=async p=>JSON.parse(await readFile(p,'utf8'));
let runner,provider,spectatorServer;let stage="configuration";
const report=process.argv[2]==='resume'?await json(evidencePath):{schema_version:1,started_at:new Date().toISOString(),maximum_fresh_games:1,launch_attempts:0,dispatches:[],proof_complete:false};
const save=()=>writeFile(evidencePath,JSON.stringify(report,null,2)+'\n');
try {
  const config=await json(sourceConfigPath);
  if(config.roster?.length!==expectedSeats)throw new Error('PROOF_ROSTER_SIZE_MISMATCH');
  provider=makeProvider(config.rpc_url);
  const chain=createChainReader({config,provider});
  if(process.argv[2]==='prepare') {
    if(launchCutoff!==null&&Date.now()>=launchCutoff)throw new Error('PROOF_WINDOW_CLOSED');
    validateControlledRuntimeEvidence(config,await json(runtimeEvidencePath));
    stage='chain-preflight';const p=await chain.preflight();
    if(p.active_game_id!=='0'||!assessControlledChainReadiness(config,p).ready)throw new Error('CHAIN_NOT_READY');
    for(const address of [config.expected_owner,...config.roster.map(s=>s.wallet_address)]) {
      if(await provider.getTransactionCount(address,'latest')!==await provider.getTransactionCount(address,'pending'))throw new Error('PENDING_NONCE');
    }
    config.start_block=p.block_number;
    config.start_time=new Date(Date.now()-1000).toISOString();
    config.stop_time=new Date(Math.min(Date.now()+600000,launchCutoff??Infinity)).toISOString();
    config.intermission_ms=0;
    config.agent_timeout_ms=300000;
    validateConfig(config);
    await mkdir(directory,{mode:0o700});
    await writeFile(configPath,JSON.stringify(config,null,2)+'\n',{flag:'wx',mode:0o600});
    await writeFile(directory+'/preflight.json',JSON.stringify(p,null,2)+'\n',{flag:'wx',mode:0o600});
    console.log(JSON.stringify({prepared:true,start_block:config.start_block,stop_new_games_at:config.stop_time}));
  } else {
    Object.assign(config,await json(configPath));
    validateConfig(config);
    stage='runtime-evidence';const runtimeEvidence=validateControlledRuntimeEvidence(config,await json(runtimeEvidencePath));
    const secrets=await loadCoordinatorSecrets('/Users/wade/.config/dilemmaeval-conference/coordinator.env');
    const agents=createMaritimeAdapter({config,apiKey:secrets.MARITIME_API_KEY,runtimeEvidence,maxAwake,maxAgents:expectedSeats,timeoutMs:config.agent_timeout_ms});
    stage='maritime-preflight';if(!(await agents.preflight()).ready)throw new Error('MARITIME_NOT_READY');
    stage='chain-preflight';const p=await chain.preflight();
    const allowedActive=process.argv[2]==='resume'&&p.active_game_id===process.env.PROOF_GAME_ID;
    if(p.active_game_id!=='0'&&!allowedActive||!assessControlledChainReadiness(config,p).ready)throw new Error('CHAIN_NOT_READY');
    if(process.argv[2]==='resume'){report.resumed_at=new Date().toISOString();report.failure=null;report.runner_stopped=false;report.proof_paused=false;}
    const operator=createOperatorAdapters({url:'http://127.0.0.1:8791',token:secrets.DILEMMA_LAUNCHER_TOKEN});
    const stopDispatch=new AbortController();
    let failure=null;
    const scoreboard=process.env.PROOF_SCOREBOARD_BINDINGS?await json(process.env.PROOF_SCOREBOARD_BINDINGS):undefined;
    const scoreboardReady=health=>!scoreboard||(health.scoreboard?.ok===true&&Object.values(health.scoreboard.pins??{}).length===2&&Object.values(health.scoreboard.pins).every(pin=>pin.status==='sent'));
    const spectator=createTelegramMirror({config,runtimeDir:directory+'/runtime',token:secrets.TELEGRAM_BOT_TOKEN,...(scoreboard?{scoreboard}:{})});
    const launcher={create:async intent=>{
      if(launchCutoff!==null&&Date.now()>=launchCutoff)throw new Error('PROOF_WINDOW_CLOSED');
      // Durable one-shot fuse is written before the sole create request.
      const fuse=await open(directory+'/launch-once.json','wx',0o600);
      try{await fuse.writeFile(JSON.stringify({intent,maximum_fresh_games:1}));await fuse.sync();}finally{await fuse.close();}
      const dir=await open(directory,'r');try{await dir.sync();}finally{await dir.close();}
      report.launch_attempts++;await save();
      const outcome=await operator.launcher.create(intent);
      report.creation=outcome;await save();
      console.log(JSON.stringify({operation:'create',...outcome}));
      return outcome;
    }};
    const guardedAgents={dispatch:async args=>{
      if(failure)throw new Error('CONTROLLED_PROOF_STOPPED');
      const row={started_at:new Date().toISOString(),request_id:args.request.request_id,seat_id:args.seat.seat_id,operation:args.request.type==='discussion'?'discussion':args.request.requested_action,game_id:args.request.game_id,round:args.request.round};
      console.log(JSON.stringify({...row,state:'dispatching'}));
      try{
        const deadlineAt=absoluteDeadline===null?args.deadline_at_ms:Math.min(args.deadline_at_ms,absoluteDeadline);
        if(Date.now()>=deadlineAt)throw Object.assign(new Error('MARITIME_DISPATCH_EXPIRED'),{code:'MARITIME_DISPATCH_EXPIRED',ambiguous:false,retryable:true});
        const response=await agents.dispatch({...args,deadline_at_ms:deadlineAt,signal:AbortSignal.any([args.signal,stopDispatch.signal,...(absoluteDeadline===null?[]:[AbortSignal.timeout(Math.max(1,absoluteDeadline-Date.now()))])])});
        Object.assign(row,{finished_at:new Date().toISOString(),status:response.status,transaction_hash:response.transaction_hash??null,error_code:response.error?safePlayerErrorCode(response.error.code):null,has_team_message:!!response.team_message});
        if(response.status==='error'&&row.operation!=='claim'){failure={...row};stopDispatch.abort();}
        report.dispatches.push(row);await save();console.log(JSON.stringify(row));
        return response;
      }catch(error){
        if(!error?.ambiguous&&(error?.code==='MARITIME_DISPATCH_EXPIRED'||error?.code==='MARITIME_ONE_AWAKE_RECONCILIATION_REQUIRED'&&error.retryable===true))throw error;
        if(!failure&&row.operation!=='claim'){failure={...row,status:'transport-error',error_code:['MARITIME_TIMEOUT','MARITIME_AGENT_RESPONSE_INVALID','MARITIME_PUBLIC_REQUEST_STAGE_FAILED','MARITIME_DISPATCH_EXPIRED','MARITIME_HTTP_500'].includes(error.code)?error.code:'MARITIME_OPERATION_FAILED',diagnostic_code:safePlayerErrorCode(error.diagnostic_code,null)};stopDispatch.abort();}
        throw error;
      }
    }};
    stage='runner-create';runner=createConferenceRunner({config,runtimeDir:directory+'/runtime',chain:createChainReader({config,provider}),agents:guardedAgents,launcher,phaseExecutor:operator.phaseExecutor,spectator});
    stage='runner-initialize';await runner.initialize();
    if (process.env.PROOF_SITE_PORT !== undefined) {
      const port=Number(process.env.PROOF_SITE_PORT);
      if (!Number.isInteger(port)||port<0||port>65535) throw new Error('PROOF_SITE_PORT_INVALID');
      spectatorServer=createSpectatorServer({getPublicState:()=>buildPublicState({config,state:runner.getState()})});
      await new Promise((resolve,reject)=>{spectatorServer.once('error',reject);spectatorServer.listen(port,'127.0.0.1',resolve);});
      console.log(JSON.stringify({spectator:'started',host:'127.0.0.1',port:spectatorServer.address().port}));
    }
    stage='runner-loop';
    const deadline=absoluteDeadline??(Date.now()+45*60000);
    let last='';
    while(Date.now()<deadline){
      const state=await runner.tick();const snapshot=state.snapshot;
      const summary={game_id:snapshot.game_id,phase:snapshot.phase,round:snapshot.round,joined:snapshot.players.length,committed:snapshot.committed_count,revealed:snapshot.revealed_count};
      if(JSON.stringify(summary)!==last){console.log(JSON.stringify(summary));last=JSON.stringify(summary);}
      report.latest=summary;report.failure=failure;await save();
      if(failure||report.creation&&report.creation.status!=='accepted')break;
      const joinedPlayers=snapshot.players.filter(player=>player.joined===true);
      const successfulJoinRequests=report.dispatches.filter(dispatch=>dispatch.game_id===snapshot.game_id&&dispatch.operation==='join'&&dispatch.status==='submitted'&&typeof dispatch.request_id==='string');
      if(process.env.PROOF_PAUSE_AFTER_JOIN==='1'&&report.launch_attempts===1&&report.creation?.status==='accepted'&&snapshot.active_game_id===snapshot.game_id&&snapshot.phase==='join'&&joinedPlayers.length===expectedSeats&&successfulJoinRequests.length===expectedSeats&&!failure&&state.events.some(event=>event.game_id===snapshot.game_id&&event.kind==='created')){
        report.restart_checkpoint={game_id:snapshot.game_id,phase:snapshot.phase,joined:joinedPlayers.length,request_ids:successfulJoinRequests.map(dispatch=>dispatch.request_id),time:new Date().toISOString()};
        report.proof_paused=true;await save();
        console.log(JSON.stringify({proof_paused:`join-${expectedSeats}`,game_id:snapshot.game_id,phase:'join',joined:expectedSeats}));
        break;
      }
      if(report.launch_attempts===1&&snapshot.phase==='terminal'&&state.events.some(e=>e.game_id===snapshot.game_id&&e.kind==='created')){
        report.result={game_id:snapshot.game_id,outcome:snapshot.outcome,events:state.events.filter(e=>e.game_id===snapshot.game_id)};
        // Flush existing canonical messages/results only; never tick another game.
        for(let i=0;i<45;i++){const health=await spectator.flush();if(health.pending===0&&health.inflight===0&&scoreboardReady(health))break;await delay(3100);}
        report.telegram=await spectator.health();
        const seats=config.roster.map(s=>s.seat_id);
        report.candidate_proof_complete=snapshot.outcome==='completed'&&snapshot.players.length===expectedSeats&&seats.every(seat=>['join','commit','reveal'].every(operation=>report.dispatches.some(d=>d.seat_id===seat&&d.operation===operation&&d.status==='submitted')))&&seats.every(seat=>report.dispatches.some(d=>d.seat_id===seat&&d.operation==='discussion'&&d.has_team_message))&&report.telegram.ok&&scoreboardReady(report.telegram);
        break;
      }
      if(!report.launch_attempts&&Date.now()>Date.parse(config.stop_time))break;
      await delay(5000);
    }
    await writeFile(directory+'/public-state.json',JSON.stringify(buildPublicState({config,state:runner.getState()}),null,2)+'\n',{mode:0o600});
    if(spectatorServer){await new Promise(resolve=>spectatorServer.close(resolve));spectatorServer=null;}
    await runner.close();runner=null;
    const final=await createChainReader({config,provider}).readSnapshot();
    report.final_chain={game_id:final.game_id,active_game_id:final.active_game_id,phase:final.phase,players:final.players.length,block_number:final.block_number};
    report.proof_complete=false; // Only the independent canonical audit can establish complete proof.
    report.awaiting_independent_audit=report.candidate_proof_complete===true&&final.active_game_id==='0'&&final.game_id===report.result?.game_id;
    report.runner_stopped=true;report.finished_at=new Date().toISOString();await save();
    console.log(JSON.stringify({proof_complete:report.proof_complete,launch_attempts:report.launch_attempts,failure:report.failure,final_chain:report.final_chain}));
  }
}catch(error){console.log(JSON.stringify({stage,error_class:['Error','TypeError','MaritimeAdapterError'].includes(error.name)?error.name:'OTHER',safe_code:['MARITIME_HTTP_500','MARITIME_HTTP_429','MARITIME_TIMEOUT','ENOTFOUND','EEXIST','ECONNRESET'].includes(error.code)?error.code:safePlayerErrorCode(error.code),error_code:['CHAIN_NOT_READY','PATCH_NOT_VERIFIED','MARITIME_NOT_READY','PENDING_NONCE'].includes(error.message)?error.message:'CONTROLLED_OPERATION_FAILED'}));process.exitCode=1;}
finally{if(spectatorServer)await new Promise(resolve=>spectatorServer.close(resolve));await runner?.close();provider?.destroy();}
