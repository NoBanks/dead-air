# Judge quickstart: DEAD AIR in under 3 minutes

**Live:** https://deadair.nohumannearby.com

Use headphones or decent speakers. Phone or desktop both work.

## The fastest path (about 2 minutes)

1. Open the live URL and press **TURN IT ON**. That tap unlocks browser audio.
2. Turn the dial. Drag it, or use the left and right arrow keys. The range is 520 to 1740. You will hear generated static, not a looped file.
3. Move toward **1714**. The static fades out as you get close and the signal locks. You are now live.
4. Listen for about a minute. You should hear:
   - Dead John say his sign-on: "I'm Dead John, coming to you LIVE, and this... is DEAD AIR."
   - Him talking over a song intro and stopping right before the music turns, with the song ducking under his voice and coming back up.
   - A song by NoBanks Nearby with its title read like a letter, and a card showing what is on air.
5. Try **CALL THE REQUEST LINE**. Send a dedication and pick a song. It airs a few minutes later, for everyone, then your song plays.
6. Open the site on a second device or tab at 1714. Both play the same moment, because the station is a schedule on a clock.

Everything you hear is original music by NoBanks Nearby. There is no signup.

## Things to notice

- The station is a pure function of time, not a streaming playlist. Everyone gets the same moment.
- On a phone, lock the screen. 1714 keeps playing and the lock screen shows the song.
- Most of the dial is static, but not all of it. The README says there is a numbers station at midnight (and a short one at 14 past every hour), that something happens at 3:14 AM, and that finding every Logbook page makes someone answer who never has before. The rest is left for you to find.

## Run it locally from a fresh clone

A fresh clone cannot play music, because the audio is not in the repo. It does run and pass its tests. Needs Node 22.

```bash
git clone https://github.com/NoBanks/dead-air.git
cd dead-air
cd station && npm install && npx vitest run && cd ..
cd web && npm install && npx vitest run && cd ..
```

Station tests that use the MCP server need `data/library.json`, which is not committed. If you see 3 failures in `station/tests/mcp.test.ts` on `main`, that is the known cause. PR #2 adds a fallback sample library for them.

To run the full station you need your own encoded audio. See the "Run it locally" section of [README.md](README.md) and `.env.example` for the settings. For the real thing, use the live site.

## Where the Kiro artifacts live

All at the repo root in [`.kiro/`](.kiro):

- **Specs:** `.kiro/specs/` has seven: `station-library`, `talkup-bugfix`, `broadcast-clock`, `tuner-player`, `the-hunt`, `request-line`, `live-stream`. Each has `requirements.md`, `design.md` and `tasks.md`.
- **Steering:** `.kiro/steering/` has `dead-john.md`, `audio.md`, `product.md`, `style.md`, `tech.md` and `structure.md`.
- **Hooks:** `.kiro/hooks/dead-air.json`, with the scripts in `scripts/hooks/`.
- **MCP:** `.kiro/settings/mcp.json`, server code in `station/src/mcp-server.ts`.

Note: `the-hunt` spec and `data/hunt.json` contain spoilers for the hidden stations.

## Links

- Source: https://github.com/NoBanks/dead-air
- Full write-up: [DEVPOST.md](DEVPOST.md)
- Demo video: [NEED]
