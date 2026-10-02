// beagle.clicker's API. The routes (all under /api):
//
//   POST /players          a new player → { save, player }  (save is the code to keep)
//   GET  /board            the suggestion board and patch notes (your own votes, with a save)
//   POST /sync             { pats, buy: [upgrade ids] } → { player }
//   POST /suggest          { text } → { suggestion, player }
//   POST /vote             { id, amount } → { suggestion, player }
//   POST /game/<name>      the game's own actions (api/src/game/index.js)
//   POST /ops/<what>       the hourly update's calls (ops.js), with x-ops-key
//
// Everything but /players, /board and /ops needs `Authorization: Bearer <save code>` (players.js).
// The store (Cosmos DB in functions/index.js, in memory in dev/memstore.cjs) has:
//   read(pk, id), upsert(doc), update(pk, id, fn), remove(pk, id), list(pk, { limit, orderBy })
// update reads, lets fn work out the new document (or null to leave it) and writes it only if
// nobody wrote in between, else it starts again. Documents with a ttl (seconds) go away by themselves.
"use strict";
const { fail, clientIp } = require("./util");
const players = require("./players");
const suggestions = require("./suggestions");
const ops = require("./ops");

const MAX_BODY = 8 * 1024;

// req: { method, route, sub, headers: { get(name) }, body (parsed JSON), rawLength }
async function handle(req, store, env = process.env, now = Date.now()) {
  if ((req.rawLength || 0) > MAX_BODY) return fail(413, "too_large", "That's too big.");
  const m = req.method, route = req.route;
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  const c = { store, env, now, headers: req.headers, body, ip: clientIp(req.headers) };

  if (route === "ops") return m === "POST" ? ops.handle(req.sub, c) : fail(405, "method", "POST only.");
  if (route === "players") return m === "POST" ? players.create(c) : fail(405, "method", "POST only.");
  if (route === "board") return m === "GET" ? suggestions.board(c, await players.who(c)) : fail(405, "method", "GET only.");

  const player = await players.who(c);
  if (!player) return fail(401, "no_save", "Your save wasn't found. Reload to start a new one, or load your save code.");
  if (m !== "POST") return fail(405, "method", "POST only.");
  if (route === "sync") return players.sync(c, player);
  if (route === "suggest") return suggestions.suggest(c, player);
  if (route === "vote") return suggestions.vote(c, player);
  if (route === "game") return players.gameAction(c, player, req.sub);
  return fail(404, "not_found", "Nothing here.");
}

module.exports = { handle, ROUTES: ["players", "board", "sync", "suggest", "vote", "game", "ops"] };
