# DilemmaEval handoff

## Goal

Finish the Maritime integration for the already-live Prisoners DAOlemma contracts: one fair OpenClaw-vs-Hermes pilot round, then five-versus-five, with local team logs, external orchestration, and chain-verifiable evidence. Do not rebuild or audit contracts, game rules, ABI/CLI code, or the web app.

## Read first

1. [Decision sheet](prisoners-daolemma-tournament-decisions-v1_0.md)
2. [Final addendum](prisoners-daolemma-plan-review-addendum-final.md)
3. [MASTER guide](wiki/MASTER-IMPLEMENTATION-GUIDE.md)
4. [Parallel plan](PARALLEL-IMPLEMENTATION-PLAN.md)

## Current state

- `main` is clean and matches `origin/main` at `bcc7490`.
- The integration leaves under `integration/` exist and all nine local `npm test` suites pass.
- Game bridge, equal harness adapters, Maritime transport, team logs, orchestrator core, pilot preflight, wallet injection, and the fallback ETH-transfer helper are implemented locally.
- Two Maritime agents are active: `dilemmaeval-pilot-openclaw` (`be7ba7b5-228d-4f09-b557-1257e0dc43ee`) and `dilemmaeval-pilot-hermes` (`e5076595-f1e1-4be9-be5c-dc06f840f934`).
- OpenClaw successfully sent `0.000001 ETH` to Hermes on Base Sepolia: [confirmed transaction](https://sepolia.basescan.org/tx/0x51d9595b7c07603bb97bb643277ca036a569d9939ecfe6f86a93f7abd2c48112).
- That proves the hackathon fallback only; it is not a completed game round.

## Secrets

- Secrets live outside Git under `/Users/wade/.config/dilemmaeval-pilot`; `pilot-secrets-local` is only a gitignored symlink.
- Never print, commit, or place wallet keys/API credentials in prompts or evidence.
- Each disposable player key is injected only into its assigned Maritime agent as masked `GAMEPLAY_WALLET_PRIVATE_KEY`.
- Keep the separate phase-advancer wallet out of all player agents and the general orchestrator.

## Known MVP limitations

- The configured Alchemy RPC returned HTTP 401; the successful demo used `https://sepolia.base.org`.
- Maritime custom-file deployment failed server-side (`AsyncClient` missing `containers`), so OpenClaw created its helper through built-in code execution; Hermes cannot yet send.
- Do not blindly repeat a transfer after an unclear response; reconcile the sender nonce and chain first.
- Before treating the live runner as reusable, finish existing-agent reconciliation, a persistent uncertain-transfer lock, strict masked-env/evidence validation, and verified skill installation for both harnesses.

## Work remaining, in order

1. Record/freeze M00–M03 run configuration, roles, live addresses, and secret boundaries.
2. Run and evidence S01 model parity, S02 game-CLI self-signing, S03 poke/timing, S04 owner configuration, and S05 persistence; S01–S03 are stop gates.
3. Review/accept M04 game kit and M05 equal harness adapters against the pinned game commit `955ce16a59b0efecf6ccdf2d391ede83de8902a8`.
4. Finish M06/M07 pilot wiring: install the pinned game checkout in both agents, register identities, fund under approved ceilings, and prove each agent signs only with its own wallet.
5. Finish M08 team-log integration and M09 always-on orchestrator, including the isolated phase-advancer executor.
6. Run M10: one OpenClaw and one Hermes through a complete real game round and reconcile every transaction with chain truth.
7. Only after M10 passes, provision the other eight seats, complete M06–M08 full-fleet gates, and run M11 five-versus-five.
8. Export M13 evidence and M14 observer/replay output; one complete game plus evidence is the required floor.

Do not add Discord, a new contract, contract auditing, or a stats/dashboard project before the complete evidenced game succeeds.
