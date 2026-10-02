// The API end to end on the in-memory store: players, syncing, suggestions, votes, the scheduled pick
// and its result, refunds, own ideas, ratings, reports, limits. (The owner's test: scheduled updates may not change test-core-* files.)
"use strict";
const { test, eq, ok, done } = require("./t.cjs");
const { handle } = require("../api/src/core/lib.js");
const { memoryStore } = require("./memstore.cjs");

const OPS_KEY = "test-ops-key-0123456789abcdef";
let env;
let store, clock;

function api(method, path, body, { save, ops, ip = "1.2.3.4" } = {}) {
  const [p, qs] = path.replace(/^\//, "").split("?");
  const [route, sub] = p.split("/");
  const h = { "x-forwarded-for": ip + ":5555" };
  if (save) h["x-bc-save"] = save;
  if (ops) h["x-ops-key"] = ops;
  return handle({ method, route, sub, query: new URLSearchParams(qs || ""), headers: { get: k => h[k.toLowerCase()] }, body, rawLength: body ? JSON.stringify(body).length : 0 }, store, env, clock);
}
const reset = () => { store = memoryStore(); clock = Date.UTC(2026, 9, 2, 12, 0, 0); env = { OPS_KEY }; };
async function player(ip) { const r = await api("POST", "/players", null, { ip }); eq(r.status, 200); return r.jsonBody.save; }
// Gives a player bones the honest way: by patting, a batch every second.
async function earn(save, bones) {
  for (let left = bones; left > 0; left -= 20) { clock += 1000; const r = await api("POST", "/sync", { pats: Math.min(20, left) }, { save }); eq(r.status, 200); }
}
const bonesOf = async save => (await api("POST", "/sync", {}, { save })).jsonBody.player.bones;

test("a new player gets a save code and a name", async () => {
  reset();
  const r = await api("POST", "/players");
  eq(r.status, 200);
  ok(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(r.jsonBody.save));
  ok(r.jsonBody.player.name.length > 3);
  eq(r.jsonBody.player.bones, 0);
  ok(!JSON.stringify(store.dump()).includes(r.jsonBody.save.split(".")[1]), "the token itself isn't stored");
});

test("a wrong or missing save code is refused", async () => {
  reset();
  const save = await player();
  eq((await api("POST", "/sync", {}, {})).status, 401);
  eq((await api("POST", "/sync", {}, { save: save.split(".")[0] + ".AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" })).status, 401);
  eq((await api("POST", "/sync", {}, { save })).status, 200);
});

test("syncing counts pats and buys", async () => {
  reset();
  const save = await player();
  await earn(save, 40);
  const had = await bonesOf(save), R = require("../api/src/game/rules.js");
  ok(had >= 40);
  const r = await api("POST", "/sync", { pats: 0, buy: ["chew-toy"] }, { save });
  const me = r.jsonBody.player;
  eq(me.owned["chew-toy"], 1);
  eq(me.bones, had - R.cost("chew-toy", {}));
  eq(me.perClick, R.perClick(me.owned, me.game));
  ok(me.perClick > R.perClick({}, me.game));
});

test("a player can change their name, within limits", async () => {
  reset();
  const save = await player();
  const r = await api("POST", "/name", { name: "  Digger   Dan  " }, { save });
  eq(r.status, 200); eq(r.jsonBody.player.name, "Digger Dan");
  eq((await api("POST", "/sync", {}, { save })).jsonBody.player.name, "Digger Dan");
  for (const bad of ["ab", "x".repeat(25), "<b>hi</b>", "Claude", "the real claude", "Site Admin", "go to www.x.com", "big poop shit"])
    eq((await api("POST", "/name", { name: bad }, { save })).status, 400, bad);
  eq((await api("POST", "/name", { name: "Digger Dan" }, { save })).status, 200, "the same name is free");
  for (let i = 0; i < 4; i++) eq((await api("POST", "/name", { name: "Name " + i }, { save })).status, 200);
  eq((await api("POST", "/name", { name: "One Too Many" }, { save })).status, 429);
  eq((await api("POST", "/name", { name: "Nobody" })).status, 401);
});

test("game code can't change who a player is", async () => {
  reset();
  const save = await player();
  const before = store.dump().find(d => d.id === "player");
  const game = require("../api/src/game");
  const real = game.sync;
  game.sync = (p, i, now) => ({ ...real(p, i, now), name: "Hacked", tokenHash: "x", pid: "someone-else" });
  try { await api("POST", "/sync", {}, { save }); } finally { game.sync = real; }
  const after = store.dump().find(d => d.id === "player");
  eq([after.name, after.tokenHash, after.pid], [before.name, before.tokenHash, before.pid]);
});

test("too many new players from one address are slowed down", async () => {
  reset();
  for (let i = 0; i < 30; i++) eq((await api("POST", "/players", null, { ip: "9.9.9.9" })).status, 200);
  eq((await api("POST", "/players", null, { ip: "9.9.9.9" })).status, 429);
  eq((await api("POST", "/players", null, { ip: "8.8.8.8" })).status, 200);
});

test("suggesting costs bones and checks the words", async () => {
  reset();
  const save = await player();
  eq((await api("POST", "/suggest", { text: "Add a golden bone" }, { save })).status, 402);
  await earn(save, 300);
  eq((await api("POST", "/suggest", { text: "hi" }, { save })).status, 400);
  eq((await api("POST", "/suggest", { text: "go to https://example.com for ideas" }, { save })).status, 400);
  const had = await bonesOf(save);
  const r = await api("POST", "/suggest", { text: "  Add a   golden bone\u0000 that appears sometimes " }, { save });
  eq(r.status, 200);
  eq(r.jsonBody.suggestion.text, "Add a golden bone that appears sometimes");
  eq(r.jsonBody.player.bones, had - 100);
  eq((await api("POST", "/suggest", { text: "Another idea entirely, please" }, { save })).status, 429, "one per 10 minutes");
  clock += 11 * 60 * 1000;
  eq((await api("POST", "/suggest", { text: "add a GOLDEN bone that appears sometimes!" }, { save })).status, 409, "duplicate");
});

test("voting moves bones onto a suggestion; the board ranks by bones", async () => {
  reset();
  const a = await player("1.1.1.1"), b = await player("2.2.2.2");
  await earn(a, 400); await earn(b, 400);
  const s1 = (await api("POST", "/suggest", { text: "A hat for the beagle" }, { save: a })).jsonBody.suggestion;
  const s2 = (await api("POST", "/suggest", { text: "Night mode with stars" }, { save: b })).jsonBody.suggestion;
  eq((await api("POST", "/vote", { id: s2.id, amount: 50 }, { save: a })).status, 200);
  const v = await api("POST", "/vote", { id: s2.id, amount: 20 }, { save: b });
  eq(v.jsonBody.suggestion.score, 70);
  eq(v.jsonBody.suggestion.mine, 20);
  eq((await api("POST", "/vote", { id: s1.id, amount: 10 }, { save: b })).status, 200);
  eq((await api("POST", "/vote", { id: s1.id, amount: 1e6 }, { save: b })).status, 402);
  eq((await api("POST", "/vote", { id: s1.id, amount: 0 }, { save: b })).status, 400);
  const board = (await api("GET", "/board", null, { save: a })).jsonBody;
  eq(board.open.map(s => s.id), [s2.id, s1.id]);
  eq(board.open[0].mine, 50);
  eq(board.open[0].voters, 2);
  ok(!("votes" in board.open[0]), "who gave what isn't public");
  ok(board.nextPickAt > clock && board.nextPickAt - clock <= 3 * 3600 * 1000, "every 3 hours by default");
  eq(board.updateHours, 3);
  eq(board.limits.max, 140);
});

test("ops calls need the key", async () => {
  reset();
  eq((await api("POST", "/ops/pick", { manual: true }, {})).status, 403);
  eq((await api("POST", "/ops/pick", { manual: true }, { ops: "wrong-key-wrong-key-wrong-key" })).status, 403);
  eq((await api("POST", "/ops/pick", { manual: true }, { ops: OPS_KEY })).status, 200);
});

test("the pick takes the top suggestion, and nothing else while it's building", async () => {
  reset();
  const a = await player();
  await earn(a, 400);
  const s = (await api("POST", "/suggest", { text: "Make the beagle wear sunglasses" }, { save: a })).jsonBody.suggestion;
  await api("POST", "/vote", { id: s.id, amount: 30 }, { save: a });
  const p = (await api("POST", "/ops/pick", { manual: true }, { ops: OPS_KEY })).jsonBody.pick;
  eq(p.id, s.id); eq(p.text, "Make the beagle wear sunglasses"); eq(p.score, 30);
  eq((await api("POST", "/ops/pick", { manual: true }, { ops: OPS_KEY })).jsonBody.reason, "busy");
  eq((await api("POST", "/vote", { id: s.id, amount: 5 }, { save: a })).status, 409, "no votes once it's building");
});

test("shipped goes to the patch notes", async () => {
  reset();
  const a = await player();
  await earn(a, 400);
  const s = (await api("POST", "/suggest", { text: "Make the beagle wear sunglasses" }, { save: a })).jsonBody.suggestion;
  await api("POST", "/vote", { id: s.id, amount: 30 }, { save: a });
  await api("POST", "/ops/pick", { manual: true }, { ops: OPS_KEY });
  const r = await api("POST", "/ops/result", { id: s.id, status: "shipped", title: "Cool shades", notes: "Tap the beagle 100 times to see them.", commit: "abc1234" }, { ops: OPS_KEY });
  eq(r.status, 200);
  const board = (await api("GET", "/board", null, { save: a })).jsonBody;
  eq(board.open.length, 0);
  eq(board.done[0].status, "shipped"); eq(board.done[0].title, "Cool shades"); eq(board.done[0].voters, 1);
});

test("declined gives every bone back", async () => {
  reset();
  const a = await player("1.1.1.1"), b = await player("2.2.2.2");
  await earn(a, 400); await earn(b, 400);
  const s = (await api("POST", "/suggest", { text: "Something we can't build" }, { save: a })).jsonBody.suggestion;
  await api("POST", "/vote", { id: s.id, amount: 100 }, { save: a });
  await api("POST", "/vote", { id: s.id, amount: 250 }, { save: b });
  const before = [await bonesOf(a), await bonesOf(b)];
  await api("POST", "/ops/pick", { manual: true }, { ops: OPS_KEY });
  await api("POST", "/ops/result", { id: s.id, status: "declined", reason: "It isn't about the game." }, { ops: OPS_KEY });
  eq([await bonesOf(a), await bonesOf(b)], [before[0] + 100, before[1] + 250]);
  const d = (await api("GET", "/board")).jsonBody.done[0];
  eq(d.status, "declined"); eq(d.reason, "It isn't about the game.");
});

test("a failed build goes back on the board once, then is declined", async () => {
  reset();
  const a = await player();
  await earn(a, 400);
  const s = (await api("POST", "/suggest", { text: "Flaky build please" }, { save: a })).jsonBody.suggestion;
  await api("POST", "/vote", { id: s.id, amount: 40 }, { save: a });
  await api("POST", "/ops/pick", { manual: true }, { ops: OPS_KEY });
  await api("POST", "/ops/result", { id: s.id, status: "failed" }, { ops: OPS_KEY });
  eq((await api("GET", "/board")).jsonBody.open[0].status, "open");
  await api("POST", "/ops/pick", { manual: true }, { ops: OPS_KEY });
  await api("POST", "/ops/result", { id: s.id, status: "failed" }, { ops: OPS_KEY });
  const board = (await api("GET", "/board")).jsonBody;
  eq(board.open.length, 0); eq(board.done[0].status, "declined");
});

test("a build that never reports back is given up on after 3 hours", async () => {
  reset();
  const a = await player();
  await earn(a, 400);
  const s = (await api("POST", "/suggest", { text: "Lost in the mail" }, { save: a })).jsonBody.suggestion;
  await api("POST", "/vote", { id: s.id, amount: 40 }, { save: a });
  await api("POST", "/ops/pick", { manual: true }, { ops: OPS_KEY });
  clock += 3.5 * 3600 * 1000;
  const p = (await api("POST", "/ops/pick", { manual: true }, { ops: OPS_KEY })).jsonBody.pick;
  eq(p && p.id, s.id, "picked again after the stuck one is reset");
  eq(p.attempts, 1);
});

test("the owner can take a suggestion off the board", async () => {
  reset();
  const a = await player();
  await earn(a, 400);
  const s = (await api("POST", "/suggest", { text: "Something rude here" }, { save: a })).jsonBody.suggestion;
  await api("POST", "/vote", { id: s.id, amount: 60 }, { save: a });
  const before = await bonesOf(a);
  eq((await api("POST", "/ops/hide", { id: s.id }, { ops: OPS_KEY })).status, 200);
  eq(await bonesOf(a), before + 60);
  eq((await api("GET", "/board")).jsonBody.open.length, 0);
});

test("game actions: unknown ones are 404, and one can change only its caller", async () => {
  reset();
  const a = await player("1.1.1.1"), b = await player("2.2.2.2");
  eq((await api("POST", "/game/nope", {}, { save: a })).status, 404);
  eq((await api("POST", "/game/constructor", {}, { save: a })).status, 404);
  const game = require("../api/src/game");
  game.actions.wave = async ({ player }) => ({ player: { ...player, game: { ...player.game, waves: (player.game.waves || 0) + 1 } }, body: { ok: true } });
  game.actions.greedy = async () => ({ error: "Not allowed." });
  try {
    const r = await api("POST", "/game/wave", {}, { save: a });
    eq(r.status, 200); eq(r.jsonBody.ok, true); eq(r.jsonBody.player.game.waves, 1);
    eq((await api("POST", "/sync", {}, { save: b })).jsonBody.player.game.waves, undefined);
    eq((await api("POST", "/game/greedy", {}, { save: a })).status, 400);
  } finally { delete game.actions.wave; delete game.actions.greedy; }
});

test("with no bones on anything, Claude builds its own idea, and it's numbered in the log", async () => {
  reset();
  const r = (await api("POST", "/ops/pick", { manual: true }, { ops: OPS_KEY })).jsonBody;
  eq(r.reason, "own"); eq(r.pick.own, true);
  const board = (await api("GET", "/board")).jsonBody;
  eq(board.open[0].status, "building"); eq(board.open[0].own, true);
  await api("POST", "/ops/result", { id: r.pick.id, status: "shipped", title: "Sleepy beagle", idea: "The beagle naps when nobody pats it.", summary: "The beagle dozes off after a while.\n- Snores appear above its head\n- A pat wakes it up" }, { ops: OPS_KEY });
  const d = (await api("GET", "/board")).jsonBody.done[0];
  eq([d.n, d.own, d.text, d.byName], [1, true, "The beagle naps when nobody pats it.", "Claude"]);
  eq(d.summary, ["The beagle dozes off after a while.", "- Snores appear above its head", "- A pat wakes it up"]);
  clock += 3 * 3600 * 1000;
  const r2 = (await api("POST", "/ops/pick", { manual: true }, { ops: OPS_KEY })).jsonBody.pick;
  await api("POST", "/ops/result", { id: r2.id, status: "shipped", title: "Second", idea: "Another one" }, { ops: OPS_KEY });
  eq((await api("GET", "/board")).jsonBody.done[0].n, 2);
});

test("each update leaves Claude's three ideas on the board, and one is picked when nothing has bones", async () => {
  reset();
  const ops = (what, body) => api("POST", "/ops/" + what, body, { ops: OPS_KEY });
  eq((await api("POST", "/ops/seed", { ideas: ["A rare gold chest"] })).status, 403, "needs the key");
  const seeded = (await ops("seed", { ideas: ["A rare gold chest that gives three times the bones", "x", "Visit www.example.com for fun", "Goggles for the beagle with a Bone Digger", "A dig sound with an on/off button", "One too many ideas here"] })).jsonBody.ideas;
  eq(seeded.map(i => i.text), ["A rare gold chest that gives three times the bones", "Goggles for the beagle with a Bone Digger", "A dig sound with an on/off button"]);
  let board = (await api("GET", "/board")).jsonBody;
  eq(board.open.length, 3);
  ok(board.open.every(s => s.own && s.byName === "Claude" && s.score === 0 && s.status === "open"));
  // Nothing has bones: one of Claude's ideas, at random, keeping its text
  const r = (await ops("pick", { manual: true })).jsonBody;
  eq(r.reason, "own_idea"); eq(r.pick.own, true);
  ok(seeded.some(i => i.id === r.pick.id && i.text === r.pick.text));
  // It ships with three new ideas: the other two (nobody backed them) make way for the new ones
  const res = (await ops("result", { id: r.pick.id, status: "shipped", title: "Done", idea: "ignored", ideas: ["Ten more ticker headlines for later", "A trophy for owning every boost", "Sparkles when a chest opens"] })).jsonBody;
  eq(res.done.text, r.pick.text);
  eq(res.ideas.length, 3);
  board = (await api("GET", "/board")).jsonBody;
  eq(board.open.map(s => s.text).sort(), ["A trophy for owning every boost", "Sparkles when a chest opens", "Ten more ticker headlines for later"]);
  // A player backs one of Claude's ideas: it competes like any suggestion and stays when new ideas come
  const save = await player();
  await earn(save, 200);
  const backedId = board.open.find(s => s.text === "Sparkles when a chest opens").id;
  eq((await api("POST", "/vote", { id: backedId, amount: 50 }, { save })).status, 200);
  await ops("seed", { ideas: ["A brand new idea for the board"] });
  board = (await api("GET", "/board")).jsonBody;
  eq(board.open.map(s => s.text).sort(), ["A brand new idea for the board", "Sparkles when a chest opens"]);
  clock += 3600 * 1000;
  const r2 = (await ops("pick", { manual: true })).jsonBody;
  eq([r2.reason, r2.pick.id, r2.pick.own, r2.pick.score], ["top", backedId, true, 50]);
  // Declined: its backers get their bones back, like any suggestion
  const before = await bonesOf(save);
  await ops("result", { id: backedId, status: "declined", reason: "Not this time." });
  ok(Math.abs((await bonesOf(save)) - before - 50) < 1e-6);
  eq((await api("GET", "/board")).jsonBody.done[0].status, "declined");
});

test("Claude's own idea that fails or is declined just goes away", async () => {
  reset();
  const r = (await api("POST", "/ops/pick", { manual: true }, { ops: OPS_KEY })).jsonBody.pick;
  await api("POST", "/ops/result", { id: r.id, status: "failed" }, { ops: OPS_KEY });
  let b = (await api("GET", "/board")).jsonBody;
  eq([b.open.length, b.done.length], [0, 0]);
  const r2 = (await api("POST", "/ops/pick", { manual: true }, { ops: OPS_KEY })).jsonBody.pick;
  await api("POST", "/ops/result", { id: r2.id, status: "declined" }, { ops: OPS_KEY });
  b = (await api("GET", "/board")).jsonBody;
  eq([b.open.length, b.done.length], [0, 0]);
});

test("OWN_IDEAS=0 skips the run when nothing has bones", async () => {
  reset();
  env.OWN_IDEAS = "0";
  eq((await api("POST", "/ops/pick", { manual: true }, { ops: OPS_KEY })).jsonBody.pick, null);
});

test("spending limits: no build past the 30-day budget or the daily count", async () => {
  reset();
  env.BUDGET_USD_30D = "5";
  const r = (await api("POST", "/ops/pick", { manual: true }, { ops: OPS_KEY })).jsonBody.pick;
  await api("POST", "/ops/result", { id: r.id, status: "shipped", title: "x", idea: "something small", cost: 5.5 }, { ops: OPS_KEY });
  const b = (await api("POST", "/ops/pick", { manual: true }, { ops: OPS_KEY })).jsonBody;
  eq([b.pick, b.reason, b.spent.usd], [null, "budget", 5.5]);
  clock += 31 * 24 * 3600 * 1000;
  ok((await api("POST", "/ops/pick", { manual: true }, { ops: OPS_KEY })).jsonBody.pick, "a month later the budget is free again");

  reset();
  env.MAX_BUILDS_PER_DAY = "2";
  for (let i = 0; i < 2; i++) {
    const p = (await api("POST", "/ops/pick", { manual: true }, { ops: OPS_KEY })).jsonBody.pick;
    await api("POST", "/ops/result", { id: p.id, status: "shipped", title: "x", idea: "idea " + i }, { ops: OPS_KEY });
  }
  eq((await api("POST", "/ops/pick", { manual: true }, { ops: OPS_KEY })).jsonBody.reason, "daily_limit");
  clock += 25 * 3600 * 1000;
  ok((await api("POST", "/ops/pick", { manual: true }, { ops: OPS_KEY })).jsonBody.pick);
});

test("suggestions: at most 140 characters, and no rude words", async () => {
  reset();
  const a = await player();
  await earn(a, 400);
  eq((await api("POST", "/suggest", { text: "x".repeat(141) }, { save: a })).status, 400);
  eq((await api("POST", "/suggest", { text: "make the beagle s3xy please" }, { save: a })).jsonBody.error.code, "not_ok");
  env.BLOCKED_WORDS = "squirrel*";
  eq((await api("POST", "/suggest", { text: "add squirrels to chase" }, { save: a })).jsonBody.error.code, "not_ok");
  eq((await api("POST", "/suggest", { text: "y".repeat(140) }, { save: a })).status, 200);
});

test("ratings: players who've played rate a shipped update; it can change", async () => {
  reset();
  const a = await player("1.1.1.1"), b = await player("2.2.2.2"), fresh = await player("3.3.3.3");
  await earn(a, 60); await earn(b, 60);
  const p = (await api("POST", "/ops/pick", { manual: true }, { ops: OPS_KEY })).jsonBody.pick;
  await api("POST", "/ops/result", { id: p.id, status: "shipped", title: "Hats", idea: "Hats for the beagle" }, { ops: OPS_KEY });
  eq((await api("POST", "/rate", { id: p.id, rating: "great" }, { save: fresh })).status, 403, "a brand-new save can't rate");
  eq((await api("POST", "/rate", { id: p.id, rating: "amazing" }, { save: a })).status, 400);
  eq((await api("POST", "/rate", { id: p.id, rating: "great" }, { save: a })).status, 200);
  eq((await api("POST", "/rate", { id: p.id, rating: "bad" }, { save: b })).status, 200);
  const u = (await api("POST", "/rate", { id: p.id, rating: "good" }, { save: b })).jsonBody.update;
  eq(u.ratings.counts, [0, 0, 0, 1, 1]); eq(u.ratings.mine, "good"); eq(u.ratings.avg, 4.5);
  const next = (await api("POST", "/ops/pick", { manual: true }, { ops: OPS_KEY })).jsonBody;
  eq(next.ratings[0].ratings, { terrible: 0, bad: 0, neutral: 0, good: 1, great: 1 }, "the next build hears how it went");
});

test("reports: three players take a suggestion down and its bones go back", async () => {
  reset();
  const saves = [];
  for (let i = 0; i < 5; i++) { saves.push(await player("10.0.0." + i)); await earn(saves[i], 200); }
  const s = (await api("POST", "/suggest", { text: "Something people will not like" }, { save: saves[0] })).jsonBody.suggestion;
  await api("POST", "/vote", { id: s.id, amount: 50 }, { save: saves[0] });
  const before = await bonesOf(saves[0]);
  eq((await api("POST", "/report", { id: s.id }, { save: saves[0] })).status, 409, "not your own");
  for (let i = 1; i <= 3; i++) eq((await api("POST", "/report", { id: s.id }, { save: saves[i] })).status, 200);
  eq((await api("POST", "/report", { id: s.id }, { save: saves[4] })).status, 409, "already down");
  eq((await api("GET", "/board")).jsonBody.open.length, 0);
  eq(await bonesOf(saves[0]), before + 50);
});

test("the log pages back through older updates", async () => {
  reset();
  env.MAX_BUILDS_PER_DAY = "100";
  for (let i = 0; i < 25; i++) {
    clock += 3 * 3600 * 1000;
    const p = (await api("POST", "/ops/pick", { manual: true }, { ops: OPS_KEY })).jsonBody.pick;
    await api("POST", "/ops/result", { id: p.id, status: "shipped", title: "Update " + i, idea: "idea number " + i }, { ops: OPS_KEY });
  }
  const b = (await api("GET", "/board")).jsonBody;
  eq([b.done.length, b.moreDone, b.done[0].n], [20, true, 25]);
  const old = (await api("GET", "/log?before=" + b.done[19].doneAt)).jsonBody;
  eq([old.done.length, old.more, old.done[0].n, old.done[4].n], [5, false, 5, 1]);
});

test("big bodies are refused", async () => {
  reset();
  const r = await handle({ method: "POST", route: "players", headers: { get: () => undefined }, body: {}, rawLength: 100000 }, store, env, clock);
  eq(r.status, 413);
});

done();
