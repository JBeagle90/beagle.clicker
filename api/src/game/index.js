// The game's side of the API, which the hourly updates are free to grow (CLAUDE.md).
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
const { sync, view } = require("./sync");

const actions = {};

module.exports = { R, sync, view, actions };
