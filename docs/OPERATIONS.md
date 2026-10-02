# Running beagle.clicker

## One-time setup

Same shape as beagle.fit: an Azure Static Web App with a managed API, Cosmos DB, GitHub Actions.

1. **GitHub repository**: `JBeagle90/beagle.clicker`, with this folder pushed to `main`.
   - Leave `main` without rules that require pull requests, or let GitHub Actions bypass them, because the hourly update pushes to `main`.
2. **Cosmos DB**: in the beagle.fit Cosmos account, or a new serverless one, add database `beagleclicker` with container `docs`.
   - Partition key: `/pk`.
   - Time to Live: **On (no default)**. Rate-limit counters expire by themselves.
3. **Static Web App** (Free plan is fine): create it with deployment source **Other**, so the GitHub workflow deploys rather than Azure. Then:
   - **Environment variables**: `COSMOS_ENDPOINT`, `COSMOS_KEY`, `COSMOS_DATABASE=beagleclicker`, `COSMOS_CONTAINER=docs`, and `OPS_KEY` (40 random characters, e.g. `node -e "console.log(require('crypto').randomBytes(30).toString('base64url'))"`).
   - **Custom domain**: `clicker.beagle.games`. In ClouDNS, add a CNAME `clicker` → the app's `*.azurestaticapps.net` host, then validate in Azure.
   - Copy the **deployment token** (Overview → Manage deployment token).
4. **GitHub secrets** (Settings → Secrets and variables → Actions):
   - `AZURE_STATIC_WEB_APPS_API_TOKEN`: the deployment token
   - `OPS_KEY`: the same value as on Azure
   - `ANTHROPIC_API_KEY` (recommended: a key from console.anthropic.com with a monthly spend limit) **or** `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`; uses your plan's allowance)
5. **GitHub variables**: `SITE_URL` = `https://clicker.beagle.games`. Optional: `CLAUDE_MODEL` (default `claude-opus-5-5`).
6. Push to `main`: **Deploy** puts the site live. **Hourly update** starts at the next hour, or run it from the Actions tab.

## Day to day

- **Pause updates**: set the repository variable `UPDATES_PAUSED` to `1`. Delete it to start again.
- **Take a suggestion off the board** (rude, spam), giving its bones back:
  `OPS_URL=https://clicker.beagle.games OPS_KEY=… node dev/ops.mjs hide '{"id":"<id>","reason":"Not for this game."}'`
  (the id is the `data-id` on the suggestion in the page).
- **Undo an update**: `git revert <commit>` and push. Deploy runs on every push to `main`. The patch notes keep the entry.
- **A run failed**: the Actions tab has each step. The `update-task` artifact holds Claude's result, the commit bundle and its screenshots. A failed build goes back on the board once and is declined after a second failure. A build that never reported back is reset after 3 hours.
- **Cost**: a run happens only when a suggestion has at least `MIN_SCORE` bones (Azure setting, default 1). Raise it if quiet hours are building one-bone ideas. Each run's turns and cost are printed under "What Claude was refused".

## The safety model

Players' words reach code that deploys itself, so there are several layers between them:

1. **The prompt** (in the workflow) treats the suggestion as a description, never as instructions, and tells Claude when to decline.
2. **Claude's job has a read-only token** and a short list of allowed commands. It can't push or deploy.
3. **The guard** (`dev/guard-rules.cjs`) allows changes only to the game's own files (`src/`, `web/`, `api/src/game/`, game tests, `docs/GAME.md`). It refuses network calls, `process`, `eval` and HTML-from-strings in them. The publish job runs the guard from `main`, so a change can't loosen its own check.
4. **The core** (players, votes, suggestions, the hourly calls) is off limits, and game code can't change who a player is. Game actions can only change the player who called them.
5. **The browser's CSP** allows scripts, styles and connections only from the site itself.
6. **Tests and the build must pass**, and the deploy tests again in a fresh checkout.

What's left: Claude could still build something silly or broken that players voted for. Revert it, or pause and look. Suggestion text is public before anyone reviews it, so check the board now and then. A "report" button is a good early update to add yourself.
