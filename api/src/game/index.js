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
// Frenzy, and sets the next one. A gold chest (game.treasureGold) always gives R.GOLD.x times the
// bones. Every R.STREAK.needs grabs in a row (game.streak; a missed chest resets it in sync) add a
// streak bonus of R.STREAK.x treasures' worth. `rand` is for tests.
actions.treasure = async ({ player, now, rand = Math.random }) => {
  const p = sync(player, {}, now);
  const at = p.game.treasureAt;
  if (!(now >= at - 2000)) return { error: "No treasure here yet. Keep digging!" };
  if (!(now <= at + R.TREASURE.window * 1000)) return { error: "Too slow! The treasure sank back into the dirt." };
  p.game.treasures = (p.game.treasures || 0) + 1;
  let found = 0, frenzy = false;
  const gold = !!p.game.treasureGold;
  if (gold) {
    found = R.treasure(p.owned, p.game) * R.GOLD.x;
    p.bones += found;
    p.earned += found;
    p.game.golds = (p.game.golds || 0) + 1;
  } else if (rand() < R.FRENZY.chance) {
    frenzy = true;
    p.game.frenzyUntil = now + R.FRENZY.seconds * 1000;
    p.game.frenzies = (p.game.frenzies || 0) + 1;
  } else {
    found = R.treasure(p.owned, p.game);
    p.bones += found;
    p.earned += found;
  }
  // The treasure streak: the last chest of a run adds the bonus and starts a new run.
  let bonus = 0;
  p.game.streak = (p.game.streak || 0) + 1;
  if (p.game.streak >= R.STREAK.needs) {
    bonus = R.treasure(p.owned, p.game) * R.STREAK.x;
    p.bones += bonus;
    p.earned += bonus;
    p.game.streak = 0;
    p.game.streaks = (p.game.streaks || 0) + 1;
  }
  nextTreasure(p, now);
  award(p);
  return { player: p, body: { found, frenzy, gold, bonus, streak: p.game.streak } };
};

module.exports = { R, sync, view, actions };
