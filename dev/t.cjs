// The tests' few helpers: `const { test, eq, ok, done } = require("./t.cjs")`.
// test(name, async fn) queues a check; done() runs them in order, prints PASS/FAIL, and exits 1 on a failure.
"use strict";
const assert = require("assert");
const queue = [];
const test = (name, fn) => queue.push({ name, fn });
const eq = (a, b, msg) => assert.deepStrictEqual(a, b, msg);
const ok = (v, msg) => assert.ok(v, msg);
async function done() {
  let failed = 0;
  for (const { name, fn } of queue) {
    try { await fn(); console.log("PASS " + name); }
    catch (e) { failed++; console.log("FAIL " + name + "\n  " + String(e && e.stack || e).split("\n").slice(0, 6).join("\n  ")); }
  }
  process.exit(failed ? 1 : 0);
}
module.exports = { test, eq, ok, done };
