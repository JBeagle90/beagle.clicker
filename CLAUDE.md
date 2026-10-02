# beagle.clicker

A small clicker game at https://clicker.beagle.games that its players change. You pat a beagle to earn
bones and buy upgrades. Players spend bones to suggest updates and to vote for them. Every hour the
suggestion with the most bones is built by Claude and goes live, with nobody reviewing it first
(`.github/workflows/hourly-update.yml`). If it's declined, every voter gets their bones back.

No framework and no build tools: plain JavaScript modules in the browser, Azure Functions for the API,
Cosmos DB for storage, all on an Azure Static Web App (like beagle.fit).

## Files

| Path | What it is | Hourly updates |
|---|---|---|
| `web/index.html` | the page: header, beagle, shop, board, patch notes, save | may change |
| `web/*.svg`, `web/robots.txt` | icons and static files, served at the site root | may change / add |
| `src/main.js` | the beagle, bones, shop, notices, save panel; starts everything | may change |
| `src/game.js` | the player's game in the browser: counting between syncs, syncing every 2 s | may change |
| `src/board.js` | suggestion board, countdown, voting, patch notes | may change |
| `src/ui.js`, `src/api.js` | `h()` for building elements, number formats; calling `/api` | may change |
| `src/style.css` | all styles; colour tokens at the top, dark mode follows the device | may change |
| `api/src/game/rules.js` | **the game's numbers**: upgrades, costs, rates, limits. Shared by server and browser (served as `/rules.js`) | may change |
| `api/src/game/sync.js` | how bones grow on the server from pats, time and purchases | may change |
| `api/src/game/index.js` | the game's API: `sync`, `view`, and `actions` (new `POST /api/game/<name>` calls) | may change |
| `docs/GAME.md` | what's in the game now: keep it up to date | may change |
| `dev/test-*.cjs` | tests (not `test-core-*`) | may change / add |
| `api/src/core/` | players, suggestions, voting, the hourly pick, rate limits | **no** |
| `api/src/functions/` | Azure Functions and the Cosmos DB store | **no** |
| `web/staticwebapp.config.json` | routes and security headers (CSP) | **no** |
| `dev/` (everything else), `.github/`, `package.json`, `api/package.json`, `api/host.json`, `CLAUDE.md`, `docs/OPERATIONS.md`, `README.md` | tooling, workflows, setup | **no** |

`dev/guard-rules.cjs` is the exact list, and it also checks the contents of changed files:
- game code (`api/src/game/`) is plain JavaScript: `require("./…")` only, and no `process`, network, timers, `eval` or prototype changes
- page code builds elements with `h()` and `textContent`: no `innerHTML` or other HTML from strings, no outside addresses, no inline scripts or handlers
- tests use only `./t.cjs`, `../api/src/…`, `assert` and `path`

`node dev/guard.mjs` runs it on your changes.

## How the game works

- **The server decides bones.** The browser sends `{ pats, buy }` to `POST /api/sync`. `api/src/game/sync.js` adds the bones (at most 20 pats a second count, and up to 8 hours of income while away) and makes the purchases. The browser keeps counting in between (`src/game.js`) and takes the server's numbers on every sync.
- **A player is one document**, kept by the core. The game owns these fields on it: `bones`, `earned`, `pats`, `owned` (upgrade id → count), `syncedAt`, and `game` (a free object for new features, e.g. `game.goldenBones`). New fields need defaults, because old saves don't have them. Never take bones or upgrades away from existing players.
- **New upgrades**: add them to `UPGRADES` in `rules.js`. The shop lists them by itself.
- **New things to do that change the save** (e.g. claiming a reward): add an action to `actions` in `api/src/game/index.js` (see its comment) and call it from the page with `spend("POST", "/game/<name>", body)` from `src/game.js`, which syncs first and takes the new player from the answer. Work things out on the server. The browser can only ask.
- **Only the page** (looks, animation, sounds made in code): `src/` and `web/` alone.
- Everything players typed is shown with text nodes (`h()` string children), never as HTML.

## Commands

- `npm start`: the game with its API at http://127.0.0.1:5190 (`dev/serve.mjs`, data in `dev/.data.json`)
- `npm test`: every `dev/test-*.cjs` (`node dev/run-tests.cjs rules` runs only those whose names contain "rules")
- `node dev/look.mjs [--dark] [--phone] [--pats n] [--click sel] [--eval js] [--full]`: a screenshot of the game as a new player, in `dev/.shots/`, plus the page's console errors
- `node dev/guard.mjs`: is this change allowed in an hourly update?
- `node dev/ops.mjs pick|result|hide`: the hourly update's calls, against the local server by default

## Style

- Plain words in the game, short and friendly. Players are of all ages.
- Match the code around you: small functions, a comment saying what each part is for, no frameworks or packages.
- Light and dark mode, phone width (from 360 px), keyboard focus, and `prefers-reduced-motion` all work.
