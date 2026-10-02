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

test("the view has what the page needs", () => {
  const v = view(fresh({ bones: 7, owned: { "chew-toy": 1 } }));
  eq(v.bones, 7); eq(v.perClick, 2); eq(v.perSecond, 0);
});

done();
