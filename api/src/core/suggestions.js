// The suggestion board and the update log. Players spend bones to post a suggestion and to vote for
// one (any number of votes, any amount). On every scheduled update the one with the most bones is
// built (ops.js); when none has any, Claude builds an idea of its own. Players rate each shipped
// update from terrible to great.
//
// Open suggestions (and the one being built) are in partition "s:open"; shipped and declined ones
// move to "s:done", which is the update log. A suggestion:
//   { id, pk, text, by (pid, or null for Claude's own), byName, own?, at, score, votes: { pid: bones },
//     status, attempts, startedAt?, doneAt?, n? (update number), title?, summary? (lines), reason?,
//     commit?, ratings?: { pid: 1..5 }, ownerPick? (when the owner picked it) }
// status: open | building | shipped | declined. A declined suggestion's votes go back to the voters.
// The owner's picks (owner.js) are built first, in the order picked, whatever their bones; they take
// no more votes, and the bones already on them stay there.
"use strict";
const { json, fail, randomId, cleanText } = require("./util");
const ratelimit = require("./ratelimit");
const moderation = require("./moderation");
const schedule = require("./schedule");
const players = require("./players");
const game = require("../game");
const { R } = game;

const OPEN = "s:open", DONE = "s:done";
const SID = /^[A-Za-z0-9_-]{6,32}$/;
// Short on purpose: a suggestion is one small idea, so each update stays small, cheap to build,
// and doesn't change the game too much at once.
const MIN_LEN = 10, MAX_LEN = 140;
const MAX_OPEN = 300, SHOWN = 60, PAGE = 20;
const MAX_VOTE = 1e15;
const RATINGS = ["terrible", "bad", "neutral", "good", "great"]; // stored as 1..5
const RATE_MIN_EARNED = 50; // bones a player has earned before their rating or report counts (not a brand-new save)
const REPORTS_TO_HIDE = 3;  // players reporting a suggestion before it comes down (the owner can always hide one)

const norm = t => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function ratingsOf(s, pid) {
  const counts = [0, 0, 0, 0, 0];
  for (const v of Object.values(s.ratings || {})) if (v >= 1 && v <= 5) counts[v - 1]++;
  const total = counts.reduce((a, b) => a + b, 0);
  const avg = total ? counts.reduce((a, n, i) => a + n * (i + 1), 0) / total : null;
  const out = { counts, total, avg };
  if (pid && s.ratings && s.ratings[pid]) out.mine = RATINGS[s.ratings[pid] - 1];
  return out;
}

function publicOf(s, pid) {
  const voters = s.votes ? Object.keys(s.votes).length : s.voters || 0;
  const o = { id: s.id, text: s.text, byName: s.byName, at: s.at, score: s.score || 0, voters, status: s.status };
  if (s.own) o.own = true;
  if (s.ownerPick) o.ownerPick = true;
  if (pid && s.votes && s.votes[pid]) o.mine = s.votes[pid];
  if (s.by && s.by === pid) o.yours = true;
  for (const k of ["startedAt", "doneAt", "n", "title", "summary", "reason"]) if (s[k] != null) o[k] = s[k];
  if (s.status === "shipped") o.ratings = ratingsOf(s, pid);
  return o;
}

// Being built, then the owner's picks (first picked first), then the most bones.
const ranked = list => list.slice().sort((a, b) => (b.status === "building") - (a.status === "building")
  || (a.ownerPick || Infinity) - (b.ownerPick || Infinity) || (b.score || 0) - (a.score || 0) || a.at - b.at);
const limits = () => ({ min: MIN_LEN, max: MAX_LEN, cost: R.SUGGEST_COST });

async function board(c, player) {
  const pid = player && player.pid, settings = await schedule.read(c);
  const open = ranked(await c.store.list(OPEN));
  const done = await c.store.list(DONE, { limit: PAGE, orderBy: "doneAt" });
  return json(200, {
    open: open.slice(0, SHOWN).map(s => publicOf(s, pid)),
    openCount: open.length,
    done: done.map(s => publicOf(s, pid)),
    moreDone: done.length === PAGE,
    limits: limits(),
    updateHours: schedule.hoursOf(settings, c.env),
    nextPickAt: schedule.nextAt(settings, c.env, c.now),
    serverTime: c.now,
  });
}

// GET /api/log?before=<doneAt>: the update log, older than that.
async function log(c, player) {
  const before = Math.floor(+(c.query.get("before") || 0)) || c.now + 1;
  const done = await c.store.list(DONE, { limit: PAGE, orderBy: "doneAt", before });
  return json(200, { done: done.map(s => publicOf(s, player && player.pid)), more: done.length === PAGE });
}

async function suggest(c, player) {
  const text = cleanText(c.body.text, MAX_LEN + 1);
  if (text.length < MIN_LEN) return fail(400, "too_short", "Say a little more: at least a few words.");
  if (text.length > MAX_LEN) return fail(400, "too_long", `Keep it to ${MAX_LEN} characters: one small idea at a time.`);
  if (/https?:|www\.|\.(com|net|org|io|gg|xyz|ru)\b/i.test(text)) return fail(400, "no_links", "No links, please: just say what you'd like.");
  if (moderation.blocked(text, c.env)) return fail(400, "not_ok", "Let's keep it friendly: beagle.clicker is for everyone. Try different words.");
  const open = await c.store.list(OPEN);
  if (open.length >= MAX_OPEN) return fail(409, "board_full", "The board is full. Vote for one that's there instead.");
  if (open.find(s => norm(s.text) === norm(text))) return fail(409, "duplicate", "That's already on the board: give it some bones instead.");
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
  if (s.ownerPick) return fail(409, "picked", "That one's already picked for the next update, so it doesn't need bones.");
  const paid = await players.spend(c, player.pid, amount);
  if (!paid) return fail(402, "not_enough", "You don't have that many bones.");
  const after = await c.store.update(OPEN, id, cur => {
    if (!cur || cur.status !== "open" || cur.ownerPick) return null;
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

// POST /api/rate { id, rating: terrible | bad | neutral | good | great }: how well a shipped update
// turned out. Free, one per player per update, and it can be changed.
async function rate(c, player) {
  const id = String(c.body.id || ""), r = RATINGS.indexOf(String(c.body.rating || "")) + 1;
  if (!SID.test(id) || !r) return fail(400, "bad_input", "Pick one: terrible, bad, neutral, good or great.");
  if ((+player.earned || 0) < RATE_MIN_EARNED) return fail(403, "too_new", `Play a little first: ratings count once you've earned ${RATE_MIN_EARNED} bones.`);
  if (!(await ratelimit.allow(c.store, "rate", player.pid, 60, 3600, c.now))) return fail(429, "slow_down", "That's a lot of ratings. Try again later.");
  const after = await c.store.update(DONE, id, cur => cur && cur.status === "shipped" ? { ...cur, ratings: { ...(cur.ratings || {}), [player.pid]: r } } : null);
  if (!after) return fail(404, "not_found", "That update isn't there to rate.");
  return json(200, { update: publicOf(after, player.pid) });
}

// POST /api/report { id }: this suggestion doesn't belong here. Once REPORTS_TO_HIDE players have
// reported it, it comes off the board and its bones go back.
async function report(c, player) {
  const id = String(c.body.id || "");
  if (!SID.test(id)) return fail(400, "bad_id", "That suggestion isn't there.");
  if ((+player.earned || 0) < RATE_MIN_EARNED) return fail(403, "too_new", `Play a little first: reports count once you've earned ${RATE_MIN_EARNED} bones.`);
  if (!(await ratelimit.allow(c.store, "report", player.pid, 20, 86400, c.now))) return fail(429, "slow_down", "That's a lot of reports for one day.");
  const after = await c.store.update(OPEN, id, cur => cur && cur.status === "open" && cur.by !== player.pid ? { ...cur, reports: { ...(cur.reports || {}), [player.pid]: c.now } } : null);
  if (!after) return fail(409, "closed", "That one can't be reported now.");
  if (Object.keys(after.reports).length >= REPORTS_TO_HIDE) await close(c, after, "declined", { reason: "Taken down after players reported it. Everyone's bones went back." });
  return json(200, { ok: true });
}

// The last few shipped updates and how players rated them, for Claude's next build (ops.js).
async function recentRatings(c, count = 10) {
  const done = await c.store.list(DONE, { limit: count * 2, orderBy: "doneAt" });
  return done.filter(s => s.status === "shipped").slice(0, count).map(s => {
    const r = ratingsOf(s);
    return { n: s.n, title: s.title, suggestion: s.text, own: !!s.own, ratings: Object.fromEntries(RATINGS.map((k, i) => [k, r.counts[i]])), average: r.avg && Math.round(r.avg * 100) / 100 };
  });
}

// Moves a suggestion to the update log as shipped or declined. Declined gives every vote back;
// shipped gets the next update number.
async function close(c, s, status, extra) {
  const done = { ...s, ...extra, pk: DONE, status, doneAt: c.now, voters: Object.keys(s.votes || {}).length };
  if (status === "declined") {
    const votes = Object.entries(s.votes || {});
    for (let i = 0; i < votes.length; i += 10) await Promise.all(votes.slice(i, i + 10).map(([pid, n]) => players.refund(c, pid, n)));
  }
  if (status === "shipped") {
    const counter = await c.store.update("sys", "updates", cur => ({ id: "updates", pk: "sys", n: ((cur && cur.n) || 0) + 1 }));
    done.n = counter.n;
  }
  delete done.votes; delete done.reports;
  await c.store.upsert(done);
  await c.store.remove(OPEN, s.id);
  return done;
}

module.exports = { board, log, suggest, vote, rate, report, close, recentRatings, ranked, publicOf, OPEN, DONE, SID, MAX_LEN };
