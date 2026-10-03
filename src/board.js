// The suggestion board, the countdown to the next update, and the update log (with each update's
// summary and players' ratings).
import { call } from "./api.js";
import { game, spend, onChange } from "./game.js";
import { h, fmt, ago, clock } from "./ui.js";

const R = window.RULES;
const $ = id => document.getElementById(id);
const REFRESH_MS = 20000;
const RATINGS = [["great", "🤩", "Great"], ["good", "🙂", "Good"], ["neutral", "😐", "Okay"], ["bad", "🙁", "Bad"], ["terrible", "😖", "Terrible"]];
const COUNT_AT = { terrible: 0, bad: 1, neutral: 2, good: 3, great: 4 }; // the server's counts run terrible → great

let board = null, offset = 0; // offset: the server's clock minus this one
let older = [], moreOlder = false; // log pages loaded with "Show older"

export async function refresh() {
  try {
    board = await call("GET", "/board");
    offset = board.serverTime - Date.now();
    if (!older.length) moreOlder = board.moreDone;
    render();
  } catch (e) { /* game.js shows when the server can't be reached */ }
}

const now = () => Date.now() + offset;
const quote = t => `“${t}”`;
const every = () => board && board.updateHours > 1 ? `every ${board.updateHours} hours` : "every hour";

function renderStatus() {
  const el = $("status");
  if (!board) { el.replaceChildren(h("p", { class: "muted", text: "Loading the board…" })); return; }
  const building = board.open.find(s => s.status === "building");
  if (building) {
    el.replaceChildren(h("div", { class: "status-box building" },
      h("div", { class: "status-icon", "aria-hidden": "true", text: "🔨" }),
      building.own && !building.text
        ? h("div", {}, h("p", { class: "status-line", text: "Claude is building an idea of its own right now." }),
          h("p", { class: "muted", text: "No suggestion had bones this time. Give some to one below so it's picked next!" }))
        : building.own && !building.score
        ? h("div", {}, h("p", { class: "status-line", text: "Claude is building one of its own ideas right now:" }), h("p", { class: "status-text", text: quote(building.text) }),
          h("p", { class: "muted", text: "No suggestion had bones this time, so Claude picked one of its ideas. Give bones to one below so it's picked next!" }))
        : h("div", {}, h("p", { class: "status-line", text: "Claude is building this right now:" }), h("p", { class: "status-text", text: quote(building.text) }),
          h("p", { class: "muted", text: `${fmt(building.score)} bones from ${building.voters} ${building.voters === 1 ? "player" : "players"}. It goes live by itself when it's done.` }))));
    return;
  }
  const lead = board.open.find(s => s.status === "open" && s.score > 0);
  el.replaceChildren(h("div", { class: "status-box" },
    h("div", { class: "status-icon", "aria-hidden": "true", text: "⏳" }),
    h("div", {},
      h("p", { class: "status-line" }, "Next update in ", h("strong", { id: "countdown", text: clock(board.nextPickAt - now()) })),
      lead ? h("p", { class: "status-text" }, "Leading: ", quote(lead.text), h("span", { class: "muted", text: ` · ${fmt(lead.score)} 🦴` }))
        : h("p", { class: "muted", text: board.open.some(s => s.own && s.status === "open")
          ? "No bones on anything yet, so Claude will pick one of its own ideas below at random. Back the one you like best, or suggest your own."
          : "No bones on anything yet, so Claude will pick an idea of its own. Suggest something, or back one below." }))));
}

function giveButtons(s) {
  const bones = game.me ? game.me.bones : 0;
  return R.VOTE_AMOUNTS.map(n => h("button", {
    type: "button", class: "give", disabled: s.status !== "open" || bones < n, "data-amount": String(n),
    "aria-label": `Give ${fmt(n)} bones to this suggestion`,
    on: { click: () => vote(s, n) },
  }, "+" + fmt(n)));
}

function renderOpen() {
  const list = $("open");
  if (!board) return;
  const shown = board.open.filter(s => !(s.own && s.status === "building" && !s.text));
  if (!shown.length) { list.replaceChildren(h("li", { class: "empty", text: "Nothing on the board yet. Be the first to suggest something!" })); return; }
  list.replaceChildren(...shown.map(s => h("li", { class: "sug" + (s.status === "building" ? " is-building" : ""), "data-id": s.id },
    h("div", { class: "score" }, h("strong", { text: fmt(s.score) }), h("span", { text: "🦴" })),
    h("div", { class: "sug-body" },
      h("p", { class: "sug-text", text: s.text }),
      h("p", { class: "meta" }, s.own ? h("span", { class: "tag claude", text: "Claude's idea" }) : "", s.own ? " " : "", s.own ? ago(s.at, now()) : `by ${s.yours ? "you" : s.byName} · ${ago(s.at, now())}`, s.voters ? ` · ${s.voters} ${s.voters === 1 ? "backer" : "backers"}` : "",
        s.mine ? h("span", { class: "mine", text: ` · you gave ${fmt(s.mine)}` }) : "",
        s.status === "open" && !s.yours && !s.own ? h("button", { type: "button", class: "report", text: "Report", "aria-label": "Report this suggestion", on: { click: () => report(s) } }) : "")),
    s.status === "open" ? h("div", { class: "gives" }, giveButtons(s)) : h("div", { class: "gives" }, h("span", { class: "tag", text: "Building" })))));
  if (board.openCount > board.open.length) list.append(h("li", { class: "empty", text: `…and ${board.openCount - board.open.length} more with fewer bones.` }));
}

// A summary is lines; those starting "- " are a list.
function summaryOf(lines) {
  const out = [];
  let ul = null;
  for (const line of lines || []) {
    if (/^- /.test(line)) { if (!ul) out.push(ul = h("ul", { class: "note-list" })); ul.append(h("li", { text: line.slice(2) })); }
    else { ul = null; out.push(h("p", { class: "note-body", text: line })); }
  }
  return out;
}

function ratingRow(s) {
  const r = s.ratings || { counts: [0, 0, 0, 0, 0], total: 0 };
  return h("div", { class: "rating" },
    h("span", { class: "rate-label", text: "How did it turn out?" }),
    h("div", { class: "rate-buttons", role: "group", "aria-label": "Rate this update" }, RATINGS.map(([key, icon, label]) => {
      const n = r.counts[COUNT_AT[key]];
      return h("button", { type: "button", class: "rate-btn", "aria-pressed": r.mine === key ? "true" : "false", title: label, "aria-label": `${label}${n ? ` (${n})` : ""}`, on: { click: () => rate(s, key) } },
        h("span", { "aria-hidden": "true", text: icon }), h("span", { class: "rate-name", text: label }), n ? h("span", { class: "rate-n", text: String(n) }) : "");
    })),
    h("p", { class: "form-msg", "data-for": s.id, role: "status" }));
}

function logEntry(s) {
  if (s.status === "shipped") return h("li", { class: "note shipped", "data-id": s.id },
    h("p", { class: "note-title" }, h("span", { class: "tag ok", text: s.n ? `Update #${s.n}` : "New" }), " ", s.title || s.text),
    h("p", { class: "note-from" }, s.own ? h("span", { text: "Claude's own idea: " }) : h("span", { text: `${s.yours ? "Your" : s.byName + "'s"} suggestion: ` }), h("q", { text: s.text })),
    ...summaryOf(s.summary),
    h("p", { class: "meta", text: [s.own ? "" : `${fmt(s.score)} 🦴 from ${s.voters} ${s.voters === 1 ? "player" : "players"}`, ago(s.doneAt, now())].filter(Boolean).join(" · ") }),
    ratingRow(s));
  return h("li", { class: "note declined", "data-id": s.id },
    h("p", { class: "note-title" }, h("span", { class: "tag", text: "Not built" }), " ", quote(s.text)),
    s.reason ? h("p", { class: "note-body", text: s.reason }) : "",
    h("p", { class: "meta", text: `suggested by ${s.yours ? "you" : s.byName} · bones returned · ${ago(s.doneAt, now())}` }));
}

function renderDone() {
  const list = $("done");
  if (!board) return;
  const all = board.done.concat(older.filter(o => !board.done.some(d => d.id === o.id)));
  if (!all.length) { list.replaceChildren(h("li", { class: "empty", text: `No updates yet. The first one starts at the next update: they happen ${every()}.` })); return; }
  list.replaceChildren(...all.map(logEntry));
  if (moreOlder) list.append(h("li", { class: "more" }, h("button", { type: "button", class: "more-btn", text: "Show older updates", on: { click: showOlder } })));
}

async function showOlder() {
  const all = board.done.concat(older);
  const last = all[all.length - 1];
  if (!last) return;
  try {
    const r = await call("GET", "/log?before=" + encodeURIComponent(last.doneAt));
    older = older.concat(r.done);
    moreOlder = r.more;
    renderDone();
  } catch (e) { /* try again later */ }
}

// The timer in the header, on every screen: the time to the next update, or that one's being built.
function renderNext() {
  if (!board) return;
  const building = board.open.some(s => s.status === "building");
  $("next-icon").textContent = building ? "🔨" : "⏳";
  $("next-text").textContent = building ? "Update being built" : `Next update ${clock(board.nextPickAt - now())}`;
  $("next").classList.toggle("building", building);
}

function render() {
  renderStatus(); renderOpen(); renderDone(); renderNext();
  $("every").textContent = every();
  const lim = board.limits;
  if (lim) {
    $("suggest-text").maxLength = lim.max;
    $("suggest-count").textContent = `${$("suggest-text").value.length} / ${lim.max}`;
  }
}

// The give buttons follow your bones as they change, without redrawing the board.
function refreshButtons() {
  const bones = game.me ? game.me.bones : 0;
  for (const b of document.querySelectorAll("#open .give")) {
    const li = b.closest(".sug"), s = board && board.open.find(x => x.id === li.dataset.id);
    b.disabled = !s || s.status !== "open" || bones < +b.dataset.amount;
  }
  $("suggest-go").disabled = bones < R.SUGGEST_COST || busy;
}

let busy = false;
async function vote(s, amount) {
  if (busy) return;
  busy = true;
  try {
    const r = await spend("POST", "/vote", { id: s.id, amount });
    Object.assign(s, r.suggestion);
    renderOpen(); renderStatus();
  } catch (e) { flash(e.message); refresh(); }
  finally { busy = false; refreshButtons(); }
}

async function rate(s, rating) {
  const msg = document.querySelector(`.form-msg[data-for="${CSS.escape(s.id)}"]`);
  try {
    const r = await call("POST", "/rate", { id: s.id, rating });
    Object.assign(s, r.update);
    for (const list of [board.done, older]) { const i = list.findIndex(x => x.id === s.id); if (i >= 0) list[i] = { ...list[i], ...r.update }; }
    renderDone();
  } catch (e) { if (msg) { msg.textContent = e.message; msg.className = "form-msg bad"; } }
}

async function report(s) {
  if (!confirm("Report this suggestion as not right for the game? If a few players report it, it comes down and its bones go back.")) return;
  try { await call("POST", "/report", { id: s.id }); flash("Thanks: it's been reported.", true); refresh(); }
  catch (e) { flash(e.message); }
}

function flash(msg, good) {
  const el = $("suggest-msg");
  el.textContent = msg; el.className = "form-msg " + (good ? "good" : "bad");
  clearTimeout(flash.t); flash.t = setTimeout(() => { el.textContent = ""; }, 5000);
}

export function startBoard() {
  $("suggest-cost").textContent = fmt(R.SUGGEST_COST);
  const text = $("suggest-text"), count = $("suggest-count");
  text.addEventListener("input", () => { count.textContent = `${text.value.length} / ${text.maxLength}`; });
  $("suggest").addEventListener("submit", async e => {
    e.preventDefault();
    if (busy) return;
    busy = true; refreshButtons();
    const msg = $("suggest-msg");
    try {
      await spend("POST", "/suggest", { text: text.value });
      text.value = ""; count.textContent = `0 / ${text.maxLength}`;
      msg.textContent = "On the board! Give it some bones to push it up."; msg.className = "form-msg good";
      await refresh();
    } catch (err) { msg.textContent = err.message; msg.className = "form-msg bad"; }
    finally { busy = false; refreshButtons(); }
  });
  onChange(() => refreshButtons());
  setInterval(() => {
    const cd = $("countdown");
    if (board && cd) {
      const left = board.nextPickAt - now();
      cd.textContent = clock(left);
      // At 0 it waits for the server, which says when the update starts (or the next check).
      if (left <= 0 && !board.asked) { board.asked = true; setTimeout(refresh, 15000); }
    }
    renderNext();
  }, 1000);
  setInterval(refresh, REFRESH_MS);
  return refresh();
}
