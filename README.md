# DEAD AIR

**Radio's dead. Turn it up anyway.**

LIVE: https://deadair.nohumannearby.com/

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
| **Specs** (requirements in EARS, design with correctness properties, tasks) | [`.kiro/specs`](.kiro/specs) | Seven specs: `station-library`, `talkup-bugfix`, `broadcast-clock`, `tuner-player`, `the-hunt`, `request-line`, `live-stream` |
| **Steering** | [`.kiro/steering`](.kiro/steering) | `dead-john.md` (the DJ's bible), `audio.md` (loudness and ducking, scoped to audio code), `product.md`, `style.md`, `tech.md`, `structure.md` |
| **Hooks** (command hooks, zero credits) | [`.kiro/hooks/dead-air.json`](.kiro/hooks/dead-air.json) | Tests on save, a PreToolUse guard that blocks audio files from the repo, a Dead John script lint, and "a task isn't done until all tests pass" |
| **MCP** | [`.kiro/settings/mcp.json`](.kiro/settings/mcp.json), [`station/src/mcp-server.ts`](station/src/mcp-server.ts) | `dead-air-station`: whats_on, find_track, talkup_window, day_summary, library_stats, signal_check |

Kiro CLI ran headless (`kiro-cli chat --v3 --no-interactive`), one spec at a time, and every result was reviewed against the requirements and real data before it was accepted. The full story, including what the reviews caught, is in the Devpost write-up.

## How it works

The schedule needs no streaming server. The whole station is a pure function of time: `generateDay(day)` lays every song, voice break, station ID, numbers reading and Emergency Broadcast end to end for one Los Angeles station day (DST safe: 23, 24 or 25 hours), with no song repeated inside 24 hours. A browser asks `GET /now`, gets the segment on air and its offset, corrects for clock skew, and schedules audio with Web Audio 20 seconds ahead. Phones that need to keep playing with the screen locked get an optional server-mixed `/stream` of the same schedule (the `live-stream` spec).

```
station/     the clock (day.ts), now playing, hidden signals (hunt.ts), request rules, server, MCP server
web/         the tuner: dial, AM filter chain, ducking, Logbook, request form
tools/       library encoder (Kiro-built CLI), voice studio and request-line worker (studio/), Hunt audio builder (hunt/), demo capture and edit (demo/)
data/        library.json (1,101 songs), voicebank.json, hunt.json, blocklist.txt
.kiro/       specs, steering, hooks, MCP settings
```

Property-based tests (fast-check) hold it together: strict tiling for any day in a 10 year window, no repeats in 24 hours, talk-ups that always end on the post, no voice line twice in a row, requests that never change what already aired, hidden signals that never leak outside their lock window, and a test that fails the build if a hidden frequency ever appears in the web client.

## Run it locally

To just listen, use the live station: https://deadair.nohumannearby.com/ (no login). [`JUDGE_QUICKSTART.md`](JUDGE_QUICKSTART.md) has a three minute path.

Needs Node 22. The song and voice MP3s are the artist's music and are not in the repo (see "Rebuild the library" below), so a fresh clone installs and passes its tests but has no music to play.

Install and test (works on a fresh clone, no audio needed):

```bash
cd station && npm install && npx vitest run
cd web && npm install && npx vitest run
cd tools/library && npm install && npx vitest run
```

Run the whole station locally with no audio of your own: `AUDIO_FALLBACK` pulls any song or voice file you don't have from the live station.

```bash
cd web && npm install && npx vite build && cd ..
cd station && npm install
AUDIO_FALLBACK=https://deadair.nohumannearby.com STATIC_DIR=../web/dist HOST=127.0.0.1 npm run dev
# open http://127.0.0.1:8787
```

Or run it with your own encoded audio. The station reads its settings from environment variables, listed in [`.env.example`](.env.example) (it does not read a `.env` file, so export them in your shell):

```bash
export LIBRARY_OUT=/path/to/library_mp3   # song MP3s
export VOICE_OUT=/path/to/voice_mp3       # Dead John clips
export FFMPEG=/path/to/ffmpeg             # used to mix /stream

# station API on :8787 (binds ::, falls back to 0.0.0.0 without IPv6; HOST=127.0.0.1 to pin)
cd station && npm install && npm run dev

# tuner on :5173 (proxies the API), in a second terminal
cd web && npm install && npx vite
```

`data/library.json` (1,101 songs, metadata only) is in the repo; `tools/library` rebuilds it from your own WAVs.

Production: `cd web && npx vite build`, then run the station with `STATIC_DIR=../web/dist PORT=<port>`.

## Rebuild the library

The songs are encoded by `tools/library`. It reads your master CSV, measures each WAV, and writes 256 kbps MP3s plus `data/library.json`. The WAVs and MP3s never go in git. Three env vars, kept outside the repo:

- `FFMPEG`: path to the ffmpeg binary.
- `CSV_PATH`: the master track list (needs `title` and `file` columns).
- `LIBRARY_OUT`: the folder the MP3s are written to.

```bash
cd tools/library && npm install && npm run build
npm start                  # add --force to re-encode, --dry-run to just look
```

More in [`tools/library/README.md`](tools/library/README.md).

## The voice

Dead John is the creator's own cloned voice, rendered locally with Qwen3-TTS and checked with Whisper (`tools/studio/studio.py`; the voice sample itself stays off GitHub). `tools/studio/build_voicebank.py` turns picked takes into the voice bank, and `tools/hunt/build_hunt.py` mixes the hidden stations. Lines are picked by hand from several takes; the newest ones use the best Whisper-checked take until they are picked. The other voices on the dial are made from the same free, local tools.

## Music

Every song on DEAD AIR is an original by NoBanks Nearby (BMI). All rights reserved. The music is not covered by the code license.

## License

Code: [MIT](LICENSE).
