// The hourly update's calls (.github/workflows/hourly-update.yml), at POST /api/ops/<what> with the
// header x-ops-key: <OPS_KEY>. ("admin" routes are kept by Azure Functions, hence "ops".)
//
//   pick     the suggestion with the most bones becomes "building" → { pick: { id, text, ... } | null, reason }
//   result   { id, status: shipped | declined | failed, title, notes, reason, commit }
//   hide     { id, reason? } take one off the board (the owner, by hand), giving its votes back
//
// Settings: OPS_KEY (24+ random characters, also a GitHub secret), MIN_SCORE (bones a suggestion
// needs to be picked; default 1).
"use strict";
const { json, fail, safeEqual, cleanText, HOUR } = require("./util");
const S = require("./suggestions");

const STUCK_MS = 3 * HOUR;  // a build that never reported back is given up on after this
const MAX_TRIES = 2;        // builds that failed (not declined) before it's declined for good
const STALE_MS = 72 * HOUR; // suggestions nobody gave a bone to are cleared after this

function allowed(c) {
  const key = c.env.OPS_KEY || "";
  return key.length >= 24 && safeEqual(c.headers.get("x-ops-key") || "", key);
}

async function failOnce(c, s, why) {
  const attempts = (s.attempts || 0) + 1;
  if (attempts >= MAX_TRIES) return S.close(c, s, "declined", { attempts, reason: why || "It couldn't be built after two tries, so everyone's bones went back." });
  await c.store.upsert({ ...s, status: "open", attempts, startedAt: null });
  return null;
}

async function pick(c) {
  let open = await c.store.list(S.OPEN);
  const building = open.find(s => s.status === "building");
  if (building && c.now - (building.startedAt || 0) < STUCK_MS) return json(200, { pick: null, reason: "busy", building: building.id });
  if (building) { await failOnce(c, building); open = await c.store.list(S.OPEN); }
  for (const s of open) if (s.status === "open" && !(s.score > 0) && c.now - s.at > STALE_MS) await c.store.remove(S.OPEN, s.id);

  const min = Math.max(1, +c.env.MIN_SCORE || 1);
  const top = S.ranked(open.filter(s => s.status === "open" && (s.score || 0) >= min))[0];
  if (!top) return json(200, { pick: null, reason: "nothing" });
  const s = await c.store.update(S.OPEN, top.id, cur => cur && cur.status === "open" ? { ...cur, status: "building", startedAt: c.now } : null);
  if (!s) return json(200, { pick: null, reason: "raced" });
  return json(200, { pick: { id: s.id, text: s.text, byName: s.byName, score: s.score, voters: Object.keys(s.votes || {}).length, attempts: s.attempts || 0 } });
}

async function result(c) {
  const id = String(c.body.id || ""), status = String(c.body.status || "");
  if (!S.SID.test(id) || !["shipped", "declined", "failed"].includes(status)) return fail(400, "bad_input", "id and status, please.");
  const s = await c.store.read(S.OPEN, id);
  if (!s || s.status !== "building") return fail(409, "not_building", "That suggestion isn't being built.");
  const title = cleanText(c.body.title, 80), notes = cleanText(c.body.notes, 600), reason = cleanText(c.body.reason, 400);
  const commit = /^[0-9a-f]{7,40}$/.test(String(c.body.commit || "")) ? c.body.commit : null;
  if (status === "shipped") return json(200, { done: await S.close(c, s, "shipped", { title: title || s.text.slice(0, 60), notes, commit }) });
  if (status === "declined") return json(200, { done: await S.close(c, s, "declined", { title, reason: reason || "Claude decided not to build this one, so everyone's bones went back." }) });
  return json(200, { done: await failOnce(c, s, reason || null) });
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
  return fail(404, "not_found", "Nothing here.");
}

module.exports = { handle };
