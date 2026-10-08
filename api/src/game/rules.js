// The game's numbers: the upgrades, boosts, trophies and buried treasure, what they cost and what
// they give. This is the one place they live. The server (sync.js) works out every player's bones
// from them, and the browser loads this same file (/rules.js) to show prices and keep counting
// between syncs.
// Plain JavaScript only: no require, no network, no timers (dev/guard-rules.cjs checks).
(function (root) {
  "use strict";

  // In price order; the shop shows them a few at a time as you buy. The ids are kept in saves, so
  // never change one (the names can change).
  // cost: the first one's price; growth: each one you own makes the next this much dearer.
  // perClick: bones added to every pat; perSecond: bones dug up every second, pats or not.
  const UPGRADES = [
    { id: "chew-toy", name: "Sharp Nose", icon: "👃", desc: "Sniffs out +1 bone every pat.", cost: 15, growth: 1.15, perClick: 1 },
    { id: "puppy-pal", name: "Dig Buddy", icon: "🐕", desc: "Digs up 1 bone a second.", cost: 50, growth: 1.15, perSecond: 1 },
    { id: "dog-park", name: "Dig Site", icon: "⛺", desc: "8 bones a second.", cost: 600, growth: 1.15, perSecond: 8 },
    { id: "steel-shovel", name: "Steel Shovel", icon: "⛏️", desc: "+5 bones every pat.", cost: 1200, growth: 1.15, perClick: 5 },
    { id: "bone-digger", name: "Bone Digger", icon: "🚜", desc: "50 bones a second.", cost: 8000, growth: 1.15, perSecond: 50 },
    { id: "bone-train", name: "Bone Train", icon: "🚂", desc: "300 bones a second.", cost: 90000, growth: 1.15, perSecond: 300 },
    { id: "bone-mine", name: "Bone Mine", icon: "⛰️", desc: "2,000 bones a second.", cost: 1000000, growth: 1.15, perSecond: 2000 },
    { id: "moon-base", name: "Moon Base", icon: "🚀", desc: "12,000 bones a second.", cost: 12000000, growth: 1.15, perSecond: 12000 },
  ];

  // Boosts: bought once each, after you own `needs` of the upgrade they boost. Each makes that
  // upgrade give twice as much. Owned ones are kept in `owned` like upgrades (owned[id] = 1).
  const BOOSTS = [
    { id: "bloodhound-training", name: "Sniffing School", icon: "🎯", boosts: "chew-toy", needs: 10, cost: 1000 },
    { id: "turbo-buddies", name: "Turbo Buddies", icon: "⚡", boosts: "puppy-pal", needs: 10, cost: 2500 },
    { id: "treasure-maps", name: "Treasure Maps", icon: "🗺️", boosts: "dog-park", needs: 10, cost: 30000 },
    { id: "diamond-shovel", name: "Diamond Shovel", icon: "💎", boosts: "steel-shovel", needs: 10, cost: 60000 },
    { id: "night-shift", name: "Night Shift", icon: "🌙", boosts: "bone-digger", needs: 10, cost: 400000 },
    { id: "express-tracks", name: "Express Tracks", icon: "🛤️", boosts: "bone-train", needs: 10, cost: 4500000 },
  ];

  const count = (owned, id) => Math.max(0, Math.floor((owned && owned[id]) || 0));
  const total = owned => UPGRADES.reduce((n, u) => n + count(owned, u.id), 0);

  // Trophies: earned once, kept for good (in game.trophies), each +TROPHY_BONUS bones from
  // everything. `when` looks at the saved player: pats, earned, owned, game.
  const TROPHIES = [
    { id: "first-pat", name: "First Pat", icon: "🐾", desc: "Pat the corgi.", when: p => p.pats >= 1 },
    { id: "quick-paws", name: "Quick Paws", icon: "👋", desc: "100 pats.", when: p => p.pats >= 100 },
    { id: "paw-machine", name: "Paw Machine", icon: "⚙️", desc: "1,000 pats.", when: p => p.pats >= 1000 },
    { id: "iron-paws", name: "Iron Paws", icon: "🦾", desc: "10,000 pats.", when: p => p.pats >= 10000 },
    { id: "pat-legend", name: "Pat Legend", icon: "🌈", desc: "100,000 pats.", when: p => p.pats >= 1e5 },
    { id: "bone-pile", name: "Bone Pile", icon: "🦴", desc: "Dig up 1,000 bones.", when: p => p.earned >= 1000 },
    { id: "bone-baron", name: "Bone Baron", icon: "🎩", desc: "Dig up 100,000 bones.", when: p => p.earned >= 1e5 },
    { id: "bone-tycoon", name: "Bone Tycoon", icon: "👑", desc: "Dig up 10 million bones.", when: p => p.earned >= 1e7 },
    { id: "crew-boss", name: "Crew Boss", icon: "📣", desc: "Own 10 Dig Buddies.", when: p => count(p.owned, "puppy-pal") >= 10 },
    { id: "big-operation", name: "Big Operation", icon: "🏗️", desc: "Own 50 upgrades.", when: p => total(p.owned) >= 50 },
    { id: "full-toolkit", name: "Full Toolkit", icon: "🧰", desc: "Own one of every upgrade.", when: p => UPGRADES.every(u => count(p.owned, u.id) > 0) },
    { id: "trained-nose", name: "Trained Nose", icon: "🎓", desc: "Buy a boost.", when: p => BOOSTS.some(b => count(p.owned, b.id) > 0) },
    { id: "treasure-hunter", name: "Treasure Hunter", icon: "🧭", desc: "Grab a buried treasure.", when: p => ((p.game && p.game.treasures) || 0) >= 1 },
    { id: "dig-frenzy", name: "Dig Frenzy", icon: "🔥", desc: "Find a frenzy chest.", when: p => ((p.game && p.game.frenzies) || 0) >= 1 },
    { id: "treasure-legend", name: "Treasure Legend", icon: "🏆", desc: "Grab 25 buried treasures.", when: p => ((p.game && p.game.treasures) || 0) >= 25 },
    { id: "gold-rush", name: "Gold Rush", icon: "🌟", desc: "Grab a gold chest.", when: p => ((p.game && p.game.golds) || 0) >= 1 },
    { id: "on-a-roll", name: "On a Roll", icon: "🎯", desc: "Grab 5 treasures in a row.", when: p => ((p.game && p.game.streaks) || 0) >= 1 },
    { id: "golden-paws", name: "Golden Paws", icon: "🥇", desc: "Grab 10 gold chests.", when: p => ((p.game && p.game.golds) || 0) >= 10 },
  ];

  const byId = id => UPGRADES.find(u => u.id === id) || BOOSTS.find(b => b.id === id) || null;
  const isBoost = id => BOOSTS.some(b => b.id === id);
  // 2 for each boost you own for this upgrade.
  const mult = (owned, id) => BOOSTS.reduce((m, b) => m * (b.boosts === id && count(owned, b.id) ? 2 : 1), 1);

  const R = {
    UPGRADES,
    BOOSTS,
    TROPHIES,
    MAX_PATS_PER_SECOND: 20, // faster than this isn't a person: the server counts no more
    OFFLINE_HOURS: 8,        // bones dug up while you're away, for at most this long
    SUGGEST_COST: 100,       // bones to put a suggestion on the board
    VOTE_AMOUNTS: [10, 100, 1000],
    TROPHY_BONUS: 0.01,      // each trophy: +1% bones from pats and digging
    // Buried treasure pops up now and then; grab it in time for a burst of bones. Seconds.
    TREASURE: { first: [60, 120], gap: [180, 360], window: 15, show: 12, minBones: 50, digSeconds: 60, pats: 30 },
    // Some chests start a Dig Frenzy instead: everything gives `x` times as much for `seconds`.
    FRENZY: { chance: 0.2, x: 7, seconds: 30 },
    // A rare gold chest (one in ten, picked when it's buried, so it shows) gives `x` times the bones, never a frenzy.
    GOLD: { chance: 0.1, x: 3 },
    // A treasure streak: grab `needs` chests in a row without missing one for `x` treasures' worth more.
    STREAK: { needs: 5, x: 5 },
    MAX_BUY: 100,            // the most of one upgrade bought in one go (the shop's ×100)
    byId,
    isBoost,
    // A boost can be bought once you own enough of what it boosts, and only once.
    available(id, owned) {
      const b = BOOSTS.find(x => x.id === id);
      return !!b && !count(owned, b.id) && count(owned, b.boosts) >= b.needs;
    },
    cost(id, owned) {
      const u = byId(id);
      if (!u) return Infinity;
      if (isBoost(id)) return R.available(id, owned) ? u.cost : Infinity;
      return Math.ceil(u.cost * Math.pow(u.growth, count(owned, id)));
    },
    // The price of the next n of an upgrade, bought one after another.
    costN(id, owned, n) {
      if (isBoost(id)) return n === 1 ? R.cost(id, owned) : Infinity;
      let sum = 0;
      const o = { ...owned };
      for (let i = 0; i < n; i++) { sum += R.cost(id, o); o[id] = count(o, id) + 1; }
      return sum;
    },
    // How many of an upgrade `bones` can buy, one after another (at most MAX_BUY; a boost: 1 or 0).
    maxBuy(id, owned, bones) {
      if (isBoost(id)) return bones >= R.cost(id, owned) ? 1 : 0;
      let n = 0, sum = 0;
      const o = { ...owned };
      while (n < R.MAX_BUY) {
        sum += R.cost(id, o);
        if (!(sum <= bones)) break;
        n++; o[id] = count(o, id) + 1;
      }
      return n;
    },
    // How much more you get from everything, from trophies.
    bonus(game) {
      const t = game && Array.isArray(game.trophies) ? game.trophies : [];
      return 1 + R.TROPHY_BONUS * TROPHIES.filter(x => t.includes(x.id)).length;
    },
    perClick(owned, game) {
      return UPGRADES.reduce((n, u) => n + (u.perClick || 0) * count(owned, u.id) * mult(owned, u.id), 1) * R.bonus(game);
    },
    perSecond(owned, game) {
      return UPGRADES.reduce((n, u) => n + (u.perSecond || 0) * count(owned, u.id) * mult(owned, u.id), 0) * R.bonus(game);
    },
    // What all you own of one upgrade makes: { perClick, perSecond }, with boosts and trophies.
    output(id, owned, game) {
      const u = UPGRADES.find(x => x.id === id), k = u ? count(owned, id) * mult(owned, id) * R.bonus(game) : 0;
      return { perClick: ((u && u.perClick) || 0) * k, perSecond: ((u && u.perSecond) || 0) * k };
    },
    // What a buried treasure gives: a minute of digging and 30 pats' worth, at least 50.
    treasure(owned, game) {
      const T = R.TREASURE;
      return Math.max(T.minBones, Math.round(T.digSeconds * R.perSecond(owned, game) + T.pats * R.perClick(owned, game)));
    },
    // The trophies this player has earned but doesn't have yet.
    newTrophies(p) {
      const have = (p.game && Array.isArray(p.game.trophies)) ? p.game.trophies : [];
      return TROPHIES.filter(t => !have.includes(t.id) && t.when(p)).map(t => t.id);
    },
  };

  if (typeof module === "object" && module.exports) module.exports = R;
  else root.RULES = R;
})(typeof window !== "undefined" ? window : this);
