import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { flushPublicArtifacts, verifyPublicArtifactIntegrity,
  INSTALL_PUBLIC_ARTIFACT_FLUSH_FAILED } from '../../src/maritime/install.mjs';
import { MaritimeAdapterError } from '../../src/maritime/transport.mjs';

function artifactAt(root) {
  const base = join(root, 'dilemma-conference/hs-1');
  return { persistent_root: root, seat_id: 'hs-1', agent_id: 'fixture-agent', files: [
    { path: join(base, 'code/nested/diagnostics.mjs'), content: 'export const fixture = true;\n' },
    { path: join(base, 'seat.json'), content: '{"fixture":true}\n' }
  ].map(file => ({ ...file, sha256: createHash('sha256').update(file.content).digest('hex') })) };
}

async function materialize(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'conference-artifact-flush-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const artifact = artifactAt(root);
  for (const file of artifact.files) {
    await mkdir(dirname(file.path), { recursive: true });
    await writeFile(file.path, file.content);
  }
  return artifact;
}

async function execute(command) {
  try {
    const { stdout, stderr } = await promisify(execFile)(command[0], command.slice(1), { timeout: 10_000 });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    return { exitCode: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

test('flush persists exact public files and directory ancestry without exposing contents', async t => {
  const artifact = await materialize(t);
  let invoked;
  const result = await flushPublicArtifacts(artifact, command => { invoked = command; return execute(command); });
  assert.deepEqual(result, { schema_version: 1, flushed_file_count: 2 });
  assert.deepEqual(invoked.slice(0, 3), ['node', '--input-type=module', '-e']);
  const payload = JSON.parse(invoked[4]);
  assert.deepEqual(payload.files, artifact.files.map(file => file.path));
  assert.equal(payload.directories.at(-1), artifact.persistent_root);
  assert.ok(payload.directories.every(path => path === artifact.persistent_root || path.startsWith(`${artifact.persistent_root}/`)));
  assert.equal(payload.directories.length, new Set(payload.directories).size);
  for (const file of artifact.files) {
    assert.equal(await readFile(file.path, 'utf8'), file.content);
    assert.equal(invoked.join(' ').includes(file.content), false);
  }
  assert.deepEqual(await verifyPublicArtifactIntegrity(artifact, execute), { schema_version: 1, verified_file_count: 2 });
});

test('flush rejects undeclared private, traversal, duplicate, and mismatched-content paths before exec', async () => {
  const artifact = artifactAt('/opt/data');
  for (const altered of [
    { ...artifact.files[0], path: '/opt/data/dilemma-conference/hs-1/private/bundle.json' },
    { ...artifact.files[0], path: '/opt/data/dilemma-conference/hs-1/code/../private/bundle.json' },
    { ...artifact.files[0], path: '/opt/data/dilemma-conference/hs-1/code/name\n.json' },
    { ...artifact.files[0], content: 'unexpected change' }
  ]) {
    let calls = 0;
    await assert.rejects(flushPublicArtifacts({ ...artifact, files: [altered] }, async () => { calls++; }),
      /INSTALL_ARTIFACT_INVALID/);
    assert.equal(calls, 0);
  }
  await assert.rejects(flushPublicArtifacts({ ...artifact, files: [artifact.files[0], artifact.files[0]] }, execute),
    /INSTALL_ARTIFACT_INVALID/);
  await assert.rejects(flushPublicArtifacts(artifact, null), /INSTALL_FLUSH_EXECUTOR_INVALID/);
});

test('flush rejects file and parent symlinks without returning raw paths or content', async t => {
  for (const targetKind of ['file', 'parent']) {
    const artifact = await materialize(t);
    const file = artifact.files[0];
    const outside = join(artifact.persistent_root, 'unrelated-private');
    await mkdir(outside);
    await writeFile(join(outside, 'diagnostics.mjs'), 'fixture-private-content');
    if (targetKind === 'file') {
      await rm(file.path);
      await symlink(join(outside, 'diagnostics.mjs'), file.path);
    } else {
      await rm(dirname(file.path), { recursive: true });
      await symlink(outside, dirname(file.path));
    }
    await assert.rejects(flushPublicArtifacts(artifact, async command => {
      const response = await execute(command);
      assert.equal(response.exitCode, 1);
      assert.equal(response.stdout, '');
      assert.equal(response.stderr, '');
      return response;
    }), error => error.code === INSTALL_PUBLIC_ARTIFACT_FLUSH_FAILED && error.message === INSTALL_PUBLIC_ARTIFACT_FLUSH_FAILED);
  }
});

test('flush strictly rejects malformed, partial, nonzero, and noisy acknowledgements', async () => {
  const artifact = artifactAt('/opt/data');
  const valid = `${JSON.stringify({ schema_version: 1, flushed_file_count: 2 })}\n`;
  for (const response of [
    null, { exitCode: 1, stdout: valid }, { exitCode: 0, stdout: '' },
    { exitCode: 0, stdout: '{bad-private-output' },
    { exitCode: 0, stdout: '{"schema_version":1,"flushed_file_count":1}\n' },
    { exitCode: 0, stdout: '{"schema_version":1,"flushed_file_count":2,"private":"fixture"}\n' },
    { exitCode: 0, stdout: `${valid}unexpected` }, { exitCode: 0, stdout: valid, stderr: 'private fixture error' }
  ]) {
    await assert.rejects(flushPublicArtifacts(artifact, async () => response),
      error => error.code === INSTALL_PUBLIC_ARTIFACT_FLUSH_FAILED && error.message === INSTALL_PUBLIC_ARTIFACT_FLUSH_FAILED);
  }
  await assert.rejects(flushPublicArtifacts(artifact, async () => { throw new Error('private fixture exception'); }),
    error => error.code === INSTALL_PUBLIC_ARTIFACT_FLUSH_FAILED && error.cause === undefined);
  await assert.rejects(flushPublicArtifacts(artifact, async () => {
    throw new MaritimeAdapterError('MARITIME_TIMEOUT', { ambiguous: true });
  }), error => error.code === INSTALL_PUBLIC_ARTIFACT_FLUSH_FAILED && error.ambiguous === true);
});
