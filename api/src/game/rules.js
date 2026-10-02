// The game's numbers: the upgrades, what they cost and what they give. This is the one place they
// live. The server (sync.js) works out every player's bones from them, and the browser loads this
// same file (/rules.js) to show prices and keep counting between syncs.
// Plain JavaScript only: no require, no network, no timers (dev/guard-rules.cjs checks).
(function (root) {
  "use strict";

  // cost: the first one's price; growth: each one you own makes the next this much dearer.
  // perClick: bones added to every pat; perSecond: bones dug up every second, pats or not.
  const UPGRADES = [
    { id: "chew-toy", name: "Chew Toy", icon: "🧸", desc: "+1 bone every pat.", cost: 15, growth: 1.15, perClick: 1 },
    { id: "puppy-pal", name: "Puppy Pal", icon: "🐶", desc: "Digs up 1 bone a second.", cost: 50, growth: 1.15, perSecond: 1 },
    { id: "dog-park", name: "Dog Park", icon: "🌳", desc: "8 bones a second.", cost: 600, growth: 1.15, perSecond: 8 },
  ];
  const byId = id => UPGRADES.find(u => u.id === id) || null;
  const count = (owned, id) => Math.max(0, Math.floor((owned && owned[id]) || 0));

  const R = {
    UPGRADES,
    MAX_PATS_PER_SECOND: 20, // faster than this isn't a person: the server counts no more
    OFFLINE_HOURS: 8,        // bones dug up while you're away, for at most this long
    SUGGEST_COST: 100,       // bones to put a suggestion on the board
    VOTE_AMOUNTS: [10, 100, 1000],
    byId,
    cost(id, owned) {
      const u = byId(id);
      return u ? Math.ceil(u.cost * Math.pow(u.growth, count(owned, id))) : Infinity;
    },
    perClick(owned) {
      return UPGRADES.reduce((n, u) => n + (u.perClick || 0) * count(owned, u.id), 1);
    },
    perSecond(owned) {
      return UPGRADES.reduce((n, u) => n + (u.perSecond || 0) * count(owned, u.id), 0);
    },
  };

  if (typeof module === "object" && module.exports) module.exports = R;
  else root.RULES = R;
})(typeof window !== "undefined" ? window : this);
