// A screenshot of the game, to look at a change: `node dev/look.mjs [options]`.
// Starts the local server (in memory, so your own save isn't touched), opens the game in headless
// Chrome or Edge as a new player, waits for it to settle, saves a PNG and prints the page's errors.
//
//   --dark  --phone              dark theme; a 390 × 844 phone
//   --pats <n>                   pat the beagle n times first (bones to try the shop and board with)
//   --click "<selector>"         click it before the shot (several run in order)
//   --eval "<js>"                run this in the page before the shot (and print what it returns)
//   --wait <ms>                  wait longer before the shot (default 1200)
//   --full                       the whole page, not just the first screen
//   --out <name>                 the file name
// Shots go in .update-task/shots/ during a scheduled update, otherwise dev/.shots/.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2), flag = n => args.includes("--" + n);
const opt = n => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : null; };
const all = n => args.flatMap((a, i) => a === "--" + n ? [args[i + 1]] : []);
const dark = flag("dark"), phone = flag("phone"), full = flag("full");
const pats = Math.max(0, Math.min(5000, +(opt("pats") || 0)));
const wait = Math.max(0, Math.min(20000, +(opt("wait") || 1200)));
const OUT = fs.existsSync(path.join(ROOT, ".update-task")) ? path.join(ROOT, ".update-task", "shots") : path.join(ROOT, "dev", ".shots");
const name = (opt("out") || ["game", dark && "dark", phone && "phone"].filter(Boolean).join("-")).replace(/[^A-Za-z0-9_-]+/g, "-");
const BROWSERS = [process.env.CHROME, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 5199, BASE = `http://127.0.0.1:${PORT}`;

async function server() {
  const up = async () => { try { return (await fetch(BASE + "/")).ok; } catch (e) { return false; } };
  const proc = spawn(process.execPath, [path.join(ROOT, "dev", "serve.mjs")], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BC_DATA: "none" }, stdio: "ignore" });
  for (let i = 0; i < 100 && !(await up()); i++) await sleep(100);
  if (!(await up())) { proc.kill(); throw new Error("The local server didn't start."); }
  return () => proc.kill();
}

async function launch() {
  const exe = BROWSERS.find(p => fs.existsSync(p));
  if (!exe) throw new Error("Chrome or Edge not found: set CHROME to its path.");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "bc-look-"));
  const proc = spawn(exe, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "--force-color-profile=srgb",
    ...(process.env.CI ? ["--no-sandbox"] : []), `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank"], { stdio: "ignore" });
  const portFile = path.join(profile, "DevToolsActivePort");
  for (let i = 0; i < 150 && !fs.existsSync(portFile); i++) await sleep(100);
  const port = fs.readFileSync(portFile, "utf8").split("\n")[0].trim();
  const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const waiting = new Map(), events = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) { const w = waiting.get(m.id); waiting.delete(m.id); m.error ? w.rej(new Error(m.error.message)) : w.res(m.result); }
    else if (m.method) events.push(m);
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const n = ++id; waiting.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method, params })); });
  const close = () => { try { ws.close(); } catch (e) { /* closed */ } proc.kill(); setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* left in temp */ } }, 500); };
  return { send, close, events };
}
const js = async (cdp, expression) => { const r = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return r.exceptionDetails ? { error: r.exceptionDetails.exception && r.exceptionDetails.exception.description } : r.result && r.result.value; };

const stop = await server();
const cdp = await launch();
try {
  await cdp.send("Page.enable"); await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", phone ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } : { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }] });
  await cdp.send("Page.navigate", { url: BASE + "/" });
  for (let i = 0; i < 100 && !(await js(cdp, "!!(window.BC && BC.ready && BC.game.me)").catch(() => false)); i++) await sleep(100);
  if (pats) await js(cdp, `(async () => { const b = document.getElementById("beagle"); for (let i = 0; i < ${pats}; i++) { b.click(); if (i % 15 === 14) await new Promise(r => setTimeout(r, 1000)); } await new Promise(r => setTimeout(r, 2500)); })()`);
  await sleep(wait);
  for (const sel of all("click")) {
    const hit = await js(cdp, `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.scrollIntoView({ block: "center" }); e.click(); return true; })()`);
    console.log(hit ? `clicked ${sel}` : `NOT FOUND: ${sel}`);
    await sleep(700);
  }
  for (const code of all("eval")) console.log("eval:", JSON.stringify(await js(cdp, `(async () => { ${code.includes("return") ? code : "return " + code} })()`)));
  if (!all("click").length) await js(cdp, "window.scrollTo(0, 0)");
  await sleep(300);
  let clip;
  if (full) { const m = await cdp.send("Page.getLayoutMetrics"); clip = { x: 0, y: 0, width: m.cssContentSize.width, height: Math.min(m.cssContentSize.height, 6000), scale: 1 }; }
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", ...(clip ? { clip, captureBeyondViewport: true } : {}) });
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, name + ".png");
  fs.writeFileSync(file, Buffer.from(data, "base64"));
  console.log(`Saved ${path.relative(ROOT, file)}${dark ? " (dark)" : ""}${phone ? " (phone)" : ""}`);
  const errs = cdp.events.filter(e => e.method === "Runtime.exceptionThrown" || (e.method === "Runtime.consoleAPICalled" && e.params.type === "error"))
    .map(e => e.method === "Runtime.exceptionThrown" ? (e.params.exceptionDetails.exception || {}).description || e.params.exceptionDetails.text : e.params.args.map(a => a.value || a.description).join(" "));
  console.log(errs.length ? `Console errors:\n  ${errs.join("\n  ")}` : "No console errors.");
} finally { cdp.close(); stop(); }
