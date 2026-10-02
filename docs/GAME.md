# What's in beagle.clicker

What players can do now. Every update adds to this. Keep it short and current: a line or two per
feature, with the numbers from `api/src/game/rules.js`.

## Bones

The beagle is a scent hound digging for treasure: short, punchy words, a little funny, still for everyone.

- Pat the beagle: 1 bone a pat, plus what Sharp Noses and Steel Shovels add.
- Bones keep coming from upgrades every second, including while you're away (up to 8 hours).
- At most 20 pats a second count.
- The beagle has a white-tipped tail that wags slowly all the time, and faster and wider the more you pat (it calms down when you stop). It stays still with reduced motion.

## Shop

| Upgrade (id) | First costs | Gives |
|---|---|---|
| Sharp Nose (`chew-toy`) | 15 | +1 bone per pat |
| Dig Buddy (`puppy-pal`) | 50 | 1 bone a second |
| Dig Site (`dog-park`) | 600 | 8 bones a second |
| Steel Shovel | 1,200 | +5 bones per pat |
| Bone Digger | 8,000 | 50 bones a second |
| Bone Train | 90,000 | 300 bones a second |
| Bone Mine | 1,000,000 | 2,000 bones a second |
| Moon Base | 12,000,000 | 12,000 bones a second |

- Each one you own makes the next 15% dearer.
- The shop shows the first three, then one more past the last kind you own.
- **Boosts** appear at the top of the shop once you own 10 of an upgrade. Each is bought once and makes that upgrade give twice as much: Bloodhound Training (Sharp Nose, 1,000), Turbo Buddies (Dig Buddy, 2,500), Treasure Maps (Dig Site, 30,000), Diamond Shovel (Steel Shovel, 60,000), Night Shift (Bone Digger, 400,000), Express Tracks (Bone Train, 4.5 M).

## Buried treasure

- A treasure chest pops up beside the beagle now and then: the first 1 to 2 minutes after you start, then every 3 to 6 minutes. It stays 12 seconds.
- Grab it for a minute's worth of digging plus 30 pats' worth (at least 50 bones). Miss it and it sinks back.

## Trophies

- 13 trophies for pats (1, 100, 1,000, 10,000), bones dug up (1,000, 100,000, 10 M), 10 Dig Buddies, 50 upgrades, one of every upgrade, a first boost, and treasures (1, 25).
- Each one is kept for good and gives +1% bones from pats and digging. The card shows the ones you have and the next four ("Show all" for the rest).

## Suggestions and updates

- A suggestion costs 100 bones: one small idea, 10 to 140 characters, no links, friendly words, one every 10 minutes.
- Give bones to any open suggestion (+10, +100, +1,000). You can give to several.
- Every 3 hours, Claude builds the suggestion with the most bones and puts it live. When none has any bones, Claude builds an idea of its own.
- If a suggestion is declined (or can't be built after two tries), everyone who gave bones to it gets them back.
- Report a suggestion that doesn't belong. After 3 players report one, it comes down and its bones go back.
- Suggestions nobody has given bones to are cleared after 3 days.

## Update log

- Every update is listed, numbered, with the suggestion it came from (or "Claude's own idea") and Claude's summary of what changed and where to find it.
- Rate each update Great, Good, Okay, Bad or Terrible. You can change your rating. It counts once you've earned 50 bones.
- "Show older updates" pages back through the whole log.

## Saves

- No sign-up: your game is kept on your browser, with a save code you can copy to play elsewhere.
- You get a random name, like "Sleepy Snoot 123".
