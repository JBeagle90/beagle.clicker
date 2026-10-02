// Small helpers the API shares.
"use strict";
const crypto = require("crypto");

const NO_STORE = { "Cache-Control": "no-store" };
const json = (status, body) => ({ status, jsonBody: body, headers: NO_STORE });
const fail = (status, code, message) => json(status, { error: { code, message } });

const sha256 = s => crypto.createHash("sha256").update(String(s)).digest("hex");
const randomId = (bytes = 8) => crypto.randomBytes(bytes).toString("base64url");
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// The visitor's address, from the proxy in front (Azure sends "ip:port" in x-forwarded-for).
function clientIp(headers) {
  const raw = String((headers && headers.get("x-forwarded-for")) || "").split(",")[0].trim();
  const v4 = /^(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/.exec(raw);
  if (v4) return v4[1];
  const v6 = /^\[([0-9a-f:]+)\](?::\d+)?$/i.exec(raw);
  return v6 ? v6[1] : raw.slice(0, 64) || "unknown";
}

const INVISIBLE = new RegExp("[" + [[0, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff]].map(([a, b]) => `\\u{${a.toString(16)}}-\\u{${b.toString(16)}}`).join("") + "]", "gu"); // control and invisible characters
// Words people typed, made safe to keep and show: one line, no control characters, trimmed.
function cleanText(v, max) {
  return String(v == null ? "" : v)
    .replace(INVISIBLE, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

// The next hour on the clock (the hourly update's cron runs at minute 0, UTC).
const HOUR = 3600 * 1000;
const nextHour = now => Math.floor(now / HOUR) * HOUR + HOUR;

module.exports = { json, fail, sha256, randomId, safeEqual, clientIp, cleanText, nextHour, HOUR };
