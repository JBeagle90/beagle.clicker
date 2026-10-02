// What a scheduled update may change, how much, and what the files it changes may not contain.
// The workflow runs this (from main, before the change is pushed) and refuses the change if anything
// is found; Claude runs it too (`node dev/guard.mjs`) to check before finishing. CLAUDE.md says the
// same in words. It is one guard among several (the prompt, a read-only token, the site's CSP), not
// the only one, and it is kept simple on purpose: it refuses some things that would have been fine.
"use strict";
const path = require("path");
const { blocked } = require(path.join(__dirname, "..", "api", "src", "core", "moderation.js"));

// Only these paths. Everything else (the workflows, the core API, the build, CLAUDE.md, the site's
// security headers, the packages) is the owner's.
const ALLOWED = [
  /^src\/[A-Za-z0-9_\/-]+\.(js|css)$/,
  /^web\/(?!staticwebapp\.config\.json$)[A-Za-z0-9_\/-]+\.(html|svg|png|webp|txt|css|webmanifest)$/,
  /^api\/src\/game\/[A-Za-z0-9_-]+\.js$/,
  /^dev\/test-(?!core-)[a-z0-9-]+\.cjs$/,
  /^docs\/(?:GAME|CODE|IDEAS|CHANGELOG)\.md$/,
];

// Small updates: each one stays cheap to build and changes the game a little at a time. Lines are
// added + removed, in everything but the docs. The docs are read by every build, so they're kept
// short too (CHANGELOG.md, which the workflow writes and builds don't read, isn't).
const MAX_FILES = 14, MAX_CODE_LINES = 500, MAX_BYTES = 200 * 1024;
const DOC_LIMITS = { "docs/GAME.md": 10 * 1024, "docs/CODE.md": 16 * 1024, "docs/IDEAS.md": 6 * 1024 };
const isDoc = p => /^docs\//.test(p);

const OUTSIDE = /(?:https?:)?\/\/(?!www\.w3\.org\/)[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/i;
const EVAL = /\b(?:eval|Function)\s*\(|\bconstructor\s*\.\s*constructor\b|\bimport\s*\(/;

// [which files, [pattern, why]...]
const BANNED = [
  [/^api\/src\/game\//, [
    [/\bprocess\b/, "process (settings, secrets, the server itself)"],
    [/\b(?:fetch|XMLHttpRequest|WebSocket)\b/, "network calls"],
    [EVAL, "running code from strings"],
    [/\b(?:globalThis|global)\b(?!\s*\))/, "globals"],
    [/\b(?:setTimeout|setInterval|setImmediate|queueMicrotask)\b/, "timers"],
    [/__proto__|\bprototype\b|\bdefineProperty\b/, "prototype changes"],
    [OUTSIDE, "outside addresses"],
  ]],
  [/^(?:src|web)\//, [
    [/\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write|createContextualFragment|DOMParser)\b/, "HTML from strings (build elements and use textContent)"],
    [EVAL, "running code from strings"],
    [/\bdocument\.cookie\b/, "cookies"],
    [/\b(?:WebSocket|EventSource|sendBeacon)\b/, "other connections"],
    [OUTSIDE, "outside addresses (everything comes from this site)"],
  ]],
  [/^web\/.*\.(?:html|svg)$/, [
    [/<script\b(?![^>]*\bsrc=["']\/)/i, "inline scripts"],
    [/<[^>]+\son[a-z]+\s*=/i, "inline event handlers"],
    [/<(?:iframe|object|embed|foreignObject)\b/i, "embedded pages"],
  ]],
  [/^dev\/test-/, [
    [/\bprocess\.(?:env|binding|dlopen)\b/, "process settings"],
    [/\b(?:fetch|XMLHttpRequest|WebSocket)\b/, "network calls"],
    [EVAL, "running code from strings"],
    [OUTSIDE, "outside addresses"],
  ]],
];

// require(...) is allowed only for these, per area.
const REQUIRES = [
  [/^api\/src\/game\//, /^\.\/[A-Za-z0-9_-]+(?:\.js)?$/],
  [/^dev\/test-/, /^(?:assert|path|node:assert|node:path|\.\/t\.cjs|\.\/memstore\.cjs|\.\.\/api\/src\/[A-Za-z0-9_\/-]+(?:\.js)?)$/],
];

// files: [{ path, deleted, content, lines (added + removed) }] → a list of problems, one line each
// (empty: allowed). env: for BLOCKED_WORDS.
function check(files, env = {}) {
  const out = [];
  if (files.length > MAX_FILES) out.push(`${files.length} files changed: at most ${MAX_FILES} in one update.`);
  const lines = files.filter(f => !isDoc(f.path)).reduce((n, f) => n + (+f.lines || 0), 0);
  if (lines > MAX_CODE_LINES) out.push(`${lines} lines of code changed: at most ${MAX_CODE_LINES} in one update. Build a smaller first step.`);
  for (const f of files) {
    const p = f.path.replace(/\\/g, "/");
    if (!ALLOWED.some(re => re.test(p))) { out.push(`${p}: may not be ${f.deleted ? "deleted" : "changed"} by an update.`); continue; }
    if (f.deleted) continue;
    const text = String(f.content || "");
    if (Buffer.byteLength(text) > MAX_BYTES) out.push(`${p}: over ${MAX_BYTES / 1024} KB.`);
    if (DOC_LIMITS[p] && Buffer.byteLength(text) > DOC_LIMITS[p]) out.push(`${p}: over ${DOC_LIMITS[p] / 1024} KB. Tighten it: say the same in fewer words.`);
    if (/\.(png|webp)$/.test(p)) continue;
    // Words that don't belong in a game for everyone, anywhere in what players could see or the
    // next build reads. (CHANGELOG.md quotes suggestions, which were checked when posted.)
    const bad = p !== "docs/CHANGELOG.md" && blocked(text, env);
    if (bad) out.push(`${p}: "${bad}" isn't a word for this game.`);
    for (const [area, rules] of BANNED) if (area.test(p)) for (const [re, why] of rules) {
      const m = re.exec(text);
      if (m) out.push(`${p}: ${why} ("${m[0].slice(0, 40)}", line ${text.slice(0, m.index).split("\n").length}).`);
    }
    for (const [area, okReq] of REQUIRES) if (area.test(p)) {
      const calls = text.match(/\brequire\s*\(([^)]*)\)/g) || [];
      for (const call of calls) {
        const arg = /\(\s*["']([^"']+)["']\s*\)/.exec(call);
        if (!arg || !okReq.test(arg[1]) || arg[1].includes("..") && !arg[1].startsWith("../api/src/")) out.push(`${p}: ${call.slice(0, 60)} isn't allowed here.`);
      }
      if (/\bimport\b[^(\n]*\bfrom\b/.test(text) && /^api\/src\/game\//.test(p)) out.push(`${p}: use require("./…"), not import.`);
    }
  }
  return out;
}

module.exports = { check, ALLOWED, MAX_FILES, MAX_CODE_LINES };
