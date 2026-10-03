// The owner's panel (api/src/core/owner.js): invites, passkeys, sessions, and the run log it shows.
// A software passkey stands in for a phone or Windows Hello. (The owner's test: scheduled updates
// may not change test-core-* files.)
"use strict";
const crypto = require("crypto");
const { test, eq, ok, done } = require("./t.cjs");
const { handle } = require("../api/src/core/lib.js");
const { memoryStore } = require("./memstore.cjs");

const OPS_KEY = "test-ops-key-0123456789abcdef";
const SITE = "https://beagle.games";
let env, store, clock;

function api(method, path, body, { session, ops, ip = "1.2.3.4" } = {}) {
  const [route, sub] = path.replace(/^\//, "").split("/");
  const h = { "x-forwarded-for": ip + ":5555" };
  if (session) h["x-owner-session"] = session;
  if (ops) h["x-ops-key"] = ops;
  return handle({ method, route, sub, query: new URLSearchParams(), headers: { get: k => h[k.toLowerCase()] }, body, rawLength: body ? JSON.stringify(body).length : 0 }, store, env, clock);
}
const reset = () => { store = memoryStore(); clock = Date.UTC(2026, 9, 2, 12, 0, 0); env = { OPS_KEY }; };

const b64 = buf => Buffer.from(buf).toString("base64url");
const sha = s => crypto.createHash("sha256").update(s).digest();

// A passkey on a pretend device: what navigator.credentials.create and .get hand the panel.
function passkey(type = "ec") {
  const { privateKey, publicKey } = type === "ed25519" ? crypto.generateKeyPairSync("ed25519") : crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const id = crypto.randomBytes(16);
  let count = 0;
  const client = (kind, challenge, origin) => Buffer.from(JSON.stringify({ type: "webauthn." + kind, challenge, origin }));
  return {
    create(options, { origin = SITE, flags = 0x45 } = {}) {
      const len = Buffer.alloc(2); len.writeUInt16BE(id.length);
      const auth = Buffer.concat([sha(new URL(origin).hostname), Buffer.from([flags]), Buffer.alloc(4), Buffer.alloc(16), len, id]);
      return { id: b64(id), alg: type === "ed25519" ? -8 : -7, publicKey: b64(publicKey.export({ type: "spki", format: "der" })),
        authenticatorData: b64(auth), clientDataJSON: b64(client("create", options.challenge, origin)) };
    },
    get(options, { origin = SITE, flags = 0x05, kind = "get", key = privateKey, step = 1 } = {}) {
      count += step;
      const n = Buffer.alloc(4); n.writeUInt32BE(count);
      const auth = Buffer.concat([sha(new URL(origin).hostname), Buffer.from([flags]), n]);
      const cd = client(kind, options.challenge, origin);
      const sig = crypto.sign(type === "ed25519" ? null : "sha256", Buffer.concat([auth, sha(cd)]), key);
      return { id: b64(id), authenticatorData: b64(auth), clientDataJSON: b64(cd), signature: b64(sig) };
    },
  };
}

async function inviteCode() {
  const r = await api("POST", "/ops/invite", {}, { ops: OPS_KEY });
  eq(r.status, 200);
  return /#invite=(.+)$/.exec(r.jsonBody.url)[1];
}
async function addDevice(pk, name = "My phone") {
  const invite = await inviteCode();
  const start = await api("POST", "/owner/register-start", { invite });
  eq(start.status, 200);
  const r = await api("POST", "/owner/register", { invite, name, ...pk.create(start.jsonBody.publicKey) });
  eq(r.status, 200, JSON.stringify(r.jsonBody));
}
async function signIn(pk, opts) {
  const start = await api("POST", "/owner/login-start");
  return api("POST", "/owner/login", pk.get(start.jsonBody.publicKey, opts));
}

test("an invite needs the scheduled-update key and points at the panel", async () => {
  reset();
  eq((await api("POST", "/ops/invite", {})).status, 403);
  const r = await api("POST", "/ops/invite", {}, { ops: OPS_KEY });
  ok(r.jsonBody.url.startsWith(SITE + "/admin#invite="));
  env.OWNER_ORIGIN = "http://localhost:5190, https://beagle.games";
  ok((await api("POST", "/ops/invite", {}, { ops: OPS_KEY })).jsonBody.url.startsWith("http://localhost:5190/admin#invite="));
});

test("an invite adds one device, once, within 10 minutes", async () => {
  reset();
  eq((await api("POST", "/owner/register-start", { invite: "made-up-made-up-made-up" })).status, 403);
  const invite = await inviteCode();
  const start = (await api("POST", "/owner/register-start", { invite })).jsonBody.publicKey;
  eq(start.authenticatorSelection.userVerification, "required");
  eq((await api("POST", "/owner/register", { invite, name: "Phone", ...passkey().create(start) })).status, 200);
  eq((await api("POST", "/owner/register-start", { invite })).status, 403, "used up");
  const late = await inviteCode();
  clock += 11 * 60 * 1000;
  eq((await api("POST", "/owner/register-start", { invite: late })).status, 403, "too old");
});

test("a new passkey must be made here, for a challenge from here", async () => {
  reset();
  const invite = await inviteCode();
  const pk = passkey();
  let start = (await api("POST", "/owner/register-start", { invite })).jsonBody.publicKey;
  eq((await api("POST", "/owner/register", { invite, ...pk.create(start, { origin: "https://beagle-games.example" }) })).status, 403, "another site");
  start = (await api("POST", "/owner/register-start", { invite })).jsonBody.publicKey;
  eq((await api("POST", "/owner/register", { invite, ...pk.create({ challenge: "not-one-we-gave-out-xxxxxxxx" }) })).status, 403, "made-up challenge");
  eq((await api("POST", "/owner/register", { invite, ...pk.create(start, { flags: 0x41 }) })).status, 403, "person not verified");
  start = (await api("POST", "/owner/register-start", { invite })).jsonBody.publicKey;
  const good = pk.create(start);
  eq((await api("POST", "/owner/register", { invite, ...good, publicKey: passkey("ed25519").create(start).publicKey })).status, 403, "an Ed25519 key said to be ES256");
  eq((await api("POST", "/owner/register", { invite, ...good, publicKey: "bm90LWEta2V5" })).status, 403, "not a key");
  eq((await api("POST", "/owner/register", { invite, ...good })).status, 200);
});

test("the owner's passkey signs in; the session shows the panel", async () => {
  reset();
  const pk = passkey();
  await addDevice(pk);
  eq((await api("GET", "/owner/status")).status, 401);
  const r = await signIn(pk);
  eq(r.status, 200);
  const st = await api("GET", "/owner/status", null, { session: r.jsonBody.session });
  eq(st.status, 200);
  eq(st.jsonBody.devices.length, 1);
  eq(st.jsonBody.devices[0].name, "My phone");
  ok(st.jsonBody.devices[0].you);
  eq(st.jsonBody.spend.budget, 250);
  ok(!JSON.stringify(store.dump()).includes(r.jsonBody.session), "only a hash of the session is kept");
});

test("an Ed25519 passkey works too", async () => {
  reset();
  const pk = passkey("ed25519");
  await addDevice(pk);
  eq((await signIn(pk)).status, 200);
});

test("signing in is refused for anything but the owner's device, here, verified", async () => {
  reset();
  const pk = passkey();
  await addDevice(pk);
  eq((await signIn(passkey())).status, 403, "a device that wasn't added");
  eq((await signIn(pk, { origin: "https://beagle-games.example" })).status, 403, "another site");
  eq((await signIn(pk, { flags: 0x01 })).status, 403, "person not verified");
  eq((await signIn(pk, { kind: "create" })).status, 403, "the wrong kind of challenge");
  eq((await signIn(pk, { key: crypto.generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey })).status, 403, "signed by another key");
  const start = (await api("POST", "/owner/login-start")).jsonBody.publicKey;
  eq((await api("POST", "/owner/login", pk.get(start))).status, 200);
  eq((await api("POST", "/owner/login", pk.get(start))).status, 403, "a challenge works once");
  eq((await signIn(pk, { step: -5 })).status, 403, "a counter going back means a copied passkey");
});

test("a session lasts an hour, and signing out ends it", async () => {
  reset();
  const pk = passkey();
  await addDevice(pk);
  let session = (await signIn(pk)).jsonBody.session;
  clock += 61 * 60 * 1000;
  eq((await api("GET", "/owner/status", null, { session })).status, 401);
  session = (await signIn(pk)).jsonBody.session;
  eq((await api("POST", "/owner/logout", {}, { session })).status, 200);
  eq((await api("GET", "/owner/status", null, { session })).status, 401);
});

test("a forgotten device can't sign in", async () => {
  reset();
  const phone = passkey(), laptop = passkey();
  await addDevice(phone, "Phone");
  await addDevice(laptop, "Laptop");
  const session = (await signIn(laptop)).jsonBody.session;
  const devices = (await api("GET", "/owner/status", null, { session })).jsonBody.devices;
  const id = devices.find(d => d.name === "Phone").id;
  eq((await api("POST", "/owner/forget", { id }, { session })).status, 200);
  eq((await signIn(phone)).status, 403);
  eq((await signIn(laptop)).status, 200);
});

test("too many tries from one address are slowed down", async () => {
  reset();
  for (let i = 0; i < 60; i++) await api("POST", "/owner/login-start");
  eq((await api("POST", "/owner/login-start")).status, 429);
  eq((await api("POST", "/owner/login-start", null, { ip: "5.6.7.8" })).status, 200);
});

test("each run's cost is logged for the panel", async () => {
  reset();
  const pk = passkey();
  await addDevice(pk);
  const pick = (await api("POST", "/ops/pick", { manual: true }, { ops: OPS_KEY })).jsonBody.pick;
  ok(pick.own);
  await api("POST", "/ops/result", { id: pick.id, status: "shipped", title: "A bouncy ball", idea: "Give the beagle a ball.", cost: 1.25,
    run: { screen: 0, build: 1.25, turns: 41, minutes: 12.34, billing: "plan" } }, { ops: OPS_KEY });
  const session = (await signIn(pk)).jsonBody.session;
  const sp = (await api("GET", "/owner/status", null, { session })).jsonBody.spend;
  eq(sp.usd, 1.25);
  eq(sp.runs.length, 1);
  const r = sp.runs[0];
  eq([r.status, r.title, r.own, r.cost, r.build, r.turns, r.minutes, r.billing], ["shipped", "A bouncy ball", true, 1.25, 1.25, 41, 12.3, "plan"]);
});

// --- The schedule, "run now", the owner's requirements ---
const H = 3600 * 1000, NOON = Date.UTC(2026, 9, 2, 12, 0, 0);
const pickNow = () => api("POST", "/ops/pick", {}, { ops: OPS_KEY }).then(r => r.jsonBody);
const report = (id, status) => api("POST", "/ops/result", { id, status, title: "Done", idea: "An idea." }, { ops: OPS_KEY });
const nextPickAt = async () => (await api("GET", "/board")).jsonBody.nextPickAt;
// Calls from the owner's panel, signing in afresh each time (the tests move the clock past a session).
async function owner() {
  const pk = passkey();
  await addDevice(pk);
  return async (method, what, body) => api(method, "/owner/" + what, body, { session: (await signIn(pk)).jsonBody.session });
}

test("a run is due every few hours from the last one, and the countdown shows when", async () => {
  reset();
  let p = await pickNow();
  ok(p.pick, "the first run is due straight away");
  await report(p.pick.id, "shipped");
  clock = NOON + 0.5 * H;
  p = await pickNow();
  eq([p.pick, p.reason, p.nextAt], [null, "not_yet", NOON + 3 * H]);
  eq(await nextPickAt(), NOON + 3 * H);
  clock = NOON + 3 * H + 7 * 60 * 1000; // GitHub's scheduled check, a few minutes late
  p = await pickNow();
  ok(p.pick);
  await report(p.pick.id, "shipped");
  clock += H;
  eq(await nextPickAt(), NOON + 6 * H, "counted from the hour it was due, so it doesn't drift");
  clock = NOON + 6 * H - 8 * 60 * 1000; // a check a few minutes early
  p = await pickNow();
  ok(p.pick, "a few minutes early counts");
  await report(p.pick.id, "shipped");
  eq(await nextPickAt(), NOON + 9 * H, "and the next is still 3 hours after the hour it was due");
  clock = NOON + 9 * H + 20 * 60 * 1000; // overdue: the countdown shows the next check
  eq(await nextPickAt(), NOON + 9 * H + 30 * 60 * 1000);
});

test("the owner changes the hours between updates", async () => {
  reset();
  const o = await owner();
  const p = await pickNow();
  await report(p.pick.id, "shipped");
  eq((await o("POST", "schedule", { hours: 5 })).status, 400);
  eq((await o("POST", "schedule", { hours: 1 })).status, 200);
  eq(await nextPickAt(), NOON + H);
  eq((await api("GET", "/board")).jsonBody.updateHours, 1);
  eq((await o("GET", "status")).jsonBody.next.hours, 1);
  clock = NOON + 0.6 * H;
  eq((await pickNow()).reason, "not_yet");
  clock = NOON + 0.9 * H;
  ok((await pickNow()).pick, "within a few minutes of its time counts");
  eq((await api("POST", "/owner/schedule", { hours: 2 })).status, 401, "only signed in");
});

test("run now: the countdown goes to 0 and the next check builds", async () => {
  reset();
  const o = await owner();
  const p = await pickNow();
  await report(p.pick.id, "shipped");
  clock = NOON + 0.5 * H;
  eq((await pickNow()).reason, "not_yet");
  const r = await o("POST", "run-now");
  eq([r.status, r.jsonBody.started], [200, false], "no GitHub token here, so it waits for the next check");
  eq(await nextPickAt(), clock);
  ok((await pickNow()).pick);
  eq((await o("GET", "status")).jsonBody.next.runNowAt, null, "used up");
  eq((await pickNow()).reason, "busy");
});

test("the owner's requirements go with the next build, whatever wins", async () => {
  reset();
  const o = await owner();
  eq((await o("POST", "note", { text: "  Make it purple.\r\n\n\n\nAnd round.  " })).jsonBody.note, "Make it purple.\n\nAnd round.");
  eq((await o("GET", "status")).jsonBody.next.note.text, "Make it purple.\n\nAnd round.");
  const p = (await pickNow()).pick;
  eq(p.note, "Make it purple.\n\nAnd round.");
  eq((await o("GET", "status")).jsonBody.next.note, null, "taken by this build");
  ok((await o("GET", "status")).jsonBody.building.note);
  await report(p.id, "shipped");
  eq((await o("GET", "status")).jsonBody.spend.runs[0].note, true);
  clock += 4 * H;
  eq((await pickNow()).pick.note, undefined, "used once");
});

test("requirements that didn't ship go back, unless the owner wrote new ones", async () => {
  reset();
  const o = await owner();
  await o("POST", "note", { text: "Add a hat." });
  let p = (await pickNow()).pick;
  await report(p.id, "failed");
  const back = (await o("GET", "status")).jsonBody.next.note;
  eq([back.text, back.tries], ["Add a hat.", 1]);
  clock += 4 * H;
  p = (await pickNow()).pick;
  eq(p.note, "Add a hat.");
  await o("POST", "note", { text: "Add a scarf instead." });
  await report(p.id, "declined");
  eq((await o("GET", "status")).jsonBody.next.note.text, "Add a scarf instead.");
  await o("POST", "note", { text: "   " });
  eq((await o("GET", "status")).jsonBody.next.note, null, "blank clears it");
});

test("with own ideas off and nothing voted, a run still builds the owner's requirements", async () => {
  reset();
  env.OWN_IDEAS = "0";
  const o = await owner();
  eq((await pickNow()).reason, "nothing");
  clock += 4 * H;
  await o("POST", "note", { text: "A rainbow trail." });
  const p = (await pickNow()).pick;
  eq([p.own, p.note], [true, "A rainbow trail."]);
});

test("the panel shows what's winning the next update", async () => {
  reset();
  const o = await owner();
  const save = (await api("POST", "/players")).jsonBody.save;
  const call = (path, body) => handle({ method: "POST", route: path.slice(1), headers: { get: k => ({ "x-bc-save": save, "x-forwarded-for": "1.2.3.4" })[k.toLowerCase()] }, body, rawLength: 10 }, store, env, clock);
  for (let i = 0; i < 40; i++) { clock += 1000; await call("/sync", { pats: 20 }); }
  const a = (await call("/suggest", { text: "Let the beagle wear a party hat" })).jsonBody.suggestion;
  clock += 11 * 60 * 1000;
  const b = (await call("/suggest", { text: "A pond for the beagle to splash in" })).jsonBody.suggestion;
  await call("/vote", { id: b.id, amount: 10 });
  const st = (await o("GET", "status")).jsonBody;
  eq(st.board.map(s => [s.text, s.score, s.voters, s.enough]), [[b.text, 10, 1, true], [a.text, 0, 0, false]]);
  eq(st.building, null);
  await api("POST", "/ops/pick", { manual: true }, { ops: OPS_KEY });
  const after = (await o("GET", "status")).jsonBody;
  eq([after.building.text, after.board.map(s => s.text)], [b.text, [a.text]], "the one being built isn't still 'winning'");
});

test("the owner's pick is built next, whatever its bones, and keeps the bones on it", async () => {
  reset();
  const o = await owner();
  const save = (await api("POST", "/players")).jsonBody.save;
  const call = (path, body) => handle({ method: "POST", route: path.slice(1), headers: { get: k => ({ "x-bc-save": save, "x-forwarded-for": "1.2.3.4" })[k.toLowerCase()] }, body, rawLength: 10 }, store, env, clock);
  for (let i = 0; i < 40; i++) { clock += 1000; await call("/sync", { pats: 20 }); }
  const a = (await call("/suggest", { text: "Let the beagle wear a party hat" })).jsonBody.suggestion;
  await call("/vote", { id: a.id, amount: 3 });
  clock += 11 * 60 * 1000;
  const b = (await call("/suggest", { text: "A pond for the beagle to splash in" })).jsonBody.suggestion;
  await call("/vote", { id: b.id, amount: 10 });
  eq((await api("POST", "/owner/pick", { id: a.id, on: true })).status, 401, "only signed in");
  eq((await o("POST", "pick", { id: "nope-nope", on: true })).status, 409);
  eq((await o("POST", "pick", { id: a.id, on: true })).status, 200);
  const st = (await o("GET", "status")).jsonBody;
  eq(st.board.map(s => [s.text, !!s.ownerPick]), [[a.text, true], [b.text, false]], "first on the panel");
  const board = (await api("GET", "/board")).jsonBody;
  eq([board.open[0].id, board.open[0].ownerPick], [a.id, true], "and on the game's board");
  const before = (await call("/sync", {})).jsonBody.player.bones;
  const v = await call("/vote", { id: a.id, amount: 5 });
  eq([v.status, v.jsonBody.error.code], [409, "picked"], "it takes no more bones");
  eq((await call("/sync", {})).jsonBody.player.bones, before, "none spent");
  const p = await pickNow();
  eq([p.reason, p.pick.id, p.pick.ownerPick, p.pick.score], ["owner_pick", a.id, true, 3]);
  const r = (await report(a.id, "shipped")).jsonBody;
  eq([r.done.status, r.done.ownerPick > 0, r.done.score], ["shipped", true, 3], "its bones aren't given back");
  eq((await call("/sync", {})).jsonBody.player.bones, before, "no refund");
  clock += 3 * H;
  eq((await pickNow()).pick.id, b.id, "then back to the most bones");
});

test("the owner can unpick, and several picks go in the order picked", async () => {
  reset();
  const o = await owner();
  const own = await api("POST", "/ops/seed", { ideas: ["A little bowl of water for the beagle", "Paw prints across the page when you pat"] }, { ops: OPS_KEY });
  const [x, y] = own.jsonBody.ideas;
  await o("POST", "pick", { id: y.id, on: true });
  clock += 1000;
  await o("POST", "pick", { id: x.id, on: true });
  await o("POST", "pick", { id: y.id, on: true });
  eq((await o("GET", "status")).jsonBody.board.map(s => s.id), [y.id, x.id], "picking again keeps its place");
  await o("POST", "pick", { id: y.id, on: false });
  eq((await o("GET", "status")).jsonBody.board.map(s => [s.id, !!s.ownerPick]), [[x.id, true], [y.id, false]]);
  const p = await pickNow();
  eq([p.pick.id, p.pick.own, p.pick.ownerPick], [x.id, true, true], "one of Claude's ideas can be picked too");
  await report(x.id, "failed");
  clock += 3 * H;
  eq((await pickNow()).pick.id, x.id, "a failed pick is tried again");
});

// GitHub's API, pretend: the newest runs of the scheduled update and one run's jobs.
const realFetch = global.fetch;
function fakeGitHub(runs, jobs) {
  const calls = [];
  global.fetch = async url => {
    calls.push(url);
    const body = /\/runs\?/.test(url) ? { workflow_runs: runs } : { jobs };
    return { ok: true, status: 200, json: async () => body };
  };
  return calls;
}
const T = t => new Date(t).toISOString();
const job = (name, status, conclusion, steps = [], at = NOON) => ({ name, status, conclusion, started_at: T(at), completed_at: status === "completed" ? T(at + 60000) : null,
  steps: steps.map(([n, st, co]) => ({ name: n, status: st, conclusion: co, started_at: T(at), completed_at: st === "completed" ? T(at + 30000) : null })) });

test("how it's going: the run under way on GitHub, stage by stage", async () => {
  reset();
  const o = await owner();
  const run = { id: 7, html_url: "https://github.com/x/y/actions/runs/7", event: "workflow_dispatch", status: "in_progress", conclusion: null, run_started_at: T(NOON), updated_at: T(NOON) };
  const calls = fakeGitHub([{ ...run, id: 8, status: "queued", event: "schedule" }, run], [
    job("pick", "completed", "success"),
    job("build", "in_progress", null, [["Screen the suggestion", "completed", "success"], ["Screen result", "completed", "success"], ["Claude builds it", "in_progress", null], ["Tests", "queued", null]]),
  ]);
  const r = (await o("GET", "progress")).jsonBody;
  eq([r.ok, r.run.id, r.summary], [true, 7, "Claude is building it…"], "the one under way, not the check queued behind it");
  eq(r.stages.map(s => s.state), ["done", "done", "running", "waiting", "waiting", "waiting", "waiting"]);
  eq(r.checks.length, 2);
  const before = calls.length;
  await o("GET", "progress");
  eq(calls.length, before, "kept a while, within GitHub's limits");
  eq((await api("GET", "/owner/progress")).status, 401, "only signed in");
});

test("how it's going: a check, a paused run, a finished update, and GitHub not answering", async () => {
  reset();
  const o = await owner();
  const run = { id: 9, html_url: "u", event: "schedule", status: "completed", conclusion: "success", run_started_at: T(NOON), updated_at: T(NOON) };
  fakeGitHub([run], [job("pick", "completed", "success"), job("build", "completed", "skipped"), job("publish", "completed", "skipped"), job("deploy", "completed", "skipped"), job("report", "completed", "skipped")]);
  eq((await o("GET", "progress")).jsonBody.summary, "Only a check: no update was due then, or there was nothing to build.");
  clock += 5 * 60 * 1000;
  fakeGitHub([{ ...run, conclusion: "skipped" }], [job("pick", "completed", "skipped")]);
  eq((await o("GET", "progress")).jsonBody.summary, "Skipped: updates were paused then (the UPDATES_PAUSED variable on GitHub).");
  clock += 5 * 60 * 1000;
  const ok = [["Screen the suggestion", "completed", "success"], ["Claude builds it", "completed", "success"], ["Tests", "completed", "success"], ["Guard", "completed", "success"]];
  fakeGitHub([run], [job("pick", "completed", "success"), job("build", "completed", "success", ok), job("publish", "completed", "success"),
    job("deploy / test", "completed", "success"), job("deploy / deploy", "completed", "success"), job("report", "completed", "success")]);
  const done = (await o("GET", "progress")).jsonBody;
  eq([done.summary, done.stages.every(s => s.state === "done")], ["Finished: the update is live.", true]);
  clock += 5 * 60 * 1000;
  global.fetch = async () => ({ ok: false, status: 403, json: async () => ({}) });
  const slow = (await o("GET", "progress")).jsonBody;
  eq([slow.summary, !!slow.stale], ["Finished: the update is live.", true], "the last answer, marked as old");
  reset();
  const o2 = await owner();
  const none = (await o2("GET", "progress")).jsonBody;
  eq([none.ok, /slow down/.test(none.why)], [false, true]);
  global.fetch = realFetch;
});

test("run now again, once the token is set, asks GitHub, and the panel says what GitHub said", async () => {
  reset();
  const o = await owner();
  await report((await pickNow()).pick.id, "shipped");
  clock = NOON + 0.5 * H;
  await o("POST", "run-now");
  const asked = clock;
  eq((await o("GET", "status")).jsonBody.next.started, null, "no token: nothing asked of GitHub");
  env.GH_DISPATCH_TOKEN = "github_pat_test";
  const sent = [];
  global.fetch = async (url, init) => { sent.push([url, init.method]); return { status: 204 }; };
  clock += 30 * 60 * 1000;
  const r = await o("POST", "run-now");
  eq([r.jsonBody.started, sent.length, sent[0][1]], [true, 1, "POST"]);
  ok(/scheduled-update\.yml\/dispatches$/.test(sent[0][0]));
  const n = (await o("GET", "status")).jsonBody.next;
  eq([n.runNowAt, n.started.ok, n.started.at], [asked, true, clock], "the first ask's time is kept");
  global.fetch = async () => ({ status: 403 });
  clock += 60 * 1000;
  const bad = await o("POST", "run-now");
  eq([bad.jsonBody.started, (await o("GET", "status")).jsonBody.next.started.ok], [false, false]);
  global.fetch = realFetch;
  ok((await pickNow()).pick);
  eq((await o("GET", "status")).jsonBody.next.started, null, "gone once the run starts");
});

done();
