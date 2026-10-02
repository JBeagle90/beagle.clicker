// beagle.clicker in the browser: the beagle, the bones, the shop, and the parts in other files
// (game.js: the player's game and syncing; board.js: suggestions and patch notes; api.js; ui.js).
import { game, start, pat, buy, tick, onChange } from "./game.js";
import { startBoard, refresh as refreshBoard } from "./board.js";
import { getSave, setSave, SAVE } from "./api.js";
import { h, fmt, fmtRate } from "./ui.js";

const R = window.RULES;
const $ = id => document.getElementById(id);
window.BC = { ready: false, game };

// --- The beagle ---
const beagle = $("beagle"), area = $("pat-area");
beagle.addEventListener("click", e => {
  const n = pat();
  if (!n) return;
  wag.joy = Math.min(1, wag.joy + 0.15);
  beagle.classList.remove("boop"); void beagle.offsetWidth; beagle.classList.add("boop");
  clearTimeout(beagle.boopTimer); beagle.boopTimer = setTimeout(() => beagle.classList.remove("boop"), 350);
  const r = area.getBoundingClientRect();
  const x = e.clientX ? e.clientX - r.left : r.width / 2, y = e.clientY ? e.clientY - r.top : r.height / 3;
  const f = h("span", { class: "floater", text: "+" + fmtRate(n), "aria-hidden": "true" });
  f.style.left = x + "px"; f.style.top = y + "px";
  area.append(f);
  setTimeout(() => f.remove(), 900);
  renderBank();
});

// --- The wagging tail: a slow happy wag, faster and wider the more you pat ---
const tail = $("tail"), calm = matchMedia("(prefers-reduced-motion: reduce)");
const wag = { joy: 0, phase: 0 };
function wagTail(dt) {
  wag.joy = Math.max(0, wag.joy - dt * 0.35);
  if (calm.matches) { tail.setAttribute("transform", ""); return; }
  wag.phase += dt * Math.PI * 2 * (0.7 + wag.joy * 4.3);
  const angle = Math.sin(wag.phase) * (10 + wag.joy * 12);
  tail.setAttribute("transform", `rotate(${angle.toFixed(1)} 130 160)`);
}

// --- Bones and rates ---
function renderBank() {
  const me = game.me;
  $("bones").textContent = fmt(me ? me.bones : 0);
  $("rate").textContent = me ? `${fmtRate(me.perClick)} per pat · ${fmtRate(me.perSecond)} per second` : "";
}

// --- The shop ---
function renderShop() {
  const me = game.me;
  $("shop").replaceChildren(...R.UPGRADES.map(u => {
    const n = (me && me.owned[u.id]) || 0, c = R.cost(u.id, me ? me.owned : {});
    return h("button", { type: "button", class: "item", "data-id": u.id, disabled: !me || me.bones < c, on: { click: () => buy(u.id) } },
      h("span", { class: "item-icon", "aria-hidden": "true", text: u.icon }),
      h("span", { class: "item-main" }, h("span", { class: "item-name", text: u.name }), h("span", { class: "item-desc", text: u.desc })),
      h("span", { class: "item-side" }, h("span", { class: "item-cost", text: fmt(c) + " 🦴" }), h("span", { class: "item-owned", text: n ? `owned ${n}` : "" })));
  }));
}
function refreshShop() {
  const me = game.me;
  for (const b of $("shop").children) b.disabled = !me || me.bones < R.cost(b.dataset.id, me.owned);
}

// --- Notices: can't reach the server; a new update is live ---
function notice(content, kind) {
  const el = $("notice");
  if (!content) { el.hidden = true; return; }
  el.className = "notice " + (kind || "");
  el.replaceChildren(...[].concat(content));
  el.hidden = false;
}

let liveVersion = null;
async function checkVersion() {
  try {
    const v = await (await fetch("/version.json", { cache: "no-store" })).json();
    if (liveVersion && v.commit !== liveVersion) {
      notice([h("span", { text: `🐾 A new update just landed${v.title ? ": " + v.title : ""}. ` }), h("button", { type: "button", on: { click: () => location.reload() }, text: "Reload to play it" })], "good");
      refreshBoard();
    }
    liveVersion = liveVersion || v.commit;
  } catch (e) { /* no version.json on this computer */ }
}

// --- Your save ---
function setupSave() {
  const code = $("save-code"), msg = $("save-msg");
  $("save").addEventListener("toggle", () => { code.value = getSave() || ""; });
  $("save-show").addEventListener("click", () => { const hide = code.type === "text"; code.type = hide ? "password" : "text"; $("save-show").textContent = hide ? "Show" : "Hide"; });
  $("save-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(getSave() || ""); msg.textContent = "Copied."; msg.className = "form-msg good"; }
    catch (e) { code.type = "text"; code.select(); msg.textContent = "Select it and copy it."; msg.className = "form-msg"; }
  });
  $("save-load").addEventListener("submit", e => {
    e.preventDefault();
    const v = $("save-input").value.trim();
    if (!SAVE.test(v)) { msg.textContent = "That isn't a save code."; msg.className = "form-msg bad"; return; }
    if (!confirm("Load that save? The game on this browser is replaced (copy its code first if you want it back).")) return;
    setSave(v); location.reload();
  });
}

// --- Start ---
onChange(what => {
  if (what === "owned") renderShop(); else refreshShop();
  renderBank();
  if (game.me) $("who").textContent = game.me.name;
  if (what === "online") notice(null);
  else if (what.startsWith("offline:")) notice(h("span", { text: "Can't reach the dog house right now. Keep patting: it all counts once it's back." }), "bad");
});

let last = performance.now(), drawn = 0;
function frame(t) {
  const dt = Math.min(1, (t - last) / 1000);
  tick(dt);
  wagTail(dt);
  last = t;
  if (t - drawn > 100) { drawn = t; renderBank(); refreshShop(); }
  requestAnimationFrame(frame);
}

renderShop();
renderBank();
setupSave();
Promise.all([start(), startBoard()]).finally(() => {
  window.BC.ready = true;
  requestAnimationFrame(frame);
  checkVersion();
  setInterval(checkVersion, 60000);
});
