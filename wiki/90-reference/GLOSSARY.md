# Glossary

**Navigation:** [Wiki home](../README.md) · [MASTER](../MASTER-IMPLEMENTATION-GUIDE.md)

| Term | Meaning in this guide |
|---|---|
| Agent | One persistent Maritime player running either the OpenClaw or Hermes harness. There are ten separate players. |
| Commit / reveal | Contract-defined player actions. Their exact encoding and validity rules must come from verified contract/tooling truth, not this guide. |
| Contract truth | Verified contract behavior, receipts, events, and state. It is authoritative for the game. |
| Defaulted | An agent missed commit or reveal. The contract scores Share, so silence alone does not eliminate it, but the observer must distinguish this from an intentional Share. |
| Direct OpenAI route | Both harnesses reach OpenAI the same way, without an unmatched intermediary route. Exact endpoint/auth behavior must be verified during S01. |
| Evidence package | Sanitized, immutable references sufficient to reconcile a run: config, seat mapping, timestamps, transaction/event references, chat references, failures, and derived scoring. |
| Floor | One complete five-versus-five game with evidence. |
| Maritime poke | The reliable wake trigger sent by the orchestrator. Discord messages are never wake triggers. |
| Observer | Discord live chat plus replay, and optionally a small pulling stats page. It is not game authority. |
| Orchestrator | Always-on non-agent script that watches, wakes, advances, relays recent chat, and writes observer state without deciding or signing for players. |
| Replay | Presentation of saved real evidence, clearly labeled as replay. |
| Run record | Per-run copy of the reference template containing selected, live-verified, and evidence values—never secret values. |
| Seat | Stable public label mapped to exactly one agent, harness, public wallet address, and team for a run. |
