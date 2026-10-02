// `node dev/guard.mjs [base]`: is what changed since base (default origin/main, else main) allowed
// in a scheduled update? Counts commits, staged and unstaged changes and new files. Prints each
// problem and exits 1 if there are any. The rules are in dev/guard-rules.cjs.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { check } = require("./guard-rules.cjs");
const ROOT = process.cwd();
const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8" });

let base = process.argv[2];
if (!base) { try { git("rev-parse", "--verify", "-q", "origin/main"); base = "origin/main"; } catch (e) { base = "main"; } }

const changed = new Map();
for (const line of git("diff", "--name-status", "--no-renames", base).split("\n").filter(Boolean)) {
  const [status, p] = line.split("\t");
  changed.set(p, status === "D");
}
const counts = new Map();
for (const line of git("diff", "--numstat", "--no-renames", base).split("\n").filter(Boolean)) {
  const [a, r, p] = line.split("\t");
  counts.set(p, (+a || 0) + (+r || 0));
}
for (const p of git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean)) changed.set(p, false);
for (const p of [...changed.keys()]) if (p.startsWith(".update-task/")) changed.delete(p);

const files = [...changed].map(([p, deleted]) => {
  const there = fs.existsSync(path.join(ROOT, p)), binary = /\.(png|webp)$/.test(p);
  const content = there ? fs.readFileSync(path.join(ROOT, p), binary ? undefined : "utf8") : "";
  const lines = counts.has(p) ? counts.get(p) : binary ? 0 : String(content).split("\n").length; // new files: every line
  return { path: p, deleted: deleted || !there, content, lines };
});
const problems = check(files, process.env);
if (problems.length) { console.log(`Not allowed in an update (${problems.length}):\n- ${problems.join("\n- ")}`); process.exit(1); }
const total = files.filter(f => !f.path.startsWith("docs/")).reduce((n, f) => n + f.lines, 0);
console.log(`Guard: ${files.length} changed file${files.length === 1 ? "" : "s"} (${total} lines of code), all allowed.`);
