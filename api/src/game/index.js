// The game's side of the API, which the scheduled updates are free to grow (CLAUDE.md).
//
// sync and view: see sync.js.
// actions: extra things a player can do, at POST /api/game/<name>. Each is
//   async ({ player, body, now }) → { player, body }
// where player is a copy of the caller's saved game (call sync(player, {}, now) first to bring
// their bones up to date), and you hand back the changed player to save and the JSON to answer
// with. An action can only change the player who called it. To refuse, return
// { error: "What to tell the player." } and nothing is saved.
"use strict";
const R = require("./rules");
const { sync, view, nextTreasure, award } = require("./sync");

const actions = {};

// Grab the buried treasure: only while it's up (the server's clock decides, with 2 s of slack for a
// browser whose clock runs a little ahead). Gives R.treasure() bones, or (one in five) starts a Dig
// Frenzy, and sets the next one. `rand` is for tests.
actions.treasure = async ({ player, now, rand = Math.random }) => {
  const p = sync(player, {}, now);
  const at = p.game.treasureAt;
  if (!(now >= at - 2000)) return { error: "No treasure here yet. Keep digging!" };
  if (!(now <= at + R.TREASURE.window * 1000)) return { error: "Too slow! The treasure sank back into the dirt." };
  p.game.treasures = (p.game.treasures || 0) + 1;
  let found = 0, frenzy = false;
  if (rand() < R.FRENZY.chance) {
    frenzy = true;
    p.game.frenzyUntil = now + R.FRENZY.seconds * 1000;
    p.game.frenzies = (p.game.frenzies || 0) + 1;
  } else {
    found = R.treasure(p.owned, p.game);
    p.bones += found;
    p.earned += found;
  }
  nextTreasure(p, now);
  award(p);
  return { player: p, body: { found, frenzy } };
};

module.exports = { R, sync, view, actions };
