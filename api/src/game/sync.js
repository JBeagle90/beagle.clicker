// How a player's bones grow. The browser sends what happened since it last synced (pats, and
// upgrades bought, in order) and the server works out the result here, so nobody can just say they
// have a million bones. Called by the core (api/src/core/players.js) with a copy of the player's
// saved game; it returns the new one. Fields the core owns (pid, name, token) are put back after,
// so this can only change the game.
"use strict";
const R = require("./rules");

const MAX_BATCH_SEC = 60; // pats in one sync count for at most a minute's worth

// The new game state after `input` ({ pats, buy: [upgrade ids] }) at time `now` (ms).
function sync(player, input, now) {
  const p = { ...player, owned: { ...(player.owned || {}) }, game: { ...(player.game || {}) } };
  p.bones = +p.bones || 0;
  p.earned = +p.earned || 0;
  p.pats = +p.pats || 0;

  const since = Math.max(0, (now - (typeof p.syncedAt === "number" ? p.syncedAt : now)) / 1000);
  const away = Math.min(since, R.OFFLINE_HOURS * 3600);
  const maxPats = Math.floor(R.MAX_PATS_PER_SECOND * (Math.min(since, MAX_BATCH_SEC) + 1)); // +1 s of slack
  const pats = Math.min(maxPats, Math.max(0, Math.floor(+(input && input.pats) || 0)));

  const gain = pats * R.perClick(p.owned) + away * R.perSecond(p.owned);
  p.bones += gain;
  p.earned += gain;
  p.pats += pats;
  p.syncedAt = now;

  const buys = Array.isArray(input && input.buy) ? input.buy.slice(0, 100) : [];
  for (const id of buys) {
    if (typeof id !== "string" || !R.byId(id)) continue;
    const c = R.cost(id, p.owned);
    if (p.bones < c) break;
    p.bones -= c;
    p.owned[id] = (p.owned[id] || 0) + 1;
  }
  return p;
}

// What the browser is told about its own game.
function view(p) {
  return {
    bones: p.bones || 0,
    earned: p.earned || 0,
    pats: p.pats || 0,
    owned: p.owned || {},
    perClick: R.perClick(p.owned),
    perSecond: R.perSecond(p.owned),
    game: p.game || {},
  };
}

module.exports = { sync, view };
