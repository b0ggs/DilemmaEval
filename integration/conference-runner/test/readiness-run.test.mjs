import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { buildInstallArtifact } from '../src/maritime/install.mjs';
import { createReadinessRun, validateReadinessRunState, verifyReadinessCurrent, READINESS_FILES,
  RUNTIME_INSTANCE_COMMAND } from '../src/maritime/readiness-run.mjs';
import { validateRuntimeDiagnosticInput } from '../src/maritime/protocol.mjs';
import { main as playerCli } from '../src/maritime/player-cli.mjs';
import { writeDiagnosticReceipt, diagnosticReceiptPath } from '../src/maritime/diagnostic-receipt.mjs';
import { validateControlledRuntimeEvidence, runtimeEvidenceFingerprint } from '../src/readiness.mjs';
import { config as baseline, operations, jsonResponse } from './maritime/fixtures.mjs';

// Explicit ten-seat fixtures: the fake native tool consumes the staged JSON
// through the real player CLI's stdin parser. No network or signing bridge.
const roster = ['openclaw','hermes'].flatMap((team, t) => Array.from({ length: 5 }, (_, i) => ({
  seat_id: `${t ? 'hs' : 'oc'}-${i + 1}`, team, harness: team,
  agent_id: `${team}-fixture-${i + 1}`, maritime_agent: `${team}-fixture-${i + 1}`,
  wallet_address: `0x${String(t * 5 + i + 1).padStart(40, '0')}`, cause_id: t + 1
})));
const config = { ...baseline, roster };
const defaults = { entryFeeWei:'100000000000000', creatorFeeBps:'100', causeFeeBps:'100',
  joinDurationSeconds:'300', commitDurationBlocks:'300', revealDurationBlocks:'180', minPlayers:'10', maxPlayers:'10', maxCauses:'2' };
const artifacts = await Promise.all(roster.map(seat => buildInstallArtifact({ config, seatId: seat.seat_id,
  persistentRoot: `/volume/${seat.seat_id}`, operationsManifest: operations })));
const hash = `0x${'ab'.repeat(32)}`;
const chainReport = () => ({ chain_id:84532, game_address:config.game_address, active_game_id:'0',
  block_number:'12345', block_hash:hash, code_hash:`0x${'bc'.repeat(32)}`, config:{ ...defaults } });

async function fixture(t, options = {}) {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'readiness-fixture-')));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const runtimeDir = join(parent, 'diagnostic-run');
  const agents = roster.map(seat => ({ id:seat.agent_id, name:seat.maritime_agent, externalId:seat.maritime_agent,
    framework:seat.harness, status:'sleeping' }));
  agents.push(...Array.from({ length: options.unrelated ?? 0 }, (_, i) => ({ id:`unrelated-${i}`, name:`unrelated-${i}`, framework:'openclaw', status:'active' })));
  const calls = [], cliInputs = [], stages = new Map(), generationChecks = new Map(), receipts = new Map();
  let maxAwake = agents.filter(agent => agent.status === 'active').length;
  const fetchImpl = async (url, request) => {
    const path = new URL(url).pathname;
    const seat = roster.find(row => row.agent_id === path.split('/')[3]);
    const agent = agents.find(row => row.id === seat?.agent_id);
    const artifact = artifacts.find(row => row.seat_id === seat?.seat_id);
    const body = request.body ? JSON.parse(request.body) : undefined;
    calls.push({ path, method:request.method, ...(seat ? {seat:seat.seat_id} : {}) });
    if (options.onCall) {
      const override = await options.onCall({ path, request, seat, agent, body, calls, agents, runtimeDir });
      if (override !== undefined) return override;
    }
    if (path === '/api/agents') return jsonResponse(agents);
    if (request.method === 'GET' && path.endsWith(`/agents/${seat.agent_id}`)) return jsonResponse(agent);
    if (path.endsWith('/reload-env')) {
      // Persisted intent must precede the actual external operation.
      const journal = JSON.parse(await readFile(join(runtimeDir, READINESS_FILES.journal),'utf8'));
      assert.equal(journal.operations.at(-1).kind, 'activation-intent');
      assert.equal(journal.operations.at(-1).status, 'intent');
      agent.status = 'active'; maxAwake = Math.max(maxAwake, agents.filter(row => row.status === 'active').length);
      return jsonResponse(agent);
    }
    if (path.endsWith('/sleep')) { agent.status = 'sleeping'; return jsonResponse(agent); }
    if (path.endsWith('/files/list')) return jsonResponse({ root:artifact.persistent_root, files:[] });
    if (path.endsWith('/exec')) {
      const command = body.command;
      if (command[0] === 'sha256sum') return jsonResponse({ exitCode:0,
        stdout:artifact.files.map(file => `${file.sha256}  ${file.path}`).join('\n') + '\n', stderr:'' });
      if (command.at(-1) === '--inspect') return jsonResponse({ exitCode:0, stderr:'', stdout:JSON.stringify({
        schema_version:1, seat_id:seat.seat_id, wallet_address:seat.wallet_address, chain_id:84532,
        persistent_storage_writable:true, gameplay_execution_proven:false }) });
      if (command.includes('--configure-hermes-config')) return jsonResponse({exitCode:0,stderr:'',stdout:JSON.stringify({
        schema_version:1,seat_id:seat.seat_id,configured:true,variable:'GAMEPLAY_WALLET_PRIVATE_KEY',
        config_owner_configured:true,private_state_owner_configured:true,runtime_identity:{uid:10000,gid:10000}})});
      if(command.includes('--check-model-route'))return jsonResponse({exitCode:0,stderr:'',stdout:JSON.stringify({
        schema_version:1,seat_id:seat.seat_id,model_route_verified:true})});
      if (command.includes('--check-model')||command.includes('--configure-model')) return jsonResponse({ exitCode:0, stderr:'', stdout:JSON.stringify({
        schema_version:1, seat_id:seat.seat_id, harness:seat.harness, configured:true, model:'gpt-5.4-mini',
        reasoning_effort:'low', max_output_tokens:2048, automatic_fallback:false, fallback_model:null,
        response_metadata_required:true }) });
      if (JSON.stringify(command) === JSON.stringify(RUNTIME_INSTANCE_COMMAND)) {
        generationChecks.set(seat.seat_id, (generationChecks.get(seat.seat_id) ?? 0) + 1);
        return jsonResponse({ exitCode:0, stderr:'', stdout:JSON.stringify({ schema_version:1, runtime_instance_fingerprint:'cd'.repeat(32) }) });
      }
      if(command.at(-1).includes('/diagnostic-receipts/')) {
        const local=receipts.get(command.at(-1));
        return jsonResponse(local?{exitCode:0,stderr:'',stdout:await readFile(local,'utf8')}:{exitCode:1,stderr:'',stdout:''});
      }
      const spec = JSON.parse(command.at(-1));
      const envelope = JSON.parse(spec.content);
      assert.equal(envelope.request.type, 'runtime-diagnostic');
      stages.set(spec.request_id, { ...spec, envelope });
      return jsonResponse({ exitCode:0, stdout:JSON.stringify({ready:true,sha256:spec.sha256}), stderr:'' });
    }
    if (path.endsWith('/chat')) {
      const diagnostic = JSON.parse(body.message.split('REQUEST_JSON\n')[1]);
      const staged = stages.get(diagnostic.request_id);
      assert.ok(staged);
      assert.ok(body.message.includes(staged.path));
      assert.ok(body.message.includes("'--diagnose'"));
      assert.ok(body.message.includes(diagnostic.mode === 'commit-input' ? ' | ' : ' < '));
      const input = structuredClone(staged.envelope);
      if (diagnostic.mode === 'commit-input') input.choice = 'share'; // The fake player, never the coordinator.
      const result = await playerCli([...artifact.gameplay_command.slice(2),'--diagnose'], {}, {
        readFileImpl:async path => artifact.files.find(file => file.path === path).content,
        stdin:Readable.from([JSON.stringify(input)]), createPlayerRuntimeImpl:() => ({
          execute:() => assert.fail('A diagnostic must never call execute/sign/submit.'),
          diagnose:async value => {
            validateRuntimeDiagnosticInput(value);
            cliInputs.push({ seat_id:value.request.seat_id, mode:value.request.mode });
            const response={ schema_version:1, type:'runtime-diagnostic-response', request_id:value.request.request_id,
              seat_id:value.request.seat_id, team:value.request.team, mode:value.request.mode, status:'ready',
              checks:{ stdin:true,wallet_identity:true,checkout:true,dependencies:true,wrapper:true,
                private_state:true,seat_lock:true,chain_id:true,contract_read:true } };
            if(!options.omitReceipt) {
              const settings={seat_id:seat.seat_id,state_directory:join(parent,'private')};
              await writeDiagnosticReceipt(settings,value.request,response);
              const remoteSettings={seat_id:seat.seat_id,state_directory:`${artifact.persistent_root}/dilemma-conference/${seat.seat_id}/private`};
              receipts.set(diagnosticReceiptPath(remoteSettings,value.request),diagnosticReceiptPath(settings,value.request));
            }
            return response;
          }
        })
      });
      if (options.chatResult) return jsonResponse(options.chatResult(result));
      return jsonResponse({ response:JSON.stringify(result) });
    }
    assert.fail('Unexpected external operation.');
  };
  const chain = { preflight:async () => chainReport(), readSnapshot:async () => ({
    chain_id:84532,game_address:config.game_address,active_game_id:'0',phase:'idle' }), readBlockHash:async () => hash,
    ...options.chain };
  const duration = options.duration ?? 60_000;
  const runOptions = { config,runtimeDir,artifacts,apiKey:'fixture-credential',fetchImpl,chain,
    deadlineAtMs:Date.now()+duration,cleanupDeadlineAtMs:Date.now()+duration+10_000,
    now:options.now??Date.now };
  return { runner:createReadinessRun(runOptions),runOptions,runtimeDir,calls,cliInputs,agents,generationChecks,
    maxAwake:() => maxAwake, chain };
}

test('readiness plan and absent status use no credentials, network, or filesystem mutations', async t => {
  const f = await fixture(t);
  const runner = createReadinessRun({ config,runtimeDir:f.runtimeDir,artifacts });
  assert.equal(runner.plan().read_only, true);
  assert.equal(runner.plan().requested_seats, 10);
  assert.equal((await runner.status()).status, 'absent');
  assert.equal(f.calls.length, 0);
  await assert.rejects(readFile(join(f.runtimeDir, READINESS_FILES.journal)), /ENOENT/);
});

test('all ten exact CLI paths run both diagnostics in one persisted activation with four unrelated awake agents', async t => {
  for (let repeat = 0; repeat < 2; repeat++) {
    const f = await fixture(t, { unrelated:4 });
    const result = await f.runner.run();
    assert.equal(f.maxAwake(), 5);
    assert.equal(f.cliInputs.length, 20);
    assert.equal(f.calls.filter(row => row.path.endsWith('/reload-env')).length, 10);
    assert.equal(f.calls.filter(row => row.path.endsWith('/sleep')).length, 10);
    assert.equal(f.calls.some(row => /create|restart|transactions|telegram/.test(row.path)), false);
    assert.ok(f.agents.slice(0,10).every(row => row.status === 'sleeping'));
    assert.ok(f.agents.slice(10).every(row => row.status === 'active'));
    assert.ok([...f.generationChecks.values()].every(count => count === 3));
    assert.equal(result.evidence.diagnostics_complete, true);
    assert.equal(result.evidence.remote_generation_attested, false);
    assert.equal(result.evidence.ready_for_controlled_gameplay, false);
    assert.throws(() => validateControlledRuntimeEvidence(config,result.evidence), /CONTROLLED_RUNTIME_NOT_READY/);
    assert.equal((await validateReadinessRunState({ config,evidence:result.evidence,runtimeDir:f.runtimeDir })).ready,true);
    assert.equal(result.evidenceDigest,runtimeEvidenceFingerprint(result.evidence));
    assert.equal((await f.runner.status()).status,'complete');
    const text = await readFile(result.evidencePath,'utf8');
    assert.doesNotMatch(text, /fixture-credential|YOUR_CHOICE|rawreply|private_key|provider_error|session|salt|prompt/i);
    assert.deepEqual((await readdir(f.runtimeDir)).sort(),Object.values(READINESS_FILES).sort());
    await assert.rejects(createReadinessRun(f.runOptions).run(),/DIRECTORY_ALREADY_EXISTS/);
    await assert.rejects(verifyReadinessCurrent({ ...f.runOptions,evidence:result.evidence }), /REMOTE_GENERATION_UNATTESTED/);
  }
});

test('full unrelated capacity refuses every wake and publishes no evidence', async t => {
  const f = await fixture(t,{unrelated:5});
  await assert.rejects(f.runner.run(),/READINESS_RUN_FAILED/);
  assert.equal(f.calls.some(row => row.path.endsWith('/reload-env')),false);
  assert.equal((await f.runner.status()).all_seats_sleeping,true);
  await assert.rejects(readFile(join(f.runtimeDir,READINESS_FILES.evidence)),/ENOENT/);
});

test('missing roster seat, stale artifact, and initial active lifecycle fail closed before any wake', async t => {
  for (const kind of ['missing','active','artifact']) {
    const f = await fixture(t,{onCall:({path,agents}) => {
      if (path === '/api/agents' && kind === 'missing') return jsonResponse(agents.slice(1));
      if (path === '/api/agents' && kind === 'active') return jsonResponse(agents.map((row,i) => i ? row : {...row,status:'active'}));
    }});
    if (kind === 'artifact') {
      const changed = structuredClone(artifacts); changed[0].files[0].content += 'stale';
      assert.throws(()=>createReadinessRun({...f.runOptions,artifacts:changed}),/ARTIFACTS_INVALID/);
    } else await assert.rejects(f.runner.run(),/READINESS_RUN_FAILED/);
    assert.equal(f.calls.some(row => row.path.endsWith('/reload-env')),false);
  }
});

test('provider errors and any private or extra diagnostic field reject even otherwise-valid replies', async t => {
  for (const change of [result=>({response:JSON.stringify(result),error:'provider detail with secret text'}),
    result=>({response:JSON.stringify({...result,salt:'sensitive'})}),
    result=>({response:JSON.stringify(result),private_key:'sensitive'}),
    result=>({response:JSON.stringify({...result,mode:'gameplay-input'})})]) {
    const f=await fixture(t,{chatResult:change});
    await assert.rejects(f.runner.run(),/READINESS_RUN_FAILED/);
    assert.equal(f.calls.filter(row=>row.path.endsWith('/sleep')).length,1);
    const saved=await readFile(join(f.runtimeDir,READINESS_FILES.journal),'utf8');
    assert.doesNotMatch(saved,/sensitive|provider detail|private_key|salt|prompt|session/);
    await assert.rejects(readFile(join(f.runtimeDir,READINESS_FILES.evidence)),/ENOENT/);
  }
});

test('mixed runtime instance, changed model and deployed artifact corruption invalidate the whole run',async t=>{
  for(const kind of ['instance','model','artifact']) {
    let observations=0;
    const f=await fixture(t,{onCall:({path,body,seat})=>{
      if(!path.endsWith('/exec'))return;
      if(kind==='instance'&&JSON.stringify(body.command)===JSON.stringify(RUNTIME_INSTANCE_COMMAND)&&++observations===2)
        return jsonResponse({exitCode:0,stdout:JSON.stringify({schema_version:1,runtime_instance_fingerprint:'ef'.repeat(32)}),stderr:''});
      if(kind==='model'&&body.command.includes('--check-model'))return jsonResponse({exitCode:0,stdout:'{}',stderr:''});
      if(kind==='artifact'&&body.command[0]==='sha256sum')return jsonResponse({exitCode:0,stdout:'incorrect public source digest',stderr:''});
    }});
    await assert.rejects(f.runner.run(),/READINESS_RUN_FAILED/);
    assert.equal(f.calls.filter(row=>row.path.endsWith('/reload-env')).length,1);
    assert.equal(f.calls.filter(row=>row.path.endsWith('/sleep')).length,1);
  }
});

test('unknown wake, unknown sleep and deadlines never replay; failure cleanup stays bounded',async t=>{
  for(const kind of ['wake','sleep','timeout']) {
    let clockOffset=0,targetReached=false;
    const f=await fixture(t,{now:()=>Date.now()+clockOffset,onCall:({path,agent})=>{
      if(kind==='wake'&&path.endsWith('/reload-env')) {agent.status='active';throw new Error('provider sensitive detail');}
      if(kind==='sleep'&&path.endsWith('/sleep'))throw new Error('provider sensitive detail');
      if(kind==='timeout'&&path.endsWith('/chat')) {
        targetReached=true;clockOffset=60_001;return jsonResponse({response:null});
      }
    }});
    await assert.rejects(f.runner.run(),/READINESS_RUN_FAILED/);
    if(kind==='timeout')assert.equal(targetReached,true,'deadline occurs after remote chat starts, never during setup');
    assert.ok(f.calls.filter(row=>row.path.endsWith('/reload-env')).length<=1);
    assert.ok(f.calls.filter(row=>row.path.endsWith('/sleep')).length<=1);
    await assert.rejects(createReadinessRun(f.runOptions).run(),/DIRECTORY_ALREADY_EXISTS|DEADLINE_INVALID/);
    assert.doesNotMatch(await readFile(join(f.runtimeDir,READINESS_FILES.journal),'utf8'),/provider sensitive detail/);
    await assert.rejects(readFile(join(f.runtimeDir,READINESS_FILES.evidence)),/ENOENT/);
  }
});

test('state binding detects changed generation, stale results, evidence digest edits and chain drift',async t=>{
  const f=await fixture(t);const result=await f.runner.run();
  await assert.rejects(validateReadinessRunState({config,evidence:result.evidence,runtimeDir:f.runtimeDir,
    now:()=>Date.parse(result.evidence.expires_at)}),/STATE_INVALID/);
  const changed=structuredClone(result.evidence);changed.seats[0].diagnostic_generations.commit_input++;
  assert.throws(()=>validateControlledRuntimeEvidence(config,changed,{allowDiagnosticsOnly:true}),/GENERATION_MISMATCH/);
  const currentChain={...f.chain,preflight:async()=>({...chainReport(),config:{...defaults,joinDurationSeconds:'299'}})};
  await assert.rejects(verifyReadinessCurrent({...f.runOptions,evidence:result.evidence,chain:currentChain}),/CHAIN_CHANGED/);
  const evidencePath=join(f.runtimeDir,READINESS_FILES.evidence),savedEvidence=await readFile(evidencePath,'utf8');
  await rm(evidencePath);
  assert.equal((await f.runner.status()).status,'incomplete-no-replay');
  await writeFile(evidencePath,savedEvidence,{mode:0o600});
  const journalPath=join(f.runtimeDir,READINESS_FILES.journal);const journal=JSON.parse(await readFile(journalPath,'utf8'));
  journal.operations[0].status='intent';await writeFile(journalPath,JSON.stringify(journal));
  await assert.rejects(validateReadinessRunState({config,evidence:result.evidence,runtimeDir:f.runtimeDir}),/STATE_INVALID/);
});

test('model-only successful reply without independent runtime receipt never proves tool execution',async t=>{
  const f=await fixture(t,{omitReceipt:true});
  await assert.rejects(f.runner.run(),/READINESS_RUN_FAILED/);
  assert.equal(f.cliInputs.length,1);
  await assert.rejects(readFile(join(f.runtimeDir,READINESS_FILES.evidence)),/ENOENT/);
});

test('ambiguous diagnostic staging response body is not retried and cleanup records no readiness',async t=>{
  let stages=0;
  const f=await fixture(t,{onCall:({path,body})=>{
    if(path.endsWith('/exec')&&body.command[3]?.includes('stagePublicRequest')) {
      stages++;return new Response(new ReadableStream({start(controller){controller.error(new Error('fixture body timeout'));}}));
    }
  }});
  await assert.rejects(f.runner.run(),/READINESS_RUN_FAILED/);
  assert.equal(stages,1);
  assert.equal(f.calls.filter(row=>row.path.endsWith('/sleep')).length,1);
});

test('bad wake identity and unresolved late activation never acquire a readiness permit',async t=>{
  for(const kind of ['identity','unknown']) {
    const f=await fixture(t,{onCall:({path,agent})=>{
      if(!path.endsWith('/reload-env'))return;
      agent.status='active';
      if(kind==='identity')return jsonResponse({...agent,id:'wrong-agent'});
      throw new Error('fixture activation completion unknown');
    }});
    await assert.rejects(f.runner.run(),/READINESS_RUN_FAILED/);
    if(kind==='unknown')assert.equal((await f.runner.status()).all_seats_sleeping,false);
    await assert.rejects(readFile(join(f.runtimeDir,READINESS_FILES.evidence)),/ENOENT/);
  }
});

test('interrupted durable journal is inspectable without replaying a lifecycle intent',async t=>{
  const f=await fixture(t,{chain:{preflight:async()=>{throw new Error('fixture interruption');}}});
  await assert.rejects(f.runner.run(),/READINESS_RUN_FAILED/);
  const path=join(f.runtimeDir,READINESS_FILES.journal);const journal=JSON.parse(await readFile(path,'utf8'));
  journal.status='running';journal.operations.at(-1).status='intent';await writeFile(path,JSON.stringify(journal));
  const restored=createReadinessRun(f.runOptions),count=f.calls.length;
  assert.equal((await restored.status()).status,'incomplete-no-replay');
  assert.equal(f.calls.length,count);
  await assert.rejects(restored.run(),/DIRECTORY_ALREADY_EXISTS/);
});
