# Conference implementation

Work on `codex/converge-demo-2026-09-25`. Read [STATUS.md](conference/STATUS.md)
first, then the relevant code. The user approved
[FAST-ITERATION-IMPLEMENTATION-v2.md](conference/FAST-ITERATION-IMPLEMENTATION-v2.md);
it governs conflicts. [IMPLEMENTATION-GUIDE.md](conference/IMPLEMENTATION-GUIDE.md)
is a technical reference, not additional scope.

## Goal and workflow

Finish one 5v5 with the five existing OpenClaw and five existing Hermes agents,
correct Telegram results and cleanup. Implement steps 0–6 of v2. Use the existing
runner with debug/proof purposes; no second engine. The user reviews the existing
`proof-audit` report. Aim for zero defaults; a fallback with defaults is a labeled
“degraded demo,” never a passed proof.

One session owns implementation and live operations. Sub-agents are optional.
Preserve all existing work, private journals, uncertain operations and consumed
fuses. Do not reset or clean. No new plans, handoffs, audit docs or temporary
wrappers. Put progress, blockers, run commands and one line per attempt in
`conference/STATUS.md`; give audit output in chat.

Run targeted tests per fix and commit after secret scanning. Run the full suite
at the steps 3–4 integration checkpoint and before final proof; documentation
commits need no tests. Batch agent-side edits: any `install.mjs` `SOURCE_FILES`
change requires reinstalling all ten before the next game. Do not edit
`execution-permit.mjs` for debug admission.

## Standing live authorization (D1–D4)

The user approved this scope; it persists across sessions and compaction until
revoked. No per-session window or per-attempt reconfirmation:

- At most 10 game creations per America/New_York calendar day and 30 total.
- At most 60 additional wakes per day for diagnostics, observer transitions
  and claims; record counters in STATUS.md.
- Owner/operator gas at most 0.07 ETH per day, excluding player entry fees.
- Existing balances, ten existing agents and existing Telegram rooms only.
- Claims, including Game 20, are authorized when no game is running.
- Ask when a wallet cannot cover another game plus cleanup or a cap is reached.
- If two consecutive debug attempts fail for the same cause after a fix, stop
  and ask about the v2 section 7 fallbacks.

If OC1 per-call provenance is unresolved at final proof, use config-level
OAuth/Sol verification for OpenClaw and disclose: “OpenClaw model verified by
configuration, not per-call receipt.” Do not delay the demo for that choice.
Continuous operation, hosting, UI expansion and broader hardening are deferred.

## Hard limits

- Base Sepolia (84532) only; refresh live state before configuration.
- Account-wide maximum five awake, counting unrelated agents, quarantined seats
  and uncertain lifecycle operations. Check before every wake. No paid capacity,
  new agents or funding.
- Each agent signs its own moves and keeps its own commit/reveal secrets. Never
  invent player choices, dialogue or defaults; defaults come from chain events.
- One signer process per wallet. Never blindly resend uncertain creation,
  signing, lifecycle or Telegram operations; read chain and nonce first.
- Persist quarantine in private state across attempts/restarts. Resolve it only
  after completion, or after the job ends and a subsequent read confirms sleep;
  matching nonces or a sleep snapshot before delayed wake completion do not suffice.
- Verify OAuth/`gpt-6.1-sol`, no reachable metered API key and no fallback on every
  seat before the first debug game; retain gameplay model/route checks.
- Debug Telegram messages all start `[DEBUG]`; no scoreboard bindings, pin edits,
  accepted-proof count changes or automatic award claims.
- No secrets in Git, prompts, logs, Telegram or public state. Run `gitleaks`
  over the complete staged diff before each commit.
- After each attempt advance any active game to terminal using the operator as
  contract deadlines expire. Then confirm account awake 0 and active game 0 with
  fresh reads; log both. If terminal cannot be reached, stop and report it.
  Debug cleanup needs no claims, Telegram reconciliation or process audit.
