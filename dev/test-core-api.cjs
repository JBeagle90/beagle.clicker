// The API end to end on the in-memory store: players, syncing, suggestions, votes, the hourly pick
// and its result, refunds. (The owner's test: hourly updates may not change test-core-* files.)
"use strict";
const { test, eq, ok, done } = require("./t.cjs");
const { handle } = require("../api/src/core/lib.js");
const { memoryStore } = require("./memstore.cjs");

const OPS_KEY = "test-ops-key-0123456789abcdef";
const env = { OPS_KEY };
let store, clock;

function api(method, path, body, { save, ops, ip = "1.2.3.4" } = {}) {
  const [route, sub] = path.replace(/^\//, "").split("/");
  const h = { "x-forwarded-for": ip + ":5555" };
  if (save) h.authorization = "Bearer " + save;
  if (ops) h["x-ops-key"] = ops;
  return handle({ method, route, sub, headers: { get: k => h[k.toLowerCase()] }, body, rawLength: body ? JSON.stringify(body).length : 0 }, store, env, clock);
}
const reset = () => { store = memoryStore(); clock = Date.UTC(2026, 9, 2, 12, 0, 0); };
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
  clock += 1000;
  const r = await api("POST", "/sync", { pats: 0, buy: ["chew-toy"] }, { save });
  eq(r.jsonBody.player.owned["chew-toy"], 1);
  eq(r.jsonBody.player.bones, 25);
  eq(r.jsonBody.player.perClick, 2);
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
  const r = await api("POST", "/suggest", { text: "  Add a   golden bone\u0000 that appears sometimes " }, { save });
  eq(r.status, 200);
  eq(r.jsonBody.suggestion.text, "Add a golden bone that appears sometimes");
  eq(r.jsonBody.player.bones, 200);
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
  ok(board.nextPickAt > clock && board.nextPickAt - clock <= 3600 * 1000);
});

test("ops calls need the key", async () => {
  reset();
  eq((await api("POST", "/ops/pick", {}, {})).status, 403);
  eq((await api("POST", "/ops/pick", {}, { ops: "wrong-key-wrong-key-wrong-key" })).status, 403);
  eq((await api("POST", "/ops/pick", {}, { ops: OPS_KEY })).status, 200);
});

test("the hourly pick takes the top suggestion, and nothing else while it's building", async () => {
  reset();
  const a = await player();
  await earn(a, 400);
  const s = (await api("POST", "/suggest", { text: "Make the beagle wear sunglasses" }, { save: a })).jsonBody.suggestion;
  eq((await api("POST", "/ops/pick", {}, { ops: OPS_KEY })).jsonBody.reason, "nothing", "no bones on it yet");
  await api("POST", "/vote", { id: s.id, amount: 30 }, { save: a });
  const p = (await api("POST", "/ops/pick", {}, { ops: OPS_KEY })).jsonBody.pick;
  eq(p.id, s.id); eq(p.text, "Make the beagle wear sunglasses"); eq(p.score, 30);
  eq((await api("POST", "/ops/pick", {}, { ops: OPS_KEY })).jsonBody.reason, "busy");
  eq((await api("POST", "/vote", { id: s.id, amount: 5 }, { save: a })).status, 409, "no votes once it's building");
});

test("shipped goes to the patch notes", async () => {
  reset();
  const a = await player();
  await earn(a, 400);
  const s = (await api("POST", "/suggest", { text: "Make the beagle wear sunglasses" }, { save: a })).jsonBody.suggestion;
  await api("POST", "/vote", { id: s.id, amount: 30 }, { save: a });
  await api("POST", "/ops/pick", {}, { ops: OPS_KEY });
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
  await api("POST", "/ops/pick", {}, { ops: OPS_KEY });
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
  await api("POST", "/ops/pick", {}, { ops: OPS_KEY });
  await api("POST", "/ops/result", { id: s.id, status: "failed" }, { ops: OPS_KEY });
  eq((await api("GET", "/board")).jsonBody.open[0].status, "open");
  await api("POST", "/ops/pick", {}, { ops: OPS_KEY });
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
  await api("POST", "/ops/pick", {}, { ops: OPS_KEY });
  clock += 3.5 * 3600 * 1000;
  const p = (await api("POST", "/ops/pick", {}, { ops: OPS_KEY })).jsonBody.pick;
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
    eq((await api("POST", "/sync", {}, { save: b })).jsonBody.player.game, {});
    eq((await api("POST", "/game/greedy", {}, { save: a })).status, 400);
  } finally { delete game.actions.wave; delete game.actions.greedy; }
});

test("big bodies are refused", async () => {
  reset();
  const r = await handle({ method: "POST", route: "players", headers: { get: () => undefined }, body: {}, rawLength: 100000 }, store, env, clock);
  eq(r.status, 413);
});

done();
