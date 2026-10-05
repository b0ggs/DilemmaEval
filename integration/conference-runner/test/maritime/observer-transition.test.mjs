import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildObserverTransitionCommand, buildObserverInspectionCommand } from '../../src/maritime/observer-transition.mjs';

test('disable and restore change only the OpenClaw observer entry and preserve receipt files', async t => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'observer-transition-test-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const settingsPath = path.join(root, 'seat.json'), configPath = path.join(root, 'openclaw.json');
  const config = { agents: { defaults: { model: { primary: 'openai/gpt-6.1-sol' } } }, auth: { profiles: {} },
    plugins: { entries: { 'conference-oauth-observer': { enabled: true }, unrelated: { enabled: true } },
      load: { paths: ['/data/.conference-production-oauth/oc-1/old-scope'] } } };
  await writeFile(settingsPath, JSON.stringify({ seat_id: 'oc-1', openclaw_config_path: configPath }));
  await writeFile(configPath, JSON.stringify(config));
  await writeFile(configPath + '.observer-transition.tmp', 'preserved interrupted transition');
  await mkdir(path.join(root, 'receipt')); await writeFile(path.join(root, 'receipt', 'old.json'), 'unchanged');
  const artifact = { harness: 'openclaw', gameplay_command: ['node', '/unused/cli', settingsPath] };
  for (const enabled of [false, true]) {
    const command = buildObserverTransitionCommand({ artifact, enabled });
    const result = await promisify(execFile)(command[0], command.slice(1));
    assert.equal(JSON.parse(result.stdout).observer_enabled, enabled);
    const inspection = buildObserverInspectionCommand({ artifact });
    assert.equal(JSON.parse((await promisify(execFile)(inspection[0], inspection.slice(1))).stdout).observer_enabled, enabled);
    const updated = JSON.parse(await readFile(configPath, 'utf8'));
    config.plugins.entries['conference-oauth-observer'].enabled = enabled;
    assert.deepEqual(updated, config);
    assert.equal(await readFile(path.join(root, 'receipt', 'old.json'), 'utf8'), 'unchanged');
    assert.equal(await readFile(configPath + '.observer-transition.tmp', 'utf8'), 'preserved interrupted transition');
  }
});

test('Hermes disable and restore preserve YAML selection and flush the config directory', async t => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'hermes-transition-test-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const settingsPath = path.join(root, 'seat.json'), configPath = path.join(root, 'config.yaml');
  await writeFile(settingsPath, JSON.stringify({ seat_id: 'hs-1', hermes_config_path: configPath }));
  await writeFile(configPath, 'model:\n  default: gpt-6.1-sol\nplugins:\n  enabled: [dilemma-conference-oauth, unrelated]\n');
  await writeFile(configPath + '.observer-transition.tmp', 'preserved interrupted transition');
  const artifact = { harness: 'hermes', gameplay_command: ['node', '/unused/cli', settingsPath] };
  for (const enabled of [false, true]) {
    const command = buildObserverTransitionCommand({ artifact, enabled });
    const source = `import os,sys,json,types,stat,yaml
original=os.lstat;target=sys.argv[2]
def metadata(p,*a,**kw):
 s=original(p,*a,**kw)
 if str(p)==target: return types.SimpleNamespace(st_mode=s.st_mode,st_uid=10000,st_gid=10000)
 return s
os.lstat=metadata
synced=[];sync=os.fsync
def flush(fd):
 synced.append(stat.S_ISDIR(os.fstat(fd).st_mode));sync(fd)
os.fsync=flush
program=sys.argv[1];sys.argv=['-c',sys.argv[3],sys.argv[4]]
exec(program)
assert True in synced,'config directory was not flushed'
c=yaml.safe_load(open(${JSON.stringify(configPath)}).read())
assert c['model']['default']=='gpt-6.1-sol'
assert c['plugins']['enabled']==['dilemma-conference-oauth','unrelated']
assert ('dilemma-conference-oauth' not in c['plugins']['disabled'])==${enabled ? 'True' : 'False'}
`;
    const result = await promisify(execFile)('python3', ['-c', source, command[3], configPath, settingsPath, String(enabled)]);
    assert.equal(JSON.parse(result.stdout).observer_enabled, enabled);
    assert.equal(await readFile(configPath + '.observer-transition.tmp', 'utf8'), 'preserved interrupted transition');
  }
});
