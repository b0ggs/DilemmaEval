# DilemmaEval

Implementation guide for the five-versus-five Prisoners DAOlemma demo: OpenClaw and Hermes agents use the same OpenAI model path, play on Base Sepolia, and exchange off-chain team messages through orchestrator-owned append-only JSONL logs.

Start here:

1. Read the historical [decision sheet](prisoners-daolemma-tournament-decisions-v1_0.md).
2. Read the [final implementation-plan addendum](prisoners-daolemma-plan-review-addendum-final.md), which locks the Maritime model route and corrects live-operating assumptions.
3. Read the approved [Discord replacement](prisoners-daolemma-discord-replacement.md), which has higher authority and supersedes every Discord-specific decision or instruction in the decision sheet for team chat, observer, replay, and evidence.
4. Open the [wiki home](wiki/README.md) for the context-loading rule and status legend.
5. Drive the shorter build from the [MASTER implementation guide](wiki/MASTER-IMPLEMENTATION-GUIDE.md).
6. Use the [parallel implementation plan](PARALLEL-IMPLEMENTATION-PLAN.md) for task ownership and integration order.

The replacement removes external chat credentials, bots, channels, APIs, and service setup from the critical path. The guide does not prove current deployments, balances, access, or configuration. It does not contain secrets, contract implementations, or authorization to make external changes.

The addendum verifies `maritime chat <agent> "<serialized-poke>" --json`; still use `maritime guide --json` to detect installed-CLI drift before a live run.

The existing game implementation is reused from
[`botnotstrawberry/prisoners-daolemma`](https://github.com/botnotstrawberry/prisoners-daolemma)
at pinned commit `955ce16a59b0efecf6ccdf2d391ede83de8902a8`. This repository
adds tournament integration around that implementation; it does not rebuild its
contracts, ABI, rules, or gameplay commands.
