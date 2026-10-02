import { createHash } from 'node:crypto';
import { Contract, Interface } from 'ethers';
import { GAME_ABI } from '../chain/abi.mjs';

const teams = ['openclaw', 'hermes'];
const integer = /^(0|[1-9][0-9]*)$/;
const abi = new Interface(GAME_ABI);
const hash = text => createHash('sha256').update(text).digest('hex');
class ScoreboardAuditError extends Error {}
function requireEvidence(condition, code) { if (!condition) throw new ScoreboardAuditError(code); }

// Read-only API call; timeout also covers response-body reading. Provider errors stay private.
async function pinnedMessage({ token, chatId, fetchImpl }) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchImpl(`https://api.telegram.org/bot${token}/getChat`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId }), redirect: 'error', signal: controller.signal,
        });
        const payload = await response.json();
        requireEvidence(response.status === 200 && payload?.ok === true && String(payload.result?.id) === chatId, 'SCOREBOARD_CHAT_UNVERIFIED');
        return payload.result.pinned_message;
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new ScoreboardAuditError('SCOREBOARD_READBACK_UNAVAILABLE')); }, 10000); }),
    ]);
  } finally { clearTimeout(timer); }
}

/** Local injection supports fixture verification; output never contains message text or credentials. */
export async function auditPinnedScoreboards({ config, gameId, bindings, ledger, chainAudit, report, provider, token, fetchImpl = globalThis.fetch }) {
  const result = { schema_version: 1, configured: true, proof_complete: false, ledger_verified: false, chain_awards_verified: false, telegram_verified: false,
    game_id: typeof gameId === 'string' && /^[1-9][0-9]*$/.test(gameId) ? gameId : null,
    series_id: /^[a-zA-Z0-9_-]{1,100}$/.test(bindings?.seriesId ?? '') ? bindings.seriesId : null,
    result_transaction_hash: null, pins: [], issues: [] };
  try {
    requireEvidence(chainAudit?.proof_complete === true && chainAudit.defaulted_count === 0 && chainAudit.game_id === gameId, 'SCOREBOARD_CANONICAL_PROOF_REQUIRED');
    requireEvidence(result.game_id && result.series_id && config?.chain_id === 84532 &&
      integer.test(String(bindings.firstGameId)) && BigInt(gameId) >= BigInt(bindings.firstGameId), 'SCOREBOARD_BINDINGS_INVALID');
    const expectedRoster = config.roster.map(seat => ({ wallet: seat.wallet_address.toLowerCase(), team: seat.team })).sort((a, b) => a.wallet.localeCompare(b.wallet));
    const scope = ledger?.scope;
    requireEvidence(ledger?.schema_version === 1 && scope?.series_id === bindings.seriesId && scope.first_game_id === String(bindings.firstGameId) && scope.chain_id === 84532 && scope.game_address === config.game_address.toLowerCase() && JSON.stringify(scope.roster) === JSON.stringify(expectedRoster), 'SCOREBOARD_LEDGER_SCOPE_MISMATCH');
    requireEvidence(teams.every(team => scope.chats?.[team] === String(config.telegram?.[team]?.chat_id) && scope.message_ids?.[team] === bindings.messageIds?.[team] && Number.isSafeInteger(bindings.messageIds?.[team]) && bindings.messageIds[team] > 0) && scope.chats.openclaw !== scope.chats.hermes, 'SCOREBOARD_LEDGER_SCOPE_MISMATCH');
    requireEvidence(Array.isArray(ledger.results) && Array.isArray(ledger.rejected_results) && ledger.rejected_results.length === 0 && !(ledger.defaults?.[gameId]?.length), 'SCOREBOARD_LEDGER_UNHEALTHY');
    requireEvidence(new Set(ledger.results.map(item => item.game_id)).size === ledger.results.length && new Set(ledger.results.map(item => item.result_id)).size === ledger.results.length, 'SCOREBOARD_DUPLICATE_RESULTS');
    const game = ledger.results.find(item => item.game_id === gameId);
    const event = report?.result?.events?.find(item => item.kind === 'completed' && item.game_id === gameId);
    requireEvidence(game && event && game.transaction_hash === chainAudit.result_transaction_hash && game.transaction_hash === event.transaction_hash?.toLowerCase() && game.result_id === `${game.transaction_hash}:${event.log_index}` && game.block_number === event.block_number, 'SCOREBOARD_GAME_RESULT_MISMATCH');
    const health = report.telegram?.scoreboard;
    requireEvidence(health?.ok === true && health.series_id === bindings.seriesId && health.first_game_id === String(bindings.firstGameId), 'SCOREBOARD_HEALTH_UNVERIFIED');
    const cumulative = { openclaw: 0n, hermes: 0n }, wins = { openclaw: 0, hermes: 0 };
    let ties = 0;
    for (const applied of ledger.results) {
      requireEvidence(integer.test(applied.game_id) && BigInt(applied.game_id) >= BigInt(bindings.firstGameId) && Array.isArray(applied.awards) && applied.awards.length === expectedRoster.length, 'SCOREBOARD_AWARDS_UNVERIFIED');
      const awards = [...applied.awards].sort((a, b) => a.wallet.localeCompare(b.wallet));
      requireEvidence(awards.every((award, index) => award.wallet === expectedRoster[index].wallet && typeof award.award_wei === 'string' && integer.test(award.award_wei)), 'SCOREBOARD_AWARDS_UNVERIFIED');
      const summed = { openclaw: 0n, hermes: 0n };
      awards.forEach((award, index) => { summed[expectedRoster[index].team] += BigInt(award.award_wei); });
      requireEvidence(teams.every(team => applied.awards_wei?.[team] === summed[team].toString()), 'SCOREBOARD_AWARDS_UNVERIFIED');
      const winner = summed.openclaw === summed.hermes ? 'tie' : summed.openclaw > summed.hermes ? 'openclaw' : 'hermes';
      requireEvidence(applied.winner === winner, 'SCOREBOARD_WINNER_UNVERIFIED');
      if (winner === 'tie') ties++; else wins[winner]++;
      teams.forEach(team => { cumulative[team] += summed[team]; });
    }
    const eventAwards = event.data?.awards?.map(item => ({ wallet: item.wallet_address.toLowerCase(), award_wei: item.award_wei })).sort((a, b) => a.wallet.localeCompare(b.wallet));
    requireEvidence(JSON.stringify(game.awards) === JSON.stringify(eventAwards), 'SCOREBOARD_GAME_AWARDS_MISMATCH');
    // Recheck every counted result, including earlier games in the series. Matching
    // local report/ledger totals cannot establish canonical awards or equal rosters.
    const contract = new Contract(config.game_address, GAME_ABI, provider);
    for (const applied of ledger.results) {
      const receipt = await provider.getTransactionReceipt(applied.transaction_hash);
      requireEvidence(receipt?.status === 1 && receipt.hash?.toLowerCase() === applied.transaction_hash && receipt.to?.toLowerCase() === config.game_address.toLowerCase() && Number.isSafeInteger(receipt.blockNumber) && String(receipt.blockNumber) === applied.block_number && /^0x[0-9a-fA-F]{64}$/.test(receipt.blockHash ?? '') && integer.test(chainAudit.confirmed_block_number ?? '') && BigInt(receipt.blockNumber) <= BigInt(chainAudit.confirmed_block_number), 'SCOREBOARD_RESULT_RECEIPT_UNVERIFIED');
      const canonicalBlock = async () => {
        const block = await provider.getBlock(receipt.blockNumber);
        requireEvidence(block?.number === receipt.blockNumber && block.hash?.toLowerCase() === receipt.blockHash.toLowerCase(), 'SCOREBOARD_RESULT_BLOCK_REORG');
      };
      await canonicalBlock();
      const terminal = (receipt.logs ?? []).filter(log => {
        if (log.address?.toLowerCase() !== config.game_address.toLowerCase() || log.removed ||
            `${receipt.hash.toLowerCase()}:${log.index}` !== applied.result_id) return false;
        const event = abi.parseLog(log);
        return event?.name === 'GameEnded' && String(event.args.gameId) === applied.game_id && [1, 2].includes(Number(event.args.outcome));
      });
      requireEvidence(terminal.length === 1, 'SCOREBOARD_GAME_RESULT_MISMATCH');
      const blockTag = receipt.blockNumber;
      const count = await contract.playerCount(applied.game_id, { blockTag });
      requireEvidence(count === BigInt(expectedRoster.length), 'SCOREBOARD_CHAIN_ROSTER_MISMATCH');
      const wallets = (await Promise.all(expectedRoster.map((_, index) => contract.playerAt(applied.game_id, index, { blockTag })))).map(wallet => wallet.toLowerCase()).sort();
      requireEvidence(wallets.every((wallet, index) => wallet === expectedRoster[index].wallet), 'SCOREBOARD_CHAIN_ROSTER_MISMATCH');
      const claims = await Promise.all(applied.awards.map(award => contract.previewWinnerClaim(applied.game_id, award.wallet, { blockTag })));
      requireEvidence(claims.every((claim, index) => claim.netPrizeWei.toString() === applied.awards[index].award_wei), 'SCOREBOARD_CHAIN_AWARDS_MISMATCH');
      await canonicalBlock();
    }
    result.chain_awards_verified = true;
    requireEvidence(health.completed === ledger.results.length && health.ties === ties && teams.every(team => health.wins?.[team] === wins[team] && health.awards_wei?.[team] === cumulative[team].toString()), 'SCOREBOARD_HEALTH_TOTALS_MISMATCH');
    requireEvidence(teams.every(team => {
      const pin = ledger.pins?.[team];
      return pin?.status === 'sent' && typeof pin.text === 'string' && pin.sent_digest === hash(pin.text) && pin.desired_digest === pin.sent_digest && health.pins?.[team]?.status === 'sent' && health.pins[team].message_id === bindings.messageIds[team] && health.pins[team].chat_id === scope.chats[team];
    }), 'SCOREBOARD_PIN_UNDELIVERED');
    result.ledger_verified = true;
    result.result_transaction_hash = game.transaction_hash;
    requireEvidence(typeof token === 'string' && token.length > 0, 'SCOREBOARD_TOKEN_UNAVAILABLE');
    for (const team of teams) {
      const actual = await pinnedMessage({ token, chatId: scope.chats[team], fetchImpl });
      requireEvidence(actual?.message_id === bindings.messageIds[team] && String(actual.chat?.id) === scope.chats[team] && actual.text === ledger.pins[team].text, 'SCOREBOARD_PIN_READBACK_MISMATCH');
      result.pins.push({ team, chat_id: scope.chats[team], message_id: actual.message_id, text_sha256: hash(actual.text), verified_at: new Date().toISOString() });
    }
    result.telegram_verified = result.proof_complete = true;
  } catch (error) {
    result.issues.push(error instanceof ScoreboardAuditError ? error.message : 'SCOREBOARD_AUDIT_UNAVAILABLE');
  }
  return result;
}
