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
  const pick = (await api("POST", "/ops/pick", {}, { ops: OPS_KEY })).jsonBody.pick;
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

done();
