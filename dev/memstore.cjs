// An in-memory (optionally file-backed) stand-in for the API's Cosmos DB store, for the tests and
// the local server (dev/serve.mjs). Same calls as api/src/functions/index.js.
// Like Cosmos it hands back copies, checks a version before update() writes, waits a moment on every
// call (so requests at the same time interleave) and lets documents with a ttl expire.
"use strict";
const fs = require("fs");

const copy = d => d == null ? null : JSON.parse(JSON.stringify(d));
const tick = () => new Promise(r => setImmediate(r));

function memoryStore(file) {
  let docs = new Map();
  if (file && fs.existsSync(file)) { try { docs = new Map(Object.entries(JSON.parse(fs.readFileSync(file, "utf8")))); } catch (e) { docs = new Map(); } }
  const versions = new Map();
  let v = 0, timer = null;
  const key = (pk, id) => `${pk}|${id}`;
  const persist = () => { if (!file) return; clearTimeout(timer); timer = setTimeout(() => fs.writeFileSync(file, JSON.stringify(Object.fromEntries(docs))), 200); };
  const alive = (k) => {
    const d = docs.get(k);
    if (d && d.ttl > 0 && d._at + d.ttl * 1000 <= Date.now()) { docs.delete(k); versions.delete(k); return null; }
    return d || null;
  };
  const put = doc => { const k = key(doc.pk, doc.id); docs.set(k, { ...copy(doc), _at: Date.now() }); versions.set(k, ++v); persist(); };
  const out = d => { if (!d) return null; const o = copy(d); delete o._at; return o; };

  return {
    async read(pk, id) { await tick(); return out(alive(key(pk, id))); },
    async upsert(doc) { await tick(); put(doc); },
    async remove(pk, id) { await tick(); const k = key(pk, id); docs.delete(k); versions.delete(k); persist(); },
    async update(pk, id, fn) {
      const k = key(pk, id);
      for (let i = 0; i < 20; i++) {
        await tick();
        const seen = versions.get(k), cur = out(alive(k));
        const next = await fn(cur);
        await tick();
        if (versions.get(k) !== seen) continue;
        if (!next) return null;
        put({ ...next, pk, id });
        return out({ ...next, pk, id });
      }
      throw Object.assign(new Error("Too many writes to one document at once"), { code: 412 });
    },
    async list(pk, { limit = 1000, orderBy, before } = {}) {
      await tick();
      let all = [...docs.keys()].map(alive).filter(d => d && d.pk === pk && (!orderBy || before == null || (d[orderBy] || 0) < before));
      if (orderBy) all.sort((a, b) => (b[orderBy] || 0) - (a[orderBy] || 0));
      return all.slice(0, limit).map(out);
    },
    dump: () => [...docs.values()].map(out),
  };
}

module.exports = { memoryStore };
