// The owner's panel: sign in with a passkey, then see what the scheduled updates have cost.
// On its own on purpose: it loads nothing from /src/ (which scheduled updates change), so game code
// never runs on this page, and the session is kept in this tab only (sessionStorage), out of the
// game's reach. The API is api/src/core/owner.js; scheduled updates may change neither.

const KEY = "bc.owner";
const $ = id => document.getElementById(id);

// h("td", { class: "num", text: "1" }, child, ...): elements with text nodes, never HTML.
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "on") for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

// Passkeys work in bytes; the API in base64url.
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), ch => ch.charCodeAt(0));

const getSession = () => { try { return sessionStorage.getItem(KEY); } catch (e) { return null; } };
const setSession = v => { try { if (v) sessionStorage.setItem(KEY, v); else sessionStorage.removeItem(KEY); } catch (e) { /* this visit only */ } };

function say(text, bad = false) {
  $("msg").textContent = text || "";
  $("msg").className = "msg" + (bad ? " bad" : "");
}

async function call(method, what, body) {
  const headers = { "Content-Type": "application/json" };
  const s = getSession();
  if (s) headers["x-owner-session"] = s;
  const r = await fetch("/api/owner/" + what, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) { setSession(null); show("signin"); }
  if (!r.ok) throw new Error((data.error && data.error.message) || "Something went wrong.");
  return data;
}

// What went wrong with a passkey, in plain words.
function passkeyError(e) {
  if (e && e.name === "NotAllowedError") return "Cancelled, or the passkey wasn't used in time. Try again.";
  if (e && e.name === "InvalidStateError") return "This device already has a passkey for the panel. Sign in with it.";
  return (e && e.message) || "That didn't work.";
}

// Only one of: adding this device, signing in, the panel.
function show(which) {
  for (const id of ["add", "signin", "panel"]) $(id).hidden = id !== which;
  $("logout").hidden = which !== "panel";
}

// --- Adding a device, with the invite in the address (#invite=<code>) ---
async function addDevice(invite) {
  const { publicKey } = await call("POST", "register-start", { invite });
  publicKey.challenge = unb64(publicKey.challenge);
  publicKey.user.id = unb64(publicKey.user.id);
  publicKey.excludeCredentials = publicKey.excludeCredentials.map(c => ({ ...c, id: unb64(c.id) }));
  const cred = await navigator.credentials.create({ publicKey });
  const r = cred.response;
  const key = r.getPublicKey && r.getPublicKey();
  if (!key || !r.getAuthenticatorData) throw new Error("This browser can't make a passkey for the panel. Try an up-to-date Chrome, Edge, Safari or Firefox.");
  await call("POST", "register", { invite, name: $("add-name").value, id: cred.id, alg: r.getPublicKeyAlgorithm(),
    publicKey: b64(key), authenticatorData: b64(r.getAuthenticatorData()), clientDataJSON: b64(r.clientDataJSON) });
}

// --- Signing in ---
async function signIn() {
  const { publicKey } = await call("POST", "login-start");
  publicKey.challenge = unb64(publicKey.challenge);
  const cred = await navigator.credentials.get({ publicKey });
  const r = cred.response;
  const { session } = await call("POST", "login", { id: cred.id, clientDataJSON: b64(r.clientDataJSON),
    authenticatorData: b64(r.authenticatorData), signature: b64(r.signature) });
  setSession(session);
}

// --- The next update: countdown, run now, hours between updates ---
let last = null, offset = 0, noteDirty = false, allShown = false;
const num = n => (+n || 0).toLocaleString();
const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`;
const timeOf = t => new Date(t).toLocaleString(undefined, new Date(t).toDateString() === new Date().toDateString()
  ? { hour: "numeric", minute: "2-digit" } : { weekday: "short", hour: "numeric", minute: "2-digit" });
// 754000 → "12:34"; 9000000 → "2:30:00"
function clock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000)), hh = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60, ss = String(s % 60).padStart(2, "0");
  return hh ? `${hh}:${String(mm).padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
}

function tick() {
  if (!last) return;
  const n = last.next, left = n.at - (Date.now() + offset);
  $("countdown").textContent = last.building ? "Building" : n.runNowAt ? "Waiting to start" : left > 0 ? clock(left) : "Any minute";
  if (prog && prog.run && prog.run.status !== "completed") renderProgress();
}

// --- How it's going: the newest run on GitHub, stage by stage (api/src/core/progress.js) ---
let prog = null, progTimer = null;
const MARK = { done: "✓", running: "•", waiting: "", skipped: "–", failed: "✕" };
const STATE = { done: "done", running: "under way", waiting: "not started", skipped: "skipped", failed: "failed" };
// 45000 → "45 s"; 200000 → "3 min"; 4000000 → "1 h 6 min"
function dur(ms) {
  const s = Math.max(0, Math.round(ms / 1000)), m = Math.floor(s / 60);
  return s < 60 ? `${s} s` : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

function renderProgress() {
  const p = prog;
  if (!p) return;
  const link = $("prog-link");
  if (!p.ok) { $("prog-summary").textContent = p.why; $("stages").replaceChildren(); $("prog-checks").textContent = ""; link.hidden = true; return; }
  const now = Date.now() + offset, run = p.run;
  $("prog-summary").textContent = (run && run.status === "completed" ? `Last run, ${timeOf(run.at)}: ` : "") + p.summary + (p.stale ? ` (As of ${timeOf(p.checkedAt)}: ${p.stale})` : "");
  // A run that was only a check ("not yet") has nothing past its first stage to show.
  const stages = run && (run.status !== "completed" || p.stages.some(s => s.key !== "pick" && s.state !== "skipped")) ? p.stages : [];
  $("stages").replaceChildren(...stages.map(s => h("li", { class: s.state },
    h("span", { class: "dot", "aria-hidden": "true", text: MARK[s.state] }),
    h("span", { class: "stage-name", text: s.label }), h("span", { class: "sr", text: `: ${STATE[s.state]}` }),
    h("span", { class: "took", text: s.state === "running" && s.startedAt ? dur(now - s.startedAt) : s.startedAt && s.endedAt ? dur(s.endedAt - s.startedAt) : "" }))));
  link.hidden = !run;
  if (run) { link.href = run.url; link.textContent = `See this run on GitHub (${run.event === "schedule" ? "scheduled" : "started by hand"}, ${timeOf(run.at)})`; }
  // When the checks ran: GitHub's scheduled ones can be late, or skipped altogether.
  const checks = p.checks || [], sched = checks.find(c => c.event === "schedule");
  const what = c => c.status !== "completed" ? " (running)" : c.conclusion === "skipped" ? " (skipped)" : c.conclusion === "failure" ? " (failed)" : "";
  let text = checks.length ? `Latest checks: ${checks.map(c => timeOf(c.at) + (c.event === "schedule" ? "" : " by hand") + what(c)).join(", ")}.` : "";
  if (!sched || now - sched.at > 45 * 60e3) {
    text += ` GitHub's scheduled checks are running late${sched ? ` (the last was at ${timeOf(sched.at)})` : ""}.`;
    if (last && !last.next.dispatch) text += " Without GH_DISPATCH_TOKEN, “Run it now” waits for one.";
  }
  $("prog-checks").textContent = text.trim();
}

// Every 15 s while something's under way or due, else every minute (the server keeps GitHub's answer a while).
async function loadProgress() {
  clearTimeout(progTimer);
  if ($("panel").hidden) { progTimer = null; return; }
  if (!prog || document.visibilityState === "visible") { // in a hidden tab, only the first time
    try { prog = await call("GET", "progress"); } catch (e) { prog = { ok: false, why: e.message }; }
    renderProgress();
  }
  const active = (prog && prog.ok && prog.run && prog.run.status !== "completed") || (last && (last.building || last.next.runNowAt));
  progTimer = setTimeout(loadProgress, active ? 15000 : 60000);
}

function renderNext(st) {
  const n = st.next, b = st.building, sel = $("hours");
  if (!sel.options.length) sel.replaceChildren(...n.choices.map(x => h("option", { value: String(x), text: x === 1 ? "Every hour" : `Every ${x} hours` })));
  if (document.activeElement !== sel) sel.value = String(n.hours);
  $("building").hidden = !b;
  if (b) $("building").textContent = (b.own ? "Claude is building an idea of its own right now" : `Claude is building “${b.text}” right now`) + (b.note ? ", with your requirements." : ".");
  $("next-when").textContent = n.runNowAt
    ? (n.dispatch ? "Starting now." : `Starts at the next check, by ${timeOf(Math.floor(st.now / 900e3) * 900e3 + 900e3)}.`)
    : `At ${timeOf(n.at)}, then every ${n.hours === 1 ? "hour" : n.hours + " hours"}.`;
  $("run-now").disabled = !!n.runNowAt;
  $("run-now").textContent = n.runNowAt ? "Asked to run" : "Run it now";
  $("hours-note").textContent = 24 / n.hours > st.spend.perDay
    ? `At most ${st.spend.perDay} builds a day are allowed (MAX_BUILDS_PER_DAY in Azure), so some runs will be skipped.` : "";
  tick();
}

// --- What's winning the next update, and your picks ---
const SHOW = 8;
function renderBoard(st) {
  const list = st.board, min = st.settings.minScore, picks = list.filter(s => s.ownerPick);
  const shown = allShown ? list : list.slice(0, Math.max(SHOW, picks.length));
  $("board").replaceChildren(...(shown.length ? shown.map(s => h("li", { class: s.enough || s.ownerPick ? null : "low" },
    h("div", { class: "pick-row" },
      h("div", {},
        h("div", { class: "sug" }, s.text, s.ownerPick ? h("span", { class: "tag pick", text: picks.length > 1 ? `Your pick #${picks.indexOf(s) + 1}` : "Your pick" }) : null),
        h("div", { class: "muted", text: `${plural(s.score, "bone", "bones")} · ${plural(s.voters, "player", "players")} · by ${s.own ? "Claude" : s.byName}` })),
      h("button", { type: "button", class: "quiet", text: s.ownerPick ? "Unpick" : "Pick",
        "aria-label": `${s.ownerPick ? "Unpick" : "Pick"} “${s.text}”`, on: { click: () => pickIt(s, !s.ownerPick) } }))))
    : [h("li", { class: "low", text: "No suggestions on the board." })]));
  $("board-all").hidden = list.length <= shown.length && !allShown;
  $("board-all").textContent = allShown ? "Show fewer" : `Show all ${list.length}`;
  $("board-note").textContent = picks.length
    ? `Your pick is built next, whatever its bones${picks.length > 1 ? ", then the others in the order you picked them" : ""}. Bones already on it stay spent; players can't add more.`
    : list.some(s => s.enough)
    ? `The top one with at least ${plural(min, "bone", "bones")} is built next. Pick one to build it next instead.`
    : st.settings.ownIdeas ? "Nothing has bones yet, so Claude will build an idea of its own."
      : "Nothing has bones yet, and Claude's own ideas are off, so the next run builds only your requirements, or skips.";
}

// --- Your requirements for the next update ---
function renderNote(st) {
  const n = st.next, box = $("note");
  box.maxLength = n.noteMax;
  if (!noteDirty) box.value = n.note ? n.note.text : "";
  $("note-count").textContent = `${box.value.length} / ${n.noteMax}`;
  $("note-state").textContent = !n.note ? "None set."
    : n.note.tries ? `Back for the next update: the last one with them didn't ship. Saved ${when(n.note.at)}.`
      : `Saved ${when(n.note.at)}. The next update will follow them.`;
}

// --- The panel ---
const usd = n => "$" + (+n || 0).toFixed(2);
const sum = list => list.reduce((a, r) => a + (+r.cost || 0), 0);
const when = t => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const RESULT = { shipped: "Shipped", declined: "Declined", failed: "Failed" };

// Monday, 0:00, on this device's clock.
function weekStart(now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (d.getDay() + 6) % 7);
  return d.getTime();
}

function stat(label, value, note) {
  return h("div", { class: "stat" }, h("div", { class: "stat-label", text: label }), h("div", { class: "stat-value", text: value }), note ? h("div", { class: "stat-note", text: note }) : null);
}

function render(st) {
  last = st; offset = st.now - Date.now();
  renderNext(st); renderBoard(st); renderNote(st);
  const sp = st.spend, runs = sp.runs, now = Date.now();
  const recent = runs.filter(r => now - r.at < 24 * 3600e3), week = runs.filter(r => r.at >= weekStart(now));
  $("stats").replaceChildren(
    stat("Last 24 hours", usd(sum(recent)), `${recent.length} ${recent.length === 1 ? "run" : "runs"}`),
    stat("This week", usd(sum(week)), "since Monday"),
    stat("Last 30 days", usd(sp.usd), `of the ${usd(sp.budget)} budget`),
    stat("Builds today", `${sp.builds} of ${sp.perDay}`, "in the last 24 hours"));
  $("billing").textContent = runs.some(r => r.billing === "plan")
    ? "Builds use your Claude plan, so these are what they would cost at API prices, not charges."
    : `Updates run every ${st.settings.updateHours} hours.`;

  $("runs-empty").hidden = runs.length > 0;
  $("runs").hidden = !runs.length;
  $("runs-body").replaceChildren(...runs.slice(0, 10).map(r => h("tr", {},
    h("td", { class: "nowrap", text: when(r.at) }),
    h("td", {}, r.title || "(no title)", r.own ? h("span", { class: "tag", text: "Claude's idea" }) : null, r.note ? h("span", { class: "tag", text: "your requirements" }) : null),
    h("td", { class: "result " + r.status, text: RESULT[r.status] || r.status }),
    h("td", { class: "num", title: `Screen ${usd(r.screen)} + build ${usd(r.build)}`, text: usd(r.cost) }),
    h("td", { class: "num", text: r.turns ? String(r.turns) : "–" }),
    h("td", { class: "num", text: r.minutes ? String(r.minutes) : "–" }))));

  $("devices").replaceChildren(...st.devices.map(d => h("li", {},
    h("div", {}, h("strong", { text: d.name }), d.you ? h("span", { class: "tag", text: "this one" }) : null,
      h("div", { class: "muted", text: `Added ${when(d.at)}` + (d.usedAt ? ` · last used ${when(d.usedAt)}` : "") })),
    h("button", { type: "button", class: "quiet", text: "Forget", "aria-label": `Forget ${d.name}`, on: { click: () => forget(d) } }))));
}

// clearMsg = false keeps the message line (after an action, or the refresh every 30 s).
async function load(clearMsg = true) {
  try { render(await call("GET", "status")); show("panel"); if (clearMsg) say(""); if (!progTimer) loadProgress(); }
  catch (e) { if (getSession()) say(e.message, true); }
}

async function pickIt(s, on) {
  if (on && !confirm(`Build “${s.text}” at the next update, whatever its bones? Players keep the bones they gave; it goes live by itself.`)) return;
  try { await call("POST", "pick", { id: s.id, on }); await load(false); say(on ? "Picked: it's built at the next update." : "Unpicked: it's back to bones."); }
  catch (e) { say(e.message, true); await load(false); }
}

async function forget(d) {
  if (!confirm(`Forget "${d.name}"? It won't be able to sign in until you add it again.`)) return;
  try { await call("POST", "forget", { id: d.id }); await load(); say(`Forgot ${d.name}.`); }
  catch (e) { say(e.message, true); }
}

function start() {
  const invite = /^#invite=([A-Za-z0-9_-]{20,64})$/.exec(location.hash);
  $("add-form").addEventListener("submit", async e => {
    e.preventDefault();
    say("Follow your device's prompt…");
    try {
      await addDevice(invite[1]);
      history.replaceState(null, "", location.pathname);
      show("signin");
      say("This device is added. Sign in with its passkey.");
    } catch (err) { say(passkeyError(err), true); }
  });
  $("signin-btn").addEventListener("click", async () => {
    say("Follow your device's prompt…");
    try { await signIn(); await load(); } catch (err) { say(passkeyError(err), true); }
  });
  $("run-now").addEventListener("click", async () => {
    if (!confirm("Start the next update now? It counts toward today's builds.")) return;
    try {
      const r = await call("POST", "run-now");
      say(r.started ? "Started. It goes live by itself when it's done."
        : r.why || "It starts at the next check, within 15 minutes. To start it straight away, add GH_DISPATCH_TOKEN in Azure (docs/OPERATIONS.md).", !!r.why);
      await load(false);
      setTimeout(loadProgress, 8000);
    } catch (e) { say(e.message, true); }
  });
  $("hours-form").addEventListener("submit", async e => {
    e.preventDefault();
    try { await call("POST", "schedule", { hours: +$("hours").value }); await load(false); say("Saved. The countdown players see has changed too."); }
    catch (err) { say(err.message, true); }
  });
  $("note").addEventListener("input", () => { noteDirty = true; $("note-count").textContent = `${$("note").value.length} / ${$("note").maxLength}`; });
  $("note-form").addEventListener("submit", async e => {
    e.preventDefault();
    try { await call("POST", "note", { text: $("note").value }); noteDirty = false; await load(false); say($("note").value ? "Saved for the next update." : "Cleared."); }
    catch (err) { say(err.message, true); }
  });
  $("note-clear").addEventListener("click", async () => {
    if (!$("note").value || !confirm("Clear your requirements for the next update?")) return;
    try { await call("POST", "note", { text: "" }); noteDirty = false; await load(false); say("Cleared."); }
    catch (err) { say(err.message, true); }
  });
  $("board-all").addEventListener("click", () => { allShown = !allShown; if (last) renderBoard(last); });
  setInterval(tick, 1000);
  setInterval(() => { if (!$("panel").hidden && document.visibilityState === "visible") load(false); }, 30000);

  $("logout").addEventListener("click", async () => {
    try { await call("POST", "logout"); } catch (e) { /* signed out here either way */ }
    setSession(null);
    show("signin");
    say("Signed out.");
  });

  if (!window.PublicKeyCredential) { say("This browser doesn't have passkeys. Try an up-to-date Chrome, Edge, Safari or Firefox.", true); return; }
  if (invite) { show("add"); return; }
  if (getSession()) load(); else show("signin");
}

start();
