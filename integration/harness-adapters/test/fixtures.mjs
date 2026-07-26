export function validPoke({
  seatId = "oc-1",
  team = "openclaw",
  phase = "commit",
  ...overrides
} = {}) {
  return {
    request_id: `game-12-round-1-${phase}-${seatId}`,
    game_id: "12",
    round: 1,
    phase,
    seat_id: seatId,
    team,
    chain_state: {
      aliveCount: 10,
      committedCount: phase === "commit" ? 0 : 10
    },
    team_chat: {
      through_sequence: 1,
      messages: [
        {
          schema_version: 1,
          game_id: "12",
          round: 1,
          phase: "commit",
          team,
          seat_id: team === "openclaw" ? "oc-2" : "hs-2",
          sequence: 1,
          received_at: "2026-07-26T18:42:10.000Z",
          request_id: `prior-${team}-message`,
          message: "  Keep this text verbatim.  "
        }
      ]
    },
    requested_action: phase,
    response_schema_version: 1,
    ...overrides
  };
}

export function validResponse(poke, overrides = {}) {
  return {
    schema_version: 1,
    request_id: poke.request_id,
    game_id: poke.game_id,
    round: poke.round,
    phase: poke.phase,
    seat_id: poke.seat_id,
    status: "submitted",
    transaction_hash: `0x${"ab".repeat(32)}`,
    error: null,
    ...overrides
  };
}

export function commandResult(operation, overrides = {}) {
  return {
    schema_version: 1,
    operation,
    command: "yarn",
    args: [`game:${operation}`, "--", "--json"],
    exit_code: 0,
    signal: null,
    stdout: JSON.stringify({ ok: true }),
    stderr: "",
    parsed: { ok: true },
    error: null,
    ...overrides
  };
}

export function createBridgeSpy() {
  const calls = [];
  return {
    calls,
    bridge: {
      async run(operation, options) {
        calls.push({ operation, options });
        return commandResult(operation);
      }
    }
  };
}
