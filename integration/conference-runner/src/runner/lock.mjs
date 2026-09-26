import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

function deadOwner(owner) {
  if (!owner || owner.hostname !== os.hostname() || !Number.isSafeInteger(owner.pid) || owner.pid < 1 || typeof owner.token !== 'string') {
    throw new Error('RUNNER_LOCK_UNVERIFIABLE');
  }
  try { process.kill(owner.pid, 0); return false; }
  catch (error) {
    if (error.code === 'ESRCH') return true;
    if (error.code === 'EPERM') return false;
    throw new Error('RUNNER_LOCK_UNVERIFIABLE');
  }
}

export async function acquireRunnerLock(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, 'runner.lock');
  const recoveryFile = `${file}.recovery`;
  const owner = { pid: process.pid, hostname: os.hostname(), token: randomUUID() };
  async function create() {
    const handle = await fs.open(file, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(owner)); await handle.sync(); }
    finally { await handle.close(); }
  }
  try { await create(); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    // A separate exclusive recovery guard prevents two stale-lock removers from
    // deleting a newly acquired lock. An orphaned guard fails closed.
    let recovery;
    try { recovery = await fs.open(recoveryFile, 'wx', 0o600); }
    catch { throw new Error('RUNNER_ALREADY_LOCKED'); }
    try {
      let previous;
      try { previous = JSON.parse(await fs.readFile(file, 'utf8')); }
      catch { throw new Error('RUNNER_LOCK_UNVERIFIABLE'); }
      if (!deadOwner(previous)) throw new Error('RUNNER_ALREADY_LOCKED');
      await fs.unlink(file);
      try { await create(); }
      catch (nextError) {
        if (nextError.code === 'EEXIST') throw new Error('RUNNER_ALREADY_LOCKED');
        throw nextError;
      }
    } finally {
      await recovery.close();
      await fs.unlink(recoveryFile);
    }
  }
  return async () => {
    let current;
    try { current = JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (current.token !== owner.token) throw new Error('RUNNER_LOCK_OWNER_CHANGED');
    await fs.unlink(file);
  };
}
