import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const clone = (value) => value === undefined ? undefined : structuredClone(value);

// The runner's process lock provides cross-process exclusion. Within a process,
// sharing a directory also shares its serialization queue, including test stores.
const queues = new Map();
function serialize(directory, task) {
  const pending = (queues.get(directory) ?? Promise.resolve()).then(task);
  const settled = pending.catch(() => {});
  queues.set(directory, settled);
  settled.finally(() => { if (queues.get(directory) === settled) queues.delete(directory); });
  return pending;
}

export async function atomicWrite(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(temporary, file);
    const directory = await fs.open(path.dirname(file), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    await handle?.close();
    await fs.unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
}

export function createDurableStore({ directory }) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) {
    throw new TypeError('Store directory must be absolute.');
  }
  directory = path.resolve(directory);
  const file = path.join(directory, 'records.json');
  async function read() {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    let value;
    try { value = JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return new Map();
      throw new Error('DURABLE_STORE_CORRUPT', { cause: undefined });
    }
    if (value?.schema_version !== 1 || !Array.isArray(value.entries)) throw new Error('DURABLE_STORE_CORRUPT');
    const records = new Map();
    for (const entry of value.entries) {
      if (!entry || typeof entry.key !== 'string' || !entry.key || !Object.hasOwn(entry, 'value') || records.has(entry.key)) {
        throw new Error('DURABLE_STORE_CORRUPT');
      }
      records.set(entry.key, entry.value);
    }
    return records;
  }
  const write = (records) => atomicWrite(file, {
    schema_version: 1,
    entries: [...records].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => ({ key, value }))
  });
  function validKey(key) {
    if (typeof key !== 'string' || !key) throw new TypeError('Store key must be a nonempty string.');
  }
  function jsonValue(value) {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new TypeError('Store values must be JSON values.');
    return JSON.parse(serialized);
  }
  return Object.freeze({
    get(key) {
      validKey(key);
      return serialize(directory, async () => clone((await read()).get(key)));
    },
    putIfAbsent(key, value) {
      validKey(key); value = jsonValue(value);
      return serialize(directory, async () => {
        const records = await read();
        if (records.has(key)) return { inserted: false, value: clone(records.get(key)) };
        records.set(key, value);
        await write(records);
        return { inserted: true, value: clone(value) };
      });
    },
    set(key, value) {
      validKey(key); value = jsonValue(value);
      return serialize(directory, async () => {
        const records = await read();
        records.set(key, value);
        await write(records);
        return clone(value);
      });
    },
    compareAndSet(key, expectedRevision, value) {
      validKey(key); value = jsonValue(value);
      return serialize(directory, async () => {
        const records = await read();
        const current = records.get(key);
        if (!current || !Number.isSafeInteger(current.revision) || current.revision !== expectedRevision) {
          return { updated: false, value: clone(current) };
        }
        records.set(key, value);
        await write(records);
        return { updated: true, value: clone(value) };
      });
    },
    entries(prefix = '') {
      if (typeof prefix !== 'string') throw new TypeError('Store prefix must be a string.');
      return serialize(directory, async () => [...(await read())]
        .filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => ({ key, value: clone(value) })));
    }
  });
}
