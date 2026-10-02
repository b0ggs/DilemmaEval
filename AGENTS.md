# Conference implementation instructions

## Active scope

- For the conference implementation, work on `codex/converge-demo-2026-09-25`. Start with [current status](conference/CURRENT-STATUS.md), the three remaining milestones in [the canonical checklist](conference/TAKEOVER-IMPLEMENTATION-CHECKLIST.md), and [the current session handoff](conference/NEXT-SESSION.md). Then consult the implementation guide, run-status archive and package interfaces for relevant details.
- These canonical documents govern this build. The original wiki, `PARALLEL-IMPLEMENTATION-PLAN.md`, and older handoffs are historical references, not additional active plans. A new session or compaction does not expand scope or renew authorization.
- Finish one independently audited 5v5 game with the five existing OpenClaw and five existing Hermes agents on Base Sepolia, including correct Telegram results and cleanup. Games 12–14 prove only the three-agent baseline. Continuous operation, hosting, UI expansion and broader hardening are deferred until that proof; they are not additional milestones for this tranche.
- Preserve existing edits and untracked files, including `HANDOFF.md`. Inspect the working tree before changing branches or integrating work; do not reset or clean away another session's work.

## Concurrent development

The user explicitly requests concurrent sub-agents for independent implementation work. Use them when implementing the conference demo; short documentation-only tasks do not require delegation.

The lead first defines the small shared interfaces and gives each worker an exact, non-overlapping file allowlist, its inputs/outputs, and an acceptance check. Then start ready workers concurrently while the lead handles live preflight and integration. Reuse existing code instead of duplicating it in each lane.

Suggested ownership, subject to the actual files present when work starts:

| Owner | Exclusive implementation area | Responsibility |
|---|---|---|
| Runner worker | `integration/conference-runner/src/runner/`, `test/runner/` within that package | Continuous scheduling, durable state, recovery |
| Chain worker | `integration/conference-runner/src/chain/`, `test/chain/` within that package | Chain reads, event accounting, isolated launcher/phase-executor adapters |
| Maritime worker | `integration/conference-runner/src/maritime/`, `test/maritime/` within that package | Roster-driven agent integration, gameplay/discussion protocol, installation tooling |
| Telegram worker | `integration/conference-runner/src/telegram/`, `test/telegram/` within that package | Message mirror, Dealer formatting, delivery recovery |
| Site worker | `conference/site/` | Phone-friendly spectator UI consuming the agreed public state |
| Lead | Shared interfaces/configuration, runner entry point and HTTP API, runner package/lockfiles, existing shared modules, root docs, integration tests | Integration, live operations, verification, run-status updates |

These are proposed paths, not a claim that code or commands already exist. Each worker owns tests inside its assigned area. The site worker may manage its own separate package files. All other paths remain with the lead unless explicitly reassigned.

- Establish the chain snapshot, agent request/response, public spectator state, and adapter signatures before consumers depend on them. Keep this interface pass small; do not turn it into another planning project.
- Workers may read shared files but must request changes through the lead. Do not edit another worker's files, shared schemas, manifests, or lockfiles concurrently.
- In a shared checkout, workers do not switch branches, commit, stash, reset, or clean. The lead coordinates any Git operations. Isolated worktrees are optional, not required for disjoint work.
- Workers report changed files, exports/interfaces, tests run, and unresolved blockers. The lead reviews changes and runs meaningful integration checks before declaring the combined feature complete.
- One lead or explicitly designated operator owns external mutations. Workers develop and test adapters locally; do not let competing workers provision the same agent, fund the same wallet, configure a contract, launch games, or publish messages independently.
- If a dependency blocks a lane, continue independent work and report the concrete missing input. Ask the user only for information or authorization not already available; do not require reconfirmation for routine implementation choices.

## Implementation boundaries

- Base Sepolia (`84532`) only. Reuse the pinned game rules and tooling described in the guide. Refresh live state before configuration; the recorded snapshot is historical evidence.
- Keep secrets out of Git, prompts, public state, and logs. Preserve separate player signing and private commit/reveal material; the coordinator does not invent player choices or dialogue.
- Respect the five-awake account-wide limit, including unrelated awake agents, using the ten existing agents. Do not add agents or paid capacity. The older three-free-slot limit describes a superseded baseline.
- Preserve and reuse applicable authorization from the session. This file does not independently authorize spending, public publishing, deployments, or messages; complete reviewable local work while any required access or permission is outstanding.
- Run targeted tests for each changed component and integration checks at assembly points. Use fixtures for development, clearly labeled; only confirmed live evidence completes the demo checklist.
- Tie every implementation change to one of the three remaining milestones and a demonstrated blocker or an existing acceptance requirement. Use targeted tests during a fix and the documented full suites before its implementation checkpoint; do not rerun unchanged suites for documentation-only handoffs or simply because a new session started. Do not reopen completed fixture work without new evidence of a defect.
- The lead maintains `conference/RUN-STATUS.md` with actual progress, evidence, blockers, and next actions. Continue toward the three canonical milestones; the older guide's broader definition of done must not expand this tranche.

Instruction-file format reference: [official AGENTS.md documentation](https://learn.chatgpt.com/docs/agent-configuration/agents-md).
