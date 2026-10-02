import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Interface } from 'ethers';
import { auditPinnedScoreboards } from '../../src/telegram/proof-audit.mjs';
import { GAME_ABI } from '../../src/chain/abi.mjs';
import { FROZEN_NETWORK } from '../../../game-bridge/src/index.js';

// Local ABI-encoded chain responses and Telegram readbacks, never live evidence.
const abi = new Interface(GAME_ABI);
const H = n => `0x${n.toString(16).padStart(64, '0')}`;
const hash = text => createHash('sha256').update(text).digest('hex');
const roster = Array.from({ length: 10 }, (_, index) => ({ seat_id: `${index < 5 ? 'oc' : 'hs'}-${index % 5 + 1}`,
  team: index < 5 ? 'openclaw' : 'hermes', wallet_address: `0x${(index + 1).toString(16).padStart(40, '0')}` }));

function fixture() {
  const config = { chain_id: 84532, game_address: FROZEN_NETWORK.game, roster: structuredClone(roster),
    telegram: { openclaw: { chat_id: '-100111' }, hermes: { chat_id: '-100222' } } };
  const bindings = { seriesId: 'ten-seat-fixture', firstGameId: '18', messageIds: { openclaw: 3, hermes: 4 } };
  const scope = { series_id: bindings.seriesId, first_game_id: '18', chain_id: 84532, game_address: config.game_address.toLowerCase(),
    roster: roster.map(seat => ({ wallet: seat.wallet_address, team: seat.team })),
    chats: { openclaw: '-100111', hermes: '-100222' }, message_ids: bindings.messageIds };
  const results = [18, 19, 20].map(game => ({ game_id: String(game), transaction_hash: H(game), result_id: `${H(game)}:0`,
    block_number: String(100 + game), awards: roster.map((seat, index) => ({ wallet: seat.wallet_address, award_wei: String(index + 1) })),
    awards_wei: { openclaw: '15', hermes: '40' }, winner: 'hermes' }));
  const text = 'DilemmaEval · 5 vs 5 · Scoreboard\nOpenClaw 0 — Hermes 3\nCompleted games: 3';
  const ledger = { schema_version: 1, scope, results, rejected_results: [], cancelled: [], defaults: {},
    pins: Object.fromEntries(['openclaw', 'hermes'].map(team => [team, { status: 'sent', text, sent_digest: hash(text), desired_digest: hash(text) }])) };
  const chainAudit = { proof_complete: true, defaulted_count: 0, game_id: '20', result_transaction_hash: H(20), confirmed_block_number: '122' };
  const report = { result: { events: [{ game_id: '20', kind: 'completed', transaction_hash: H(20), log_index: 0, block_number: '120',
    data: { awards: roster.map((seat, index) => ({ wallet_address: seat.wallet_address, award_wei: String(index + 1) })) } }] },
    telegram: { scoreboard: { ok: true, series_id: bindings.seriesId, first_game_id: '18', completed: 3, ties: 0,
      wins: { openclaw: 0, hermes: 3 }, awards_wei: { openclaw: '45', hermes: '120' },
      pins: Object.fromEntries(['openclaw', 'hermes'].map(team => [team, { status: 'sent', message_id: bindings.messageIds[team], chat_id: scope.chats[team] }])) } } };
  const receipts = new Map(results.map(result => [result.transaction_hash, { status: 1, hash: result.transaction_hash,
    to: config.game_address, blockNumber: Number(result.block_number), blockHash: H(Number(result.block_number)),
    logs: [{ ...abi.encodeEventLog(abi.getEvent('GameEnded'), [BigInt(result.game_id), 1, 2, 10, 0]),
      address: config.game_address, index: 0, removed: false }] }]));
  const chain = { players: new Map(results.map(game => [game.game_id, roster.map(seat => seat.wallet_address)])),
    awards: new Map(results.map(game => [game.game_id, new Map(game.awards.map(award => [award.wallet, award.award_wei]))])) };
  const calls = [];
  const provider = {
    getTransactionReceipt: async tx => receipts.get(tx),
    getBlock: async number => ({ number, hash: H(number) }),
    call: async transaction => {
      const { name, args } = abi.parseTransaction(transaction); calls.push({ name, args: [...args], blockTag: transaction.blockTag });
      const game = String(args[0]);
      assert.equal(transaction.to.toLowerCase(), config.game_address.toLowerCase());
      assert.equal(transaction.blockTag, Number(game) + 100);
      if (name === 'playerCount') return abi.encodeFunctionResult(name, [chain.players.get(game).length]);
      if (name === 'playerAt') return abi.encodeFunctionResult(name, [chain.players.get(game)[Number(args[1])]]);
      assert.equal(name, 'previewWinnerClaim');
      const award = BigInt(chain.awards.get(game).get(args[1].toLowerCase()));
      return abi.encodeFunctionResult(name, [award, 0, award, true]);
    },
  };
  const pins = new Map(['openclaw', 'hermes'].map(team => [scope.chats[team], {
    message_id: bindings.messageIds[team], chat: { id: scope.chats[team] }, text,
  }]));
  const requests = [];
  const fetchImpl = async (url, request) => {
    assert.equal(url.split('/').at(-1), 'getChat');
    const body = JSON.parse(request.body); requests.push(body);
    return { status: 200, json: async () => ({ ok: true, result: { id: body.chat_id, pinned_message: pins.get(body.chat_id) } }) };
  };
  return { config, gameId: '20', bindings, ledger, chainAudit, report, provider, token: 'fixture-token', fetchImpl, pins, receipts, chain, calls, requests };
}

test('ten-seat scoreboard audit independently verifies all three canonical rosters/awards and both pins', async () => {
  const f = fixture();
  const audit = await auditPinnedScoreboards(f);
  assert.equal(audit.proof_complete, true, JSON.stringify(audit));
  assert.equal(audit.ledger_verified, true); assert.equal(audit.chain_awards_verified, true); assert.equal(audit.telegram_verified, true);
  assert.equal(audit.pins.length, 2);
  assert.equal(f.calls.filter(call => call.name === 'previewWinnerClaim').length, 30);
  assert.equal(f.calls.filter(call => call.name === 'playerAt').length, 30);
  assert.deepEqual(f.requests, [{ chat_id: '-100111' }, { chat_id: '-100222' }]);
  assert.ok(!JSON.stringify(audit).includes('OpenClaw 0'));
  assert.ok(!JSON.stringify(audit).includes(f.token));
});

test('ten-seat scoreboard audit rejects historical, result, accounting and pin corruption', async t => {
  const cases = [
    ['failed independent proof', f => { f.chainAudit.proof_complete = false; }, 'SCOREBOARD_CANONICAL_PROOF_REQUIRED'],
    ['defaulted current game', f => { f.ledger.defaults['20'] = ['default']; }, 'SCOREBOARD_LEDGER_UNHEALTHY'],
    ['wrong series roster', f => { f.ledger.scope.roster.pop(); }, 'SCOREBOARD_LEDGER_SCOPE_MISMATCH'],
    ['duplicate counted game', f => { f.ledger.results.push(f.ledger.results[0]); }, 'SCOREBOARD_DUPLICATE_RESULTS'],
    ['historical pre-series result', f => { f.ledger.results[0].game_id = '17'; }, 'SCOREBOARD_AWARDS_UNVERIFIED'],
    ['missing award seat', f => { f.ledger.results[0].awards.pop(); }, 'SCOREBOARD_AWARDS_UNVERIFIED'],
    ['wrong sum', f => { f.ledger.results[0].awards_wei.hermes = '41'; }, 'SCOREBOARD_AWARDS_UNVERIFIED'],
    ['wrong winner', f => { f.ledger.results[0].winner = 'openclaw'; }, 'SCOREBOARD_WINNER_UNVERIFIED'],
    ['wrong current transaction', f => { f.chainAudit.result_transaction_hash = H(999); }, 'SCOREBOARD_GAME_RESULT_MISMATCH'],
    ['wrong confirmed awards in both artifacts', f => { f.chain.awards.get('20').set(roster[0].wallet_address, '999'); }, 'SCOREBOARD_CHAIN_AWARDS_MISMATCH'],
    ['wrong earlier confirmed awards', f => { f.chain.awards.get('18').set(roster[0].wallet_address, '999'); }, 'SCOREBOARD_CHAIN_AWARDS_MISMATCH'],
    ['historical unequal roster', f => { f.chain.players.get('18').pop(); }, 'SCOREBOARD_CHAIN_ROSTER_MISMATCH'],
    ['historical foreign roster wallet', f => { f.chain.players.get('18')[9] = `0x${'f'.repeat(40)}`; }, 'SCOREBOARD_CHAIN_ROSTER_MISMATCH'],
    ['reverted historical result', f => { f.receipts.get(H(18)).status = 0; }, 'SCOREBOARD_RESULT_RECEIPT_UNVERIFIED'],
    ['missing historical terminal event', f => { f.receipts.get(H(18)).logs = []; }, 'SCOREBOARD_GAME_RESULT_MISMATCH'],
    ['wrong historical game event', f => { f.receipts.get(H(18)).logs[0] = { ...f.receipts.get(H(18)).logs[0], ...abi.encodeEventLog(abi.getEvent('GameEnded'), [17, 1, 2, 10, 0]) }; }, 'SCOREBOARD_GAME_RESULT_MISMATCH'],
    ['noncanonical historical result', f => { f.receipts.get(H(18)).blockHash = H(999); }, 'SCOREBOARD_RESULT_BLOCK_REORG'],
    ['unconfirmed current result', f => { f.chainAudit.confirmed_block_number = '119'; }, 'SCOREBOARD_RESULT_RECEIPT_UNVERIFIED'],
    ['wrong health totals', f => { f.report.telegram.scoreboard.awards_wei.hermes = '999'; }, 'SCOREBOARD_HEALTH_TOTALS_MISMATCH'],
    ['uncertain pin edit', f => { f.ledger.pins.hermes.status = 'pending'; }, 'SCOREBOARD_PIN_UNDELIVERED'],
    ['tampered pin digest', f => { f.ledger.pins.hermes.text += ' altered'; }, 'SCOREBOARD_PIN_UNDELIVERED'],
    ['wrong pinned message', f => { f.pins.get('-100222').message_id = 99; }, 'SCOREBOARD_PIN_READBACK_MISMATCH'],
    ['wrong pinned chat', f => { f.pins.get('-100222').chat.id = '-100111'; }, 'SCOREBOARD_PIN_READBACK_MISMATCH'],
    ['wrong pinned content', f => { f.pins.get('-100222').text += ' altered'; }, 'SCOREBOARD_PIN_READBACK_MISMATCH'],
    ['missing pin', f => { f.pins.delete('-100222'); }, 'SCOREBOARD_PIN_READBACK_MISMATCH'],
    ['provider failure', f => { f.provider.call = async () => { throw new Error('PRIVATE_PROVIDER_TEXT'); }; }, 'SCOREBOARD_AUDIT_UNAVAILABLE'],
    ['Telegram failure', f => { f.fetchImpl = async () => { throw new Error('PRIVATE_PROVIDER_TEXT'); }; }, 'SCOREBOARD_AUDIT_UNAVAILABLE'],
  ];
  for (const [name, corrupt, issue] of cases) await t.test(name, async () => {
    const f = fixture(); corrupt(f);
    const audit = await auditPinnedScoreboards(f);
    assert.equal(audit.proof_complete, false);
    assert.deepEqual(audit.issues, [issue]);
    assert.ok(!JSON.stringify(audit).includes('PRIVATE_PROVIDER_TEXT'));
    assert.ok(!JSON.stringify(audit).includes(f.token));
  });
});
