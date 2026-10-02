import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
    calls.push({ path, method:request.method, ...(seat ? {seat:seat.seat_id} : {}),
      ...(body?.command ? {command:body.command} : {}) });
    if (options.onCall) {
      const override = await options.onCall({ path, request, seat, agent, body, calls, agents, runtimeDir, parent, receipts });
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
    if (path.endsWith('/start')) {
      agent.status = 'active'; maxAwake = Math.max(maxAwake, agents.filter(row => row.status === 'active').length);
      return jsonResponse(agent);
    }
    if (path.endsWith('/sleep')) { agent.status = 'sleeping'; return jsonResponse(agent); }
    if (path.endsWith('/files/list')) return jsonResponse({ path:artifact.persistent_root, root:artifact.persistent_root,
      entries:[{name:'dilemma-conference',isDir:true,size:4096,mtime:1723900000}] });
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
      if (JSON.stringify(command) === JSON.stringify(RUNTIME_INSTANCE_COMMAND) || command.at(-1).endsWith('/execution-permit.mjs')) {
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
  // Durable setup performs hundreds of real fsyncs. Its logical clock must not
  // expire because another local suite stalls disk I/O; deadline tests advance
  // their injected clock only after the specific operation under test starts.
  const fixtureAtMs = Date.now(), now = options.now ?? (() => fixtureAtMs), startedAtMs = now();
  const runOptions = { config,runtimeDir,artifacts,apiKey:'fixture-credential',fetchImpl,chain,
    deadlineAtMs:startedAtMs+duration,cleanupDeadlineAtMs:startedAtMs+duration+10_000,now };
  const runner=createReadinessRun(runOptions);
  const controlledRunner={...runner,async run(){
    // The real adapter has a native Date.now deadline boundary as well as the
    // producer's injected clock. Keep both on this fixture's clock only while
    // diagnostics run, and restore the native clock even when cleanup fails.
    const nativeClock=Date.now,clock=t.mock.method(Date,'now',now);
    try { return await runner.run(); }
    finally { clock.mock.restore();assert.equal(Date.now,nativeClock,'fixture clock is restored after success or failure'); }
  }};
  return { runner:controlledRunner,runOptions,runtimeDir,parent,calls,cliInputs,agents,generationChecks,receipts,options,
    maxAwake:() => maxAwake, chain };
}

async function originalPublication(f) {
  return Object.fromEntries(await Promise.all(Object.values(READINESS_FILES).map(async name =>
    [name, await readFile(join(f.runtimeDir, name), 'utf8')])));
}

function verificationOptions(f, evidence, name, extra = {}) {
  const now = extra.now ?? f.runOptions.now, deadlineAtMs = now() + 120_000;
  return { ...f.runOptions, evidence, now, deadlineAtMs, cleanupDeadlineAtMs:deadlineAtMs + 10_000,
    verificationDir:join(f.parent, name), ...extra };
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
    assert.equal(result.evidence.producer_version, 2);
    assert.equal(result.evidence.continuity_policy, 'observed-runtime-continuity-v1');
    assert.equal(result.evidence.ready_for_controlled_gameplay, true);
    assert.doesNotThrow(() => validateControlledRuntimeEvidence(config,result.evidence,{now:f.runOptions.now}));
    assert.equal((await validateReadinessRunState({ config,evidence:result.evidence,runtimeDir:f.runtimeDir,now:f.runOptions.now })).ready,true);
    assert.equal(result.evidenceDigest,runtimeEvidenceFingerprint(result.evidence));
    const status = await f.runner.status();
    assert.equal(status.status,'complete');
    assert.equal(status.ready_for_controlled_gameplay,false);
    assert.equal(status.verification_required,true);
    const text = await readFile(result.evidencePath,'utf8');
    assert.doesNotMatch(text, /fixture-credential|YOUR_CHOICE|rawreply|private_key|provider_error|session|salt|prompt/i);
    assert.deepEqual((await readdir(f.runtimeDir)).sort(),Object.values(READINESS_FILES).sort());
    await assert.rejects(createReadinessRun(f.runOptions).run(),/DIRECTORY_ALREADY_EXISTS/);
    const original = await originalPublication(f), beforeCalls = f.calls.length, beforePaths = await readdir(f.parent);
    const readonly = await verifyReadinessCurrent(verificationOptions(f,result.evidence,'unused-readonly',{readOnly:true}));
    assert.equal(readonly.ready,false);
    assert.equal(readonly.read_only,true);
    assert.equal(readonly.verification_required,true);
    assert.equal(readonly.evidence_sha256,result.evidenceDigest);
    assert.equal(f.calls.slice(beforeCalls).every(row => row.method === 'GET'),true);
    assert.deepEqual(await readdir(f.parent),beforePaths);
    assert.deepEqual(await originalPublication(f),original);
    if (repeat === 0) {
      const args = verificationOptions(f,result.evidence,'serial-verification');
      f.options.onCall = async ({path}) => {
        if (!path.endsWith('/start')) return;
        const journal = JSON.parse(await readFile(join(args.verificationDir,'continuity-verification.json'),'utf8'));
        assert.equal(journal.operations.at(-1).kind,'activation');
        assert.equal(journal.operations.at(-1).status,'intent');
      };
      const begin = f.calls.length;
      const verified = await verifyReadinessCurrent(args);
      const calls = f.calls.slice(begin);
      assert.equal(verified.ready,true);
      assert.equal(verified.evidence_sha256,result.evidenceDigest);
      assert.equal(verified.lifecycle_state_digest,result.evidence.lifecycle_state_digest);
      assert.equal(verified.continuity_policy,'observed-runtime-continuity-v1');
      assert.equal(calls.filter(row => row.path.endsWith('/start')).length,10);
      assert.equal(calls.filter(row => row.path.endsWith('/sleep')).length,10);
      assert.equal(calls.filter(row => row.command?.[0] === 'sha256sum').length,20);
      assert.equal(calls.filter(row => row.command?.at(-1).endsWith('/execution-permit.mjs')).length,20);
      assert.equal(calls.filter(row => row.command?.includes('--inspect')).length,10);
      assert.equal(calls.filter(row => row.command?.includes('--check-model')).length,10);
      assert.equal(calls.filter(row => row.command?.includes('--check-model-route')).length,10);
      assert.equal(calls.filter(row => row.command?.at(-1).includes('/diagnostic-receipts/')).length,20);
      assert.equal(calls.some(row => /reload-env|chat|restart|transactions/.test(row.path) ||
        row.command?.some(part => /--configure|execution-permits\//.test(part))),false);
      for (let index = 1; index < roster.length; index++) {
        assert.ok(calls.findIndex(row => row.seat === roster[index-1].seat_id && row.path.endsWith('/sleep')) <
          calls.findIndex(row => row.seat === roster[index].seat_id && row.path.endsWith('/start')));
      }
      assert.equal(f.cliInputs.length,20,'revalidation never sends another model request');
      assert.equal(f.maxAwake(),5);
      assert.ok(f.agents.slice(0,10).every(row => row.status === 'sleeping'));
      assert.ok(f.agents.slice(10).every(row => row.status === 'active'));
      assert.deepEqual(await originalPublication(f),original);
      const journal = JSON.parse(await readFile(join(args.verificationDir,'continuity-verification.json'),'utf8'));
      assert.equal(journal.status,'complete');
      assert.equal(journal.all_seats_sleeping,true);
      assert.equal(journal.evidence_sha256,result.evidenceDigest);
      assert.ok(journal.operations.every(row => row.status === 'complete'));
      assert.equal(verified.verification_sha256,runtimeEvidenceFingerprint(journal));
      assert.deepEqual(await readdir(args.verificationDir),['continuity-verification.json']);
      await assert.rejects(verifyReadinessCurrent(args),/DIRECTORY_ALREADY_EXISTS/);
      assert.equal(f.calls.slice(begin).filter(row => row.path.endsWith('/start')).length,10);
    }
  }
});

test('full unrelated capacity refuses every wake and publishes no evidence', async t => {
  const f = await fixture(t,{unrelated:5});
  await assert.rejects(f.runner.run(),/READINESS_RUN_FAILED/);
  assert.equal(f.calls.some(row => row.path.endsWith('/reload-env')),false);
  assert.equal((await f.runner.status()).all_seats_sleeping,true);
  await assert.rejects(readFile(join(f.runtimeDir,READINESS_FILES.evidence)),/ENOENT/);
});

test('current continuity rejects cold guests, missing original receipts, source or model drift, and expired evidence',async t=>{
  const f=await fixture(t),result=await f.runner.run(),original=await originalPublication(f);
  for(const kind of ['cold','missing-receipt','source','model','route','private-reply','wrong-start']) {
    let reached=false;
    const args=verificationOptions(f,result.evidence,`reject-${kind}`),begin=f.calls.length;
    f.options.onCall=({path,body,agent})=>{
      if(kind==='wrong-start'&&path.endsWith('/start')) {
        reached=true;agent.status='active';return jsonResponse({...agent,id:'different-agent'});
      }
      if(!path.endsWith('/exec'))return;
      const command=body.command;
      if(kind==='cold'&&command.at(-1).endsWith('/execution-permit.mjs')) {
        reached=true;return jsonResponse({exitCode:0,stderr:'',stdout:JSON.stringify({
          schema_version:1,runtime_instance_fingerprint:'ef'.repeat(32)})});
      }
      if(kind==='missing-receipt'&&command.at(-1).includes('/diagnostic-receipts/')) {
        reached=true;return jsonResponse({exitCode:1,stderr:'',stdout:''});
      }
      if(kind==='source'&&command[0]==='sha256sum') {
        reached=true;return jsonResponse({exitCode:0,stderr:'',stdout:'different source bytes'});
      }
      if(kind==='model'&&command.includes('--check-model')||kind==='route'&&command.includes('--check-model-route')) {
        reached=true;return jsonResponse({exitCode:0,stderr:'',stdout:'{}'});
      }
      if(kind==='private-reply'&&command.at(-1).endsWith('/execution-permit.mjs')) {
        reached=true;return jsonResponse({exitCode:0,stderr:'',stdout:JSON.stringify({schema_version:1,
          runtime_instance_fingerprint:'cd'.repeat(32),private_key:'unpublished-continuity-fixture-secret'})});
      }
    };
    await assert.rejects(verifyReadinessCurrent(args),/READINESS_VERIFICATION_FAILED/);
    assert.equal(reached,true,`${kind} reaches the intended boundary`);
    const calls=f.calls.slice(begin);
    assert.equal(calls.filter(row=>row.path.endsWith('/start')).length,1);
    assert.equal(calls.filter(row=>row.path.endsWith('/sleep')).length,1);
    assert.equal(calls.some(row=>/chat|reload-env|transactions/.test(row.path)),false);
    assert.ok(f.agents.every(row=>row.status==='sleeping'));
    const saved=await readFile(join(args.verificationDir,'continuity-verification.json'),'utf8');
    assert.equal(JSON.parse(saved).status,'failed');
    assert.doesNotMatch(saved,/unpublished-continuity-fixture-secret|private_key|different source bytes/);
    await assert.rejects(verifyReadinessCurrent(args),/DIRECTORY_ALREADY_EXISTS/);
    assert.equal(f.calls.slice(begin).filter(row=>row.path.endsWith('/start')).length,1);
    assert.deepEqual(await originalPublication(f),original);
  }
  f.options.onCall=undefined;
  for(const kind of ['evidence','expiry','artifact']) {
    const evidence=structuredClone(result.evidence),changedArtifacts=structuredClone(artifacts);
    if(kind==='evidence')evidence.seats[0].runtime_instance_fingerprint='ef'.repeat(32);
    if(kind==='artifact')changedArtifacts[0].files[0].content+='drift';
    const begin=f.calls.length;
    const args=verificationOptions(f,evidence,`reject-local-${kind}`,{
      artifacts:changedArtifacts,...(kind==='expiry'?{now:()=>Date.parse(evidence.expires_at)}:{})});
    await assert.rejects(verifyReadinessCurrent(args),/READINESS_STATE_INVALID|READINESS_ARTIFACTS_INVALID/);
    assert.equal(f.calls.slice(begin).some(row=>row.method==='POST'),false);
    await assert.rejects(readdir(args.verificationDir),/ENOENT/);
  }
  assert.deepEqual(await originalPublication(f),original);
});

test('interrupted verification preserves uncertainty, bounded cleanup and durable no-replay after late work',async t=>{
  const f=await fixture(t),result=await f.runner.run(),original=await originalPublication(f);
  for(const kind of ['deadline','aborted-start','aborted-body']) {
    const observedAtMs=f.runOptions.now();
    let reached=false,clockOffset=0,release;
    const controller=new AbortController();
    const args=verificationOptions(f,result.evidence,`interrupted-${kind}`,{signal:controller.signal,
      now:()=>observedAtMs+clockOffset});
    const begin=f.calls.length;
    f.options.onCall=({path,body,agent})=>{
      if(kind==='aborted-start'&&path.endsWith('/start')) {
        reached=true;
        const pending=new Promise(resolve=>{release=()=>{agent.status='active';resolve(jsonResponse(agent));};});
        queueMicrotask(()=>controller.abort());return pending; // Fake fetch deliberately ignores its signal.
      }
      if(!path.endsWith('/exec')||!body.command.at(-1).endsWith('/execution-permit.mjs'))return;
      reached=true;
      if(kind==='deadline') {
        clockOffset=args.deadlineAtMs-observedAtMs+1;
        return jsonResponse({exitCode:0,stderr:'',stdout:JSON.stringify({schema_version:1,runtime_instance_fingerprint:'cd'.repeat(32)})});
      }
      if(kind==='aborted-body') {
        return new Response(new ReadableStream({start(stream){
          release=()=>{stream.enqueue(new TextEncoder().encode(JSON.stringify({exitCode:0,stderr:'',stdout:JSON.stringify({
            schema_version:1,runtime_instance_fingerprint:'cd'.repeat(32)})})));stream.close();};
          queueMicrotask(()=>controller.abort());
        }}));
      }
    };
    await assert.rejects(verifyReadinessCurrent(args),/READINESS_VERIFICATION_FAILED_SLEEP_UNCONFIRMED/);
    assert.equal(reached,true,`${kind} reaches the targeted lifecycle/runtime boundary`);
    const file=join(args.verificationDir,'continuity-verification.json'),saved=await readFile(file,'utf8');
    const journal=JSON.parse(saved);
    assert.equal(journal.status,'failed');
    assert.equal(journal.all_seats_sleeping,false);
    assert.ok(journal.operations.some(row=>row.status==='unknown'));
    assert.equal(f.calls.slice(begin).filter(row=>row.path.endsWith('/start')).length,1);
    assert.equal(f.calls.slice(begin).filter(row=>row.path.endsWith('/sleep')).length,1);
    assert.ok(f.agents.every(row=>row.status==='sleeping'),'cleanup observation precedes any late activation completion');
    release?.();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(await readFile(file,'utf8'),saved,'late work cannot certify or rewrite a terminal journal');
    if(kind==='aborted-start') {
      assert.equal(f.agents[0].status,'active','late activation demonstrates why sleep certainty remains false');
      f.agents[0].status='sleeping'; // Reset only the local fake before checking replay refusal.
    }
    f.options.onCall=undefined;
    const replay=verificationOptions(f,result.evidence,`interrupted-${kind}`);
    await assert.rejects(verifyReadinessCurrent(replay),/DIRECTORY_ALREADY_EXISTS/);
    assert.equal(f.calls.slice(begin).filter(row=>row.path.endsWith('/start')).length,1);
    assert.deepEqual(await originalPublication(f),original);
  }
  let finalPublicationObserved=false;
  const args=verificationOptions(f,result.evidence,'final-publication-timeout');
  const file=join(args.verificationDir,'continuity-verification.json');
  args.now=()=>{
    try {
      if(JSON.parse(readFileSync(file,'utf8')).status==='complete') {
        finalPublicationObserved=true;return args.deadlineAtMs+1;
      }
    } catch { /* The fixture has not published its journal yet. */ }
    return f.runOptions.now();
  };
  await assert.rejects(verifyReadinessCurrent(args),error=>error.message==='READINESS_VERIFICATION_FAILED');
  assert.equal(finalPublicationObserved,true,'the deadline crosses only after the final journal is published');
  const terminal=JSON.parse(await readFile(file,'utf8'));
  assert.equal(terminal.status,'failed');
  assert.equal(terminal.all_seats_sleeping,true);
  assert.deepEqual(await originalPublication(f),original);
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

test('volume listing accepts documented root and entries metadata without retaining directory names',async t=>{
  for(const entries of [[],[{name:'unpublished-fixture-name',isDir:false,size:182,mtime:1723900000.125},
    {name:'dilemma-conference',isDir:true,size:4096,mtime:1723900000}]]) {
    let volumeRead=false,accepted=false;
    const f=await fixture(t,{onCall:({path,seat,body})=>{
      if(path.endsWith('/files/list')) {
        volumeRead=true;const root=`/volume/${seat.seat_id}`;
        return jsonResponse({path:root,root,entries});
      }
      if(volumeRead&&path.endsWith('/exec')&&body.command[0]==='sha256sum') {
        accepted=true;throw new Error('fixture stops after accepted volume metadata');
      }
    }});
    await assert.rejects(f.runner.run(),/READINESS_RUN_FAILED/);
    assert.equal(volumeRead,true);assert.equal(accepted,true);
    assert.doesNotMatch(await readFile(join(f.runtimeDir,READINESS_FILES.journal),'utf8'),/unpublished-fixture-name/);
  }
});

test('volume listing rejects wrong roots, legacy or mixed schemas, malformed entries and leaked fields safely',async t=>{
  const entry={name:'notes.md',isDir:false,size:182,mtime:1723900000};
  const changes=[
    value=>({...value,root:'/different-volume'}),
    value=>({...value,path:`${value.root}/other`}),
    value=>({root:value.root,files:[]}),
    value=>({...value,files:[]}),
    value=>({...value,entries:null}),
    value=>({...value,entries:[{...entry,name:'../escape'}]}),
    value=>({...value,entries:[{...entry,size:-1}]}),
    value=>({...value,entries:[{...entry,isDir:'false'}]}),
    value=>({...value,entries:[{...entry,mtime:'1723900000'}]}),
    value=>({...value,entries:[entry,entry]}),
    value=>({...value,entries:[{...entry,private_key:'unpublished-volume-secret'}]}),
    value=>({...value,provider_error:'unpublished-volume-secret'})
  ];
  for(const change of changes) {
    let volumeRead=false,advanced=false;
    const f=await fixture(t,{onCall:({path,seat,body})=>{
      if(path.endsWith('/files/list')) {
        volumeRead=true;const root=`/volume/${seat.seat_id}`;
        return jsonResponse(change({path:root,root,entries:[entry]}));
      }
      if(volumeRead&&path.endsWith('/exec')&&body.command[0]==='sha256sum')advanced=true;
    }});
    await assert.rejects(f.runner.run(),error=>error.message==='READINESS_RUN_FAILED');
    assert.equal(volumeRead,true);assert.equal(advanced,false);
    assert.equal(f.cliInputs.length,0);
    assert.doesNotMatch(await readFile(join(f.runtimeDir,READINESS_FILES.journal),'utf8'),
      /unpublished-volume-secret|notes\.md|private_key|provider_error/);
    await assert.rejects(readFile(join(f.runtimeDir,READINESS_FILES.evidence)),/ENOENT/);
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
    const observedAtMs=Date.now();
    let clockOffset=0,targetReached=false;
    const f=await fixture(t,{now:()=>observedAtMs+clockOffset,onCall:({path,agent})=>{
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
  assert.throws(()=>validateControlledRuntimeEvidence(config,changed,{now:f.runOptions.now,allowDiagnosticsOnly:true}),/GENERATION_MISMATCH/);
  const currentChain={...f.chain,preflight:async()=>({...chainReport(),config:{...defaults,joinDurationSeconds:'299'}})};
  await assert.rejects(verifyReadinessCurrent({...f.runOptions,evidence:result.evidence,chain:currentChain}),/CHAIN_CHANGED/);
  const evidencePath=join(f.runtimeDir,READINESS_FILES.evidence),savedEvidence=await readFile(evidencePath,'utf8');
  await rm(evidencePath);
  assert.equal((await f.runner.status()).status,'incomplete-no-replay');
  await writeFile(evidencePath,savedEvidence,{mode:0o600});
  const journalPath=join(f.runtimeDir,READINESS_FILES.journal);const journal=JSON.parse(await readFile(journalPath,'utf8'));
  journal.operations[0].status='intent';await writeFile(journalPath,JSON.stringify(journal));
  await assert.rejects(validateReadinessRunState({config,evidence:result.evidence,runtimeDir:f.runtimeDir,now:f.runOptions.now}),/STATE_INVALID/);
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
