import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fixtureConfig } from '../../src/fixture.mjs';
import { prepareDebugAgents } from '../../src/maritime/prepare-debug.mjs';

test('observer transition deploys all ten through checked serial wakes, preserves cleanup and sends no chat/signing', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'prepare-debug-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = await fixtureConfig({ teamSizes: { openclaw: 5, hermes: 5 } });
  const artifacts = config.roster.map(seat => {
    const base = `${seat.harness === 'openclaw' ? '/data' : '/opt/data'}/dilemma-conference/${seat.seat_id}`;
    return { ...seat, gameplay_command: ['node', `${base}/code/integration/conference-runner/src/maritime/player-cli.mjs`, `${base}/seat.json`],
      model_config_check_command: ['model'], model_route_check_command: ['route'],
      files: [{ path: `${base}/seat.json`, content: JSON.stringify({ ...seat, persistent_root: seat.harness === 'openclaw' ? '/data' : '/opt/data',
        openclaw_config_path: '/data/.openclaw/openclaw.json' }) }] };
  });
  const awake = new Set(), installed = [], wakes = [];
  const fetchImpl = async (url, options) => {
    const route = new URL(url).pathname;
    const json = value => new Response(JSON.stringify(value));
    if (route === '/api/agents') return json(config.roster.map(seat => ({ id: seat.agent_id, framework: seat.harness,
      status: awake.has(seat.agent_id) ? 'active' : 'sleeping' })));
    const seat = config.roster.find(seat => route.includes(seat.agent_id));
    assert.ok(seat);
    if (route.endsWith('/start') || route.endsWith('/reload-env')) { awake.add(seat.agent_id); assert.ok(awake.size <= 5); return json({ status: 'active' }); }
    if (route.endsWith('/sleep')) { awake.delete(seat.agent_id); return json({ status: 'sleeping' }); }
    if (route.endsWith('/exec')) {
      const command = JSON.parse(options.body).command;
      const source = JSON.stringify(command);
      let value = { schema_version: 1, seat_id: seat.seat_id };
      if (command[0] === 'route') value.model_route_verified = true;
      else if (source.includes('observer_enabled')) value.observer_enabled = false;
      else if (seat.harness === 'openclaw') { value.oauth_profile_exclusive = true; value.inspection_cli_api_fallback_absent = true; }
      else value.oauth_only = true;
      return json({ exitCode: 0, stdout: JSON.stringify(value), stderr: '' });
    }
    assert.equal(options?.method ?? 'GET', 'GET');
    return json({ id: seat.agent_id, framework: seat.harness, status: awake.has(seat.agent_id) ? 'active' : 'sleeping' });
  };
  const report = await prepareDebugAgents({ config, artifacts, apiKey: 'fixture-credential',
    runtimeDir: path.join(root, 'transition'), fetchImpl, pause: async () => {},
    installer: { install: async artifact => { installed.push(artifact.seat_id); } },
    onWake: async seat => { wakes.push(seat.seat_id); } });
  assert.equal(report.status, 'complete'); assert.equal(report.account_awake, 0);
  assert.equal(installed.length, 10); assert.equal(wakes.length, 10);
  assert.ok(report.seats.every(seat => seat.observer_disabled && seat.native_credentials_oauth_only && seat.sleep_confirmed));
  assert.doesNotMatch(JSON.stringify(report), /fixture-credential/);
});
