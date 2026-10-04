// How a player's bones grow. The browser sends what happened since it last synced (pats, and
// upgrades bought, in order) and the server works out the result here, so nobody can just say they
// have a million bones. Called by the core (api/src/core/players.js) with a copy of the player's
// saved game; it returns the new one. Fields the core owns (pid, name, token) are put back after,
// so this can only change the game.
"use strict";
const R = require("./rules");

const MAX_BATCH_SEC = 60; // pats in one sync count for at most a minute's worth

// The new game state after `input` ({ pats, buy: [upgrade or boost ids] }) at time `now` (ms).
// `rand` (0–1) picks when the next treasure turns up; tests pass their own.
function sync(player, input, now, rand = Math.random) {
  const p = { ...player, owned: { ...(player.owned || {}) }, game: { ...(player.game || {}) } };
  p.bones = +p.bones || 0;
  p.earned = +p.earned || 0;
  p.pats = +p.pats || 0;

  const since = Math.max(0, (now - (typeof p.syncedAt === "number" ? p.syncedAt : now)) / 1000);
  const away = Math.min(since, R.OFFLINE_HOURS * 3600);
  const maxPats = Math.floor(R.MAX_PATS_PER_SECOND * (Math.min(since, MAX_BATCH_SEC) + 1)); // +1 s of slack
  const pats = Math.min(maxPats, Math.max(0, Math.floor(+(input && input.pats) || 0)));

  // A Dig Frenzy multiplies the part of this batch that fell inside it (syncs come every couple of
  // seconds, so that's close enough for pats too).
  const last = typeof p.syncedAt === "number" ? p.syncedAt : now;
  const hot = Math.max(0, Math.min(now, +p.game.frenzyUntil || 0) - last) / 1000;
  const frenzy = since > 0 ? 1 + (R.FRENZY.x - 1) * Math.min(1, hot / since) : 1;
  const gain = (pats * R.perClick(p.owned, p.game) + away * R.perSecond(p.owned, p.game)) * frenzy;
  p.bones += gain;
  p.earned += gain;
  p.pats += pats;
  p.syncedAt = now;

  if (typeof p.game.startedAt !== "number") p.game.startedAt = now; // for Stats ("playing since")

  const buys = Array.isArray(input && input.buy) ? input.buy.slice(0, 2 * R.MAX_BUY) : [];
  for (const id of buys) {
    if (typeof id !== "string" || !R.byId(id)) continue;
    const c = R.cost(id, p.owned);
    if (!(c < Infinity)) continue; // a boost not unlocked yet, or already owned
    if (p.bones < c) break;
    p.bones -= c;
    p.owned[id] = (p.owned[id] || 0) + 1;
  }

  // A treasure that was missed sinks back; the next one is set.
  const at = p.game.treasureAt;
  if (typeof at !== "number" || now > at + R.TREASURE.window * 1000) nextTreasure(p, now, rand);
  award(p);
  return p;
}

// Sets when the next buried treasure turns up (soon for a first one, then every few minutes), and
// whether it's a rare gold chest.
function nextTreasure(p, now, rand = Math.random) {
  const [lo, hi] = p.game.treasures ? R.TREASURE.gap : R.TREASURE.first;
  p.game.treasureAt = Math.round(now + (lo + (hi - lo) * rand()) * 1000);
  p.game.treasureGold = rand() < R.GOLD.chance;
}

// Adds any trophies the player has just earned (they're kept for good).
function award(p) {
  const add = R.newTrophies(p);
  if (add.length) p.game.trophies = (Array.isArray(p.game.trophies) ? p.game.trophies : []).concat(add);
}

// What the browser is told about its own game.
function view(p) {
  return {
    bones: p.bones || 0,
    earned: p.earned || 0,
    pats: p.pats || 0,
    owned: p.owned || {},
    perClick: R.perClick(p.owned, p.game),
    perSecond: R.perSecond(p.owned, p.game),
    game: p.game || {},
  };
}

module.exports = { sync, view, nextTreasure, award };
