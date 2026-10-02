// The suggestion board. Players spend bones to post a suggestion and to vote for one (any number of
// votes, any amount). Every hour the one with the most bones on it is built (ops.js).
//
// Open suggestions (and the one being built) are in partition "s:open"; shipped and declined ones
// move to "s:done", which is the game's patch notes. A suggestion:
//   { id, pk, text, by (pid), byName, at, score, votes: { pid: bones }, status, attempts,
//     startedAt?, doneAt?, title?, notes?, reason?, commit? }
// status: open | building | shipped | declined. A declined suggestion's votes go back to the voters.
"use strict";
const { json, fail, randomId, cleanText, nextHour } = require("./util");
const ratelimit = require("./ratelimit");
const players = require("./players");
const game = require("../game");
const { R } = game;

const OPEN = "s:open", DONE = "s:done";
const SID = /^[A-Za-z0-9_-]{6,32}$/;
const MIN_LEN = 8, MAX_LEN = 200, MAX_OPEN = 300, SHOWN = 60, DONE_SHOWN = 30;
const MAX_VOTE = 1e15;

const norm = t => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function publicOf(s, pid) {
  const voters = s.votes ? Object.keys(s.votes).length : s.voters || 0;
  const o = { id: s.id, text: s.text, byName: s.byName, at: s.at, score: s.score || 0, voters, status: s.status };
  if (pid && s.votes && s.votes[pid]) o.mine = s.votes[pid];
  if (s.by && s.by === pid) o.yours = true;
  for (const k of ["startedAt", "doneAt", "title", "notes", "reason"]) if (s[k] != null) o[k] = s[k];
  return o;
}

const ranked = list => list.slice().sort((a, b) => (b.status === "building") - (a.status === "building") || (b.score || 0) - (a.score || 0) || a.at - b.at);

async function board(c, player) {
  const pid = player && player.pid;
  const open = ranked(await c.store.list(OPEN));
  const done = await c.store.list(DONE, { limit: DONE_SHOWN, orderBy: "doneAt" });
  return json(200, {
    open: open.slice(0, SHOWN).map(s => publicOf(s, pid)),
    openCount: open.length,
    done: done.map(s => publicOf(s, pid)),
    nextPickAt: nextHour(c.now),
    serverTime: c.now,
  });
}

async function suggest(c, player) {
  const text = cleanText(c.body.text, MAX_LEN + 1);
  if (text.length < MIN_LEN) return fail(400, "too_short", "Say a little more: at least a few words.");
  if (text.length > MAX_LEN) return fail(400, "too_long", `Keep it under ${MAX_LEN} characters.`);
  if (/https?:|www\.|\.(com|net|org|io|gg|xyz|ru)\b/i.test(text)) return fail(400, "no_links", "No links, please: just say what you'd like.");
  const open = await c.store.list(OPEN);
  if (open.length >= MAX_OPEN) return fail(409, "board_full", "The board is full. Vote for one that's there instead.");
  const same = open.find(s => norm(s.text) === norm(text));
  if (same) return fail(409, "duplicate", "That's already on the board: give it some bones instead.");
  if (game.sync(player, {}, c.now).bones < R.SUGGEST_COST) return fail(402, "not_enough", `A suggestion costs ${R.SUGGEST_COST} bones.`);
  if (!(await ratelimit.allow(c.store, "suggest", player.pid, 1, 600, c.now))) return fail(429, "slow_down", "One suggestion every 10 minutes.");
  if (!(await ratelimit.allow(c.store, "suggest-ip", c.ip, 20, 86400, c.now))) return fail(429, "slow_down", "That's a lot of suggestions for one day.");
  const paid = await players.spend(c, player.pid, R.SUGGEST_COST);
  if (!paid) return fail(402, "not_enough", `A suggestion costs ${R.SUGGEST_COST} bones.`);
  const s = { id: randomId(8), pk: OPEN, text, by: player.pid, byName: player.name, at: c.now, score: 0, votes: {}, status: "open", attempts: 0 };
  await c.store.upsert(s);
  return json(200, { suggestion: publicOf(s, player.pid), player: players.view(paid, c.now) });
}

async function vote(c, player) {
  const id = String(c.body.id || ""), amount = Math.floor(+c.body.amount || 0);
  if (!SID.test(id)) return fail(400, "bad_id", "That suggestion isn't there.");
  if (!(amount >= 1 && amount <= MAX_VOTE)) return fail(400, "bad_amount", "Give at least 1 bone.");
  const s = await c.store.read(OPEN, id);
  if (!s || s.status !== "open") return fail(409, "closed", s ? "That one's being built right now." : "That suggestion isn't on the board any more.");
  const paid = await players.spend(c, player.pid, amount);
  if (!paid) return fail(402, "not_enough", "You don't have that many bones.");
  const after = await c.store.update(OPEN, id, cur => {
    if (!cur || cur.status !== "open") return null;
    const votes = { ...(cur.votes || {}) };
    votes[player.pid] = (votes[player.pid] || 0) + amount;
    return { ...cur, votes, score: (cur.score || 0) + amount };
  });
  if (!after) { // picked or removed between the read and the vote
    await players.refund(c, player.pid, amount);
    return fail(409, "closed", "That one just closed, so your bones are back.");
  }
  const p = await c.store.read(players.pk(player.pid), "player");
  return json(200, { suggestion: publicOf(after, player.pid), player: players.view(p || paid, c.now) });
}

// Moves a suggestion to the patch notes as shipped or declined. Declined gives every vote back.
async function close(c, s, status, extra) {
  const done = { ...s, ...extra, pk: DONE, status, doneAt: c.now, voters: Object.keys(s.votes || {}).length };
  if (status === "declined") {
    const votes = Object.entries(s.votes || {});
    for (let i = 0; i < votes.length; i += 10) await Promise.all(votes.slice(i, i + 10).map(([pid, n]) => players.refund(c, pid, n)));
  }
  delete done.votes;
  await c.store.upsert(done);
  await c.store.remove(OPEN, s.id);
  return done;
}

module.exports = { board, suggest, vote, close, ranked, publicOf, OPEN, DONE, SID };
