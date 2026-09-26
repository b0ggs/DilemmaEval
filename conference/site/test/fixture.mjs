// Explicitly synthetic UI test data. These are not Maritime messages or chain evidence.
const wallet = suffix => `0x${suffix.repeat(40)}`;
export function createFixture(now = Date.now()) {
  const roster = [
    { seat_id: 'oc-1', team: 'openclaw', harness: 'openclaw', wallet_address: wallet('1') },
    { seat_id: 'oc-2', team: 'openclaw', harness: 'openclaw', wallet_address: wallet('2') },
    { seat_id: 'hs-1', team: 'hermes', harness: 'hermes', wallet_address: wallet('3') },
  ];
  return {
    schema_version: 1, run_id: 'synthetic-interface-fixture', mode: 'fixture', network: 'Base Sepolia', chain_id: 84532,
    updated_at: new Date(now).toISOString(), status: 'playing', next_game_at: null, roster,
    counts: { completed: 12, cancelled: 1 },
    current_game: { game_id: '104', round: 2, phase: 'commit', alive_count: 3, committed_count: 2, revealed_count: 0, clock: { unit: 'block', current: '47246000', deadline: '47246029' } },
    messages: {
      openclaw: [
        { seat_id: 'oc-1', game_id: '104', round: 2, message: '[Fixture] A sample planning message occupies this space. Real agent words will appear in the connected demo.', received_at: new Date(now - 18000).toISOString() },
        { seat_id: 'oc-2', game_id: '104', round: 2, message: '[Fixture] This second seat demonstrates the team conversation layout.', received_at: new Date(now - 9000).toISOString() },
      ],
      hermes: [{ seat_id: 'hs-1', game_id: '104', round: 2, message: '[Fixture] This seat has no teammate. The room shows its individual plans and confirmed Dealer results.', received_at: new Date(now - 12000).toISOString() }],
    },
    earnings: roster.map((seat, i) => ({ seat_id: seat.seat_id, wallet_address: seat.wallet_address, awarded_wei: `${[980, 392, 784][i]}000000000000`, claimed_wei: `${[980, 294, 784][i]}000000000000`, refunded_wei: '100000000000000' })),
    latest_result: {
      game_id: '103', outcome: 'completed', transaction_hash: `0x${'a'.repeat(64)}`, transaction_url: `https://sepolia.basescan.org/tx/0x${'a'.repeat(64)}`,
      choices: [{ wallet_address: roster[0].wallet_address, choice: 'Share', defaulted: false, eliminated: false }, { wallet_address: roster[1].wallet_address, choice: 'Share', defaulted: true, eliminated: false }, { wallet_address: roster[2].wallet_address, choice: 'Steal', defaulted: false, eliminated: false }],
      awards: [{ wallet_address: roster[2].wallet_address, award_wei: '294000000000000' }],
    },
    links: { contract: 'https://sepolia.basescan.org/address/0x42892BEc3d1d926Db25FfB6A144ee363AaE40A1a', telegram: { openclaw: null, hermes: null } },
    health: { ok: true, issues: [] },
  };
}
