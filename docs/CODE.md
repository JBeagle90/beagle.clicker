# The game's code: a guide for the next update

Kept by every update, for the next one. Keep it true, short (under 16 KB) and useful. Fix what's wrong,
add what you wish you'd known, and cut what no longer helps. The rules are in CLAUDE.md, not here.

## Map

| File | What's in it |
|---|---|
| `api/src/game/rules.js` | **The game's numbers**: `UPGRADES` (id, name, icon, desc, cost, growth, perClick, perSecond), `MAX_PATS_PER_SECOND`, `OFFLINE_HOURS`, `SUGGEST_COST`, `VOTE_AMOUNTS`; `cost(id, owned)`, `perClick(owned)`, `perSecond(owned)`. One file for the server and the browser (served as `/rules.js`, `window.RULES`), written so both can load it: plain JS, no imports. |
| `api/src/game/sync.js` | `sync(player, { pats, buy }, now)` → the new saved game: caps pats, adds pats × perClick and time × perSecond, makes purchases in order. `view(player)` → what the browser is told. |
| `api/src/game/index.js` | Exports `R`, `sync`, `view` and `actions` (none yet): `POST /api/game/<name>` calls (see the comment there). |
| `src/main.js` | The beagle button (pats, the "+N" floaters, the boop animation), the bones counter and rates, the shop (built from `UPGRADES`), notices (offline, "a new update landed"), the save panel. The wagging tail (`wag.joy` 0–1, raised by each pat, fades over time; `wagTail(dt)` sets the `#tail` group's `transform` every frame; it stays still under reduced motion). The frame loop (`frame`) wags the tail every frame and redraws the bank every 100 ms. |
| `src/game.js` | The player in the browser: `game.me` (the saved game, counting between syncs), `pat()`, `buy(id)`, `tick(dt)`, `sync()` (every 2 s when something happened, 15 s otherwise), `spend(method, path, body)` (sync first, then a call that spends; takes the new player from the answer), `onChange(fn)` (fires `"owned"`, `"bones"`, `"online"`, `"offline:…"`). |
| `src/board.js` | The suggestion board, the countdown, voting, reporting, and the update log (summaries, ratings, "Show older"). |
| `src/ui.js` | `h(tag, attrs, ...children)` builds elements (attrs: `class`, `text`, `on: { click }`, others as attributes); `fmt(n)` (1,234 / 2.50 M), `fmtRate`, `ago(ms)`, `clock(ms)`. |
| `src/api.js` | `call(method, path, body)` to `/api`, with the save code; `getSave`, `setSave`. |
| `src/style.css` | Colour tokens at the top (`--bg`, `--card`, `--ink`, `--muted`, `--line`, `--accent`, `--tan`, `--brown`, `--cream`, `--good`, `--bad`), dark mode under them, then one section per part of the page. |
| `web/index.html` | The page: header, the play card (`#bones`, `#rate`, `#beagle` with its inline SVG: `#tail` (drawn first so it's behind, pivot at 130,160), `.ear`, `.head`, `.blaze`, `.muzzle`, `.nose`, `.eye`, `.tongue`), `#shop`, the board (`#status`, `#suggest`, `#open`), the log (`#done`), the footer with the save panel. |

## How to…

- **Add an upgrade**: one entry in `UPGRADES` (`rules.js`). The shop shows it by itself. Update the table in `docs/GAME.md`.
- **Change what a pat or a second gives**: `perClick` / `perSecond` in `rules.js`, or the sums there.
- **Keep something new in the save** (e.g. golden bones collected): put it under `player.game` (e.g. `game.goldenBones`). It's sent to the browser as `game.me.game`. Read it with a default: `(p.game.goldenBones || 0)`.
- **Let players do something new that changes the save**: add `actions.<name> = async ({ player, body, now }) => …` in `api/src/game/index.js`. Call `sync(player, {}, now)` first, then return `{ player, body }` or `{ error }`. From the page, call `spend("POST", "/game/<name>", body)` (from `src/game.js`). Work out rewards on the server, and check time on the server (`now`), not the browser's word.
- **Something only on the page** (an animation, a sound made with the Web Audio API, a look): `src/` and `web/` alone. Use CSS tokens for colours and check dark mode.
- **Test it**: a `dev/test-<thing>.cjs` like `dev/test-rules.cjs` (`const { test, eq, ok, done } = require("./t.cjs")`).
- **See it**: `node dev/look.mjs --pats 200 --click ".item[data-id='chew-toy']"`, then `--dark`, then `--phone`.

## Lessons

- The server caps pats at 20 a second (plus a second of slack), so `look.mjs --pats` waits between batches. Don't expect more bones than that in a screenshot.
- The CSP blocks inline styles in HTML, but setting `el.style.x` from JS is fine.
- For smooth animation whose speed changes (like the tail), drive it from `frame` with a phase and `setAttribute("transform", …)` on SVG: changing a CSS `animation-duration` mid-way makes it jump. The beagle's ears cover x 17–183, so anything added beside the head must stick out past them to be seen. Check motion with `look.mjs --eval` sampling an attribute over time.
