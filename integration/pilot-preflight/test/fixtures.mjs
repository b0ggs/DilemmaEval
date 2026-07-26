export function publicManifest(overrides = {}) {
  return {
    schema_version: 1,
    network: "base-sepolia",
    game_id: "two-seat-pilot",
    seats: [
      {
        seat_id: "oc-1",
        team: "openclaw",
        harness: "openclaw",
        maritime_agent: "dilemmaeval-pilot-openclaw",
        wallet_address: "0x1111111111111111111111111111111111111111"
      },
      {
        seat_id: "hs-1",
        team: "hermes",
        harness: "hermes",
        maritime_agent: "dilemmaeval-pilot-hermes",
        wallet_address: "0x2222222222222222222222222222222222222222"
      }
    ],
    ...overrides
  };
}
