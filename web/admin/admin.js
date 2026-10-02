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
    h("td", {}, r.title || "(no title)", r.own ? h("span", { class: "tag", text: "Claude's idea" }) : null),
    h("td", { class: "result " + r.status, text: RESULT[r.status] || r.status }),
    h("td", { class: "num", title: `Screen ${usd(r.screen)} + build ${usd(r.build)}`, text: usd(r.cost) }),
    h("td", { class: "num", text: r.turns ? String(r.turns) : "–" }),
    h("td", { class: "num", text: r.minutes ? String(r.minutes) : "–" }))));

  $("devices").replaceChildren(...st.devices.map(d => h("li", {},
    h("div", {}, h("strong", { text: d.name }), d.you ? h("span", { class: "tag", text: "this one" }) : null,
      h("div", { class: "muted", text: `Added ${when(d.at)}` + (d.usedAt ? ` · last used ${when(d.usedAt)}` : "") })),
    h("button", { type: "button", class: "quiet", text: "Forget", "aria-label": `Forget ${d.name}`, on: { click: () => forget(d) } }))));
}

async function load() {
  try { render(await call("GET", "status")); show("panel"); say(""); }
  catch (e) { if (getSession()) say(e.message, true); }
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
