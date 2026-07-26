---
name: base-sepolia-eth-transfer
description: Send a tightly capped amount of Base Sepolia ETH to a fixed public recipient alias.
---

# Base Sepolia ETH transfer

Use the package API in `src/index.mjs`; do not implement signing or RPC calls
yourself.

Only invoke a transfer when the user supplies exactly:

`Send agent <alias> <amount> ETH`

where `<alias>` is exactly `openclaw-1` or `hermes-1`, or the exact structured
form documented in `README.md`. Restate the alias and amount before invoking
when conversational confirmation is required by the host. Never expose the
resolved private key or RPC credential.

On `RECEIPT_STATE_UNKNOWN`, `SUBMISSION_STATE_UNKNOWN`, or any other
post-submission failure, stop. Report the safe error code and transaction hash
if supplied. Do not retry until an operator independently verifies chain state.
