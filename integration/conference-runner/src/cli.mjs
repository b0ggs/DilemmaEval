#!/usr/bin/env node
import { readFile,writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { loadConfig,prepareRuntimeDirectory,assertCoordinatorEnvironment,validateConfig } from './config.mjs';
import { createChainReader } from './chain/index.mjs';
import { createOperatorAdapters } from './operator.mjs';
import { createMaritimeAdapter } from './maritime/index.mjs';
import { createTelegramMirror } from './telegram/index.mjs';
import { createConferenceRunner } from './runner/index.mjs';
import { buildPublicState } from './public-state.mjs';
import { createSpectatorServer } from './server.mjs';
import { fixtureConfig,createFixtureAdapters } from './fixture.mjs';
import { assessChainReadiness,assessControlledChainReadiness,validateControlledRuntimeEvidence,validateRuntimeEvidence } from './readiness.mjs';

function options(argv){const o={};for(let i=0;i<argv.length;i+=2){if(!/^--[a-z-]+$/.test(argv[i])||argv[i+1]===undefined)throw new Error('INVALID_ARGUMENTS');o[argv[i].slice(2)]=argv[i+1];}return o;}
const secretNames=new Set(['MARITIME_API_KEY','TELEGRAM_BOT_TOKEN','DILEMMA_LAUNCHER_TOKEN']);
async function secretEnvironment(filename){const result=Object.fromEntries([...secretNames].map(k=>[k,process.env[k]]));if(filename){for(const line of (await readFile(filename,'utf8')).split(/\r?\n/)){const m=line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);if(m&&secretNames.has(m[1]))result[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');}}return result;}

async function main(){
  const [command,...rest]=process.argv.slice(2);
  if(!['run','rehearse','fixture','preflight'].includes(command)){console.log('Usage: node src/cli.mjs preflight|run --config CONFIG [--secrets-env PRIVATE_ENV] [--output PUBLIC_JSON]\n       node src/cli.mjs run --config CONFIG --runtime-dir PRIVATE_DIR --readiness VERIFIED_JSON\n       node src/cli.mjs rehearse --config CONFIG --runtime-dir PRIVATE_DIR --readiness VERIFIED_JSON --accept-initial-readiness-gaps true\n       node src/cli.mjs fixture --runtime-dir TEMP_DIR [--port 8787]');return;}
  const args=options(rest);assertCoordinatorEnvironment();
  // Historical launch routes lack the current durable readiness/fuse contract.
  // Refuse before credentials, RPC, runtime creation, or any external work.
  if(['run','rehearse'].includes(command))throw new Error('PROOF_VERSIONED_CLI_REQUIRED');
  if(command==='rehearse'&&args['accept-initial-readiness-gaps']!=='true')throw new Error('CONTROLLED_REHEARSAL_ACCEPTANCE_REQUIRED');
  const config=command==='fixture'?validateConfig(await fixtureConfig({runId:args['run-id']??'local-fixture'})):await loadConfig(args.config,{allowIncomplete:command==='preflight'});
  const secrets=command==='fixture'?{}:await secretEnvironment(args['secrets-env']);
  if(command==='preflight'){
    const report={schema_version:1,mode:'read-only-preflight',observed_at:new Date().toISOString(),chain:null,chain_readiness:null,maritime:null};
    try{report.chain=await createChainReader({config}).preflight();report.chain_readiness=assessChainReadiness(config,report.chain);}catch{report.chain={error:'CHAIN_PREFLIGHT_FAILED'};}
    if(secrets.MARITIME_API_KEY){
      try{
        // Inventory can be checked before the third seat has an assigned agent ID.
        const {maritimeRequest}=await import('./maritime/transport.mjs');
        const {reconcileRoster}=await import('./maritime/roster.mjs');
        const inventory=await maritimeRequest({apiKey:secrets.MARITIME_API_KEY,path:'/api/agents',timeoutMs:15000});
        report.maritime=reconcileRoster({roster:config.roster,agents:inventory,maxAgents:20});
      }catch(e){report.maritime={error:/^MARITIME_HTTP_\d+$/.test(e.code??'')?e.code:'MARITIME_PREFLIGHT_FAILED'};}
    }else report.maritime={error:'MARITIME_CREDENTIAL_MISSING'};
    if(args.output)await writeFile(args.output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify(report,null,2));process.exit(report.chain_readiness?.ready&&report.maritime?.ready?0:2);
  }
  if(['run','rehearse'].includes(command)&&config.mode!=='live')throw new Error(`${command==='run'?'RUN':'REHEARSAL'}_REQUIRES_LIVE_CONFIG`);
  const runtimeDir=await prepareRuntimeDirectory(args['runtime-dir']);
  let adapters;
  if(command==='fixture')adapters=createFixtureAdapters({config});
  else {
    const evidence=(command==='rehearse'?validateControlledRuntimeEvidence:validateRuntimeEvidence)(config,JSON.parse(await readFile(args.readiness,'utf8')));
    for(const name of ['MARITIME_API_KEY','DILEMMA_LAUNCHER_TOKEN'])if(!secrets[name])throw new Error(`${name}_MISSING`);
    const chain=createChainReader({config});const preflight=await chain.preflight();
    if(!(command==='rehearse'?assessControlledChainReadiness:assessChainReadiness)(config,preflight).ready)throw new Error('CHAIN_NOT_READY');
    if(command==='run'&&evidence.game_code_hash.toLowerCase()!==preflight.code_hash.toLowerCase())throw new Error('GAME_CODE_CHANGED');
    const agents=createMaritimeAdapter({config,apiKey:secrets.MARITIME_API_KEY,runtimeEvidence:evidence,timeoutMs:config.agent_timeout_ms??45000,maxAwake:5,maxAgents:20});
    if(!(await agents.preflight()).ready)throw new Error('MARITIME_ROSTER_NOT_READY');
    adapters={chain,agents,...createOperatorAdapters({url:process.env.DILEMMA_LAUNCHER_URL,token:secrets.DILEMMA_LAUNCHER_TOKEN}),spectator:createTelegramMirror({config,runtimeDir,token:secrets.TELEGRAM_BOT_TOKEN})};
  }
  const runner=createConferenceRunner({config,runtimeDir,...adapters});
  await runner.initialize();
  const server=createSpectatorServer({getPublicState:()=>buildPublicState({config,state:runner.getState()})});
  const port=Number(args.port??8787);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('INVALID_PORT');
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,args.host??'127.0.0.1',resolve);});
  console.log(`${command==='fixture'?'FIXTURE — synthetic local data':command==='rehearse'?'CONTROLLED LIVE REHEARSAL':'LIVE'} spectator service: http://${args.host??'127.0.0.1'}:${port}`);
  let stopping=false;process.once('SIGINT',()=>{stopping=true;});process.once('SIGTERM',()=>{stopping=true;});
  while(!stopping){try{await runner.tick();}catch{console.error('TICK_FAILED: persisted state retained; retrying chain read.');}if(!stopping)await delay(config.poll_interval_ms);}
  await new Promise(resolve=>server.close(resolve));await runner.close();process.exit(0);
}
main().catch(error=>{const code=error?.message;console.error(typeof code==='string'&&/^[A-Z][A-Z0-9_:.-]{0,100}$/.test(code)?code:'CONFERENCE_COMMAND_FAILED: inspect configuration and private operator state.');process.exit(1);});
