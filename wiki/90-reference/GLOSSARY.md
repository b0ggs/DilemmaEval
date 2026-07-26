# Glossary

**Navigation:** [Wiki home](../README.md) · [MASTER](../MASTER-IMPLEMENTATION-GUIDE.md)

| Term | Meaning in this guide |
|---|---|
| Agent | One persistent Maritime player running either the OpenClaw or Hermes harness. There are ten separate players. |
| Commit / reveal | Contract-defined player actions. Their exact encoding and validity rules must come from verified contract/tooling truth, not this guide. |
| Contract truth | Verified contract behavior, receipts, events, and state. It is authoritative for the game. |
| Defaulted | An agent missed commit or reveal. The contract scores Share, so silence alone does not eliminate it, but the observer must distinguish this from an intentional Share. |
| Maritime model route | Both harnesses use the same OpenAI-compatible Maritime proxy endpoint, model, and effective settings. Native `api.openai.com` is excluded because its OpenClaw-specific behavior would create an asymmetry. |
| Accepted/rejected record | Orchestrator evidence stating whether a structured response/message passed validation and, if rejected, why; rejected text never enters a team log. |
| Evidence package | Sanitized, immutable artifacts sufficient to reconcile a run: chain data, config/limits, seat mapping, timestamps, raw team logs, every poke's `through_sequence`, accepted/rejected records, redacted request/response logs, transaction/event references, recovery records, failures, derived scoring, and file hashes. |
| Floor | One complete five-versus-five game with evidence. |
| Maritime poke | The reliable and only wake trigger sent by the orchestrator. A team-log write is not a separate trigger. The final addendum verifies `maritime chat ... --json`; compare the installed command manifest before live use. |
| Observer | A delayed-as-configured presentation of orchestrator/evidence output plus replay, and optionally a small post-floor pulling stats page. It is not game authority. |
| Orchestrator | Always-on non-agent script that watches chain state, wakes agents, constructs bounded chat snapshots, validates responses, appends agent text verbatim, advances from chain conditions, and writes observer state without deciding moves/messages or signing/sending player transactions. |
| Replay | Presentation of saved real evidence, clearly labeled as replay. |
| Request ID | Idempotency key for one seat/game/round/phase request; used to prevent duplicate pokes and message appends. |
| Run record | Per-run copy of the reference template containing selected, live-verified, and evidence values—never secret values. |
| Seat | Stable public label mapped to exactly one agent, harness, public wallet address, and team for a run. |
| Team log | One orchestrator-owned append-only JSONL file for exactly one team and game: `runtime/chat/<game-id>/openclaw.jsonl` or `runtime/chat/<game-id>/hermes.jsonl`. |
| Through sequence | Highest accepted team-log sequence included when a poke snapshot was constructed; evidence uses it with frozen limits to reproduce what the agent could see. |
