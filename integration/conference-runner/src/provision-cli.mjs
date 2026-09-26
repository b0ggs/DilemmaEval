#!/usr/bin/env node
import { Maritime } from 'maritime-sdk';
import { loadConfig, validateConfig } from './config.mjs';
import { createConferenceLaunchWorkflow } from './maritime/index.mjs';
import { createPlayerSecretProvider, loadCoordinatorSecrets } from './live-secrets.mjs';

function options(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!/^--[a-z-]+$/.test(argv[index]) || argv[index + 1] === undefined) throw new Error('INVALID_ARGUMENTS');
    result[argv[index].slice(2)] = argv[index + 1];
  }
  return result;
}

function applyRunOverrides(config, args) {
  const next = structuredClone(config);
  if (args['run-id']) next.run_id = args['run-id'];
  if (args['start-block']) next.start_block = args['start-block'];
  if (args['start-time']) next.start_time = args['start-time'];
  if (args['stop-time']) next.stop_time = args['stop-time'];
  return validateConfig(next, { allowIncomplete: true });
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!['plan', 'launch'].includes(command)) {
    throw new Error('USAGE: provision-cli.mjs plan|launch --config FILE --runtime-dir PRIVATE_DIR --secrets-env PRIVATE_ENV [--wallet-directory PRIVATE_DIR] [--run-id ID --start-block N --start-time ISO --stop-time ISO]');
  }
  const args = options(rest);
  if (!args.config || !args['runtime-dir'] || !args['secrets-env']) throw new Error('PROVISION_ARGUMENTS_REQUIRED');
  const config = applyRunOverrides(await loadConfig(args.config, { allowIncomplete: true }), args);
  if (config.mode !== 'live') throw new Error('PROVISION_LIVE_CONFIG_REQUIRED');
  const secrets = await loadCoordinatorSecrets(args['secrets-env']);
  const maritime = new Maritime({ apiKey: secrets.MARITIME_API_KEY, maxRetries: 0, timeout: 120_000 });
  const secretProvider = command === 'launch'
    ? await createPlayerSecretProvider({ config, walletDirectory: args['wallet-directory'] })
    : async () => { throw new Error('PLAYER_SECRET_NOT_AVAILABLE_DURING_PLAN'); };
  const workflow = createConferenceLaunchWorkflow({
    config,
    runtimeDir: args['runtime-dir'],
    maritime,
    apiKey: secrets.MARITIME_API_KEY,
    secretProvider,
    maxAgents: 10,
    oneAwake: true,
    reverifyIncomplete: true
  });
  const result = command === 'plan' ? await workflow.plan() : await workflow.launch();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  const code = error?.code ?? error?.message;
  process.stderr.write(`${typeof code === 'string' && /^[A-Z][A-Z0-9_:.-]{0,100}$/.test(code) ? code : 'MARITIME_PROVISION_COMMAND_FAILED'}\n`);
  process.exitCode = 1;
});
