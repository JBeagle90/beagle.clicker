// The game's numbers (api/src/game/rules.js) and how bones grow (api/src/game/sync.js).
"use strict";
const { test, eq, ok, done } = require("./t.cjs");
const R = require("../api/src/game/rules.js");
const { sync, view } = require("../api/src/game/sync.js");

const fresh = (extra = {}) => ({ bones: 0, earned: 0, pats: 0, owned: {}, game: {}, syncedAt: 0, ...extra });

test("upgrades have unique ids and sane numbers", () => {
  eq(new Set(R.UPGRADES.map(u => u.id)).size, R.UPGRADES.length);
  for (const u of R.UPGRADES) ok(u.cost > 0 && u.growth >= 1 && (u.perClick > 0 || u.perSecond > 0), u.id);
});

test("prices grow with each one owned", () => {
  eq(R.cost("chew-toy", {}), 15);
  eq(R.cost("chew-toy", { "chew-toy": 1 }), Math.ceil(15 * 1.15));
  eq(R.cost("nope", {}), Infinity);
});

test("a pat is 1 bone, more with chew toys", () => {
  eq(R.perClick({}), 1);
  eq(R.perClick({ "chew-toy": 3 }), 4);
  eq(R.perSecond({ "puppy-pal": 2, "dog-park": 1 }), 10);
});

test("pats count, up to what a person can do", () => {
  const p = sync(fresh(), { pats: 30 }, 2000);
  eq(p.bones, 30); eq(p.pats, 30);
  const q = sync(fresh(), { pats: 1e9 }, 2000); // 2 s: at most 20/s × (2 + 1)
  eq(q.pats, 60);
});

test("a batch counts at most a minute of pats", () => {
  const p = sync(fresh(), { pats: 1e9 }, 3600 * 1000);
  eq(p.pats, 20 * 61);
});

test("pups dig while you're away, for up to 8 hours", () => {
  const p = sync(fresh({ owned: { "puppy-pal": 1 } }), {}, 10 * 1000);
  eq(p.bones, 10);
  const q = sync(fresh({ owned: { "puppy-pal": 1 } }), {}, 24 * 3600 * 1000);
  eq(q.bones, 8 * 3600);
});

test("buying takes the price and adds one; can't buy what you can't afford", () => {
  const p = sync(fresh({ bones: 20 }), { buy: ["chew-toy", "chew-toy"] }, 0);
  eq(p.owned["chew-toy"], 1); eq(p.bones, 5);
  const q = sync(fresh({ bones: 20 }), { buy: ["made-up", "__proto__"] }, 0);
  eq(q.owned, {}); eq(q.bones, 20);
});

test("bad input doesn't break anything", () => {
  for (const input of [null, {}, { pats: -5 }, { pats: "lots" }, { buy: "chew-toy" }, { pats: NaN, buy: [1, {}, null] }]) {
    const p = sync(fresh({ bones: 3 }), input, 1000);
    ok(Number.isFinite(p.bones) && p.bones >= 3, JSON.stringify(input));
  }
});

test("upgrades are in price order, and boosts point at real upgrades", () => {
  for (let i = 1; i < R.UPGRADES.length; i++) ok(R.UPGRADES[i].cost > R.UPGRADES[i - 1].cost, R.UPGRADES[i].id);
  const ids = R.UPGRADES.map(u => u.id).concat(R.BOOSTS.map(b => b.id));
  eq(new Set(ids).size, ids.length);
  for (const b of R.BOOSTS) ok(R.UPGRADES.some(u => u.id === b.boosts) && b.needs > 0 && b.cost > 0, b.id);
});

test("a boost unlocks at 10, is bought once, and doubles its upgrade", () => {
  eq(R.cost("bloodhound-training", { "chew-toy": 9 }), Infinity);
  eq(R.cost("bloodhound-training", { "chew-toy": 10 }), 1000);
  eq(R.perClick({ "chew-toy": 10, "bloodhound-training": 1 }), 21);
  eq(R.cost("bloodhound-training", { "chew-toy": 10, "bloodhound-training": 1 }), Infinity);
  const p = sync(fresh({ bones: 5000, owned: { "chew-toy": 10 } }), { buy: ["bloodhound-training", "bloodhound-training", "chew-toy"] }, 0);
  eq(p.owned["bloodhound-training"], 1);
  eq(p.owned["chew-toy"], 11); // the second boost is skipped, not the end of the list
  eq(sync(fresh({ bones: 5000 }), { buy: ["turbo-buddies"] }, 0).bones, 5000);
});

test("trophies are earned once, kept, and give 1% each", () => {
  const p = sync(fresh(), { pats: 40 }, 2000);
  eq(p.game.trophies, ["first-pat"]);
  eq(R.bonus(p.game), 1.01);
  eq(R.perClick({}, p.game), 1.01);
  const q = sync(p, { pats: 40 }, 4000);
  eq(q.game.trophies, ["first-pat"]);
  ok(Math.abs(q.bones - (40 + 40 * 1.01)) < 1e-9);
  eq(R.bonus({ trophies: ["first-pat", "made-up"] }), 1.01);
  eq(R.newTrophies(fresh({ pats: 100, earned: 1000 })).sort(), ["bone-pile", "first-pat", "quick-paws"]);
});

test("a treasure is set soon for new players, then every few minutes, and sinks back when missed", () => {
  const p = sync(fresh(), {}, 0, () => 0);
  eq(p.game.treasureAt, 60 * 1000);
  const q = sync(p, {}, 70 * 1000, () => 0);
  eq(q.game.treasureAt, 60 * 1000); // still up
  const r = sync(q, {}, 80 * 1000, () => 1);
  eq(r.game.treasureAt, 80 * 1000 + 120 * 1000); // missed: the next one
  const s = sync({ ...r, game: { ...r.game, treasures: 3 } }, {}, 1e6, () => 0.5);
  eq(s.game.treasureAt, 1e6 + 270 * 1000);
});

test("a treasure gives a minute of digging and 30 pats, at least 50", () => {
  eq(R.treasure({}), 50);
  eq(R.treasure({ "puppy-pal": 2, "chew-toy": 1 }), 60 * 2 + 30 * 2);
});

test("buying ten at once costs the next ten prices, and the server takes them all", () => {
  const ten = Array.from({ length: 10 }, (_, i) => R.cost("chew-toy", { "chew-toy": i })).reduce((a, b) => a + b, 0);
  eq(R.costN("chew-toy", {}, 10), ten);
  eq(R.costN("bloodhound-training", { "chew-toy": 10 }, 10), Infinity);
  const p = sync(fresh({ bones: ten }), { buy: Array(10).fill("chew-toy") }, 0);
  eq(p.owned["chew-toy"], 10); ok(Math.abs(p.bones) < 1e-9);
  eq(sync(fresh({ bones: 1e12 }), { buy: Array(R.MAX_BUY).fill("puppy-pal") }, 0).owned["puppy-pal"], R.MAX_BUY);
});

test("Max buys as many as you can afford, up to MAX_BUY", () => {
  const owned = { "chew-toy": 3 };
  eq(R.maxBuy("chew-toy", owned, 0), 0);
  eq(R.maxBuy("chew-toy", owned, R.costN("chew-toy", owned, 7)), 7);
  eq(R.maxBuy("chew-toy", owned, R.costN("chew-toy", owned, 7) - 1), 6);
  eq(R.maxBuy("puppy-pal", {}, 1e300), R.MAX_BUY);
  eq(R.maxBuy("bloodhound-training", { "chew-toy": 9 }, 1e300), 0);
  const b = R.BOOSTS[0], unlocked = { [b.boosts]: b.needs };
  eq(R.maxBuy(b.id, unlocked, 1e300), 1);
  eq(R.maxBuy(b.id, unlocked, b.cost - 1), 0);
});

test("what one upgrade makes, with boosts and trophies", () => {
  eq(R.output("dog-park", { "dog-park": 10, "treasure-maps": 1 }, {}), { perClick: 0, perSecond: 160 });
  eq(R.output("chew-toy", { "chew-toy": 2 }, { trophies: ["first-pat"] }), { perClick: 2.02, perSecond: 0 });
});

test("the view has what the page needs", () => {
  const v = view(fresh({ bones: 7, owned: { "chew-toy": 1 } }));
  eq(v.bones, 7); eq(v.perClick, 2); eq(v.perSecond, 0);
});

done();
