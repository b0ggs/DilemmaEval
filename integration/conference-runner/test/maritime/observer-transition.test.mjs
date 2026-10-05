import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildObserverTransitionCommand } from '../../src/maritime/observer-transition.mjs';

test('disable and restore change only the OpenClaw observer entry and preserve receipt files', async t => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'observer-transition-test-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const settingsPath = path.join(root, 'seat.json'), configPath = path.join(root, 'openclaw.json');
  const config = { agents: { defaults: { model: { primary: 'openai/gpt-6.1-sol' } } }, auth: { profiles: {} },
    plugins: { entries: { 'conference-oauth-observer': { enabled: true }, unrelated: { enabled: true } },
      load: { paths: ['/data/.conference-production-oauth/oc-1/old-scope'] } } };
  await writeFile(settingsPath, JSON.stringify({ seat_id: 'oc-1', openclaw_config_path: configPath }));
  await writeFile(configPath, JSON.stringify(config));
  await mkdir(path.join(root, 'receipt')); await writeFile(path.join(root, 'receipt', 'old.json'), 'unchanged');
  const artifact = { harness: 'openclaw', gameplay_command: ['node', '/unused/cli', settingsPath] };
  for (const enabled of [false, true]) {
    const command = buildObserverTransitionCommand({ artifact, enabled });
    const result = await promisify(execFile)(command[0], command.slice(1));
    assert.equal(JSON.parse(result.stdout).observer_enabled, enabled);
    const updated = JSON.parse(await readFile(configPath, 'utf8'));
    config.plugins.entries['conference-oauth-observer'].enabled = enabled;
    assert.deepEqual(updated, config);
    assert.equal(await readFile(path.join(root, 'receipt', 'old.json'), 'utf8'), 'unchanged');
  }
});
