# DilemmaEval integration

This directory contains the thin tournament integration around the pinned
`botnotstrawberry/prisoners-daolemma` game implementation.

## Source boundary

- Required revision: `955ce16a59b0efecf6ccdf2d391ede83de8902a8`
- Runtime acquisition: an exact checkout supplied through
  `DILEMMA_GAME_REPO`; the bridge must verify the checkout revision before use.
- Network: Base Sepolia only.
- Forbidden: Base mainnet configuration, mainnet keys/assets, reimplemented
  ABI calls, game rules, contracts, or gameplay commands.

See [`shared/runtime-source.json`](shared/runtime-source.json) for the
machine-readable frozen values.

## Module ownership

- `game-bridge/`: executor/parser for the pinned game's existing commands.
- `team-logs/`: pure local append-only team-log implementation.
- `maritime-transport/`: Maritime configuration and poke/response transport.
- `shared/schemas/`: lead-owned cross-module JSON Schemas.

Each leaf module owns its tests and package metadata. Leaf modules must not
modify another leaf or the shared schemas.
