// `npm test`: runs every dev/test-*.cjs (new ones are picked up by themselves) and fails if any
// fails. `node dev/run-tests.cjs api` runs only the files whose names contain "api"; -v shows all output.
"use strict";
const { spawn } = require("child_process"), fs = require("fs"), path = require("path");
const args = process.argv.slice(2), verbose = args.includes("-v") || args.includes("--verbose");
const words = args.filter(a => !a.startsWith("-"));
const files = fs.readdirSync(__dirname).filter(f => /^test-.+\.cjs$/.test(f) && (!words.length || words.some(w => f.includes(w)))).sort();
if (!files.length) { console.error(`No dev/test-*.cjs matches ${words.join(", ")}.`); process.exit(1); }

const run = f => new Promise(resolve => {
  const t0 = Date.now(), out = [];
  const p = spawn(process.execPath, [path.join(__dirname, f)], { cwd: path.join(__dirname, "..") });
  p.stdout.on("data", d => out.push(d)); p.stderr.on("data", d => out.push(d));
  p.on("close", code => resolve({ f, ok: code === 0, code, ms: Date.now() - t0, out: Buffer.concat(out).toString() }));
});

(async () => {
  const results = await Promise.all(files.map(run));
  for (const r of results) {
    const passes = (r.out.match(/^PASS /gm) || []).length;
    console.log(`${r.ok ? "ok  " : "FAIL"} ${r.f} (${passes} checks, ${(r.ms / 1000).toFixed(1)} s)`);
    if (!r.ok || verbose) console.log(r.out.replace(/\s+$/, "").replace(/^/gm, "    ") + (r.ok ? "" : `\n    exited with ${r.code}`));
  }
  const bad = results.filter(r => !r.ok);
  console.log(bad.length ? `\n${bad.length} of ${files.length} test files failed.` : `\nAll passed (${files.length} test files).`);
  process.exit(bad.length ? 1 : 0);
})();
