// The suggestion board, the countdown to the next pick, and the patch notes.
import { call } from "./api.js";
import { game, spend, onChange } from "./game.js";
import { h, fmt, ago, clock } from "./ui.js";

const R = window.RULES;
const $ = id => document.getElementById(id);
const REFRESH_MS = 20000;
let board = null, offset = 0; // offset: the server's clock minus this one

export async function refresh() {
  try {
    board = await call("GET", "/board");
    offset = board.serverTime - Date.now();
    render();
  } catch (e) { /* game.js shows when the server can't be reached */ }
}

const now = () => Date.now() + offset;
const quote = t => `“${t}”`;

function renderStatus() {
  const el = $("status");
  if (!board) { el.replaceChildren(h("p", { class: "muted", text: "Loading the board…" })); return; }
  const building = board.open.find(s => s.status === "building");
  if (building) {
    el.replaceChildren(h("div", { class: "status-box building" },
      h("div", { class: "status-icon", "aria-hidden": "true", text: "🔨" }),
      h("div", {}, h("p", { class: "status-line", text: "Claude is building this right now:" }), h("p", { class: "status-text", text: quote(building.text) }),
        h("p", { class: "muted", text: `${fmt(building.score)} bones from ${building.voters} ${building.voters === 1 ? "player" : "players"}. It goes live by itself when it's done.` }))));
    return;
  }
  const lead = board.open.find(s => s.status === "open" && s.score > 0);
  el.replaceChildren(h("div", { class: "status-box" },
    h("div", { class: "status-icon", "aria-hidden": "true", text: "⏳" }),
    h("div", {},
      h("p", { class: "status-line" }, "Next pick in ", h("strong", { id: "countdown", text: clock(board.nextPickAt - now()) })),
      lead ? h("p", { class: "status-text" }, "Leading: ", quote(lead.text), h("span", { class: "muted", text: ` · ${fmt(lead.score)} 🦴` }))
        : h("p", { class: "muted", text: "No bones on anything yet. Suggest something, or back one below." }))));
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
  if (!board.open.length) { list.replaceChildren(h("li", { class: "empty", text: "Nothing on the board yet. Be the first to suggest something!" })); return; }
  list.replaceChildren(...board.open.map(s => h("li", { class: "sug" + (s.status === "building" ? " is-building" : ""), "data-id": s.id },
    h("div", { class: "score" }, h("strong", { text: fmt(s.score) }), h("span", { text: "🦴" })),
    h("div", { class: "sug-body" },
      h("p", { class: "sug-text", text: s.text }),
      h("p", { class: "meta" }, `by ${s.yours ? "you" : s.byName} · ${ago(s.at, now())}`, s.voters ? ` · ${s.voters} ${s.voters === 1 ? "backer" : "backers"}` : "",
        s.mine ? h("span", { class: "mine", text: ` · you gave ${fmt(s.mine)}` }) : "")),
    s.status === "open" ? h("div", { class: "gives" }, giveButtons(s)) : h("div", { class: "gives" }, h("span", { class: "tag", text: "Building" })))));
  if (board.openCount > board.open.length) list.append(h("li", { class: "empty", text: `…and ${board.openCount - board.open.length} more with fewer bones.` }));
}

function renderDone() {
  const list = $("done");
  if (!board) return;
  if (!board.done.length) { list.replaceChildren(h("li", { class: "empty", text: "No updates yet. The first one is picked at the top of the hour." })); return; }
  list.replaceChildren(...board.done.map(s => s.status === "shipped"
    ? h("li", { class: "note shipped" },
      h("p", { class: "note-title" }, h("span", { class: "tag ok", text: "New" }), " ", s.title || s.text),
      s.notes ? h("p", { class: "note-body", text: s.notes }) : "",
      h("p", { class: "meta", text: `${quote(s.text)} · suggested by ${s.yours ? "you" : s.byName} · ${fmt(s.score)} 🦴 · ${ago(s.doneAt, now())}` }))
    : h("li", { class: "note declined" },
      h("p", { class: "note-title" }, h("span", { class: "tag", text: "Not built" }), " ", quote(s.text)),
      s.reason ? h("p", { class: "note-body", text: s.reason }) : "",
      h("p", { class: "meta", text: `suggested by ${s.yours ? "you" : s.byName} · bones returned · ${ago(s.doneAt, now())}` }))));
}

function render() { renderStatus(); renderOpen(); renderDone(); }

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

function flash(msg) {
  const el = $("suggest-msg");
  el.textContent = msg; el.className = "form-msg bad";
  clearTimeout(flash.t); flash.t = setTimeout(() => { el.textContent = ""; }, 5000);
}

export function startBoard() {
  $("suggest-cost").textContent = fmt(R.SUGGEST_COST);
  const text = $("suggest-text"), count = $("suggest-count");
  text.addEventListener("input", () => { count.textContent = `${text.value.length} / 200`; });
  $("suggest").addEventListener("submit", async e => {
    e.preventDefault();
    if (busy) return;
    busy = true; refreshButtons();
    const msg = $("suggest-msg");
    try {
      await spend("POST", "/suggest", { text: text.value });
      text.value = ""; count.textContent = "0 / 200";
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
      if (left <= 0) { board.nextPickAt += 3600000; setTimeout(refresh, 15000); }
    }
  }, 1000);
  setInterval(refresh, REFRESH_MS);
  return refresh();
}
