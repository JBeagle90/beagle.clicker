// The news ticker on the Dig screen: short, dry headlines about the beagle's digging. Some only
// turn up once you've got that far. headline(me) picks one that isn't the last one shown.
const own = (me, id) => (me.owned[id] || 0) > 0;
const any = () => true;

const NEWS = [
  ["Beagle digs hole. Finds bone. Digs another hole.", any],
  ["Weather today: sunny, with a good chance of bones.", any],
  ["Local squirrel unimpressed by beagle's digging.", any],
  ["Beagle declines interview. Too busy sniffing.", any],
  ["Mailman reports a suspicious number of holes in the yard.", any],
  ["Study finds bones are 100% the best thing to dig up.", any],
  ["Beagle sniffs the same patch of grass for an hour. \"Worth it,\" says beagle.", any],
  ["Bone prices steady. Beagle: not for sale.", any],
  ["Cat seen watching the dig from a fence. Says nothing.", any],
  ["Beagle's head reported to be \"very well patted\".", me => me.pats >= 100],
  ["Beagle pats now counted in the thousands. Beagle wants more.", me => me.pats >= 1000],
  ["Dig Buddies form a line. Nobody knows who's in charge.", me => (me.owned["puppy-pal"] || 0) >= 5],
  ["New dig site opens. Neighbors ask what the tent is for.", me => own(me, "dog-park")],
  ["Beagle spotted wearing a hard hat. \"Safety first,\" it barks.", me => own(me, "dog-park")],
  ["Hardware store sold out of shovels. Again.", me => own(me, "steel-shovel")],
  ["Big yellow digger seen at the dig. Is the beagle driving?", me => own(me, "bone-digger")],
  ["All aboard the Bone Train. Next stop: more bones.", me => own(me, "bone-train")],
  ["Bone Mine goes deeper. Miners find... more bones.", me => own(me, "bone-mine")],
  ["Beagle plants a flag on the Moon. The flag is a bone.", me => own(me, "moon-base")],
  ["Treasure hunters baffled: beagle keeps finding chests.", me => (me.game.treasures || 0) >= 1],
  ["Witnesses describe Dig Frenzy as \"a blur of paws\".", me => (me.game.frenzies || 0) >= 1],
  ["Beagle now a bone millionaire. Still sniffs everything.", me => me.earned >= 1e6],
  ["Experts warn the world may be running out of places to dig.", me => me.earned >= 1e8],
];

let last = -1;
export function headline(me) {
  const ok = NEWS.map((n, i) => i).filter(i => i !== last && (me ? NEWS[i][1](me) : NEWS[i][1] === any));
  last = ok[Math.floor(Math.random() * ok.length)];
  return NEWS[last][0];
}
