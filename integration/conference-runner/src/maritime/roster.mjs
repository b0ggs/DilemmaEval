const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function validateMaritimeRoster(roster, { requireAgentIds = true } = {}) {
  if (!Array.isArray(roster) || roster.length < 2 || roster.length > 20) throw new TypeError('ROSTER_SIZE_INVALID');
  const seats = new Set(), wallets = new Set(), agents = new Set(), names = new Set();
  for (const row of roster) {
    if (!row || !/^(?:oc|hs)-(?:[1-9]|10)$/.test(row.seat_id) || !['openclaw', 'hermes'].includes(row.team) ||
        row.harness !== row.team || !row.seat_id.startsWith(row.team === 'openclaw' ? 'oc-' : 'hs-') ||
        !ADDRESS.test(row.wallet_address) || typeof row.maritime_agent !== 'string' ||
        !AGENT_ID.test(row.maritime_agent) ||
        (requireAgentIds && (typeof row.agent_id !== 'string' || !AGENT_ID.test(row.agent_id))) ||
        (row.agent_id && (typeof row.agent_id !== 'string' || !AGENT_ID.test(row.agent_id)))) {
      throw new TypeError('ROSTER_IDENTITY_INVALID');
    }
    for (const [set, value] of [[seats, row.seat_id], [wallets, row.wallet_address.toLowerCase()], [names, row.maritime_agent], ...(row.agent_id ? [[agents, row.agent_id]] : [])]) {
      if (set.has(value)) throw new TypeError('ROSTER_IDENTITY_DUPLICATE');
      set.add(value);
    }
  }
  return roster;
}

/** Pure planning: never creates, deletes, restarts, or changes any account agent. */
export function reconcileRoster({ roster, agents, maxAgents = 3 }) {
  validateMaritimeRoster(roster, { requireAgentIds: false });
  if (!Array.isArray(agents) || !Number.isInteger(maxAgents) || maxAgents < 1) throw new TypeError('AGENT_INVENTORY_INVALID');
  const seen = new Set();
  for (const agent of agents) {
    if (!agent || typeof agent.id !== 'string' || !AGENT_ID.test(agent.id) || seen.has(agent.id)) throw new TypeError('AGENT_INVENTORY_INVALID');
    seen.add(agent.id);
  }
  const matched = new Set();
  const seats = roster.map(row => {
    const candidates = agents.filter(agent => row.agent_id ? agent.id === row.agent_id :
      (agent.externalId ?? agent.external_id) === row.maritime_agent || agent.name === row.maritime_agent);
    const base = { seat_id: row.seat_id, harness: row.harness, maritime_agent: row.maritime_agent, wallet_address: row.wallet_address };
    if (candidates.length === 0) return { ...base, agent_id: row.agent_id ?? null, status: 'missing', ready: false };
    if (candidates.length !== 1) return { ...base, agent_id: null, status: 'ambiguous-identity', ready: false };
    const agent = candidates[0];
    const externalId = agent.externalId ?? agent.external_id;
    const framework = agent.framework ?? agent.templateId ?? agent.template_id;
    if (matched.has(agent.id) || framework !== row.harness ||
        (externalId && externalId !== row.maritime_agent) || (!externalId && agent.name !== row.maritime_agent)) {
      return { ...base, agent_id: agent.id, status: 'identity-mismatch', ready: false };
    }
    matched.add(agent.id);
    const status = ['active', 'sleeping', 'deploying', 'stopped', 'error'].includes(agent.status) ? agent.status : 'unknown';
    return { ...base, agent_id: agent.id, status, ready: ['active', 'sleeping'].includes(status) };
  });
  const missing = seats.filter(row => row.status === 'missing');
  const available = Math.max(0, maxAgents - agents.length);
  return {
    schema_version: 1, ready: seats.every(row => row.ready), seats,
    account_agent_count: agents.length, budget_agent_count: maxAgents, available_slots: available,
    missing_seat_ids: missing.map(row => row.seat_id),
    provisioning_within_budget: missing.length <= available,
    blockers: [...seats.filter(row => !row.ready).map(row => `${row.seat_id}:${row.status}`),
      ...(missing.length > available ? ['FREE_SLOT_BUDGET_EXCEEDED'] : [])]
  };
}
