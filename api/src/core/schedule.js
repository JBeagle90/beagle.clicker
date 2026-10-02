// When the next scheduled update starts, and what the owner set for it (the owner's panel, owner.js):
//   { id: "settings", pk: "sys", hours, lastRunAt, runNowAt, note: { text, at, tries } }
// The workflow asks every hour (ops.js, pick). A run is due `hours` after the last one, counted from
// the start of that one's hour (GitHub's scheduled runs start a few minutes late, and this keeps them
// from drifting), or at once after "run now". Before the first run, it's due straight away.
// hours: the owner's choice, else the UPDATE_HOURS setting (default 3).
"use strict";
const { HOUR, updateHours, cleanText } = require("./util");

const HOURS = [1, 2, 3, 4, 6, 8, 12, 24];
const EARLY = 10 * 60 * 1000; // a run this close to its time counts as on time
const NOTE_LEN = 1000;

const blank = () => ({ id: "settings", pk: "sys" });
async function read(c) { return (await c.store.read("sys", "settings")) || blank(); }
async function change(c, fn) { return c.store.update("sys", "settings", cur => fn(cur || blank())); }

const hoursOf = (s, env) => HOURS.includes(s.hours) ? s.hours : updateHours(env);
const dueAt = (s, env) => s.lastRunAt ? Math.floor(s.lastRunAt / HOUR) * HOUR + hoursOf(s, env) * HOUR : 0;
const due = (s, env, now) => !!s.runNowAt || now >= dueAt(s, env) - EARLY;

// For the countdown: now after "run now"; else when it's due, or the next hourly check if that's passed.
function nextAt(s, env, now) {
  if (s.runNowAt) return now;
  const at = dueAt(s, env);
  return at > now ? at : Math.floor(now / HOUR) * HOUR + HOUR;
}

// The owner's requirements, kept to plain lines (no control or invisible characters).
const noteText = v => String(v == null ? "" : v).split(/\r?\n/).map(l => cleanText(l, NOTE_LEN))
  .join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, NOTE_LEN);

module.exports = { read, change, hoursOf, due, nextAt, noteText, HOURS, NOTE_LEN };
