# DEAD AIR

**Radio's dead. Turn it up anyway.**

*"I'm Dead John, coming to you LIVE, and this... is DEAD AIR."*

1714 AM, a pirate station past the end of the dial. Turn an old analog dial through the static, land on 1714, and you're live with Dead John: a late night DJ who never signed off, playing 1,101 original songs by NoBanks Nearby, all night, every night. Everyone tuned in hears the same moment, like real radio.

Built for **Kiroween 2026** (Resurrection). Built with **[Kiro](https://kiro.dev)**: specs, hooks, steering and an MCP server, all in [`.kiro/`](.kiro).

## What you can do

- **Tune in.** Drag the dial (or use the arrow keys). Static gives way to the station as you get close to 1714.
- **Listen.** Dead John talks over song intros and stops right before the music turns, reads time capsule song titles like letters, runs ads for businesses that can't exist, and checks the time. Some lines only air at certain hours.
- **Call the request line.** Send a dedication and pick a song. Dead John reads it on the air a few minutes later, on every radio, then plays your song.
- **Hunt.** Most of the dial is static. Not all of it. Hold still on the right spots and your Logbook fills in, page by page. There is a numbers station at midnight (and a short one at 14 past every hour), and something happens at 3:14 AM. Find all eight pages and someone answers who never has before. (Spoilers live in `data/hunt.json` and `.kiro/specs/the-hunt`.)

## How Kiro built it

| Kiro feature | Where | What it did |
|---|---|---|
| **Specs** (requirements in EARS, design with correctness properties, tasks) | [`.kiro/specs`](.kiro/specs) | Six specs: `station-library`, `talkup-bugfix`, `broadcast-clock`, `tuner-player`, `the-hunt`, `request-line` |
| **Steering** | [`.kiro/steering`](.kiro/steering) | `dead-john.md` (the DJ's bible), `audio.md` (loudness and ducking, scoped to audio code), `product.md`, `style.md`, `tech.md`, `structure.md` |
| **Hooks** (command hooks, zero credits) | [`.kiro/hooks/dead-air.json`](.kiro/hooks/dead-air.json) | Tests on save, a PreToolUse guard that blocks audio files from the repo, a Dead John script lint, and "a task isn't done until all tests pass" |
| **MCP** | [`.kiro/settings/mcp.json`](.kiro/settings/mcp.json), [`station/src/mcp-server.ts`](station/src/mcp-server.ts) | `dead-air-station`: whats_on, find_track, talkup_window, day_summary, library_stats, signal_check |

Kiro CLI ran headless (`kiro-cli chat --v3 --no-interactive`), one spec at a time, and every result was reviewed against the requirements and real data before it was accepted. The full story, including what the reviews caught, is in the Devpost write-up.

## How it works

There is no streaming server. The whole station is a pure function of time: `generateDay(day)` lays every song, voice break, station ID, numbers reading and Emergency Broadcast end to end for one Los Angeles station day (DST safe: 23, 24 or 25 hours), with no song repeated inside 24 hours. A browser asks `GET /now`, gets the segment on air and its offset, corrects for clock skew, and schedules audio with Web Audio 20 seconds ahead.

```
station/     the clock (day.ts), now playing, hidden signals (hunt.ts), request rules, server, MCP server
web/         the tuner: dial, AM filter chain, ducking, Logbook, request form
tools/       library encoder (Kiro-built CLI) and the request-line studio worker
data/        library.json (1,101 songs), voicebank.json, hunt.json, blocklist.txt
.kiro/       specs, steering, hooks, MCP settings
```

Property-based tests (fast-check) hold it together: strict tiling for any day in a 10 year window, no repeats in 24 hours, talk-ups that always end on the post, no voice line twice in a row, requests that never change what already aired, hidden signals that never leak outside their lock window, and a test that fails the build if a hidden frequency ever appears in the web client.

## Run it locally

Needs Node 22 and the encoded audio (the MP3s are not in the repo; see `tools/library`).

```bash
# station API on :8787 (set LIBRARY_OUT and VOICE_OUT to your audio folders)
cd station && npm install && npm run dev   # binds ::, falls back to 0.0.0.0 without IPv6; HOST=127.0.0.1 to pin

# tuner on :5173 (proxies the API)
cd web && npm install && npx vite

# tests
cd station && npx vitest run
cd web && npx vitest run
```

Production: `cd web && npx vite build`, then run the station with `STATIC_DIR=../web/dist PORT=<port>`.

## The voice

Dead John is the creator's own cloned voice, rendered locally with Qwen3-TTS and checked with Whisper. Lines are picked by hand from several takes; the newest ones use the best Whisper-checked take until they are picked. The other voices on the dial are made from the same free, local tools.

## Music

Every song on DEAD AIR is an original by NoBanks Nearby (BMI). All rights reserved. The music is not covered by the code license.

## License

Code: [MIT](LICENSE).
