// The scheduled update's calls to the API (api/src/core/ops.js): `node dev/ops.mjs <pick|result|hide> [json]`.
// The JSON body is the argument, or read from stdin when there's none (and not a terminal). Prints
// the answer as JSON; exits 1 if the API refused. Settings: OPS_URL (default the local server,
// http://127.0.0.1:5190) and OPS_KEY (default the local server's key).
//   node dev/ops.mjs pick
//   node dev/ops.mjs hide '{"id":"abc123xy","reason":"Not for this game."}'
const [what, arg] = process.argv.slice(2);
if (!["pick", "result", "hide"].includes(what)) { console.error("Usage: node dev/ops.mjs <pick|result|hide> [json]"); process.exit(2); }

let body = arg;
if (body == null && !process.stdin.isTTY) { const chunks = []; for await (const c of process.stdin) chunks.push(c); body = Buffer.concat(chunks).toString("utf8").trim(); }
const base = (process.env.OPS_URL || "http://127.0.0.1:5190").replace(/\/+$/, "");
const key = process.env.OPS_KEY || "dev-ops-key-for-this-computer-only";

const r = await fetch(`${base}/api/ops/${what}`, { method: "POST", headers: { "Content-Type": "application/json", "x-ops-key": key }, body: body || "{}" });
const text = await r.text();
console.log(text);
if (!r.ok) { console.error(`${what}: ${r.status}`); process.exit(1); }
