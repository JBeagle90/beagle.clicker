// The player's game in this browser. The server decides how many bones you really have
// (api/src/game/sync.js); this keeps counting between syncs so the numbers move smoothly, queues
// the pats and purchases made since the last sync, and sends them every couple of seconds.
import { call, getSave, setSave } from "./api.js";

const R = window.RULES;
const SYNC_MS = 2000, IDLE_SYNC_MS = 15000;

export const game = {
  me: null,                    // the player, as the server last said plus what happened here since
  queue: { pats: 0, buy: [] }, // not sent yet
  online: true,
  listeners: new Set(),
};

const emit = what => { for (const fn of game.listeners) fn(what); };
export const onChange = fn => game.listeners.add(fn);

// Takes the server's word for the player, then adds back whatever happened here that it hasn't heard yet.
export function applyServer(player) {
  const me = { ...player, owned: { ...player.owned } };
  me.bones += game.queue.pats * R.perClick(me.owned);
  const kept = [];
  for (const id of game.queue.buy) {
    const c = R.cost(id, me.owned);
    if (me.bones < c) continue;
    me.bones -= c; me.owned[id] = (me.owned[id] || 0) + 1; kept.push(id);
  }
  game.queue.buy = kept;
  const ownedChanged = !game.me || JSON.stringify(game.me.owned) !== JSON.stringify(me.owned);
  me.perClick = R.perClick(me.owned);
  me.perSecond = R.perSecond(me.owned);
  game.me = me;
  emit(ownedChanged ? "owned" : "bones");
}

export function pat() {
  if (!game.me) return 0;
  const n = game.me.perClick;
  game.me.bones += n; game.me.earned += n; game.me.pats++;
  game.queue.pats++;
  emit("bones");
  return n;
}

export function buy(id) {
  const me = game.me, c = me && R.cost(id, me.owned);
  if (!me || !(me.bones >= c)) return false;
  me.bones -= c;
  me.owned = { ...me.owned, [id]: (me.owned[id] || 0) + 1 };
  me.perClick = R.perClick(me.owned); me.perSecond = R.perSecond(me.owned);
  game.queue.buy.push(id);
  emit("owned");
  sync();
  return true;
}

// Bones dug up by the pups, every frame.
export function tick(dt) { if (game.me && game.me.perSecond) { game.me.bones += game.me.perSecond * dt; game.me.earned += game.me.perSecond * dt; } }

let inflight = null, lastSync = 0;
export function sync() {
  if (inflight) return inflight;
  const sent = game.queue;
  game.queue = { pats: 0, buy: [] };
  inflight = call("POST", "/sync", sent)
    .then(r => { lastSync = Date.now(); setOnline(true); applyServer(r.player); })
    .catch(e => {
      game.queue = { pats: game.queue.pats + sent.pats, buy: sent.buy.concat(game.queue.buy) };
      if (e.code === "no_save") return newPlayer();
      setOnline(false, e.message);
    })
    .finally(() => { inflight = null; });
  return inflight;
}

// Something that spends bones (a vote, a suggestion): sync first, so the server has every pat.
export async function spend(method, path, body) {
  await sync();
  const r = await call(method, path, body);
  if (r.player) applyServer(r.player);
  return r;
}

function setOnline(on, why) {
  if (game.online === on) return;
  game.online = on;
  emit(on ? "online" : "offline:" + (why || ""));
}

async function newPlayer() {
  const r = await call("POST", "/players");
  setSave(r.save);
  game.queue = { pats: 0, buy: [] };
  applyServer(r.player);
}

export async function start() {
  try {
    if (getSave()) await sync(); else await newPlayer();
  } catch (e) { setOnline(false, e.message); }
  setInterval(() => {
    const busy = game.queue.pats || game.queue.buy.length;
    if (!game.me && !getSave()) newPlayer().catch(e => setOnline(false, e.message));
    else if (busy || !game.me || Date.now() - lastSync > IDLE_SYNC_MS) sync();
  }, SYNC_MS);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") sync(); });
}
