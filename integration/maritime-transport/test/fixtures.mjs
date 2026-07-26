export function validPoke(overrides = {}) {
  return {
    request_id: "req-001",
    game_id: "game-42",
    round: 2,
    phase: "commit",
    seat_id: "oc-1",
    team: "openclaw",
    chain_state: {
      aliveCount: 10,
      committedCount: 3,
      deadlineBlock: 123456
    },
    team_chat: {
      through_sequence: 1,
      messages: [
        {
          schema_version: 1,
          game_id: "game-42",
          round: 2,
          phase: "commit",
          team: "openclaw",
          seat_id: "oc-2",
          sequence: 1,
          received_at: "2026-07-26T12:00:00.000Z",
          request_id: "req-prior",
          message: "  Keep punctuation, whitespace, and emoji 🐚 exactly.  "
        }
      ]
    },
    requested_action: "commit",
    response_schema_version: 1,
    ...overrides
  };
}

export function validResponse(poke = validPoke(), overrides = {}) {
  return {
    schema_version: 1,
    request_id: poke.request_id,
    game_id: poke.game_id,
    round: poke.round,
    phase: poke.phase,
    seat_id: poke.seat_id,
    status: "submitted",
    transaction_hash: `0x${"ab".repeat(32)}`,
    ...overrides
  };
}
