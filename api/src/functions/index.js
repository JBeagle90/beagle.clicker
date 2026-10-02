// Azure Functions (v4 Node model) for beagle.clicker's API, the managed API of the Static Web App.
// The logic is in ../core/lib.js; this file connects it to HTTP and Cosmos DB.
//
// App settings (Static Web App → Environment variables):
//   COSMOS_ENDPOINT   https://<account>.documents.azure.com:443/
//   COSMOS_KEY        the account's primary key
//   COSMOS_DATABASE   default "beagleclicker"
//   COSMOS_CONTAINER  default "docs" (partition key /pk, Time to Live: On, no default)
//   OPS_KEY           24+ random characters; the same value is the OPS_KEY secret on GitHub
//   UPDATE_HOURS      the schedule in hours, matching the workflow's cron (default 3), for the countdown
//   MIN_SCORE         optional: bones a suggestion needs before it can be picked (default 1)
//   BUDGET_USD_30D    the most Claude may spend in 30 days; no build starts past it (default 250)
//   MAX_BUILDS_PER_DAY  default 8
//   OWN_IDEAS         0 = Claude doesn't build its own ideas when no suggestion has bones (default 1)
//   BLOCKED_WORDS     more words to refuse in suggestions and updates, comma-separated (../core/moderation.js)
//   OWNER_ORIGIN      the owner's panel's address(es) for passkeys, comma-separated (default https://beagle.games)
"use strict";
const { app } = require("@azure/functions");
const { CosmosClient } = require("@azure/cosmos");
const { handle, ROUTES } = require("../core/lib");

let container = null;
function cosmos() {
  if (container) return container;
  if (!process.env.COSMOS_ENDPOINT || !process.env.COSMOS_KEY) throw Object.assign(new Error("COSMOS_ENDPOINT and COSMOS_KEY aren't set"), { code: "config" });
  const client = new CosmosClient({ endpoint: process.env.COSMOS_ENDPOINT, key: process.env.COSMOS_KEY });
  container = client.database(process.env.COSMOS_DATABASE || "beagleclicker").container(process.env.COSMOS_CONTAINER || "docs");
  return container;
}

const SYSTEM = ["_etag", "_rid", "_self", "_ts", "_attachments"];
const bare = d => { const o = { ...d }; for (const k of SYSTEM) delete o[k]; return o; };
const TRIES = 20;

const store = {
  async read(pk, id) {
    try { const { resource } = await cosmos().item(id, pk).read(); return resource || null; }
    catch (e) { if (e.code === 404) return null; throw e; }
  },
  async upsert(doc) { await cosmos().items.upsert(bare(doc)); },
  async remove(pk, id) {
    try { await cosmos().item(id, pk).delete(); } catch (e) { if (e.code !== 404) throw e; }
  },
  // Read, change, write: the write carries the etag of what was read, so if someone wrote in between
  // Cosmos refuses it (412) and it starts again; a new document is only created if still missing (409).
  async update(pk, id, fn) {
    for (let i = 0; i < TRIES; i++) {
      let cur = null, etag = null;
      try { const r = await cosmos().item(id, pk).read(); cur = r.resource || null; etag = r.etag || (cur && cur._etag) || null; }
      catch (e) { if (e.code !== 404) throw e; }
      const next = await fn(cur ? bare(cur) : null);
      if (!next) return null;
      const doc = bare({ ...next, pk, id });
      try {
        if (cur && etag) await cosmos().item(id, pk).replace(doc, { accessCondition: { type: "IfMatch", condition: etag } });
        else if (cur) await cosmos().items.upsert(doc);
        else await cosmos().items.create(doc);
        return doc;
      } catch (e) {
        if (e.code !== 412 && e.code !== 409 && e.code !== 404) throw e;
        await new Promise(r => setTimeout(r, Math.random() * 20 * (i + 1)));
      }
    }
    throw Object.assign(new Error("Too many writes to one document at once"), { code: 412 });
  },
  // Every document in a partition (or the newest `limit` by orderBy, below `before` if given).
  async list(pk, { limit = 1000, orderBy, before } = {}) {
    const field = orderBy && /^[A-Za-z]+$/.test(orderBy) ? orderBy : null;
    const n = Math.max(1, Math.min(1000, limit | 0));
    const parameters = [{ name: "@pk", value: pk }];
    let where = "c.pk = @pk";
    if (field && before != null) { where += ` AND c.${field} < @before`; parameters.push({ name: "@before", value: before }); }
    const q = { query: `SELECT TOP ${n} * FROM c WHERE ${where}${field ? ` ORDER BY c.${field} DESC` : ""}`, parameters };
    const { resources } = await cosmos().items.query(q, { partitionKey: pk }).fetchAll();
    return (resources || []).map(bare);
  },
};

async function run(request, route) {
  let body, rawLength = 0;
  if (request.method === "POST") {
    const text = await request.text();
    rawLength = Buffer.byteLength(text);
    try { body = JSON.parse(text); } catch (e) { body = undefined; }
  }
  try {
    return await handle({ method: request.method, route, sub: request.params.sub, query: request.query, headers: request.headers, body, rawLength }, store);
  } catch (e) {
    console.error("[api]", route, request.method, e && e.code, e && e.message);
    const why = e && e.code === "config" ? "settings" : e && (e.code === 401 || e.code === 403) ? "database_key" : "server";
    return { status: 500, jsonBody: { error: { code: why, message: "Something went wrong at the dog house. Try again in a moment." } }, headers: { "Cache-Control": "no-store" } };
  }
}

for (const route of ROUTES) {
  const sub = route === "game" || route === "ops" || route === "owner";
  app.http(route, { methods: ["GET", "POST"], authLevel: "anonymous", route: sub ? `${route}/{sub}` : route, handler: req => run(req, route) });
}
