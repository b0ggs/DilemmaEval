import { mkdir, readFile, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { configFingerprint } from '../readiness.mjs';
import { REPOSITORY_ROOT } from '../config.mjs';
import { writeProofReport } from '../../../../conference/operations/saved-helpers/proof-dispatch-journal.mjs';

const fail = () => { throw Object.assign(new Error('MARITIME_QUARANTINE_INVALID'), { code: 'MARITIME_QUARANTINE_INVALID' }); };
/** Owned by the single coordinator. Shared operator storage survives fresh attempts. */
export async function createSeatQuarantine({ directory, config, now = Date.now }) {
  if (!path.isAbsolute(directory) || config?.chain_id !== 84532 || typeof now !== 'function') fail();
  const repo = await realpath(REPOSITORY_ROOT);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const root = await realpath(directory), relative = path.relative(repo, root);
  if (relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) fail();
  const filename = path.join(root, 'seat-quarantine.json');
  const scope = configFingerprint({ chain_id: 84532, game_address: config.game_address.toLowerCase(),
    seats: config.roster.map(({ seat_id, agent_id, wallet_address }) => ({ seat_id, agent_id, wallet_address })).sort((a, b) => a.seat_id.localeCompare(b.seat_id)) });
  let state;
  try {
    const metadata = await lstat(filename);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.mode & 0o077 || metadata.size > 1048576) fail();
    state = JSON.parse(await readFile(filename, 'utf8'));
    if (state.schema_version !== 1 || state.scope !== scope || !state.seats || Array.isArray(state.seats) ||
        Object.keys(state).sort().join() !== 'schema_version,scope,seats') fail();
    for (const [id, row] of Object.entries(state.seats)) {
      if (!config.roster.some(seat => seat.seat_id === id && seat.agent_id === row.agent_id) || row.status !== 'unknown' ||
          typeof row.request_id !== 'string' || !Number.isSafeInteger(row.started_at_ms)) fail();
    }
  } catch (error) {
    if (error.code !== 'ENOENT') fail();
    state = { schema_version: 1, scope, seats: {} };
  }
  let writes = Promise.resolve();
  const mutate = fn => {
    const task = writes.then(async () => { fn(); await writeProofReport(filename, state); });
    writes = task;
    return task;
  };
  const seatFor = seat => {
    const expected = config.roster.find(row => row.seat_id === seat?.seat_id && row.agent_id === seat.agent_id);
    if (!expected) fail();
    return expected;
  };
  return Object.freeze({
    async assertAvailable(seat) {
      await writes; seatFor(seat);
      if (state.seats[seat.seat_id]) throw Object.assign(new Error('MARITIME_SEAT_QUARANTINED'),
        { code: 'MARITIME_SEAT_QUARANTINED', ambiguous: false, retryable: false });
    },
    async begin(seat, requestId) {
      seatFor(seat);
      if (typeof requestId !== 'string' || !/^[A-Za-z0-9:._-]{1,256}$/.test(requestId)) fail();
      await mutate(() => {
        if (state.seats[seat.seat_id]) fail();
        state.seats[seat.seat_id] = { agent_id: seat.agent_id, request_id: requestId, status: 'unknown', started_at_ms: now() };
      });
    },
    async complete(seat, requestId) {
      seatFor(seat);
      await mutate(() => {
        if (state.seats[seat.seat_id]?.request_id !== requestId) fail();
        delete state.seats[seat.seat_id];
      });
    },
    /** Explicit reconciliation only: a completed matching operation, or a job
     * end followed by sleep. Nonces and earlier sleep snapshots cannot release. */
    async resolve({ seat, requestId, completedRequestId, jobEndedAtMs, sleepingObservedAtMs, status }) {
      await writes; seatFor(seat);
      const row = state.seats[seat.seat_id];
      if (!row || row.request_id !== requestId || !(completedRequestId === requestId ||
          Number.isSafeInteger(jobEndedAtMs) && jobEndedAtMs >= row.started_at_ms &&
          Number.isSafeInteger(sleepingObservedAtMs) && sleepingObservedAtMs > jobEndedAtMs &&
          sleepingObservedAtMs <= now() && status === 'sleeping')) fail();
      await mutate(() => { delete state.seats[seat.seat_id]; });
    },
    async reservedAgentIds() { await writes; return Object.values(state.seats).map(row => row.agent_id); }
  });
}
