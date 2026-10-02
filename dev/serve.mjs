// The game on this computer, with its API: `npm start` (http://127.0.0.1:5190).
// Serves web/ at the site root, src/ at /src/, the game rules at /rules.js (as the build does), and
// the real API (api/src/core/lib.js) on a store kept in dev/.data.json. BC_DATA=none keeps it in
// memory only (dev/look.mjs). The hourly update's key here is OPS_KEY, or the one printed at start.
// For trying the game on one computer: it isn't a secure server.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { handle } = require("../api/src/core/lib.js");
const { memoryStore } = require("./memstore.cjs");
const store = memoryStore(process.env.BC_DATA === "none" ? undefined : path.join(ROOT, "dev", ".data.json"));
const PORT = Number(process.env.PORT) || 5190;
const env = { ...process.env, OPS_KEY: process.env.OPS_KEY || "dev-ops-key-for-this-computer-only" };
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".txt": "text/plain", ".webmanifest": "application/manifest+json" };

function fileFor(rel) {
  if (rel === "/" ) return path.join(ROOT, "web", "index.html");
  if (rel === "/rules.js") return path.join(ROOT, "api", "src", "game", "rules.js");
  if (rel.startsWith("/src/")) return path.join(ROOT, rel);
  return path.join(ROOT, "web", rel);
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost"), rel = decodeURIComponent(url.pathname);
    if (rel.startsWith("/api/")) {
      const [route, sub] = rel.slice(5).split("/");
      const chunks = []; for await (const ch of req) chunks.push(ch);
      const text = Buffer.concat(chunks).toString("utf8");
      let body; try { body = text ? JSON.parse(text) : undefined; } catch (e) { body = undefined; }
      const headers = { ...req.headers, "x-forwarded-for": req.socket.remoteAddress };
      const r = await handle({ method: req.method, route, sub, headers: { get: k => headers[k.toLowerCase()] }, body, rawLength: Buffer.byteLength(text) }, store, env);
      res.writeHead(r.status, { "Content-Type": "application/json; charset=utf-8", ...(r.headers || {}) });
      return res.end(JSON.stringify(r.jsonBody));
    }
    const file = fileFor(rel);
    if (rel.includes("..") || !file.startsWith(ROOT) || /staticwebapp\.config\.json$/.test(file)) { res.writeHead(403).end(); return; }
    const buf = await fs.readFile(file);
    res.writeHead(200, { "Content-Type": (TYPES[path.extname(file)] || "application/octet-stream") + "; charset=utf-8", "Cache-Control": "no-store" });
    res.end(buf);
  } catch (e) {
    if (e.code !== "ENOENT") console.error(e);
    res.writeHead(e.code === "ENOENT" ? 404 : 500, { "Content-Type": "text/plain" }).end(e.code === "ENOENT" ? "Not found" : "Server error");
  }
}).on("error", e => {
  if (e.code === "EADDRINUSE") console.error(`Port ${PORT} is in use: beagle.clicker may already be running at http://127.0.0.1:${PORT}, or set PORT.`);
  else console.error(e);
  process.exit(1);
}).listen(PORT, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`beagle.clicker is running at ${url}  (Ctrl+C to stop)`);
  if (!process.env.OPS_KEY) console.log(`Hourly-update key here: ${env.OPS_KEY}  (node dev/ops.mjs pick)`);
  if (process.argv.includes("--open")) exec(process.platform === "win32" ? `start "" "${url}"` : `open "${url}" || xdg-open "${url}"`);
});
