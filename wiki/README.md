# DilemmaEval implementation wiki

This wiki turns the historical [decision sheet](../prisoners-daolemma-tournament-decisions-v1_0.md) and approved [Discord replacement](../prisoners-daolemma-discord-replacement.md) into bounded runbooks. The replacement has higher authority and supersedes every Discord-specific decision or instruction in the decision sheet for team chat, observer, replay, and evidence. All unrelated locked decisions remain in force; verified contract behavior and live chain state control gameplay and deployed-state facts.

The hackathon critical path uses two local append-only team logs and the existing orchestrator poke/response cycle. It requires no external chat account, bot, webhook, token, channel, API, or service-rate-limit setup, and its protocol can be tested deterministically from local fixtures before a live game.

## Context-loading rule

For a fresh human or OpenClaw subagent, load only:

1. the [MASTER guide](MASTER-IMPLEMENTATION-GUIDE.md);
2. the active module;
3. the active module's **Read first** links; and
4. the relevant rows of the current run record.

Do not preload the whole wiki. Finish the active page's handoff before moving on.

## Status language

| Label | Meaning |
|---|---|
| **LOCKED** | Decided by the decision sheet as modified by the approved replacement. Change only by an explicit new decision. |
| **OPEN** | The sheet requires a human answer; no answer is implied here. |
| **LIVE-VERIFY** | A source value or candidate must be checked against the current system before use. |
| **RUN-FROZEN** | An operational input selected for one run to satisfy locked requirements; it is not a new canon decision. |
| **OPTIONAL** | May be skipped without losing the one-game floor. |
| **STRETCH** | Attempt only after the floor deliverable remains sound. |
| **CONTRACT-AUTHORITY** | Contract behavior or chain state wins; documentation must not invent or override it. |

Module execution status is `Not started`, `In progress`, `Blocked`, `Passed`, `Failed`, or `Skipped (optional only)`.

## Navigation

- [MASTER implementation guide](MASTER-IMPLEMENTATION-GUIDE.md)
- [Setup and governance](00-start-here/M00-PROJECT-CANON.md)
- [First-hour spikes](10-first-hour-spikes/S01-MODEL-PARITY.md)
- [Build modules](20-build/M04-AGENT-GAME-KIT.md)
- [Pilot and tournament](30-execute/M10-TWO-AGENT-PILOT.md)
- [Evidence and observer](40-observe/M13-EVIDENCE-EXPORT.md)

Compact references:

- [Approved communication replacement](../prisoners-daolemma-discord-replacement.md)
- [Decision coverage](90-reference/DECISION-COVERAGE.md)
- [Glossary](90-reference/GLOSSARY.md)
- [Module template](90-reference/MODULE-TEMPLATE.md)
- [Run and evidence record template](90-reference/RUN-EVIDENCE-RECORD.md)
