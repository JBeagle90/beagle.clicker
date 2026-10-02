// "At most max of these per window": a counter document per key and window, gone when the window is.
"use strict";

// → true when this one is allowed (and counts it), false when the limit is reached.
async function allow(store, kind, key, max, windowSec, now) {
  const slot = Math.floor(now / 1000 / windowSec);
  const id = `${kind}:${key}:${slot}`.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 200);
  let ok = false;
  await store.update("rl", id, cur => {
    const n = cur ? cur.n || 0 : 0;
    ok = n < max;
    return ok ? { id, pk: "rl", n: n + 1, ttl: windowSec * 2 } : null;
  });
  return ok;
}

module.exports = { allow };
