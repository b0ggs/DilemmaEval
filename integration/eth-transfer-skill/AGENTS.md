# Agent constraints

- Use this helper only for Base Sepolia (`84532`), never mainnet.
- Accept only the exact text or structured grammar documented in `README.md`.
- Resolve only `openclaw-1` and `hermes-1` through the immutable public alias
  directory.
- Never request, reveal, print, persist, or return `GAMEPLAY_WALLET_PRIVATE_KEY`.
- Never accept a private key as a tool argument; the live adapter reads its
  assigned key from the process environment.
- For custom-file execution, invoke `src/cli.mjs` with the five exact command
  tokens. Never pass environment values on the command line.
- Never bypass the per-transfer maximum, gas reserve, balance, fee, or chain
  checks.
- Never reuse a latched skill instance after ambiguous submission or receipt
  state; an operator must verify chain state before constructing a new one.
- Treat every post-submission error as non-retryable until an operator checks
  the transaction hash, sender nonce, and chain state.
- Do not add automatic retries, batch transfers, arbitrary-address transfers,
  token transfers, bridging, approvals, or contract calls.
