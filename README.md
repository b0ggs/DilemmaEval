# DilemmaEval

Implementation guide for the five-versus-five Prisoners DAOlemma demo: OpenClaw and Hermes agents use the same OpenAI model path, play on Base Sepolia, and exchange off-chain team messages through orchestrator-owned append-only JSONL logs.

Start here:

1. Read the historical [decision sheet](prisoners-daolemma-tournament-decisions-v1_0.md).
2. Read the approved [Discord replacement](prisoners-daolemma-discord-replacement.md), which has higher authority and supersedes every Discord-specific decision or instruction in the decision sheet for team chat, observer, replay, and evidence.
3. Open the [wiki home](wiki/README.md) for the context-loading rule and status legend.
4. Drive the shorter build from the [MASTER implementation guide](wiki/MASTER-IMPLEMENTATION-GUIDE.md).

The replacement removes external chat credentials, bots, channels, APIs, and service setup from the critical path. The guide does not prove current deployments, balances, access, or configuration. It does not contain secrets, contract implementations, or authorization to make external changes.

The replacement's proposed `maritime chat <agent> "<serialized-poke>" --json` example is **LIVE-VERIFY**, not established tooling truth; use only a supported path verified against the installed Maritime version.
