import { FROZEN_NETWORK } from '../../../game-bridge/src/index.js';

export const roster = [
  { seat_id: 'oc-1', team: 'openclaw', harness: 'openclaw', agent_id: 'agent-openclaw-1', maritime_agent: 'dilemmaeval-pilot-openclaw', wallet_address: `0x${'1'.repeat(40)}`, cause_id: 1 },
  { seat_id: 'oc-2', team: 'openclaw', harness: 'openclaw', agent_id: 'agent-openclaw-2', maritime_agent: 'dilemmaeval-conference-openclaw-2', wallet_address: `0x${'2'.repeat(40)}`, cause_id: 1 },
  { seat_id: 'hs-1', team: 'hermes', harness: 'hermes', agent_id: 'agent-hermes-1', maritime_agent: 'dilemmaeval-pilot-hermes', wallet_address: `0x${'3'.repeat(40)}`, cause_id: 2 }
];
export const config = { schema_version: 1, run_id: 'conference-fixture', mode: 'fixture', chain_id: 84532,
  game_address: FROZEN_NETWORK.game, rpc_url: 'https://sepolia.base.org', roster };
export const operations = { schema_version: 1, network: 'base-sepolia', chain_id: 84532,
  phase_advancer: { role: 'phase-advancer', wallet_address: `0x${'4'.repeat(40)}`, is_player_seat: false, erc8004_registered: false }, gas_ceiling_wei: '1000000000000000' };
export const inventory = roster.map(row => ({ id: row.agent_id, name: row.maritime_agent, framework: row.harness, status: 'active' }));

export function poke(phase = 'commit', row = roster[0]) {
  return { request_id: `fixture:${row.seat_id}:${phase}`, game_id: '7', round: 1, phase,
    seat_id: row.seat_id, team: row.team, chain_state: { phase, block_number: '99' },
    team_chat: { through_sequence: 0, messages: [] }, requested_action: phase, response_schema_version: 1 };
}
export function discussion(row = roster[0]) {
  const { requested_action, response_schema_version, ...rest } = poke('commit', row);
  return { schema_version: 1, type: 'discussion', ...rest, request_id: `discussion:${row.seat_id}`, max_message_chars: 200 };
}
export function reply(request, extra = {}) {
  return { schema_version: 1, request_id: request.request_id, game_id: request.game_id,
    round: request.round, phase: request.phase, seat_id: request.seat_id, status: 'observed', ...extra };
}
export function discussionReply(request, extra = {}) {
  return { ...reply(request), type: 'discussion-response', team: request.team, ...extra };
}
export const jsonResponse = data => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
