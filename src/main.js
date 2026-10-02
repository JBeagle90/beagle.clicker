// beagle.clicker in the browser: the beagle, the bones, the shop, and the parts in other files
// (game.js: the player's game and syncing; board.js: suggestions and patch notes; api.js; ui.js).
import { game, start, pat, buy, tick, onChange, serverNow, grabTreasure } from "./game.js";
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
  floater("+" + fmtRate(n), x, y);
  renderBank();
});

// A "+N" that floats up from (x, y) in the pat area.
function floater(text, x, y, kind) {
  const f = h("span", { class: "floater " + (kind || ""), text, "aria-hidden": "true" });
  f.style.left = x + "px"; f.style.top = y + "px";
  area.append(f);
  setTimeout(() => f.remove(), kind ? 1600 : 900);
}

// A short message under the beagle (trophies, treasure), gone after a few seconds.
function toast(text, kind) {
  const el = $("toast");
  el.textContent = text;
  el.className = "toast show " + (kind || "");
  clearTimeout(el.timer); el.timer = setTimeout(() => { el.className = "toast"; }, 3500);
}

// --- Buried treasure: the server says when it's up (game.treasureAt); grab it in time ---
const chest = $("treasure"), T = R.TREASURE;
let chestAt = 0, grabbed = 0;
function checkTreasure() {
  const at = game.me && game.me.game.treasureAt, now = serverNow();
  const up = typeof at === "number" && at !== grabbed && now >= at && now < at + T.show * 1000;
  if (up && chestAt !== at) {
    chestAt = at;
    // A spot beside the beagle, a different one each time.
    const spots = [[12, 70], [88, 70], [14, 20], [86, 22]], s = spots[Math.floor(at / 1000) % spots.length];
    chest.style.left = s[0] + "%"; chest.style.top = s[1] + "%";
  }
  if (chest.hidden === up) chest.hidden = !up;
}
chest.addEventListener("click", async () => {
  const x = chest.offsetLeft, y = chest.offsetTop;
  grabbed = chestAt; chest.hidden = true;
  try {
    const found = await grabTreasure();
    floater("+" + fmt(found), x, y, "big");
    toast(`Treasure! +${fmt(found)} bones.`, "good");
  } catch (e) { toast(e.message || "The treasure got away.", "bad"); }
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

// --- The shop: upgrades a few at a time (the next one shows once you own the one before), and
// boosts once you've unlocked them ---
function shopItem(u, desc, side, me) {
  const c = R.cost(u.id, me ? me.owned : {});
  return h("button", { type: "button", class: "item", "data-id": u.id, disabled: !me || me.bones < c, on: { click: () => buy(u.id) } },
    h("span", { class: "item-icon", "aria-hidden": "true", text: u.icon }),
    h("span", { class: "item-main" }, h("span", { class: "item-name", text: u.name }), h("span", { class: "item-desc", text: desc })),
    h("span", { class: "item-side" }, h("span", { class: "item-cost", text: fmt(c) + " 🦴" }), h("span", { class: "item-owned", text: side })));
}
function renderShop() {
  const me = game.me, owned = me ? me.owned : {};
  const last = R.UPGRADES.reduce((i, u, k) => owned[u.id] ? k : i, -1);
  const shown = R.UPGRADES.slice(0, Math.max(3, last + 2));
  $("shop").replaceChildren(...shown.map(u => shopItem(u, u.desc, owned[u.id] ? `owned ${owned[u.id]}` : "", me)));
  $("boosts").replaceChildren(...R.BOOSTS.filter(b => R.available(b.id, owned))
    .map(b => shopItem(b, `Boost: ${R.byId(b.boosts).name} gives twice as much.`, "once", me)));
}
function refreshShop() {
  const me = game.me;
  for (const b of [...$("boosts").children, ...$("shop").children]) b.disabled = !me || me.bones < R.cost(b.dataset.id, me.owned);
}

// --- Trophies: the ones you have and the next few to go for (or every one, after "Show all") ---
let allTrophies = false;
function renderTrophies() {
  const have = (game.me && game.me.game.trophies) || [];
  const n = R.TROPHIES.filter(t => have.includes(t.id)).length;
  $("trophy-sum").textContent = `${n} / ${R.TROPHIES.length}` + (n ? ` · +${Math.round(n * R.TROPHY_BONUS * 100)}% bones` : "");
  let next = 0;
  const shown = R.TROPHIES.filter(t => allTrophies || have.includes(t.id) || next++ < 4);
  const more = shown.length < R.TROPHIES.length
    ? h("li", { class: "trophy-more" }, h("button", { type: "button", class: "more-btn", text: "Show all", on: { click: () => { allTrophies = true; renderTrophies(); } } }))
    : null;
  $("trophies").replaceChildren(...shown.map(t => {
    const got = have.includes(t.id);
    return h("li", { class: "trophy" + (got ? " got" : ""), title: got ? "Earned" : "Not yet" },
      h("span", { class: "trophy-icon", "aria-hidden": "true", text: t.icon }),
      h("span", { class: "trophy-main" }, h("span", { class: "trophy-name", text: t.name }), h("span", { class: "trophy-desc", text: (got ? "✓ " : "") + t.desc })));
  }), ...(more ? [more] : []));
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
  if (what.startsWith("trophy:")) {
    const t = R.TROPHIES.find(x => x.id === what.slice(7));
    if (t) toast(`${t.icon} Trophy: ${t.name}! +${Math.round(R.TROPHY_BONUS * 100)}% bones.`, "good");
    renderTrophies();
    return;
  }
  if (what === "owned") renderShop(); else refreshShop();
  if (what === "online" || what === "owned") renderTrophies();
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
  if (t - drawn > 100) { drawn = t; renderBank(); refreshShop(); checkTreasure(); }
  requestAnimationFrame(frame);
}

renderShop();
renderTrophies();
renderBank();
setupSave();
Promise.all([start(), startBoard()]).finally(() => {
  window.BC.ready = true;
  requestAnimationFrame(frame);
  checkVersion();
  setInterval(checkVersion, 60000);
});
