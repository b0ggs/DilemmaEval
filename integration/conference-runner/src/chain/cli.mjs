#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { Wallet } from 'ethers';
import { createChainReader, makeProvider } from './reader.mjs';
import { createIsolatedSigner } from './signer.mjs';
import { createSignerServer } from './transport.mjs';
import { CONFIG_FIELDS } from './abi.mjs';
import { assertSignerEnvironment } from './guards.mjs';
import { loadConfig } from '../config.mjs';

// All secret values stay in this process's environment; never accept key argv.
async function main() {
  const [command, configPath, directory, argument] = process.argv.slice(2);
  if (!['preflight', 'operator', 'reconcile-operator', 'launcher', 'phase-executor', 'configure-defaults', 'reconcile-launcher', 'reconcile-phase'].includes(command) || !configPath) throw new Error('USAGE: chain/cli.mjs preflight|operator|configure-defaults|reconcile-operator CONFIG [PRIVATE_DIRECTORY] [PORT_OR_DEFAULTS_JSON]');
  const config = await loadConfig(configPath, { allowIncomplete: command === 'preflight' });
  const role = ['phase-executor', 'reconcile-phase'].includes(command) ? 'phase-executor' : ['launcher', 'reconcile-launcher'].includes(command) ? 'launcher' : command === 'preflight' ? 'read-only' : 'operator';
  const secretName = assertSignerEnvironment(role);
  const provider = makeProvider(config.rpc_url);
  if (command === 'preflight') {
    try { process.stdout.write(`${JSON.stringify(await createChainReader({ config, provider }).preflight(), null, 2)}\n`); } finally { provider.destroy(); }
    return;
  }
  if (config.mode !== 'live') throw new Error('LIVE_CONFIG_REQUIRED_FOR_SIGNER');
  if (!/^0x[0-9a-fA-F]{64}$/.test(process.env[secretName] ?? '')) throw new Error('ROLE_PRIVATE_KEY_MISSING');
  const signer = new Wallet(process.env[secretName], provider);
  delete process.env[secretName];
  const service = await createIsolatedSigner({ role, config, provider, signer, directory });
  if (command.startsWith('reconcile-')) {
    try { process.stdout.write(`${JSON.stringify(await service.reconcile(), null, 2)}\n`); } finally { await service.close(); provider.destroy(); }
    return;
  }
  if (command === 'configure-defaults') {
    try {
      const defaults = JSON.parse(await readFile(argument, 'utf8'));
      const before = await createChainReader({ config: { ...config, confirmations: 1 }, provider }).preflight();
      const outcome = await service.configureDefaults({ action_id: `configure:${before.block_number}`, source_block_number: before.block_number, defaults });
      if (!outcome.reference) throw new Error('DEFAULT_CONFIG_NOT_SUBMITTED');
      const receipt = await provider.waitForTransaction(outcome.reference.value, config.confirmations ?? 2, 60_000);
      if (!receipt || receipt.status !== 1) throw new Error('DEFAULT_CONFIG_NOT_CONFIRMED');
      const after = await createChainReader({ config, provider }).preflight();
      if (CONFIG_FIELDS.some((field) => String(defaults[field]) !== after.config[field])) throw new Error('DEFAULT_CONFIG_READBACK_MISMATCH');
      process.stdout.write(`${JSON.stringify({ transaction_hash: outcome.reference.value, before, after }, null, 2)}\n`);
    } finally { await service.close(); provider.destroy(); }
    return;
  }
  const token = process.env.DILEMMA_SIGNER_TOKEN;
  delete process.env.DILEMMA_SIGNER_TOKEN;
  const port = Number(argument ?? (role === 'phase-executor' ? 8792 : 8791));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_PORT');
  const server = createSignerServer({ role, service, token });
  server.listen(port, '127.0.0.1', () => process.stdout.write(`${role} listening on 127.0.0.1:${port}\n`));
  const stop = () => server.close(async () => { await service.close(); provider.destroy(); });
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
main().catch(() => { process.stderr.write('CHAIN_COMMAND_FAILED: inspect configuration, role access, and private transaction journal; provider error details are suppressed.\n'); process.exitCode = 1; });
