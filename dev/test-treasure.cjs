// Grabbing the buried treasure (actions.treasure in api/src/game/index.js): only while it's up.
"use strict";
const { test, eq, ok, done } = require("./t.cjs");
const { R, sync, actions } = require("../api/src/game/index.js");

const fresh = (extra = {}) => ({ bones: 0, earned: 0, pats: 0, owned: {}, game: {}, syncedAt: 0, ...extra });
const up = (at, extra = {}) => fresh({ syncedAt: at - 1000, ...extra, game: { treasureAt: at, ...(extra.game || {}) } });

const never = () => 0.99, always = () => 0; // rand for "no frenzy" and "frenzy"

test("grabbing it while it's up gives bones and sets the next one", async () => {
  const r = await actions.treasure({ player: up(100000, { owned: { "puppy-pal": 1 } }), body: {}, now: 105000, rand: never });
  ok(!r.error, r.error);
  eq(r.body.found, R.treasure({ "puppy-pal": 1 }));
  eq(r.body.frenzy, false);
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

test("a gold chest gives three times the bones, never a frenzy, and a trophy", async () => {
  const r = await actions.treasure({ player: up(100000, { owned: { "puppy-pal": 1 }, game: { treasureGold: true } }), body: {}, now: 100000, rand: always });
  ok(!r.error, r.error);
  eq(r.body.gold, true); eq(r.body.frenzy, false);
  eq(r.body.found, R.treasure({ "puppy-pal": 1 }) * R.GOLD.x);
  eq(r.player.game.golds, 1);
  ok(r.player.game.trophies.includes("gold-rush"));
});

test("about one chest in ten is buried gold", () => {
  let golds = 0;
  for (let i = 0; i < 2000; i++) if (sync(fresh(), {}, 0).game.treasureGold) golds++;
  ok(golds > 120 && golds < 290, String(golds));
  eq(sync(fresh(), {}, 0, () => 0.5).game.treasureGold, false);
});

test("a frenzy chest gives x7 for 30 s instead of bones, and the sync counts it", async () => {
  const r = await actions.treasure({ player: up(100000, { owned: { "puppy-pal": 1 } }), body: {}, now: 100000, rand: always });
  eq(r.body.frenzy, true); eq(r.body.found, 0);
  eq(r.player.game.frenzyUntil, 100000 + R.FRENZY.seconds * 1000);
  ok(r.player.game.trophies.includes("dig-frenzy"));
  const b = r.player.bones, bonus = R.bonus(r.player.game);
  const p = sync(r.player, { pats: 10 }, 110000); // 10 s, all in the frenzy
  ok(Math.abs(p.bones - b - (10 * 1 + 10 * 1) * bonus * R.FRENZY.x) < 1e-6, String(p.bones - b));
  const q = sync(p, {}, 140000); // 30 s: 20 of them in the frenzy
  const bonus2 = R.bonus(p.game); // the pats just earned First Pat
  ok(Math.abs(q.bones - p.bones - 30 * bonus2 * (1 + (R.FRENZY.x - 1) * 20 / 30)) < 1e-6, String(q.bones - p.bones));
  const z = sync(q, {}, 150000); // after: back to normal
  ok(Math.abs(z.bones - q.bones - 10 * bonus2) < 1e-6);
});

done();
