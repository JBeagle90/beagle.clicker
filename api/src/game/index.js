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
// browser whose clock runs a little ahead). Gives R.treasure() bones and sets the next one.
actions.treasure = async ({ player, now }) => {
  const p = sync(player, {}, now);
  const at = p.game.treasureAt;
  if (!(now >= at - 2000)) return { error: "No treasure here yet. Keep digging!" };
  if (!(now <= at + R.TREASURE.window * 1000)) return { error: "Too slow! The treasure sank back into the dirt." };
  const found = R.treasure(p.owned, p.game);
  p.bones += found;
  p.earned += found;
  p.game.treasures = (p.game.treasures || 0) + 1;
  nextTreasure(p, now);
  award(p);
  return { player: p, body: { found } };
};

module.exports = { R, sync, view, actions };
