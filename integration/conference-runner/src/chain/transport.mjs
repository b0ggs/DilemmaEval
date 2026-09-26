import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';

const statuses = new Set(['accepted', 'confirmed-revert', 'race-or-revert', 'rejected-before-submit']);
function validateOutcome(value) {
  if (!value || !statuses.has(value.status) || Object.keys(value).some((key) => !['status', 'reference'].includes(key))) throw new Error('INVALID_SIGNER_RESPONSE');
  if (value.reference && (value.reference.kind !== 'transaction-hash' || !/^0x[0-9a-fA-F]{64}$/.test(value.reference.value) || Object.keys(value.reference).length !== 2)) throw new Error('INVALID_SIGNER_REFERENCE');
  return value;
}
function createClient({ url, token, fetchImpl = fetch }, operation) {
  const endpoint = new URL(url);
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !['http:', 'https:'].includes(endpoint.protocol)) throw new Error('INVALID_SIGNER_URL');
  if (endpoint.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) throw new Error('SIGNER_HTTPS_REQUIRED');
  if (typeof token !== 'string' || token.length < 24) throw new Error('SIGNER_TOKEN_REQUIRED');
  return Object.freeze({ [operation]: async (intent) => {
    try {
      const response = await fetchImpl(new URL(`/${operation}`, endpoint), { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(intent), signal: AbortSignal.timeout(20_000), redirect: 'error' });
      if (!response.ok) return { status: 'race-or-revert' };
      return validateOutcome(await response.json());
    } catch { return { status: 'race-or-revert' }; }
  } });
}
export const createLauncherClient = (options) => createClient(options, 'create');
export const createPhaseExecutorClient = (options) => createClient(options, 'advance');

/** Bind locally; use an authenticated TLS proxy if the coordinator is remote. */
export function createSignerServer({ role, service, token }) {
  if (!['operator', 'launcher', 'phase-executor'].includes(role) || typeof token !== 'string' || token.length < 24) throw new Error('INVALID_SIGNER_SERVER_CONFIG');
  const expected = Buffer.from(`Bearer ${token}`);
  const operations = role === 'operator' ? new Map([['/create', 'create'], ['/advance', 'advance']]) : new Map(role === 'launcher' ? [['/create', 'create']] : [['/advance', 'advance']]);
  const server = http.createServer(async (request, response) => {
    const supplied = Buffer.from(request.headers.authorization ?? '');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { response.writeHead(401).end(); return; }
    const operation = operations.get(request.url);
    if (request.method !== 'POST' || !operation) { response.writeHead(404).end(); return; }
    try {
      let body = '';
      for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > 8192) throw new Error('BODY_TOO_LARGE'); }
      const value = validateOutcome(await service[operation](JSON.parse(body)));
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(value));
    } catch {
      // A service exception may follow a broadcast or disk failure. Never imply
      // that retrying is safe merely because the HTTP request failed.
      response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'race-or-revert' }));
    }
  });
  server.requestTimeout = 25_000;
  server.headersTimeout = 10_000;
  return server;
}
