// A first, simple filter for words that don't belong in a game anyone (children too) can open:
// sexual, graphic or hateful words and strong swearing. It checks suggestions when they're posted
// (suggestions.js) and every file an update changes (dev/guard-rules.cjs). It's deliberately blunt
// and only the first line: Claude screens each suggestion before building it, players can report
// suggestions, and the owner can take any off the board.
//
// More words: the BLOCKED_WORDS setting (comma-separated) on Azure. Words are matched whole, after
// undoing common disguises (s3x, s.e.x, seeeex); entries ending in * match words starting with them.
"use strict";

const WORDS = [
  // sexual
  "sex", "sexy", "sexual", "sexually", "porn*", "nude", "nudes", "nudity", "naked", "boob*", "tits", "titty", "titties",
  "penis", "vagina", "genital*", "dick", "dicks", "cock", "cocks", "pussy", "cum", "orgasm*", "horny", "erotic*", "fetish*",
  "hentai", "nsfw", "xxx", "masturbat*", "stripper*", "onlyfans", "milf", "thong", "lingerie", "rape*", "rapist*", "molest*",
  "pedo*", "paedo*", "incest", "bdsm", "kinky", "seduc*", "sexting",
  // graphic
  "gore", "gory", "gruesome", "dismember*", "decapitat*", "behead*", "mutilat*", "disembowel*", "torture*", "suicide*",
  "kys", "selfharm", "massacre*", "murder*", "corpse*", "slaughter*", "bloodbath", "entrails", "guts",
  // drugs
  "cocaine", "heroin", "meth", "weed", "marijuana", "stoner", "drunk", "vodka", "beer",
  // hate
  "nazi*", "hitler", "kkk", "genocide",
  // swearing
  "fuck*", "fuk*", "fck*", "fcuk*", "fkn", "fk", "shit*", "sht", "biatch", "bitch*", "bastard*", "cunt*", "whore*", "slut*", "asshole*", "arsehole*", "wank*", "twat*", "bollock*",
  "motherf*", "dumbass", "jackass", "piss*", "crap", "damn", "goddamn", "hell",
];

const LEET = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", 8: "b", "@": "a", $: "s", "!": "i", "|": "i", "+": "t" };

function compile(list) {
  const exact = new Set(), prefixes = [];
  for (const raw of list) {
    const w = String(raw).toLowerCase().trim();
    if (!w) continue;
    if (w.endsWith("*")) prefixes.push(w.slice(0, -1)); else exact.add(w);
  }
  return { exact, prefixes };
}
const BASE = compile(WORDS);
let extraKey = null, extra = compile([]);

// The words in a text, as plain letters: lowercase, disguises undone.
function words(text) {
  const t = String(text || "").toLowerCase().normalize("NFKD").replace(/[^\x00-\x7f]/g, "")
    .replace(/[0134578@$!|+]/g, ch => LEET[ch] || ch);
  const out = t.split(/[^a-z.\-_*]+/).flatMap(w => [w, w.replace(/[.\-_*]/g, "")]).flatMap(w => w.split(/[.\-_*]+/).concat(w));
  // "s e x": single letters in a row joined up
  const singles = t.split(/[^a-z]+/).reduce((acc, w) => { if (w.length === 1) acc[acc.length - 1] += w; else acc.push(""); return acc; }, [""]);
  return [...new Set(out.concat(singles).filter(w => w.length > 1))];
}
const squash = w => w.replace(/(.)\1+/g, "$1");

function hit(w, lists) {
  for (const { exact, prefixes } of lists) {
    if (exact.has(w)) return true;
    for (const p of prefixes) if (w.startsWith(p)) return true;
  }
  return false;
}

// → the first blocked word found (as written in the list's terms), or null when the text is fine.
function blocked(text, env = process.env) {
  const key = env.BLOCKED_WORDS || "";
  if (key !== extraKey) { extraKey = key; extra = compile(key.split(",")); }
  const lists = [BASE, extra];
  for (const w of words(text)) {
    if (hit(w, lists)) return w;
    const s = squash(w);
    if (s !== w && hit(s, lists)) return s;
  }
  return null;
}

module.exports = { blocked };
