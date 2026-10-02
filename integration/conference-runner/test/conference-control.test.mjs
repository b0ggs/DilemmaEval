import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fixtureConfig } from '../src/fixture.mjs';
import { parseControlArguments, runConferenceControl, controlErrorCode } from '../src/conference-control.mjs';

const exec = promisify(execFile);
async function setup(t) {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'conference-control-test-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = await fixtureConfig();
  config.mode = 'live';
  config.roster = Array.from({ length: 10 }, (_, index) => {
    const team = index < 5 ? 'openclaw' : 'hermes';
    const number = index % 5 + 1;
    return { seat_id: `${index < 5 ? 'oc' : 'hs'}-${number}`, team, harness: team,
      agent_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      maritime_agent: `${team}-fixture-${number}`, wallet_address: `0x${(index + 101).toString(16).padStart(40, '0')}`,
      cause_id: index < 5 ? 1 : 2 };
  });
  const artifactPlan = { schema_version: 1, seats: config.roster.map(seat => ({ seat_id: seat.seat_id,
    persistent_root: `/volume/${seat.seat_id}` })) };
  const operations = { schema_version: 1, network: 'base-sepolia', chain_id: 84532,
    phase_advancer: { role: 'phase-advancer', wallet_address: config.expected_owner,
      is_player_seat: false, erc8004_registered: false }, gas_ceiling_wei: '1000000000000000' };
  for (const [filename, value] of [['config.json', config], ['artifacts.json', artifactPlan], ['operations.json', operations]]) {
    await writeFile(path.join(directory, filename), JSON.stringify(value));
  }
  const args = ['--config', path.join(directory, 'config.json'), '--runtime-dir', path.join(directory, 'new-run'),
    '--artifact-plan', path.join(directory, 'artifacts.json'), '--operations-manifest', path.join(directory, 'operations.json')];
  return { directory, config, args };
}

test('versioned local plan/status build exact ten-seat artifacts without secrets, provider, or writes', async t => {
  const { directory, config, args } = await setup(t);
  const before = await readdir(directory);
  for (const command of ['plan', 'status']) {
    let visited = false;
    const result = await runConferenceControl([command, ...args], {
      loadSecrets() { assert.fail('read-only command loaded credentials'); },
      chainModule: { makeProvider() { assert.fail('read-only command constructed network provider'); } },
      readiness: { createReadinessRun(input) {
        visited = true;
        assert.equal(input.apiKey, undefined); assert.equal(input.chain, undefined);
        assert.equal(input.artifacts.length, 10);
        assert.deepEqual(input.artifacts.map(artifact => artifact.seat_id), config.roster.map(seat => seat.seat_id));
        assert.ok(input.artifacts.every(artifact => /^[a-f0-9]{64}$/.test(artifact.artifact_sha256)));
        return { [command]: async () => ({ schema_version: 1, read_only: true, seats: 10 }) };
      } },
    });
    assert.equal(visited, true); assert.equal(result.read_only, true);
  }
  assert.deepEqual(await readdir(directory), before);
});

test('CLI rejects duplicate, unknown, relative, incomplete and injected signing arguments', async t => {
  const { args } = await setup(t);
  for (const argv of [
    ['plan', ...args, '--config', '/tmp/repeated'], ['plan', ...args, '--signer', '/tmp/key'],
    ['plan', ...args.slice(0, -1)], ['launch', ...args], ['plan', '--config', 'relative'],
  ]) assert.throws(() => parseControlArguments(argv), /CONTROL_/);
  await assert.rejects(runConferenceControl(['plan', ...args], { env: { GAMEPLAY_WALLET_PRIVATE_KEY: 'not-a-real-key' } }),
    /COORDINATOR_SIGNER_ENVIRONMENT_FORBIDDEN/);
  assert.equal(controlErrorCode(new Error('PROVIDER_SECRET_SHAPED_LIKE_A_CODE')), 'CONTROL_OPERATION_FAILED');
  assert.equal(controlErrorCode(new Error('provider included private details')), 'CONTROL_OPERATION_FAILED');
  for (const code of ['READINESS_RUN_FAILED_SLEEP_UNCONFIRMED', 'READINESS_REMOTE_GENERATION_UNATTESTED',
    'PROOF_PROCESS_RUNNING', 'PROOF_JOURNAL_UNRESOLVED', 'PROOF_PENDING_NONCE']) {
    assert.equal(controlErrorCode(new Error(code)), code);
  }
});

test('actual producer plan and absent status leave the filesystem untouched', async t => {
  const { directory, args } = await setup(t);
  const before = await readdir(directory);
  const plan = await runConferenceControl(['plan', ...args]);
  assert.equal(plan.read_only, true);
  assert.equal(plan.seats.length, 10);
  assert.equal(plan.max_account_awake, 5);
  assert.equal(plan.continuity_policy, 'observed-runtime-continuity-v1');
  assert.equal(plan.verification_required, true);
  const status = await runConferenceControl(['status', ...args]);
  assert.equal(status.status, 'absent');
  assert.deepEqual(await readdir(directory), before);
});

test('diagnostic CLI passes absolute deadlines to producer, never creates gameplay adapters and only emits summary', async t => {
  const { args } = await setup(t);
  let destroyed = false;
  const deadline = '2030-01-01T00:01:00.000Z', cleanup = '2030-01-01T00:02:00.000Z';
  const result = await runConferenceControl(['diagnose', ...args, '--deadline', deadline,
    '--cleanup-deadline', cleanup, '--secrets-env', '/not-read/fixture.env'], {
    loadSecrets: async () => ({ MARITIME_API_KEY: 'fixture-private-value' }),
    chainModule: { makeProvider: () => ({ destroy: () => { destroyed = true; } }), createChainReader: () => ({ fixture: true }) },
    readiness: { createReadinessRun(input) {
      assert.equal(input.deadlineAtMs, Date.parse(deadline));
      assert.equal(input.cleanupDeadlineAtMs, Date.parse(cleanup));
      assert.equal(input.apiKey, 'fixture-private-value');
      return { run: async () => ({ evidence: { diagnostics_complete: true, ready_for_controlled_gameplay: false },
        evidenceDigest: 'ab'.repeat(32), evidencePath: '/not-public/path', rawReply: 'private-fixture' }) };
    } },
  });
  assert.equal(destroyed, true);
  assert.deepEqual(result, { schema_version: 1, cli_version: 2, diagnostics_complete: true,
    ready_for_controlled_gameplay: false, evidence_sha256: 'ab'.repeat(32) });
});

test('duplicate artifact seat and missing input fail before credentials or diagnostic effects', async t => {
  const { directory, args } = await setup(t);
  const filename = path.join(directory, 'artifacts.json');
  const plan = JSON.parse(await readFile(filename, 'utf8'));
  plan.seats[9] = plan.seats[0];
  await writeFile(filename, JSON.stringify(plan));
  await assert.rejects(runConferenceControl(['plan', ...args], {
    loadSecrets: () => assert.fail('loaded secrets'), readiness: { createReadinessRun: () => assert.fail('producer invoked') },
  }), /CONTROL_ARTIFACT_PLAN_INVALID/);
});

test('historical live run/rehearse entrypoints reject before reading config or credentials', async () => {
  const filename = new URL('../src/cli.mjs', import.meta.url).pathname;
  for (const command of ['run', 'rehearse']) {
    await assert.rejects(exec(process.execPath, [filename, command, '--config', '/not-read/private-input']), error => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /PROOF_VERSIONED_CLI_REQUIRED/);
      assert.equal(error.stderr.includes('/not-read'), false);
      return true;
    });
  }
});

function proofArgs(fixture) {
  const directory = fixture.directory;
  return ['--config', path.join(directory, 'config.json'), '--evidence', path.join(directory, 'evidence.json'),
    '--readiness-dir', path.join(directory, 'readiness'), '--proof-dir', path.join(directory, 'proof'),
    '--operator-dir', path.join(directory, 'operator'), '--runner-dirs', JSON.stringify([path.join(directory, 'old-runner')]),
    '--stop-new-games-at', new Date(Date.now() + 300_000).toISOString(),
    '--hard-stop-at', new Date(Date.now() + 600_000).toISOString(), '--secrets-env', path.join(directory, 'secrets.env'),
    '--artifact-plan', path.join(directory, 'artifacts.json'), '--operations-manifest', path.join(directory, 'operations.json'),
    '--verification-root', directory];
}
function readers() {
  return { env: {}, loadSecrets: async () => ({ MARITIME_API_KEY: 'fixture-maritime', TELEGRAM_BOT_TOKEN: 'fixture-telegram',
    DILEMMA_LAUNCHER_TOKEN: 'fixture-operator' }),
    chainModule: { makeProvider: () => ({ destroy() {} }), createChainReader: () => ({ fixture: true }) } };
}
test('proof read-only commands never allocate a verification directory; preparation requests a fresh one', async t => {
  const fixture = await setup(t), before = await readdir(fixture.directory);
  for (const command of ['proof-plan', 'proof-status', 'proof-prepare']) {
    let checked = false;
    const readOnly = command !== 'proof-prepare';
    const inspect = async options => {
      assert.equal(options.readOnly, readOnly);
      await options.validateReadinessCurrent({ config: fixture.config, evidence: {}, readOnly });
      return { status: readOnly ? 'verification-required' : 'prepared' };
    };
    const result = await runConferenceControl([command, ...proofArgs(fixture)], { ...readers(),
      proof: { planControlledProof: inspect, validatePreparedProof: inspect, prepareControlledProof: inspect },
      readiness: { verifyReadinessCurrent: async input => {
        checked = true; assert.equal(input.readOnly, readOnly); assert.equal(input.artifacts.length, 10);
        assert.ok(input.artifacts.every(row => JSON.parse(row.files.find(file => file.path === row.gameplay_command[2]).content).execution_permit_required === true));
        if (readOnly) assert.equal(input.verificationDir, undefined);
        else {
          assert.equal(path.dirname(input.verificationDir), fixture.directory);
          assert.match(path.basename(input.verificationDir), /^verification-[a-f0-9-]{36}$/);
        }
        return { ready: !readOnly };
      } }, maritime: { createMaritimeAdapter: () => assert.fail('gameplay during planning or preparation') },
    });
    assert.equal(checked, true); assert.equal(result.ready_for_creation, false);
    assert.equal(result.verification_required, readOnly);
  }
  assert.deepEqual(await readdir(fixture.directory), before);
});
test('proof-run connects certified adapters after operator and spectator preflight and emits no private adapter result', async t => {
  const fixture = await setup(t), order = [];
  const scoreboardPath = path.join(fixture.directory, 'scoreboards.json');
  await writeFile(scoreboardPath, JSON.stringify({ fixture: true }));
  await writeFile(path.join(fixture.directory, 'evidence.json'), '{}');
  const continuity = { verify() {}, prepareAction() {} };
  const result = await runConferenceControl(['proof-run', ...proofArgs(fixture), '--operator-pid', String(process.pid),
    '--operator-url', 'http://127.0.0.1:4312', '--scoreboard-bindings', scoreboardPath], {
    ...readers(), proof: { validatePreparedProof: async options => {
      order.push('metadata'); assert.equal(options.readOnly, true); assert.equal(options.ownedProcesses.length, 1);
      return { preparedConfig: fixture.config };
    } }, livePreflight: {
      inspectProofOperator: async input => { order.push('operator'); assert.equal(input.expectedPid, process.pid);
        return { role: 'operator', directory: input.operatorDirectory, pid: process.pid, token: 'fixture-lock-token' }; },
      verifyProofSpectators: async input => { order.push('spectators'); assert.deepEqual(input.scoreboard, { fixture: true }); },
    }, continuity: { createRuntimeContinuity: input => { order.push('continuity'); assert.equal(input.artifacts.length, 10); return continuity; } },
    maritime: { createMaritimeAdapter: input => { order.push('agents'); assert.equal(input.maxAwake, 5);
      assert.equal(input.maxAgents, 10); assert.equal(input.runtimeContinuity, continuity); return {}; } },
    operator: { createOperatorAdapters: input => { assert.equal(input.token, 'fixture-operator'); return { launcher: {}, phaseExecutor: {} }; } },
    telegram: { createTelegramMirror: input => { assert.equal(input.runtimeDir, path.join(fixture.directory, 'proof', 'runtime')); return {}; } },
    execution: { runControlledProof: async input => { order.push('execute'); assert.equal(input.proofOptions.ownedProcesses[0].token, 'fixture-lock-token');
      return { status: 'candidate-complete', game_id: '18', launch_attempts: 1, candidate_proof_complete: true,
        awaiting_independent_audit: true, proof_complete: true, raw: 'private-fixture' }; } },
  });
  assert.deepEqual(order, ['operator', 'metadata', 'spectators', 'continuity', 'agents', 'execute']);
  assert.equal(result.proof_complete, false); assert.equal(result.awaiting_independent_audit, true);
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.equal(JSON.stringify(result).includes('fixture-lock-token'), false);
});
test('versioned audit requires explicit output and proof-run requires a loopback operator', async t => {
  const fixture = await setup(t);
  const audit = parseControlArguments(['proof-audit', '--proof-dir', path.join(fixture.directory, 'proof'), '--game-id', '18',
    '--scoreboard-bindings', path.join(fixture.directory, 'scoreboards.json'), '--secrets-env', path.join(fixture.directory, 'secrets.env'),
    '--output', path.join(fixture.directory, 'audit.json')]);
  assert.equal(audit.command, 'proof-audit');
  assert.throws(() => parseControlArguments(['proof-run', ...proofArgs(fixture), '--operator-pid', '42',
    '--operator-url', 'https://example.invalid', '--scoreboard-bindings', path.join(fixture.directory, 'scoreboards.json')]), /CONTROL_OPERATOR_URL_INVALID/);
  assert.equal((await runConferenceControl(['--version'])).cli_version, 2);
});
