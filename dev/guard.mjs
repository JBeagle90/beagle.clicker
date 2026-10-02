// `node dev/guard.mjs [base]`: is what changed since base (default origin/main, else main) allowed
// in an hourly update? Counts commits, staged and unstaged changes and new files. Prints each
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
for (const p of git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean)) changed.set(p, false);
for (const p of [...changed.keys()]) if (p.startsWith(".update-task/")) changed.delete(p);

const files = [...changed].map(([p, deleted]) => ({ path: p, deleted: deleted || !fs.existsSync(path.join(ROOT, p)), content: fs.existsSync(path.join(ROOT, p)) ? fs.readFileSync(path.join(ROOT, p), /\.(png|webp)$/.test(p) ? undefined : "utf8") : "" }));
const problems = check(files);
if (problems.length) { console.log(`Not allowed in an update (${problems.length}):\n- ${problems.join("\n- ")}`); process.exit(1); }
console.log(`Guard: ${files.length} changed file${files.length === 1 ? "" : "s"}, all allowed.`);
