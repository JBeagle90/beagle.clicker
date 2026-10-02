// Grabbing the buried treasure (actions.treasure in api/src/game/index.js): only while it's up.
"use strict";
const { test, eq, ok, done } = require("./t.cjs");
const { R, actions } = require("../api/src/game/index.js");

const fresh = (extra = {}) => ({ bones: 0, earned: 0, pats: 0, owned: {}, game: {}, syncedAt: 0, ...extra });
const up = (at, extra = {}) => fresh({ syncedAt: at - 1000, ...extra, game: { treasureAt: at, ...(extra.game || {}) } });

test("grabbing it while it's up gives bones and sets the next one", async () => {
  const r = await actions.treasure({ player: up(100000, { owned: { "puppy-pal": 1 } }), body: {}, now: 105000 });
  ok(!r.error, r.error);
  eq(r.body.found, R.treasure({ "puppy-pal": 1 }));
  eq(r.player.game.treasures, 1);
  ok(r.player.game.trophies.includes("treasure-hunter"));
  const gap = (r.player.game.treasureAt - 105000) / 1000;
  ok(gap >= R.TREASURE.gap[0] && gap <= R.TREASURE.gap[1], String(gap));
});

test("too early, too late, or twice: no bones", async () => {
  ok((await actions.treasure({ player: up(100000), body: {}, now: 90000 })).error);
  ok((await actions.treasure({ player: up(100000), body: {}, now: 100000 + R.TREASURE.window * 1000 + 1 })).error);
  const once = await actions.treasure({ player: up(100000), body: {}, now: 101000 });
  ok((await actions.treasure({ player: once.player, body: {}, now: 102000 })).error);
});

test("a player with no treasure set yet can't grab one", async () => {
  ok((await actions.treasure({ player: fresh({ syncedAt: 0 }), body: {}, now: 5000 })).error);
});

done();
