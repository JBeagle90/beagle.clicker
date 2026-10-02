// `npm run build`: the site as it's deployed, in dist/. No bundler: it copies web/ to the root,
// src/ to /src/, the game rules to /rules.js, and writes /version.json (which commit is live; the
// page checks it to say when an update has landed). The API (api/) is deployed as it is.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");

fs.rmSync(DIST, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, "web"), DIST, { recursive: true });
fs.cpSync(path.join(ROOT, "src"), path.join(DIST, "src"), { recursive: true });
fs.copyFileSync(path.join(ROOT, "api", "src", "game", "rules.js"), path.join(DIST, "rules.js"));

let commit = "dev";
try { commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch (e) { /* not a git checkout, or no commits yet */ }
const version = { commit: commit.slice(0, 12), title: process.env.UPDATE_TITLE || "", at: new Date().toISOString() };
fs.writeFileSync(path.join(DIST, "version.json"), JSON.stringify(version));

const count = dir => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(path.join(dir, e.name)) : 1), 0);
console.log(`Built dist/ (${count(DIST)} files, version ${version.commit}).`);
