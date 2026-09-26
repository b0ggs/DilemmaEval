import{readFile,writeFile}from'node:fs/promises';import{setTimeout as delay}from'node:timers/promises';
import{createOrchestratorCore}from'/Users/wade/Documents/DilemmaEval/integration/orchestrator-core/src/index.js';
import{createDurableStore}from'/Users/wade/Documents/DilemmaEval/integration/conference-runner/src/runner/store.mjs';
import{loadCoordinatorSecrets}from'/Users/wade/Documents/DilemmaEval/integration/conference-runner/src/live-secrets.mjs';
import{createChainReader,makeProvider}from'/Users/wade/Documents/DilemmaEval/integration/conference-runner/src/chain/reader.mjs';
import{createOperatorAdapters}from'/Users/wade/Documents/DilemmaEval/integration/conference-runner/src/operator.mjs';
import{createTelegramMirror}from'/Users/wade/Documents/DilemmaEval/integration/conference-runner/src/telegram/index.mjs';
const dir=process.env.PROOF_DIRECTORY,evidence=process.env.PROOF_EVIDENCE,id=process.env.PROOF_GAME_ID;
const config=JSON.parse(await readFile(dir+'/config.json','utf8'));const provider=makeProvider(config.rpc_url),chain=createChainReader({config,provider});
try{
 const secrets=await loadCoordinatorSecrets('/Users/wade/.config/dilemmaeval-conference/coordinator.env');
 const operator=createOperatorAdapters({url:'http://127.0.0.1:8791',token:secrets.DILEMMA_LAUNCHER_TOKEN});
 const read=async()=>{const s=await chain.readSnapshot();if(s.game_id!==id||s.phase!=='join'||s.players.length>=Number(s.config.minPlayers))throw new Error('CANCEL_SCOPE_CHANGED');return Object.fromEntries(['schema_version','game_id','round','phase','block_number','block_hash','alive_count','committed_count','revealed_count','clock'].map(k=>[k,s[k]]));};
 const core=createOrchestratorCore({store:createDurableStore({directory:dir+'/runtime/coordinator'}),readChainSnapshot:read,requestAdvance:operator.phaseExecutor.advance});
 const advance=await core.advanceIfEligible();console.log(JSON.stringify({advance_status:advance.status}));
 let s;for(let i=0;i<12;i++){s=await chain.readSnapshot();if(s.phase==='terminal')break;await delay(5000)}
 const events=(await chain.readEvents({fromBlock:config.start_block})).filter(e=>e.game_id===id);
 const cancellation=events.find(e=>e.kind==='cancelled');
 const scoreboard=process.env.PROOF_SCOREBOARD_BINDINGS?JSON.parse(await readFile(process.env.PROOF_SCOREBOARD_BINDINGS,'utf8')):undefined;const spectator=createTelegramMirror({config,runtimeDir:dir+'/runtime',token:secrets.TELEGRAM_BOT_TOKEN,...(scoreboard?{scoreboard}:{})});await spectator.publish({events,messages:[],snapshot:s});
 for(let i=0;i<8;i++){const h=await spectator.flush();if(h.pending===0)break;await delay(3100)}
 const report=JSON.parse(await readFile(evidence,'utf8'));report.cancellation={confirmed:!!cancellation,transaction_hash:cancellation?.transaction_hash??null};report.final_chain={game_id:s.game_id,active_game_id:s.active_game_id,phase:s.phase,players:s.players.length,block_number:s.block_number};report.telegram=await spectator.health();await writeFile(evidence,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({cancellation:report.cancellation,final_chain:report.final_chain,telegram:report.telegram}));
}catch{console.log('{"error_code":"CANCELLATION_FAILED"}');process.exitCode=1}finally{provider.destroy()}
