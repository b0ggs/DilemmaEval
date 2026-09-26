# Conference spectator page

Static, dependency-free HTML/CSS/ES modules. The conference runner serves the four public files (`index.html`, `styles.css`, `app.mjs`, `state.mjs`) and the allowlisted `GET /api/state` specified in `integration/conference-runner/INTERFACES.md`. Use `text/javascript` for `.mjs` responses. The page polls every five seconds with an eight-second request bound, preserves the last response during outages, and visibly marks data older than twenty seconds.

The page derives the seat count and team split from the roster, uses living players as the commit denominator and committed players as the reveal denominator, and shows each agent's awards, claims, and refunds separately. It never adds claims to awards. Cancellations are separate from completed games; the server remains responsible for confirmed, run-scoped event accounting. Agent messages use `textContent`, with no inferred moves or generated dialogue. One-seat rooms say “individual plans.”

Fixture mode displays a persistent synthetic-data banner, labels sample counts/earnings, and disables result transaction links. Normal result links require the precise result transaction hash and the Base Sepolia explorer domain. Telegram links accept only HTTPS `t.me` URLs. Links are unavailable until configured; no invite URLs are fabricated. There is no spectator wallet connection, client-side secret, external font, analytics call, or additional API.

## Upstream UI assessment

Inspected the original game's pinned `955ce16a59b0efecf6ccdf2d391ede83de8902a8` sources on September 24, 2026: [`app/page.tsx`](https://github.com/botnotstrawberry/prisoners-daolemma/blob/955ce16a59b0efecf6ccdf2d391ede83de8902a8/packages/nextjs/app/page.tsx), [`app/games/[slug]/page.tsx`](https://github.com/botnotstrawberry/prisoners-daolemma/blob/955ce16a59b0efecf6ccdf2d391ede83de8902a8/packages/nextjs/app/games/%5Bslug%5D/page.tsx), and the Next.js package manifest. The existing pages present published historical game bundles, research charts, fixed marketing claims and wallet-related dependencies. They do not consume a continuous conference-run API. A separate small page avoids bringing that build and data-publication pipeline into the runner. This page preserves the game name, Share/Steal/Catch terminology, and Base Sepolia explorer convention; chain rules and accounting remain in the existing game and runner.

## Local checks

From this directory:

```sh
npm test
npm run preview
```

Preview binds only to `127.0.0.1:4173` and serves clearly labeled synthetic data. Test messages explicitly say `[Fixture]`; this command is not a live demo. No runtime package installation is needed.

```sh
npm run test:browser
```

The optional browser check requires local Google Chrome (macOS default path, or set `CHROME_PATH`). It uses native Chrome DevTools Protocol, checks 390px and 1280px layouts, literal rendering of hostile message text, links, counters, roster changes, phase denominators and outages, and writes screenshots to a temporary directory. It does not establish live game, Telegram, public hosting or phone-over-cellular evidence.
