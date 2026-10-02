// Players: no sign-up. The first visit makes a player with a random name and a secret token; the
// browser keeps "<pid>.<token>" (the save code) and sends it as `Authorization: Bearer <save code>`.
// Only a hash of the token is stored. A player is one document: { id: "player", pk: "p:<pid>", ... }.
// The game fields on it (bones, owned, game, ...) belong to api/src/game; the ones here don't.
"use strict";
const { json, fail, sha256, randomId, safeEqual } = require("./util");
const ratelimit = require("./ratelimit");
const game = require("../game");

const PID = /^[A-Za-z0-9_-]{8,32}$/, TOKEN = /^[A-Za-z0-9_-]{20,64}$/;
const CORE = ["id", "pk", "pid", "name", "tokenHash", "createdAt"];
const pk = pid => "p:" + pid;

const ADJ = ["Sleepy", "Zoomy", "Snuffly", "Waggy", "Floppy", "Howly", "Sniffy", "Bouncy", "Muddy", "Cuddly", "Speedy", "Goofy", "Fluffy", "Brave", "Hungry", "Noble"];
const NOUN = ["Snoot", "Pup", "Beagle", "Paws", "Tail", "Ears", "Biscuit", "Nose", "Howler", "Sniffer", "Bean", "Nugget"];
const pickOf = list => list[Math.floor(Math.random() * list.length)];
const newName = () => `${pickOf(ADJ)} ${pickOf(NOUN)} ${Math.floor(100 + Math.random() * 900)}`;

// The player this request's save code belongs to, or null.
async function who(c) {
  const m = /^Bearer ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(c.headers.get("authorization") || ""));
  if (!m || !PID.test(m[1]) || !TOKEN.test(m[2])) return null;
  const p = await c.store.read(pk(m[1]), "player");
  return p && safeEqual(p.tokenHash, sha256(m[2])) ? p : null;
}

const view = (p, now) => ({ pid: p.pid, name: p.name, ...game.view(p), serverTime: now });

async function create(c) {
  if (!(await ratelimit.allow(c.store, "new", c.ip, 30, 3600, c.now))) return fail(429, "slow_down", "Too many new saves from here. Try again in a while.");
  const pid = randomId(9), token = randomId(24);
  const p = { id: "player", pk: pk(pid), pid, name: newName(), tokenHash: sha256(token), createdAt: c.now,
    bones: 0, earned: 0, pats: 0, owned: {}, game: {}, syncedAt: c.now };
  await c.store.upsert(p);
  return json(200, { save: `${pid}.${token}`, player: view(p, c.now) });
}

// Change the player's saved game with fn(copy) → the new game (or null to leave it), keeping the
// core's own fields as they were whatever fn does. → the saved player, or null.
async function change(c, pid, fn) {
  return c.store.update(pk(pid), "player", cur => {
    if (!cur) return null;
    const next = fn({ ...cur });
    if (!next) return null;
    for (const k of CORE) next[k] = cur[k];
    return next;
  });
}

async function sync(c, player) {
  const input = { pats: c.body.pats, buy: c.body.buy };
  const p = await change(c, player.pid, cur => game.sync(cur, input, c.now));
  return p ? json(200, { player: view(p, c.now) }) : fail(404, "no_save", "That save isn't there any more.");
}

// Takes `amount` bones (after bringing them up to date). → the saved player, or null when short.
async function spend(c, pid, amount) {
  let enough = false;
  const p = await change(c, pid, cur => {
    const s = game.sync(cur, {}, c.now);
    enough = s.bones >= amount;
    if (!enough) return null;
    s.bones -= amount;
    return s;
  });
  return enough ? p : null;
}

// Gives bones back (a declined suggestion's votes), however long ago they were spent.
async function refund(c, pid, amount) {
  if (!PID.test(pid) || !(amount > 0)) return;
  await change(c, pid, cur => ({ ...cur, bones: (+cur.bones || 0) + amount }));
}

// POST /api/game/<name>: an action from api/src/game/index.js.
async function gameAction(c, player, name) {
  const act = Object.prototype.hasOwnProperty.call(game.actions, name || "") ? game.actions[name] : null;
  if (typeof act !== "function") return fail(404, "not_found", "Nothing here.");
  let out = null;
  for (let i = 0; i < 3 && !out; i++) {
    const cur = await c.store.read(pk(player.pid), "player");
    if (!cur) return fail(404, "no_save", "That save isn't there any more.");
    const r = await act({ player: { ...cur }, body: c.body, now: c.now });
    if (!r || r.error) return fail(400, "refused", String((r && r.error) || "You can't do that.").slice(0, 200));
    // Saved only if nobody saved this player in between (else the action runs again on the new state).
    let clash = false;
    const saved = await change(c, player.pid, now => {
      if (now.syncedAt !== cur.syncedAt || now.bones !== cur.bones) { clash = true; return null; }
      return r.player || null;
    });
    if (!clash) out = { player: saved || cur, body: r.body };
  }
  if (!out) return fail(409, "busy", "Try that again.");
  return json(200, { ...(out.body && typeof out.body === "object" ? out.body : {}), player: view(out.player, c.now) });
}

module.exports = { who, create, sync, spend, refund, gameAction, view, pk };
