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
   - **Custom domain**: `clicker.beagle.games`. In ClouDNS, add a CNAME `clicker` → the app's `*.azurestaticapps.net` host, then validate in Azure.
   - Copy the **deployment token** (Overview → Manage deployment token).
4. **GitHub secrets** (Settings → Secrets and variables → Actions):
   - `AZURE_STATIC_WEB_APPS_API_TOKEN`: the deployment token
   - `OPS_KEY`: the same value as on Azure
   - `ANTHROPIC_API_KEY` (recommended: a key from console.anthropic.com, in a workspace with a **monthly spend limit**) **or** `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`; uses your plan's allowance)
5. **GitHub variables**: `SITE_URL` = `https://clicker.beagle.games`. Optional ones are below.
6. Push to `main`: **Deploy** puts the site live. **Scheduled update** runs every 3 hours (at 0:00, 3:00, 6:00… UTC), or run it from the Actions tab.

## Settings

| Where | Name | Default | What it does |
|---|---|---|---|
| Azure | `UPDATE_HOURS` | 3 | The schedule, for the countdown players see. Change it together with the `cron` in `scheduled-update.yml` (e.g. `0 */6 * * *` and 6). Use a number that divides 24. |
| Azure | `BUDGET_USD_30D` | 60 | No build starts once the last 30 days of runs cost this much. |
| Azure | `MAX_BUILDS_PER_DAY` | 8 | No more builds than this in 24 hours. |
| Azure | `OWN_IDEAS` | 1 | `0`: when no suggestion has bones, skip the run instead of building Claude's own idea. |
| Azure | `MIN_SCORE` | 1 | Bones a suggestion needs before it can be picked. |
| Azure | `BLOCKED_WORDS` | (none) | More words to refuse in suggestions and in updates, comma-separated. `word*` matches words starting with it. |
| GitHub variable | `UPDATES_PAUSED` | | `1` stops the scheduled updates until it's removed. |
| GitHub variable | `MAX_RUN_USD` | 4 | The most one build may spend (`--max-budget-usd`). |
| GitHub variable | `CLAUDE_MODEL` | `claude-opus-5-5` | The building model. `claude-sonnet-5-5` costs less. |
| GitHub variable | `CLAUDE_EFFORT` | `medium` | `low` is cheaper, `high` more careful. |
| GitHub variable | `CLAUDE_MAX_TURNS` | 60 | The most steps one build may take. |

## Keeping costs down

These limits stack, so one runaway build can't use much:

1. **Each run is capped**: `MAX_RUN_USD` (4 by default), `CLAUDE_MAX_TURNS` (60), and 30 minutes.
2. **The game stops starting builds** past `BUDGET_USD_30D` (60) in 30 days, or `MAX_BUILDS_PER_DAY` (8). Each run's cost is reported back and counted.
3. **Screening is cheap**: a small model (Haiku, at most $0.25) checks each player suggestion before the expensive build starts.
4. **Small changes**: suggestions are at most 140 characters, and an update may change at most 14 files and 500 lines of code.
5. **Short docs**: the docs every build reads have size limits, and builds never read the long changelog.
6. **The hard stop**: with `ANTHROPIC_API_KEY`, the workspace's monthly spend limit in the Anthropic Console caps everything, whatever happens here.

At the defaults, the most it can spend is about 8 runs × $4 a day, and never more than $60 in 30 days. The run log shows each one's cost ("Cost and refusals"), and the pick step prints the 30-day total.

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
  `OPS_URL=https://clicker.beagle.games OPS_KEY=… node dev/ops.mjs hide '{"id":"<id>","reason":"Not for this game."}'`
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
