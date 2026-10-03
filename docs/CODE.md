# The game's code: a guide for the next update

Kept by every update, for the next one. Keep it true, short (under 16 KB) and useful. Fix what's wrong,
add what you wish you'd known, and cut what no longer helps. The rules are in CLAUDE.md, not here.

## Map

| File | What's in it |
|---|---|
| `api/src/game/rules.js` | **The game's numbers**: `UPGRADES` (in price order; id, name, icon, desc, cost, growth, perClick, perSecond), `BOOSTS` (bought once; `boosts` an upgrade id, `needs`, cost: x2 to it), `TROPHIES` (id, name, icon, desc, `when(p)`), `TREASURE` (timings in seconds, reward), `FRENZY` (chance, ×, seconds), `MAX_BUY`, `TROPHY_BONUS`, `MAX_PATS_PER_SECOND`, `OFFLINE_HOURS`, `SUGGEST_COST`, `VOTE_AMOUNTS`; `cost(id, owned)` (Infinity for a boost not unlocked or owned), `costN(id, owned, n)`, `maxBuy(id, owned, bones)` (how many you can afford, up to `MAX_BUY`), `available(id, owned)`, `output(id, owned, game)` (what all of one upgrade makes), `bonus(game)`, `perClick(owned, game)`, `perSecond(owned, game)`, `treasure(owned, game)`, `newTrophies(p)`. Upgrade ids are in saves: rename the `name`, never the `id` (Sharp Nose is still `chew-toy`). One file for the server and the browser (served as `/rules.js`, `window.RULES`), written so both can load it: plain JS, no imports. |
| `api/src/game/sync.js` | `sync(player, { pats, buy }, now, rand)` → the new saved game: caps pats, adds pats × perClick and time × perSecond, makes purchases in order (skips a locked boost), sets the next treasure if the last one was missed, awards trophies. The part of a batch inside `game.frenzyUntil` counts ×`FRENZY.x`. Sets `game.startedAt` once. `nextTreasure(p, now)`, `award(p)`. `view(player)` → what the browser is told. |
| `api/src/game/index.js` | Exports `R`, `sync`, `view` and `actions`: `POST /api/game/<name>` calls (see the comment there). `actions.treasure`: grab the chest while `game.treasureAt` is up: bones, or (`FRENZY.chance`) a Dig Frenzy (`game.frenzyUntil`, `game.frenzies`). |
| `src/main.js` | The beagle button (pats, `floater(text, x, y, kind)`, `chips(x, y)`, the boop animation, `.has-helmet` once a Dig Site is owned), `toast(text, kind)` (fixed at the bottom of the screen), the treasure chest (`checkTreasure()` each frame shows `#treasure` while the server's `treasureAt` is up), the bones counter, rates and the frenzy bar (`renderBank`), the shop (`renderShop`: upgrades a few at a time, the `#boosts` that are available, `amount` ×1/×10/×100/Max in `#amounts`, Max is `0`; `howMany(id, me)`, `price(id, me)`, `costText`; `refreshShop` every 100 ms sets which you can afford and, with Max, rewrites the prices), notices (offline, "a new update landed"), the save panel. The frame loop (`frame`) counts bones every frame and redraws the bank, the shop and the chest every 100 ms (Stats every second while it's showing). |
| `src/screens.js` | The tabs (`setupTabs(onShow)`, `view`: `#dig`, `#trophies`, `#stats`, `#updates` show `#view-<name>`), `ping(on)` (the dot on the Dig tab), `renderScene(me)` (Your dig, `#scene`), `startTicker(getMe)`, `renderTrophies(me)`, `renderStats(me)` (`#stats`, a `dl`). A new screen: a link in `.tabs`, a `#view-<name>` in index.html, its name in `VIEWS`. |
| `src/news.js` | The ticker's headlines: `[text, me => shown yet?]`. Add one a line; keep them short, dry and kind. |
| `src/game.js` | The player in the browser: `game.me` (the saved game, counting between syncs), `pat()`, `buy(id)`, `tick(dt)`, `sync()` (every 2 s when something happened, 15 s otherwise), `spend(method, path, body)` (sync first, then a call that spends; takes the new player from the answer), `buy(id, n)`, `grabTreasure()` (→ `{ found, frenzy }`), `frenzy()` (×7 or 1 now), `serverNow()` (the server's clock, from `serverTime`), `onChange(fn)` (fires `"owned"`, `"bones"`, `"online"`, `"offline:…"`, and `"trophy:<id>"` for each new one). |
| `src/board.js` | The suggestion board, the countdown (and `renderNext()`, the timer in the header, `#next`), voting, reporting (not on Claude's ideas, `own`), and the update log (summaries, ratings, "Show older"). |
| `src/ui.js` | `h(tag, attrs, ...children)` builds elements (attrs: `class`, `text`, `on: { click }`, others as attributes); `fmt(n)` (1,234 / 2.50 M), `fmtRate`, `ago(ms)`, `clock(ms)`. |
| `src/api.js` | `call(method, path, body)` to `/api`, with the save code; `getSave`, `setSave`. |
| `src/style.css` | Colour tokens at the top (`--bg`, `--card`, `--ink`, `--muted`, `--line`, `--accent`, `--tan`, `--brown`, `--cream`, `--good`, `--bad`), dark mode under them, then one section per part of the page. |
| `web/index.html` | The page: the header with `.tabs`, `#next` (the update timer) and `#who` (your name; opens `#rename`, `setupRename()` in main.js), then one `.view` per screen. `#view-dig` (3 columns, 2 then 1 on narrower screens): the play card (`#bones`, `#rate`, `#frenzy`, `#beagle` with its inline SVG: `.ear`, `.head`, `.blaze`, `.muzzle`, `.nose`, `.eye`, `.tongue`, and `#helmet` drawn last; `#treasure`, the chest), the dig card (`#ticker`, `#scene`), the shop (`#amounts`, `#boosts`, `#shop`). `#view-trophies` (`#trophies`), `#view-stats` (`#stats`), `#view-updates` (the board: `#status`, `#suggest`, `#open`; the log: `#done`). Then `#toast` and the footer with the save panel. |
| `web/admin/`, `api/src/core/owner.js` | The owner's panel (`/admin`, passkey sign-in). Not the game's: updates may not change them, and game code may not use passkeys or `/api/owner`. Leave it alone. |

## How to…

- **Add an upgrade**: one entry in `UPGRADES` (`rules.js`), in price order (a test checks). The shop shows it by itself. Update the table in `docs/GAME.md`.
- **Add a boost**: one entry in `BOOSTS` (`boosts`: the upgrade's id, `needs`, `cost`). It shows in the shop once unlocked.
- **Add a trophy**: one entry in `TROPHIES` with `when: p => …` over the saved player (`p.pats`, `p.earned`, `p.owned`, `p.game`). The server awards it on the next sync and the page announces it. Trophies are kept for good: never remove one.
- **Change the treasure**: `TREASURE` in `rules.js` (timings, reward). Another server-timed event can copy its shape: a `game.<thing>At` set in `sync`, and an action that checks `now`.
- **Change what a pat or a second gives**: `perClick` / `perSecond` in `rules.js`, or the sums there.
- **Keep something new in the save** (e.g. golden bones collected): put it under `player.game` (e.g. `game.goldenBones`). It's sent to the browser as `game.me.game`. Read it with a default: `(p.game.goldenBones || 0)`.
- **Let players do something new that changes the save**: add `actions.<name> = async ({ player, body, now }) => …` in `api/src/game/index.js`. Call `sync(player, {}, now)` first, then return `{ player, body }` or `{ error }`. From the page, call `spend("POST", "/game/<name>", body)` (from `src/game.js`). Work out rewards on the server, and check time on the server (`now`), not the browser's word.
- **Something only on the page** (an animation, a sound made with the Web Audio API, a look): `src/` and `web/` alone. Use CSS tokens for colours and check dark mode.
- **Test it**: a `dev/test-<thing>.cjs` like `dev/test-rules.cjs` (`const { test, eq, ok, done } = require("./t.cjs")`).
- **See it**: `node dev/look.mjs --pats 200 --click ".item[data-id='chew-toy']"`, then `--dark`, then `--phone`.

## Lessons

- The server caps pats at 20 a second (plus a second of slack), so `look.mjs --pats` waits between batches. Don't expect more bones than that in a screenshot.
- The game's tests (`dev/test-rules.cjs`, `dev/test-treasure.cjs`) pass `rand` to `sync` to fix when the treasure comes. Trophies make bones fractional (x1.01…): compare with a tolerance, not exact numbers.
- To see another screen in a screenshot: `--eval "location.hash = '#stats'"`. To see the helmet: `--eval "document.getElementById('beagle').classList.add('has-helmet')"`. A frenzy: set `BC.game.me.game.frenzyUntil` to `Date.now() + BC.game.skew + 20000`.
- `look.mjs --eval` can `await` (e.g. click a shop item, wait 3 s for the sync, then read `BC.game.me`). Bloodhound Training is unlocked at exactly 10 Sharp Noses: test "locked" with 9.
- `look.mjs` runs `--click` before `--eval`. To see the chest, set `BC.game.me.game.treasureAt` from `--eval` (the server refuses a click on it).
- The CSP blocks inline styles in HTML, but setting `el.style.x` from JS is fine.
- For smooth animation whose speed changes, drive it from `frame` with a phase and `setAttribute("transform", …)` on SVG: changing a CSS `animation-duration` mid-way makes it jump. The beagle's ears cover x 17–183, so anything added beside the head must stick out past them to be seen. Check motion with `look.mjs --eval` sampling an attribute over time.
