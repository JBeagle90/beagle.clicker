// The game's screens (tabs in the header: Dig, Trophies, Stats, Updates) and what's on them besides
// the beagle and the shop: your dig, the news ticker, the trophy case and the stats.
import { h, fmt, fmtRate } from "./ui.js";
import { headline } from "./news.js";

const R = window.RULES;
const $ = id => document.getElementById(id);
const VIEWS = ["dig", "trophies", "stats", "updates"];

// --- Tabs: the address's #hash picks the screen, so Back works and links like #updates do too ---
export let view = "dig";
export function setupTabs(onShow) {
  const show = () => {
    const want = location.hash.slice(1);
    view = VIEWS.includes(want) ? want : "dig";
    for (const v of VIEWS) $("view-" + v).hidden = v !== view;
    for (const a of document.querySelectorAll(".tabs a")) {
      if (a.dataset.view === view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    }
    onShow(view);
  };
  addEventListener("hashchange", () => { show(); scrollTo(0, 0); });
  show();
}
// A dot on the Dig tab while a treasure is up and you're looking at another screen.
export function ping(on) { document.querySelector('.tabs a[data-view="dig"]').classList.toggle("ping", on && view !== "dig"); }

// --- Your dig: a row for each kind of upgrade you own, with what they make ---
const ROW_ICONS = 24; // icons drawn in a row; past that, "+N"
export function renderScene(me) {
  const owned = me ? me.owned : {};
  const rows = R.UPGRADES.filter(u => owned[u.id] > 0).map(u => {
    const n = owned[u.id], out = R.output(u.id, owned, me.game);
    const makes = out.perSecond ? `${fmtRate(out.perSecond)} a second` : `+${fmtRate(out.perClick)} a pat`;
    return h("li", { class: "row" },
      h("div", { class: "row-head" },
        h("span", { class: "row-name", text: `${u.name} ×${n}` }),
        h("span", { class: "row-makes", text: makes })),
      h("div", { class: "row-strip", "aria-hidden": "true" },
        ...Array.from({ length: Math.min(n, ROW_ICONS) }, () => h("span", { class: "row-icon", text: u.icon })),
        n > ROW_ICONS ? h("span", { class: "row-more", text: `+${n - ROW_ICONS}` }) : null));
  });
  $("scene").replaceChildren(...(rows.length ? rows : [h("li", { class: "empty", text: "Nothing dug in yet. Buy a Sharp Nose or a Dig Buddy and it shows up here." })]));
}

// --- The news ticker: a new headline every few seconds ---
export function startTicker(getMe) {
  const el = $("ticker");
  const next = () => {
    el.classList.add("fade");
    setTimeout(() => { el.textContent = "📰 " + headline(getMe()); el.classList.remove("fade"); }, 250);
  };
  next();
  setInterval(next, 9000);
}

// --- Trophies: every one, earned or still to get ---
export function renderTrophies(me) {
  const have = (me && me.game.trophies) || [];
  const n = R.TROPHIES.filter(t => have.includes(t.id)).length;
  $("trophy-sum").textContent = `${n} / ${R.TROPHIES.length}` + (n ? ` · +${Math.round(n * R.TROPHY_BONUS * 100)}% bones` : "");
  $("trophies").replaceChildren(...R.TROPHIES.map(t => {
    const got = have.includes(t.id);
    return h("li", { class: "trophy" + (got ? " got" : "") },
      h("span", { class: "trophy-icon", "aria-hidden": "true", text: t.icon }),
      h("span", { class: "trophy-main" }, h("span", { class: "trophy-name", text: t.name }),
        h("span", { class: "trophy-desc", text: (got ? "✓ " : "Not yet: ") + t.desc })));
  }));
}

// --- Stats ---
export function renderStats(me) {
  if (!me) return;
  const g = me.game, owned = me.owned;
  const upgrades = R.UPGRADES.reduce((n, u) => n + (owned[u.id] || 0), 0);
  const boosts = R.BOOSTS.filter(b => owned[b.id]).length;
  const trophies = R.TROPHIES.filter(t => (g.trophies || []).includes(t.id)).length;
  const rows = [
    ["Bones now", fmt(me.bones)],
    ["Bones dug up, all time", fmt(me.earned)],
    ["Pats", fmt(me.pats)],
    ["Bones a pat", fmtRate(me.perClick)],
    ["Bones a second", fmtRate(me.perSecond)],
    ["Upgrades owned", fmt(upgrades)],
    ["Boosts", `${boosts} / ${R.BOOSTS.length}`],
    ["Trophies", `${trophies} / ${R.TROPHIES.length} (+${Math.round(trophies * R.TROPHY_BONUS * 100)}% bones)`],
    ["Treasures grabbed", fmt(g.treasures || 0)],
    ["Gold chests", fmt(g.golds || 0)],
    ["Dig Frenzies", fmt(g.frenzies || 0)],
    ["Counting since", g.startedAt ? new Date(g.startedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "today"],
  ];
  $("stats").replaceChildren(...rows.flatMap(([k, v]) => [h("dt", { text: k }), h("dd", { text: v })]));
}
