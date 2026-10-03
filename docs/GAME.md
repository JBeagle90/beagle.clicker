# What's in beagle.clicker

What players can do now. Every update adds to this. Keep it short and current: a line or two per
feature, with the numbers from `api/src/game/rules.js`.

## Bones

The dog is a corgi (it was a beagle until update 3; the site keeps its name, beagle.clicker): an orange corgi with big pointy ears that wiggle when patted, a white blaze and fluffy white cheeks, digging for treasure. Short, punchy words, a little funny, still for everyone.

- Pat the corgi: 1 bone a pat, plus what Sharp Noses and Steel Shovels add.
- Bones keep coming from upgrades every second, including while you're away (up to 8 hours).
- At most 20 pats a second count.
- Each pat sends three little bones flying (not with reduced motion). Once you own a Dig Site, the corgi wears a yellow miner's helmet with a headlamp. With a Bone Digger it adds round goggles, and with a Moon Base the miner's helmet becomes a glass space helmet with a collar.

## Screens

Tabs in the header (the address's #hash, so Back works): **Dig** (the corgi; Your dig, a row of icons for each kind of upgrade you own with what it makes, under a news ticker of short, dry headlines that unlock as you progress; the shop), **Trophies**, **Stats** (bones, pats, rates, upgrades, boosts, trophies, treasures, frenzies, counting since) and **Updates** (the suggestion board and the update log). A dot on the Dig tab means a treasure is up. The header also shows the time to the next update (or that one's being built) on every screen, and your name: click it to change it.

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

- Each one you own makes the next 15% dearer. Buy ×1, ×10 or ×100 at once (all or none), or Max: as many as you can afford right now, up to 100 (the price shows "×5 · 103 🦴"). The choice is remembered on the browser.
- The shop shows the first three, then one more past the last kind you own.
- **Boosts** appear at the top of the shop once you own 10 of an upgrade. Each is bought once and makes that upgrade give twice as much: Sniffing School (`bloodhound-training`; Sharp Nose, 1,000), Turbo Buddies (Dig Buddy, 2,500), Treasure Maps (Dig Site, 30,000), Diamond Shovel (Steel Shovel, 60,000), Night Shift (Bone Digger, 400,000), Express Tracks (Bone Train, 4.5 M).

## Buried treasure

- A treasure chest pops up beside the corgi now and then: the first 1 to 2 minutes after you start, then every 3 to 6 minutes. It stays 12 seconds.
- Grab it for a minute's worth of digging plus 30 pats' worth (at least 50 bones). Miss it and it sinks back.
- One chest in five is a **Dig Frenzy** instead: everything gives ×7 for 30 seconds (a gold bar counts down, the corgi glows).

## Trophies

- 14 trophies for pats (1, 100, 1,000, 10,000), bones dug up (1,000, 100,000, 10 M), 10 Dig Buddies, 50 upgrades, one of every upgrade, a first boost, treasures (1, 25) and a Dig Frenzy.
- Each one is kept for good and gives +1% bones from pats and digging. The Trophies screen shows every one; a message pops up at the bottom when you earn one.

## Suggestions and updates

- A suggestion costs 100 bones: one small idea, 10 to 140 characters, no links, friendly words, one every 10 minutes.
- Give bones to any open suggestion (+10, +100, +1,000). You can give to several.
- On each scheduled update, Claude builds the suggestion with the most bones and puts it live. The owner can make any open suggestion the "Owner's pick" instead: it's built at the next update whatever its bones, shows "Up next", and takes no more bones (the bones already on it stay spent).
- Each update leaves three of Claude's own ideas on the board ("Claude's idea", 0 bones) for players to back. When nothing has bones at update time, one of them is picked at random (with none on the board, Claude picks an idea of its own). New ones replace Claude's ideas nobody backed; a backed one stays and competes like any suggestion.
- If a suggestion is declined (or can't be built after two tries), everyone who gave bones to it gets them back.
- Report a suggestion that doesn't belong. After 3 players report one, it comes down and its bones go back.
- Suggestions nobody has given bones to are cleared after 3 days.

## Update log

- Every update is listed, numbered, with the suggestion it came from (or "Claude's own idea") and Claude's summary of what changed and where to find it.
- Rate each update Great, Good, Okay, Bad or Terrible. You can change your rating. It counts once you've earned 50 bones.
- "Show older updates" pages back through the whole log.

## Saves

- No sign-up: your game is kept on your browser, with a save code you can copy to play elsewhere.
- You get a random name, like "Sleepy Snoot 123". Change it from the header: 3 to 24 letters, numbers and spaces, friendly words, nothing that passes for Claude or the owner, up to 5 times a day. Suggestions you made before keep the old name.
