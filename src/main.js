// beagle.clicker in the browser: the beagle, the bones, the treasure, the shop, and the parts in other
// files (game.js: the player's game and syncing; screens.js: the tabs, your dig, trophies, stats and
// the ticker; board.js: suggestions and patch notes; news.js; api.js; ui.js).
import { game, start, pat, buy, tick, onChange, serverNow, grabTreasure, frenzy, rename } from "./game.js";
import { startBoard, refresh as refreshBoard } from "./board.js";
import { setupTabs, ping, view, renderScene, startTicker, renderTrophies, renderStats } from "./screens.js";
import { getSave, setSave, SAVE } from "./api.js";
import { h, fmt, fmtRate } from "./ui.js";

const R = window.RULES;
const $ = id => document.getElementById(id);
window.BC = { ready: false, game };

// --- The beagle: pat it for bones; chips of bone fly out. It wears a miner's helmet once you own a Dig Site,
// goggles with a Bone Digger, a space helmet (instead of the miner's) with a Moon Base, and a party hat
// with 100 of any one thing ---
const beagle = $("beagle"), area = $("pat-area"), calm = matchMedia("(prefers-reduced-motion: reduce)");
beagle.addEventListener("click", e => {
  const n = pat();
  if (!n) return;
  beagle.classList.remove("boop"); void beagle.offsetWidth; beagle.classList.add("boop");
  clearTimeout(beagle.boopTimer); beagle.boopTimer = setTimeout(() => beagle.classList.remove("boop"), 350);
  const r = area.getBoundingClientRect();
  const x = e.clientX ? e.clientX - r.left : r.width / 2, y = e.clientY ? e.clientY - r.top : r.height / 3;
  floater("+" + fmtRate(n), x, y);
  if (!calm.matches) chips(x, y);
  renderBank();
});

// Three little bones that burst out from (x, y) and fall.
function chips(x, y) {
  for (let i = 0; i < 3; i++) {
    const c = h("span", { class: "chip", text: "🦴", "aria-hidden": "true" });
    const a = -Math.random() * Math.PI; // upwards, left to right
    c.style.left = x + "px"; c.style.top = y + "px";
    c.style.setProperty("--dx", Math.round(Math.cos(a) * (40 + Math.random() * 40)) + "px");
    c.style.setProperty("--dy", Math.round(Math.sin(a) * (30 + Math.random() * 30)) + "px");
    c.style.setProperty("--spin", Math.round(Math.random() * 360 - 180) + "deg");
    area.append(c);
    setTimeout(() => c.remove(), 700);
  }
}

// A "+N" that floats up from (x, y) in the pat area.
function floater(text, x, y, kind) {
  const f = h("span", { class: "floater " + (kind || ""), text, "aria-hidden": "true" });
  f.style.left = x + "px"; f.style.top = y + "px";
  area.append(f);
  setTimeout(() => f.remove(), kind ? 1600 : 900);
}

// A short message at the bottom of the screen (trophies, treasure), gone after a few seconds.
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
    // A rare gold chest shines (the server picked it when it buried it).
    const gold = !!game.me.game.treasureGold;
    chest.classList.toggle("gold", gold);
    chest.setAttribute("aria-label", gold ? "Grab the gold treasure!" : "Grab the buried treasure!");
  }
  if (chest.hidden === up) chest.hidden = !up;
  ping(up);
}
chest.addEventListener("click", async () => {
  const x = chest.offsetLeft, y = chest.offsetTop;
  grabbed = chestAt; chest.hidden = true;
  try {
    const r = await grabTreasure();
    if (r.frenzy) { floater("FRENZY!", x, y, "big"); toast(`🔥 Dig Frenzy! Everything gives ×${R.FRENZY.x} for ${R.FRENZY.seconds} seconds.`, "good"); }
    else if (r.gold) { floater("+" + fmt(r.found), x, y, "big"); toast(`🌟 A gold chest! ×${R.GOLD.x} bones: +${fmt(r.found)}.`, "good"); }
    else { floater("+" + fmt(r.found), x, y, "big"); toast(`Treasure! +${fmt(r.found)} bones.`, "good"); }
    // The treasure streak: the fifth chest in a row says so instead.
    if (r.bonus) { floater("STREAK! +" + fmt(r.bonus), x, y - 40, "big"); toast(`🎯 ${R.STREAK.needs} treasures in a row! Streak bonus: +${fmt(r.bonus)} bones.`, "good"); }
  } catch (e) { toast(e.message || "The treasure got away.", "bad"); }
});

// --- Bones and rates, and the Dig Frenzy bar while one is on ---
function renderBank() {
  const me = game.me, x = frenzy();
  $("bones").textContent = fmt(me ? me.bones : 0);
  $("rate").textContent = me ? `${fmtRate(me.perClick * x)} per pat · ${fmtRate(me.perSecond * x)} per second` : "";
  const left = me ? Math.ceil(((me.game.frenzyUntil || 0) - serverNow()) / 1000) : 0;
  const bar = $("frenzy");
  if (left > 0) bar.textContent = `🔥 Dig Frenzy ×${R.FRENZY.x} · ${left}s`;
  if (bar.hidden === left > 0) { bar.hidden = !(left > 0); document.body.classList.toggle("in-frenzy", left > 0); }
  // The treasure streak so far, one paw for each chest grabbed in a row (hidden at 0).
  const n = me ? me.game.streak || 0 : 0, streak = $("streak");
  const text = n > 0 ? `Treasure streak ${"🐾".repeat(n)} ${n}/${R.STREAK.needs}` : "";
  if (streak.textContent !== text) {
    streak.textContent = text;
    streak.hidden = !text;
    streak.setAttribute("aria-label", `Treasure streak: ${n} of ${R.STREAK.needs}`);
  }
}

// --- The shop: upgrades a few at a time (the next one shows once you own the one before), boosts once
// you've unlocked them, and how many to buy at once (×1, ×10, ×100 or Max, 0 here: as many as you can
// afford, up to MAX_BUY; remembered on this browser) ---
let amount = 1;
try { const n = localStorage.getItem("bc.buy"); if (["0", "1", "10", "100"].includes(n)) amount = +n; } catch (e) { /* private mode */ }
// How many one click buys: with Max, what you can afford now (at least 1, so the price of one shows).
const howMany = (id, me) => R.isBoost(id) ? 1 : amount ? Math.min(amount, R.MAX_BUY) : Math.max(1, me ? R.maxBuy(id, me.owned, me.bones) : 0);
const price = (id, me) => R.costN(id, me ? me.owned : {}, howMany(id, me));
const costText = (id, me) => (amount || R.isBoost(id) ? "" : `×${howMany(id, me)} · `) + fmt(price(id, me)) + " 🦴";
function setupAmounts() {
  const mark = () => { for (const b of $("amounts").children) b.setAttribute("aria-pressed", String(+b.dataset.n === amount)); };
  for (const b of $("amounts").children) b.addEventListener("click", () => {
    amount = +b.dataset.n; mark(); renderShop();
    try { localStorage.setItem("bc.buy", String(amount)); } catch (e) { /* private mode */ }
  });
  mark();
}
function shopItem(u, desc, side, me) {
  return h("button", { type: "button", class: "item", "data-id": u.id, disabled: !me || me.bones < price(u.id, me), on: { click: () => buy(u.id, howMany(u.id, game.me)) } },
    h("span", { class: "item-icon", "aria-hidden": "true", text: u.icon }),
    h("span", { class: "item-main" }, h("span", { class: "item-name", text: u.name }), h("span", { class: "item-desc", text: desc })),
    h("span", { class: "item-side" }, h("span", { class: "item-cost", text: costText(u.id, me) }), h("span", { class: "item-owned", text: side })));
}
function renderShop() {
  const me = game.me, owned = me ? me.owned : {};
  const last = R.UPGRADES.reduce((i, u, k) => owned[u.id] ? k : i, -1);
  const shown = R.UPGRADES.slice(0, Math.max(3, last + 2));
  $("shop").replaceChildren(...shown.map(u => shopItem(u, u.desc, owned[u.id] ? `owned ${owned[u.id]}` : "", me)));
  $("boosts").replaceChildren(...R.BOOSTS.filter(b => R.available(b.id, owned))
    .map(b => shopItem(b, `Boost: ${R.byId(b.boosts).name} gives twice as much.`, "once", me)));
}
// Every 100 ms: what you can afford, and (with Max) how many and their price.
function refreshShop() {
  const me = game.me;
  for (const b of [...$("boosts").children, ...$("shop").children]) {
    b.disabled = !me || me.bones < price(b.dataset.id, me);
    if (!amount) { const c = b.querySelector(".item-cost"), t = costText(b.dataset.id, me); if (c.textContent !== t) c.textContent = t; }
  }
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

// --- Your name: the button in the header opens a small form to change it ---
function setupRename() {
  const form = $("rename"), input = $("rename-input"), msg = $("rename-msg"), who = $("who");
  const open = on => {
    form.hidden = !on; who.setAttribute("aria-expanded", String(on)); msg.textContent = "";
    if (on) { input.value = game.me ? game.me.name : ""; input.focus(); input.select(); } else who.focus();
  };
  who.addEventListener("click", () => open(form.hidden));
  $("rename-cancel").addEventListener("click", () => open(false));
  form.addEventListener("keydown", e => { if (e.key === "Escape") open(false); });
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    try { await rename(input.value); open(false); toast("Name changed. New suggestions show it."); }
    catch (err) { msg.textContent = err.message; msg.className = "form-msg bad"; }
    finally { btn.disabled = false; }
  });
}

// --- Start ---
// The corgi's gear: put on or taken off, with a cheer the first time it appears,
// but not when a save that has it loads (worn[cls] is unset until the first save arrives)
const worn = {};
function wear(cls, on, cheer) {
  if (on && worn[cls] === false) toast(cheer, "good");
  beagle.classList.toggle(cls, on);
  if (game.me) worn[cls] = on;
}
onChange(what => {
  if (what.startsWith("trophy:")) {
    const t = R.TROPHIES.find(x => x.id === what.slice(7));
    if (t) toast(`${t.icon} Trophy: ${t.name}! +${Math.round(R.TROPHY_BONUS * 100)}% bones.`, "good");
    renderTrophies(game.me);
    return;
  }
  if (what === "owned") {
    renderShop(); renderScene(game.me); renderTrophies(game.me);
    const owns = id => !!(game.me && game.me.owned[id]);
    beagle.classList.toggle("has-helmet", owns("dog-park"));
    beagle.classList.toggle("has-goggles", owns("bone-digger"));
    beagle.classList.toggle("has-space", owns("moon-base"));
    wear("has-party", !!game.me && Object.values(game.me.owned).some(n => n >= 100), "🎉 100 of one thing! The corgi put on a party hat.");
    wear("has-bandana", owns("bone-train"), "🚂 All aboard! The corgi tied on a little red bandana.");
  } else refreshShop();
  renderBank();
  if (game.me) $("who").textContent = game.me.name + " ✏️";
  if (what === "online") notice(null);
  else if (what.startsWith("offline:")) notice(h("span", { text: "Can't reach the dog house right now. Keep patting: it all counts once it's back." }), "bad");
});

let last = performance.now(), drawn = 0, statted = 0;
function frame(t) {
  const dt = Math.min(1, (t - last) / 1000);
  tick(dt);
  last = t;
  if (t - drawn > 100) { drawn = t; renderBank(); refreshShop(); checkTreasure(); }
  if (view === "stats" && t - statted > 1000) { statted = t; renderStats(game.me); }
  requestAnimationFrame(frame);
}

setupTabs(v => { if (v === "stats") renderStats(game.me); });
setupAmounts();
renderShop();
renderScene(game.me);
renderTrophies(game.me);
renderBank();
setupSave();
setupRename();
startTicker(() => game.me);
Promise.all([start(), startBoard()]).finally(() => {
  window.BC.ready = true;
  requestAnimationFrame(frame);
  checkVersion();
  setInterval(checkVersion, 60000);
});
