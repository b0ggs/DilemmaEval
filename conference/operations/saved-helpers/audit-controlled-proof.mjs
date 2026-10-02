import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeProvider } from '../../../integration/conference-runner/src/chain/reader.mjs';
import { auditControlledProof } from '../../../integration/conference-runner/src/proof-audit.mjs';
import { loadCoordinatorSecrets } from '../../../integration/conference-runner/src/live-secrets.mjs';

export { auditPinnedScoreboards } from '../../../integration/conference-runner/src/telegram/proof-audit.mjs';
import { auditPinnedScoreboards } from '../../../integration/conference-runner/src/telegram/proof-audit.mjs';
const json = async filename => JSON.parse(await readFile(filename, 'utf8'));

async function main() {
  const dir = process.env.PROOF_DIRECTORY, file = process.env.PROOF_EVIDENCE, id = process.env.PROOF_GAME_ID;
  const config = await json(path.join(dir, 'config.json')), report = await json(file), outbox = await json(path.join(dir, 'runtime/telegram/outbox.json'));
  const provider = makeProvider(config.rpc_url);
  try {
    const audit = await auditControlledProof({ config, gameId: id, provider, report, outbox });
    report.audit = audit;
    report.proof_complete = audit.proof_complete;
    if (process.env.PROOF_SCOREBOARD_BINDINGS) {
      try {
        const bindings = await json(process.env.PROOF_SCOREBOARD_BINDINGS);
        const ledger = await json(path.join(bindings.runtimeDir, 'telegram/scoreboard.json'));
        if (!path.isAbsolute(process.env.PROOF_SECRETS_ENV ?? '')) throw new Error('PROOF_SECRETS_PATH_REQUIRED');
        const secrets = await loadCoordinatorSecrets(process.env.PROOF_SECRETS_ENV);
        report.scoreboard_audit = await auditPinnedScoreboards({ config, gameId: id, bindings, ledger, chainAudit: audit, report, provider, token: secrets.TELEGRAM_BOT_TOKEN });
      } catch {
        report.scoreboard_audit = { configured: true, proof_complete: false, game_id: id, issues: ['SCOREBOARD_AUDIT_UNAVAILABLE'] };
      }
      report.proof_complete = audit.proof_complete && report.scoreboard_audit.proof_complete;
    }
    await writeFile(file, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ ...audit, proof_complete: report.proof_complete, ...(report.scoreboard_audit ? { scoreboard_audit: report.scoreboard_audit } : {}) }));
    if (!report.proof_complete) process.exitCode = 2;
  } finally { provider.destroy(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
