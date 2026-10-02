// The scheduled update's calls (.github/workflows/scheduled-update.yml), at POST /api/ops/<what> with
// the header x-ops-key: <OPS_KEY>. ("admin" routes are kept by Azure Functions, hence "ops".)
//
//   pick     { manual? } → { pick: { id, own, text, note?, ... } | null, reason, ratings }
//            The workflow asks every hour; only when a run is due (schedule.js; manual: run by hand,
//            so always) does the suggestion with the most bones become "building". When none has
//            enough bones, a placeholder for Claude's own idea is made instead (own: true), so every
//            run builds something. note: the owner's requirements for this update, if any (taken
//            off the schedule; they go back if it doesn't ship). ratings: how players rated the last
//            few updates.
//   result   { id, status: shipped | declined | failed, title, summary, idea, reason, commit, cost, run }
//            summary: the players' summary (lines; "- " lines are bullets); idea: for Claude's own,
//            the idea in one sentence, shown as its suggestion. cost: what the run cost in USD.
//            run: { screen, build, turns, minutes, billing: api | plan }, for the owner's panel.
//   hide     { id, reason? } take one off the board (the owner, by hand), giving its votes back
//   invite   a one-time link that adds a device to the owner's panel (owner.js)
//
// Settings: OPS_KEY (24+ random characters, also a GitHub secret), MIN_SCORE (bones a suggestion
// needs to be picked; default 1), UPDATE_HOURS (hours between updates until the owner sets them; default 3).
// Limits on spending, checked before every build (the workflow also caps each run, --max-budget-usd):
//   BUDGET_USD_30D      no build starts once the last 30 days' runs cost this much (default 250)
//   MAX_BUILDS_PER_DAY  no more builds than this in 24 hours (default 8)
//   OWN_IDEAS           0: when no suggestion has bones, skip the run instead of building Claude's idea
"use strict";
const { json, fail, randomId, safeEqual, cleanText, HOUR } = require("./util");
const S = require("./suggestions");
const schedule = require("./schedule");

const STUCK_MS = 3 * HOUR;  // a build that never reported back is given up on after this
const MAX_TRIES = 2;        // builds that failed (not declined) before it's declined for good
const STALE_MS = 72 * HOUR; // suggestions nobody gave a bone to are cleared after this
const SUMMARY_LINES = 8, LINE_LEN = 240;

function allowed(c) {
  const key = c.env.OPS_KEY || "";
  return key.length >= 24 && safeEqual(c.headers.get("x-ops-key") || "", key);
}

const summaryOf = v => String(v == null ? "" : v).split(/\r?\n/).map(l => cleanText(l, LINE_LEN)).filter(Boolean).slice(0, SUMMARY_LINES);

// A build that didn't finish: a player's suggestion goes back on the board (once); Claude's own idea
// is simply dropped, as there's nothing for anyone to get back.
async function failOnce(c, s, why) {
  if (s.own) { await c.store.remove(S.OPEN, s.id); return null; }
  const attempts = (s.attempts || 0) + 1;
  if (attempts >= MAX_TRIES) return S.close(c, s, "declined", { attempts, reason: why || "It couldn't be built after two tries, so everyone's bones went back." });
  await c.store.upsert({ ...s, status: "open", attempts, startedAt: null, ownerNote: null });
  return null;
}

// The owner's requirements go back for the next update when this one didn't ship (unless the owner
// has written new ones since).
async function noteBack(c, s) {
  if (!s || !s.ownerNote) return;
  await schedule.change(c, cur => cur.note ? null : { ...cur, note: { ...s.ownerNote, tries: (s.ownerNote.tries || 0) + 1 } });
}

// What the builds have cost: { id: "spend", pk: "sys", days: { "2026-10-02": 1.23 }, picks: [times],
// runs: [{ at, id, status, title, own, cost, screen, build, turns, minutes, billing, note }] } (the last 14 days).
const DAY = 24 * HOUR, RUN_DAYS = 14, MAX_RUNS = 200;
const dayOf = t => new Date(t).toISOString().slice(0, 10);
async function spending(c) {
  const s = (await c.store.read("sys", "spend")) || {};
  const from = dayOf(c.now - 29 * DAY);
  const usd = Object.entries(s.days || {}).filter(([d]) => d >= from).reduce((a, [, v]) => a + (+v || 0), 0);
  const builds = (s.picks || []).filter(t => c.now - t < DAY).length;
  return { usd: Math.round(usd * 100) / 100, builds };
}
async function record(c, change) {
  const from = dayOf(c.now - 40 * DAY);
  await c.store.update("sys", "spend", cur => {
    const s = cur ? { ...cur, days: { ...(cur.days || {}) }, picks: [...(cur.picks || [])], runs: [...(cur.runs || [])] } : { id: "spend", pk: "sys", days: {}, picks: [], runs: [] };
    change(s);
    for (const d of Object.keys(s.days)) if (d < from) delete s.days[d];
    s.picks = s.picks.filter(t => c.now - t < 2 * DAY).slice(-100);
    s.runs = s.runs.filter(r => c.now - r.at < RUN_DAYS * DAY).slice(-MAX_RUNS);
    return s;
  });
}

// The spending limits: the 30-day budget (USD) and the most builds in 24 hours.
function limits(env) {
  return {
    budget: env.BUDGET_USD_30D != null && env.BUDGET_USD_30D !== "" ? +env.BUDGET_USD_30D : 250,
    perDay: Math.max(0, Math.floor(+(env.MAX_BUILDS_PER_DAY || 8))),
  };
}

// One line in the run log, from what the workflow reported.
function runOf(c, id, status, s) {
  const run = c.body.run && typeof c.body.run === "object" ? c.body.run : {};
  const usd = v => Math.round(Math.max(0, Math.min(1000, +v || 0)) * 10000) / 10000;
  const title = cleanText(c.body.title, 80) || cleanText(c.body.idea, 80) || (s && cleanText(s.text, 80)) || "";
  const out = { at: c.now, id, status, title, own: !!(s && s.own), cost: usd(c.body.cost), screen: usd(run.screen), build: usd(run.build),
    turns: Math.round(Math.max(0, Math.min(10000, +run.turns || 0))), minutes: Math.round(Math.max(0, Math.min(1000, +run.minutes || 0)) * 10) / 10 };
  if (run.billing === "api" || run.billing === "plan") out.billing = run.billing;
  if (s && s.ownerNote) out.note = true;
  return out;
}

async function pick(c) {
  let open = await c.store.list(S.OPEN);
  const building = open.find(s => s.status === "building");
  if (building && c.now - (building.startedAt || 0) < STUCK_MS) return json(200, { pick: null, reason: "busy", building: building.id });
  const settings = await schedule.read(c);
  if (!c.body.manual && !schedule.due(settings, c.env, c.now)) return json(200, { pick: null, reason: "not_yet", nextAt: schedule.nextAt(settings, c.env, c.now) });
  if (building) { await noteBack(c, building); await failOnce(c, building); open = await c.store.list(S.OPEN); }
  for (const s of open) if (s.status === "open" && !(s.score > 0) && c.now - s.at > STALE_MS) await c.store.remove(S.OPEN, s.id);

  // This is the run that was due: the countdown starts again from now, whatever happens next.
  // build: true takes the owner's requirements for this build.
  const ran = async build => {
    let note = null;
    await schedule.change(c, cur => { note = build && cur.note && cur.note.text ? cur.note : null; return { ...cur, lastRunAt: c.now, runNowAt: null, note: build ? null : cur.note || null }; });
    return note;
  };
  const spent = await spending(c);
  const { budget, perDay } = limits(c.env);
  if (spent.usd >= budget) { await ran(false); return json(200, { pick: null, reason: "budget", spent }); }
  if (spent.builds >= perDay) { await ran(false); return json(200, { pick: null, reason: "daily_limit", spent }); }

  const ratings = await S.recentRatings(c);
  const min = Math.max(1, +c.env.MIN_SCORE || 1);
  const top = S.ranked(open.filter(s => s.status === "open" && (s.score || 0) >= min))[0];
  // With no suggestion to build, Claude's own idea, unless that's turned off and the owner asked for nothing.
  if (!top && c.env.OWN_IDEAS === "0" && !(settings.note && settings.note.text)) { await ran(false); return json(200, { pick: null, reason: "nothing", spent }); }
  const note = await ran(true);
  await record(c, sp => { sp.picks.push(c.now); });
  const withNote = p => note ? { ...p, note: note.text } : p;
  if (!top) {
    const s = { id: randomId(8), pk: S.OPEN, own: true, text: "", by: null, byName: "Claude", at: c.now, score: 0, votes: {}, status: "building", startedAt: c.now, attempts: 0, ownerNote: note };
    await c.store.upsert(s);
    return json(200, { pick: withNote({ id: s.id, own: true, text: "", byName: "Claude", score: 0, voters: 0, attempts: 0 }), reason: "own", ratings, spent });
  }
  const s = await c.store.update(S.OPEN, top.id, cur => cur && cur.status === "open" ? { ...cur, status: "building", startedAt: c.now, ownerNote: note } : null);
  if (!s) { if (note) await schedule.change(c, cur => cur.note ? null : { ...cur, note }); return json(200, { pick: null, reason: "raced" }); }
  return json(200, { pick: withNote({ id: s.id, own: false, text: s.text, byName: s.byName, score: s.score, voters: Object.keys(s.votes || {}).length, attempts: s.attempts || 0 }), reason: "top", ratings, spent });
}

async function result(c) {
  const id = String(c.body.id || ""), status = String(c.body.status || "");
  if (!S.SID.test(id) || !["shipped", "declined", "failed"].includes(status)) return fail(400, "bad_input", "id and status, please.");
  const s = await c.store.read(S.OPEN, id);
  const cost = Math.max(0, Math.min(1000, +c.body.cost || 0));
  await record(c, sp => {
    if (cost) sp.days[dayOf(c.now)] = Math.round(((+sp.days[dayOf(c.now)] || 0) + cost) * 10000) / 10000;
    sp.runs.push(runOf(c, id, status, s));
  });
  if (!s || s.status !== "building") return fail(409, "not_building", "That suggestion isn't being built.");
  if (status !== "shipped") await noteBack(c, s);
  const title = cleanText(c.body.title, 80), summary = summaryOf(c.body.summary), reason = cleanText(c.body.reason, 400);
  const commit = /^[0-9a-f]{7,40}$/.test(String(c.body.commit || "")) ? c.body.commit : null;
  if (s.own) s.text = cleanText(c.body.idea, S.MAX_LEN) || title || "Claude's own idea";
  if (status === "shipped") return json(200, { done: await S.close(c, s, "shipped", { title: title || s.text.slice(0, 60), summary, commit }) });
  if (status === "declined" && !s.own) return json(200, { done: await S.close(c, s, "declined", { title, reason: reason || "Claude decided not to build this one, so everyone's bones went back." }) });
  return json(200, { done: await failOnce(c, s, status === "failed" ? reason || null : null) });
}

async function hide(c) {
  const id = String(c.body.id || "");
  const s = S.SID.test(id) && await c.store.read(S.OPEN, id);
  if (!s) return fail(404, "not_found", "That suggestion isn't on the board.");
  return json(200, { done: await S.close(c, s, "declined", { reason: cleanText(c.body.reason, 400) || "Taken off the board by the owner. Everyone's bones went back." }) });
}

async function handle(what, c) {
  if (!allowed(c)) return fail(403, "forbidden", "No.");
  if (what === "pick") return pick(c);
  if (what === "result") return result(c);
  if (what === "hide") return hide(c);
  if (what === "invite") return require("./owner").invite(c); // here, not at the top: owner.js uses this file
  return fail(404, "not_found", "Nothing here.");
}

module.exports = { handle, spending, limits };
