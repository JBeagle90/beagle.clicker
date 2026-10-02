// The owner's panel (web/admin/), at /api/owner/<what>. Only the owner signs in, with a passkey
// (fingerprint, face, Windows Hello or a security key) on a device added with a one-time invite:
//   node dev/ops.mjs invite   → { url: "<site>/admin#invite=<code>" }: good once, for 10 minutes
//
//   POST register-start { invite }                 → options for navigator.credentials.create
//   POST register       { invite, name, ...passkey } → { ok }: the device is added
//   POST login-start                                → options for navigator.credentials.get
//   POST login          { ...passkey }              → { session }: kept in the panel's tab only
//   GET  status         (x-owner-session)           → spending, recent runs, settings, devices
//   POST forget         { id } (x-owner-session)    → that device can't sign in any more
//   POST logout         (x-owner-session)
//
// Passkeys are checked here with Node's crypto (no packages): the browser's signature over a
// one-time challenge from this server, made at an allowed address, with the person verified.
// There's no password to steal, and game code can't use a passkey without the device asking first.
// Documents are in partition "owner": inv:<hash>, ch:<challenge>, dev:<hash>, ses:<hash>.
// Setting: OWNER_ORIGIN, the panel's address, or several comma-separated (default https://beagle.games).
"use strict";
const crypto = require("crypto");
const { json, fail, sha256, randomId, cleanText, updateHours, HOUR } = require("./util");
const ratelimit = require("./ratelimit");
const ops = require("./ops");

const PK = "owner";
const MIN = 60 * 1000;
const INVITE_MS = 10 * MIN, CHALLENGE_MS = 5 * MIN, SESSION_MS = HOUR;
const MAX_DEVICES = 10;
const B64 = /^[A-Za-z0-9_-]{1,4000}$/;
const ALGS = { "-7": "ec", "-8": "ed25519", "-257": "rsa" }; // ES256, EdDSA, RS256
const USER_ID = Buffer.from("beagle.clicker owner").toString("base64url"); // one owner, so one user

const origins = env => String(env.OWNER_ORIGIN || "https://beagle.games").split(",").map(s => s.trim().replace(/\/+$/, "")).filter(Boolean);
const bytes = v => typeof v === "string" && B64.test(v) ? Buffer.from(v, "base64url") : null;
const refuse = (why = "That didn't work. Try again.") => fail(403, "refused", why);

// A one-time document (invite or challenge), used up by whoever gets it first. → it, or null.
async function useOnce(c, id) {
  let got = null;
  await c.store.update(PK, id, cur => {
    if (!cur || cur.used || !(cur.exp > c.now)) return null;
    got = cur;
    return { ...cur, used: true };
  });
  return got;
}

async function challenge(c, type) {
  const ch = randomId(32);
  await c.store.upsert({ id: "ch:" + ch, pk: PK, type, exp: c.now + CHALLENGE_MS, ttl: 600 });
  return ch;
}

// What the browser signed: { type, challenge, origin }, checked against a challenge this server gave.
async function clientData(c, b64, type) {
  const raw = bytes(b64);
  if (!raw) return null;
  let d; try { d = JSON.parse(raw.toString("utf8")); } catch (e) { return null; }
  if (!d || d.type !== "webauthn." + type || d.crossOrigin === true || !origins(c.env).includes(d.origin)) return null;
  const ch = typeof d.challenge === "string" && B64.test(d.challenge) && await useOnce(c, "ch:" + d.challenge);
  return ch && ch.type === type ? { origin: d.origin, hash: crypto.createHash("sha256").update(raw).digest() } : null;
}

// The authenticator's data: for this site, the person there (UP) and verified (UV, a fingerprint, face
// or PIN). → { count, rest } or null.
function authData(buf, origin) {
  if (!buf || buf.length < 37) return null;
  const rp = crypto.createHash("sha256").update(new URL(origin).hostname).digest();
  if (!crypto.timingSafeEqual(buf.subarray(0, 32), rp) || (buf[32] & 0x05) !== 0x05) return null;
  return { flags: buf[32], count: buf.readUInt32BE(33), rest: buf.subarray(37) };
}

async function devices(c) {
  return (await c.store.list(PK)).filter(d => d.id.startsWith("dev:"));
}

// The signed-in session, from x-owner-session. → its document, or null.
async function session(c) {
  const token = String(c.headers.get("x-owner-session") || "");
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) return null;
  const s = await c.store.read(PK, "ses:" + sha256(token));
  return s && s.exp > c.now ? s : null;
}

// From the scheduled-update key (ops.js): a link that adds one device.
async function invite(c) {
  const code = randomId(24);
  await c.store.upsert({ id: "inv:" + sha256(code), pk: PK, exp: c.now + INVITE_MS, ttl: 900 });
  return json(200, { url: `${origins(c.env)[0]}/admin#invite=${code}`, expires: c.now + INVITE_MS });
}

async function registerStart(c) {
  const inv = await c.store.read(PK, "inv:" + sha256(String(c.body.invite || "")));
  if (!inv || inv.used || !(inv.exp > c.now)) return refuse("That invite has been used or is too old. Make a new one: node dev/ops.mjs invite");
  const have = await devices(c);
  if (have.length >= MAX_DEVICES) return refuse(`At most ${MAX_DEVICES} devices. Forget one first.`);
  return json(200, { publicKey: {
    challenge: await challenge(c, "create"),
    rp: { name: "beagle.clicker" },
    user: { id: USER_ID, name: "owner", displayName: "beagle.clicker owner" },
    pubKeyCredParams: Object.keys(ALGS).map(alg => ({ type: "public-key", alg: +alg })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    excludeCredentials: have.map(d => ({ type: "public-key", id: d.credId })),
    attestation: "none",
    timeout: 120000,
  } });
}

// A new passkey: the browser's getPublicKey() (SPKI) and getAuthenticatorData(), for a valid invite.
async function register(c) {
  const b = c.body, id = bytes(b.id), key = bytes(b.publicKey), alg = String(b.alg);
  if (!id || id.length > 1023 || !key || !ALGS[alg]) return refuse("This browser can't make a passkey here. Try an up-to-date Chrome, Edge, Safari or Firefox.");
  let pub; try { pub = crypto.createPublicKey({ key, format: "der", type: "spki" }); } catch (e) { return refuse(); }
  if (pub.asymmetricKeyType !== ALGS[alg]) return refuse();
  const cd = await clientData(c, b.clientDataJSON, "create");
  const ad = cd && authData(bytes(b.authenticatorData), cd.origin);
  // The credential's id is in the authenticator data too: 16 bytes of AAGUID, its length, then the id.
  if (!ad || !(ad.flags & 0x40) || ad.rest.length < 18 || !ad.rest.subarray(18, 18 + ad.rest.readUInt16BE(16)).equals(id)) return refuse();
  if (!(await useOnce(c, "inv:" + sha256(String(b.invite || ""))))) return refuse("That invite has been used or is too old. Make a new one: node dev/ops.mjs invite");
  await c.store.upsert({ id: "dev:" + sha256(b.id), pk: PK, credId: b.id, key: b.publicKey, alg: +alg, count: ad.count,
    name: cleanText(b.name, 40) || "A device", at: c.now, usedAt: null });
  return json(200, { ok: true });
}

async function loginStart(c) {
  return json(200, { publicKey: { challenge: await challenge(c, "get"), userVerification: "required", timeout: 120000 } });
}

async function login(c) {
  const b = c.body, sig = bytes(b.signature), raw = bytes(b.authenticatorData);
  const dev = typeof b.id === "string" && B64.test(b.id) && await c.store.read(PK, "dev:" + sha256(b.id));
  const cd = dev && sig && await clientData(c, b.clientDataJSON, "get");
  const ad = cd && authData(raw, cd.origin);
  if (!ad) return refuse("That passkey isn't one of the owner's devices.");
  const key = crypto.createPublicKey({ key: Buffer.from(dev.key, "base64url"), format: "der", type: "spki" });
  const data = Buffer.concat([raw, cd.hash]);
  let good = false;
  try { good = crypto.verify(dev.alg === -8 ? null : "sha256", data, dev.alg === -7 ? { key, dsaEncoding: "der" } : key, sig); } catch (e) { good = false; }
  if (!good) return refuse("That passkey isn't one of the owner's devices.");
  // Passkeys that count their uses must count up; one that goes back was copied. (Synced ones stay at 0.)
  if ((ad.count || dev.count) && ad.count <= dev.count) return refuse("That passkey looks copied. Forget the device and add it again.");
  await c.store.upsert({ ...dev, count: ad.count, usedAt: c.now });
  const token = randomId(32);
  await c.store.upsert({ id: "ses:" + sha256(token), pk: PK, device: dev.id, exp: c.now + SESSION_MS, ttl: SESSION_MS / 1000 + 600 });
  return json(200, { session: token, expires: c.now + SESSION_MS });
}

async function status(c, s) {
  const spend = (await c.store.read("sys", "spend")) || {};
  const { budget, perDay } = ops.limits(c.env);
  return json(200, {
    now: c.now,
    spend: { ...(await ops.spending(c)), budget, perDay, days: spend.days || {}, runs: (spend.runs || []).slice(-50).reverse() },
    settings: { updateHours: updateHours(c.env), ownIdeas: c.env.OWN_IDEAS !== "0", minScore: Math.max(1, +c.env.MIN_SCORE || 1) },
    devices: (await devices(c)).sort((a, b) => a.at - b.at).map(d => ({ id: d.id.slice(4, 16), name: d.name, at: d.at, usedAt: d.usedAt, you: d.id === s.device })),
    sessionEnds: s.exp,
  });
}

async function forget(c) {
  const id = String(c.body.id || "");
  const dev = /^[0-9a-f]{12}$/.test(id) && (await devices(c)).find(d => d.id.slice(4, 16) === id);
  if (!dev) return fail(404, "not_found", "That device isn't there.");
  await c.store.remove(PK, dev.id);
  return json(200, { ok: true });
}

async function handle(what, c, method) {
  if (method === "GET" && what === "status") {
    const s = await session(c);
    return s ? status(c, s) : fail(401, "signed_out", "Sign in again.");
  }
  if (method !== "POST") return fail(405, "method", "POST only.");
  if (["register-start", "register", "login-start", "login"].includes(what)) {
    if (!(await ratelimit.allow(c.store, "owner", c.ip, 60, 3600, c.now))) return fail(429, "slow_down", "Too many tries. Wait a while.");
    if (what === "register-start") return registerStart(c);
    if (what === "register") return register(c);
    if (what === "login-start") return loginStart(c);
    return login(c);
  }
  const s = await session(c);
  if (!s) return fail(401, "signed_out", "Sign in again.");
  if (what === "forget") return forget(c);
  if (what === "logout") { await c.store.remove(PK, s.id); return json(200, { ok: true }); }
  return fail(404, "not_found", "Nothing here.");
}

module.exports = { handle, invite };
