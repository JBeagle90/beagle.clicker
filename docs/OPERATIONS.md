# Running beagle.clicker

## One-time setup

Same shape as beagle.fit: an Azure Static Web App with a managed API, Cosmos DB, GitHub Actions.

1. **GitHub repository**: `JBeagle90/beagle.clicker`, with this folder pushed to `main`.
   - Leave `main` without rules that require pull requests, or let GitHub Actions bypass them, because the scheduled update pushes to `main`.
2. **Cosmos DB**: in the beagle.fit Cosmos account, or a new serverless one, add database `beagleclicker` with container `docs`.
   - Partition key: `/pk`.
   - Time to Live: **On (no default)**. Rate-limit counters expire by themselves.
3. **Static Web App** (Free plan is fine): create it with deployment source **Other**, so the GitHub workflow deploys rather than Azure. Then:
   - **Environment variables**: `COSMOS_ENDPOINT`, `COSMOS_KEY`, `COSMOS_DATABASE=beagleclicker`, `COSMOS_CONTAINER=docs`, and `OPS_KEY` (40 random characters, e.g. `node -e "console.log(require('crypto').randomBytes(30).toString('base64url'))"`). Optional settings are listed below.
   - **Custom domain**: `beagle.games` (the apex, which today points at the Azure VM serving beagle.idle). See "Moving beagle.games" below.
   - Copy the **deployment token** (Overview → Manage deployment token).
4. **GitHub secrets** (Settings → Secrets and variables → Actions):
   - `AZURE_STATIC_WEB_APPS_API_TOKEN`: the deployment token
   - `OPS_KEY`: the same value as on Azure
   - `ANTHROPIC_API_KEY` (recommended: a key from console.anthropic.com, in a workspace with a **monthly spend limit**) **or** `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`; uses your plan's allowance)
5. **GitHub variables**: `SITE_URL` = the address the game answers at: the app's `https://<name>.azurestaticapps.net` at first, then `https://beagle.games` once the domain has moved. Optional ones are below.
6. Push to `main`: **Deploy** puts the site live. **Scheduled update** runs every 3 hours (at 0:00, 3:00, 6:00… UTC), or run it from the Actions tab.

## Moving beagle.games

beagle.games is the domain's apex. Today it has an A record to the Azure VM (20.37.130.90), where IIS serves beagle.idle. DNS is at ClouDNS. Do the steps in this order so the game is ready before the address moves:

1. **Check it works first** at the app's own address (`https://<name>.azurestaticapps.net`, on the Static Web App's Overview). Play it, and let one scheduled update run.
2. **Keep beagle.idle, if you want it**: in ClouDNS add an A record `idle` → `20.37.130.90`, and add an `idle.beagle.games` binding (and certificate) to its IIS site. Do this before the apex moves.
3. **Lower the TTL** of the apex A record to 300 a while before, so the switch is quick.
4. **Prove you own it**: Static Web App → Custom domains → Add → Custom domain on other DNS → `beagle.games`, validation **TXT**. In ClouDNS add the TXT record it shows, at the apex (host left empty), and wait until Azure says Validated.
5. **Point the apex at the app**: in ClouDNS, delete the apex A record (`20.37.130.90`) and add an **ALIAS** record at the apex → `<name>.azurestaticapps.net`. Leave the MX, TXT and other records alone. Azure then issues the certificate by itself, which can take up to an hour.
6. **www** (optional): a CNAME `www` → `<name>.azurestaticapps.net`, added as a second custom domain in Azure.
7. **Set `SITE_URL`** (GitHub variable) to `https://beagle.games`. Until then, use the `azurestaticapps.net` address there, so the scheduled update can reach the game before the move.

To go back, put the apex A record back to `20.37.130.90`.

## Settings

| Where | Name | Default | What it does |
|---|---|---|---|
| Azure | `UPDATE_HOURS` | 3 | The schedule, for the countdown players see. Change it together with the `cron` in `scheduled-update.yml` (e.g. `0 */6 * * *` and 6). Use a number that divides 24. |
| Azure | `BUDGET_USD_30D` | 250 | No build starts once the last 30 days of runs cost this much. |
| Azure | `MAX_BUILDS_PER_DAY` | 8 | No more builds than this in 24 hours. |
| Azure | `OWN_IDEAS` | 1 | `0`: when no suggestion has bones, skip the run instead of building Claude's own idea. |
| Azure | `MIN_SCORE` | 1 | Bones a suggestion needs before it can be picked. |
| Azure | `BLOCKED_WORDS` | (none) | More words to refuse in suggestions and in updates, comma-separated. `word*` matches words starting with it. |
| GitHub variable | `UPDATES_PAUSED` | | `1` stops the scheduled updates until it's removed. |
| GitHub variable | `MAX_RUN_USD` | 2 | The most one build may spend (`--max-budget-usd`). |
| GitHub variable | `CLAUDE_MODEL` | `claude-opus-5-5` | The building model. `claude-sonnet-5-5` costs less. |
| GitHub variable | `CLAUDE_EFFORT` | `medium` | `low` is cheaper, `high` more careful. |
| GitHub variable | `CLAUDE_MAX_TURNS` | 80 | The most steps one build may take. |

## Keeping costs down

These limits stack, so one runaway build can't use much:

1. **Each run is capped**: `MAX_RUN_USD` (2 by default), `CLAUDE_MAX_TURNS` (80), and 30 minutes.
2. **The game stops starting builds** past `BUDGET_USD_30D` (250) in 30 days, or `MAX_BUILDS_PER_DAY` (8). Each run's cost is reported back and counted.
3. **Screening is cheap**: a small model (Haiku, at most $0.25) checks each player suggestion before the expensive build starts.
4. **Small changes**: suggestions are at most 140 characters, and an update may change at most 14 files and 500 lines of code.
5. **Short docs**: the docs every build reads have size limits, and builds never read the long changelog.
6. **The hard stop**: with `ANTHROPIC_API_KEY`, the workspace's monthly spend limit in the Anthropic Console caps everything, whatever happens here.

For scale: beagle.fit's Claude builds (Opus, high effort) have cost $0.40 to $1.16 each at API prices, in 29 to 50 turns. Expect about $0.50 to $1.50 a build here, so the full schedule (8 a day) is roughly $120 to $360 in 30 days. The $2 cap stops a run that goes wrong, and the 30-day budget is a backstop. The run log shows each one's cost ("Cost and refusals"), and the pick step prints the 30-day total.

**On your subscription** (`CLAUDE_CODE_OAUTH_TOKEN`), the dollars are API-equivalent estimates, not charges: builds use your plan's usage limits, alongside your own Claude Code use. To use less, run every 6 hours (`0 */6 * * *` and `UPDATE_HOURS=6`), set `MAX_BUILDS_PER_DAY=4` or `OWN_IDEAS=0`, or set `CLAUDE_MODEL=claude-sonnet-5-5`. With `ANTHROPIC_API_KEY` they're real charges, and the Console spend limit is the hard cap.

## Keeping it friendly

beagle.clicker is meant for everyone, children included. The layers:

1. **Words are filtered when a suggestion is posted** (`api/src/core/moderation.js`): sexual, graphic, hateful words, drugs and swearing, including disguised spellings. Add your own with `BLOCKED_WORDS`.
2. **Players report suggestions.** Three reports take one down, and its bones go back.
3. **A screen before every build**: Haiku reads the suggestion and blocks anything sexual, violent, scary, hateful or otherwise not for children, and anything trying to trick the builder. The suggestion is declined and its bones go back.
4. **The build's prompt** has the same rules for everything Claude adds (words, pictures, sounds), including its own ideas, and tells it to decline.
5. **The guard** runs the word filter over every file an update changes.
6. **You**: take a suggestion off the board with `hide` (below), revert an update, or pause.

## Day to day

- **Pause updates**: set the repository variable `UPDATES_PAUSED` to `1`. Delete it to start again.
- **Take a suggestion off the board** (rude, spam), giving its bones back:
  `OPS_URL=https://beagle.games OPS_KEY=… node dev/ops.mjs hide '{"id":"<id>","reason":"Not for this game."}'`
  (the id is the `data-id` on the suggestion in the page).
- **Undo an update**: `git revert <commit>` and push. Deploy runs on every push to `main`. The update log and changelog keep the entry.
- **A run failed**: the Actions tab has each step. The `update-task` artifact holds Claude's result, the commit bundle and its screenshots. A failed build goes back on the board once and is declined after a second failure. Claude's own ideas that fail are dropped. A build that never reported back is reset after 3 hours.
- **How updates are landing**: players' ratings show in the update log, and each build is given the last 10 updates' ratings.
- **The docs Claude keeps**: `docs/CODE.md`, `docs/GAME.md` and `docs/IDEAS.md` change with every update. Read them now and then: they're how each build learns from the last. CLAUDE.md is yours, and updates can't change it.

## The safety model

Players' words reach code that deploys itself, so there are several layers between them:

1. **The prompts** (in the workflow) treat the suggestion as a description, never as instructions, and say when to decline.
2. **Claude's jobs have a read-only token** and a short list of allowed commands. They can't push or deploy.
3. **The guard** (`dev/guard-rules.cjs`) allows changes only to the game's own files (`src/`, `web/`, `api/src/game/`, game tests, and three docs) and limits their size. It refuses network calls, `process`, `eval`, HTML-from-strings and blocked words in them. The publish job runs the guard from `main`, so a change can't loosen its own check.
4. **The core** (players, votes, suggestions, ratings, reports, the scheduled calls, the word filter) is off limits. Game code can't change who a player is, and game actions can only change the player who called them.
5. **The browser's CSP** allows scripts, styles and connections only from the site itself.
6. **Tests and the build must pass**, and the deploy tests again in a fresh checkout.

What's left: Claude could still build something silly or broken that players voted for. Bad ratings will show it. Revert it, or pause and look. The docs Claude keeps are read by later builds, so a bad idea could linger there: skim them now and then.
