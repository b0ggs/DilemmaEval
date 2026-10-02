import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { validateRuntimeDiagnosticRequest, validateRuntimeDiagnosticResponse } from './protocol.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const invalid = () => { throw new Error('PLAYER_DIAGNOSTIC_RECEIPT_INVALID'); };

export function diagnosticReceiptPath(settings, request) {
  validateRuntimeDiagnosticRequest(request);
  const base = dirname(settings.state_directory ?? '');
  if (!isAbsolute(base) || resolve(base) !== base || request.seat_id !== settings.seat_id ||
      settings.state_directory !== join(base, 'private')) invalid();
  return join(base, 'diagnostic-receipts', `${digest(request.request_id)}.json`);
}

/** Public diagnostic evidence only. Never hash/persist the stdin envelope: it
 * can contain a choice. This namespace is separate from gameplay state. */
export async function writeDiagnosticReceipt(settings, request, response) {
  validateRuntimeDiagnosticResponse(response, request);
  const path = diagnosticReceiptPath(settings, request), directory = dirname(path), base = dirname(directory);
  if (await realpath(base) !== base) invalid();
  try { await mkdir(directory, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(directory) !== directory ||
      (metadata.mode & 0o077) !== 0) invalid();
  const value = { schema_version: 1, type: 'runtime-diagnostic-receipt', request_sha256: digest(request), response };
  let handle;
  try {
    // A stable request id can produce at most one successful receipt. A crash
    // leaves an incomplete file that is rejected, never silently overwritten.
    handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(`${JSON.stringify(value)}\n`); await handle.sync();
  } finally { await handle?.close(); }
  for (const target of [directory,base]) {
    const directoryHandle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  }
  return value;
}

export function validateDiagnosticReceipt(value, request, response) {
  validateRuntimeDiagnosticResponse(response, request);
  if (!value || Object.keys(value).sort().join('\0') !== ['schema_version','type','request_sha256','response'].sort().join('\0') ||
      value.schema_version !== 1 || value.type !== 'runtime-diagnostic-receipt' || value.request_sha256 !== digest(request)) invalid();
  validateRuntimeDiagnosticResponse(value.response, request);
  if (digest(value.response) !== digest(response)) invalid();
  return value;
}

/** Reads exactly one known public receipt; never opens a private directory. */
export function buildDiagnosticReceiptReadCommand(artifact, request) {
  const base = dirname(artifact.gameplay_command[2]);
  const file = diagnosticReceiptPath({ seat_id: artifact.seat_id, state_directory: join(base,'private') },request);
  return ['node','--input-type=module','-e',`
import { constants } from 'node:fs';
import { open, realpath, lstat } from 'node:fs/promises';
import { dirname } from 'node:path';
let handle;
try {
 const path=process.argv[1];
 const parent=await lstat(dirname(path));
 if(!parent.isDirectory()||parent.isSymbolicLink()||await realpath(dirname(path))!==dirname(path))throw new Error();
 handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 const stat=await handle.stat();
 if(!stat.isFile()||stat.nlink!==1||stat.size>16384||(stat.mode&0o077)!==0)throw new Error();
 process.stdout.write(await handle.readFile('utf8'));
} catch { process.exitCode=1; } finally { await handle?.close(); }
`,file];
}
