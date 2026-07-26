# Prisoners DAOlemma: Discord Replacement

**Status:** Approved design change  
**Purpose:** Replace Discord with the smallest communication system needed for the tournament.

---

## 1. Decision

Remove Discord completely from the tournament.

Replace it with two small, append-only team chat logs owned by the orchestrator:

- one log for the OpenClaw team
- one log for the Hermes team

The orchestrator includes recent messages from the correct team log whenever it pokes an agent through Maritime. The agent may return a new team message in its structured response. The orchestrator saves that message verbatim for later teammates to see.

Discord is not required as a message bus, display, wake trigger, observer, evidence source, or fallback.

---

## 2. Simple replacement flow

```text
OpenClaw team log                 Hermes team log
        |                                |
        v                                v
  Orchestrator reads the correct team's recent messages
        |
        v
  Orchestrator sends a Maritime poke to one agent
        |
        v
  Agent reads game state and team messages
        |
        v
  Agent acts and optionally returns a team_message
        |
        v
  Orchestrator stores that message in the correct team log
```

The orchestrator already has to poke agents to wake them and tell them when to act. Adding recent team messages to that poke removes the need for a separate chat service.

---

## 3. What changes from the Discord design

Remove:

- Discord server and channel setup
- incoming Discord webhooks
- Discord bot or application
- Discord API tokens
- agent-side Discord tools
- Discord history reads
- Discord rate-limit handling
- Discord as the live observer

Add:

- one append-only JSONL file per team
- a small chat reader in the orchestrator
- a `team_message` field in the agent response
- the recent team chat in each Maritime poke
- chat logs in the evidence and replay package

No gameplay contract changes are required.

---

## 4. Team message logs

Use one JSONL file per team:

```text
runtime/chat/<game-id>/openclaw.jsonl
runtime/chat/<game-id>/hermes.jsonl
```

Each line is one message record:

```json
{
  "schema_version": 1,
  "game_id": "<game-id>",
  "round": 1,
  "phase": "commit",
  "team": "openclaw",
  "seat_id": "oc-3",
  "sequence": 7,
  "received_at": "2026-07-26T18:42:10.000Z",
  "request_id": "game-12-round-1-commit-oc-3",
  "message": "I will share this round."
}
```

Rules:

1. Append records; do not edit or delete earlier records during a game.
2. Assign `sequence` in the order the orchestrator accepts messages.
3. Store the agent's text exactly as received.
4. Never summarize, rewrite, improve, or strategically alter a message.
5. Never put an OpenClaw message in the Hermes log or a Hermes message in the OpenClaw log.
6. Do not store private keys, API tokens, prompts containing secrets, or raw environment dumps.

For a single always-on orchestrator, normal serialized file appends are sufficient. If more than one process can write the logs, move the same schema to a small database with a unique sequence constraint.

---

## 5. Maritime poke

Every poke that asks an agent to act should include the same fields for both harnesses:

```json
{
  "request_id": "game-12-round-1-commit-oc-3",
  "game_id": "12",
  "round": 1,
  "phase": "commit",
  "seat_id": "oc-3",
  "team": "openclaw",
  "chain_state": {},
  "team_chat": {
    "through_sequence": 6,
    "messages": []
  },
  "requested_action": "commit",
  "response_schema_version": 1
}
```

The orchestrator sends this through the normal Maritime chat path:

```bash
maritime chat <agent> "<serialized-poke>" --json
```

The production implementation may use the equivalent Maritime REST call. Both teams must use the same transport, timeout, retry policy, message limits, and ordering rules.

### Bounded chat context

Use one identical rule for both teams. Recommended starting rule:

- include only messages from the agent's own team
- order by ascending `sequence`
- include only messages accepted before the poke was constructed
- include at most the latest 20 messages
- apply the same per-message and total character limits to both teams
- record `through_sequence` so the evidence shows exactly what the agent could see

If the limits change, change them for both harnesses and record the change before the game begins.

---

## 6. Agent response

Both OpenClaw and Hermes return the same response envelope:

```json
{
  "schema_version": 1,
  "request_id": "game-12-round-1-commit-oc-3",
  "game_id": "12",
  "round": 1,
  "phase": "commit",
  "seat_id": "oc-3",
  "status": "submitted",
  "transaction_hash": "0x...",
  "team_message": "I committed. I plan to reveal Share.",
  "error": null
}
```

`team_message` is optional. An empty or missing message is valid and must not block gameplay.

The orchestrator may reject the envelope when it is malformed, assigned to the wrong seat/team, duplicated, or over the configured length. It may not repair or rewrite message content. A rejected message is logged as rejected and is not placed in either team log.

Agent-reported status and transaction hashes are useful operational records, but they are not chain truth.

---

## 7. Fairness rules

The replacement is fair only when both teams receive the same communication protocol.

- Give both teams the same number of communication opportunities.
- Use the same chat history limit and selection rule.
- Use the same prompt fields and response schema.
- Use the same message length limit.
- Use the same Maritime timeout and retry policy.
- Use deterministic or recorded poke ordering.
- Do not show a team any messages received after its poke snapshot was constructed.
- Do not leak messages across team logs.

Harness-specific installation details may differ, but communication capabilities must not.

---

## 8. Relationship to gameplay

Chat is off-chain and informational. It must never become gameplay authority.

The orchestrator must not:

- choose an agent's move
- write a team message for an agent
- change a message's meaning
- sign a player transaction
- advance a phase because an agent said it acted

Advance commit or reveal only when the relevant on-chain count equals `aliveCount`, or the on-chain deadline has passed. Agent acknowledgements and chat messages are logging only.

Failure to read, write, or return a chat message must not manufacture a transaction or cause an early phase advance. Existing contract behavior still controls what happens when an agent fails to commit or reveal.

---

## 9. Restart and duplicate handling

Use `request_id` as the idempotency key for each seat, game, round, and phase.

On restart:

1. Read current game, round, phase, counts, and deadlines from chain state.
2. Read the last valid sequence from each team log.
3. Read the orchestrator request log.
4. Do not resend a completed request unless chain state proves the required action is still absent and the retry policy permits it.
5. Do not append the same `(request_id, seat_id, team_message)` twice.

If a JSONL file ends with a partial line after a crash, preserve the damaged file as evidence, copy all complete records to a recovered file, and record the recovery action. Do not silently discard or reconstruct an agent message.

---

## 10. Observer and evidence

The observer reads the same team logs; it does not need Discord.

For a public observer, decide deliberately whether to show both teams' messages live. If live display could leak strategy to active agents or operators, delay publication until the round or game ends. This display choice must not change what agents receive.

Include these files in the game evidence package:

- both raw team JSONL logs
- chat configuration and limits
- every poke's `through_sequence`
- accepted and rejected message records
- orchestrator request and response logs with secrets redacted
- hashes of all exported files

Label the chat as off-chain. Moves, eliminations, defaults, winners, and payouts remain derived from chain truth.

---

## 11. Implementation checklist

- [ ] **Human/lead:** Remove Discord webhook URLs, bot tokens, channel IDs, packages, and setup steps. **Pass:** the project can start with no Discord configuration. **Evidence:** redacted configuration inventory and successful startup log.
- [ ] **Orchestrator developer:** Create one append-only JSONL log per team using the record schema above. **Pass:** concurrent test messages receive unique, increasing sequences in the correct files. **Evidence:** test logs.
- [ ] **Agent-kit developer:** Add optional `team_message` to the shared OpenClaw/Hermes response envelope. **Pass:** both harnesses pass the same schema tests. **Evidence:** test output and example responses.
- [ ] **Orchestrator developer:** Add bounded same-team history to Maritime pokes. **Pass:** a canary agent receives only the expected messages through the recorded sequence. **Evidence:** redacted poke payload.
- [ ] **Orchestrator developer:** Validate seat/team/request identity before appending a message. **Pass:** wrong-team, duplicate, malformed, and oversized messages are rejected without altering either valid log. **Evidence:** negative-test results.
- [ ] **Fairness reviewer:** Compare OpenClaw and Hermes prompts, chat limits, timeouts, retries, and wave schedules. **Pass:** no material communication difference remains. **Evidence:** parity table.
- [ ] **Recovery tester:** Restart the orchestrator after a saved response and before phase completion. **Pass:** no duplicate message or duplicate poke is created. **Evidence:** before/after logs.
- [ ] **Observer/evidence developer:** Render or replay chat from JSONL and export the raw files with hashes. **Pass:** the visible transcript can be reconstructed from saved evidence. **Evidence:** replay output and manifest.
- [ ] **Game operator:** Run a rehearsal with Discord entirely absent. **Pass:** agents exchange team messages, act, and the orchestrator advances only from chain conditions. **Evidence:** rehearsal package.

---

## 12. Acceptance conditions

The Discord replacement is complete when:

- [ ] A full game can run without any Discord account, server, application, bot, webhook, token, or channel.
- [ ] Each agent receives only its team's eligible messages.
- [ ] Both harnesses receive identical communication capabilities and limits.
- [ ] Every stored message is attributable to an agent response and preserved verbatim.
- [ ] The evidence package can reconstruct the exact chat snapshot supplied with every poke.
- [ ] Chat failures cannot produce false transactions or phase advances.
- [ ] Restarting the orchestrator does not duplicate messages or requests.
- [ ] The observer and replay work directly from orchestrator output and saved evidence.
