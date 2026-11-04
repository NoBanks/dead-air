# DEAD AIR

**Tagline:** Radio's dead. Turn it up anyway.

> "I'm Dead John, coming to you LIVE, and this... is DEAD AIR."

Kiroween 2026 entry, category: Resurrection.

## Inspiration

I wanted to bring back the late night AM radio DJ. The kind of voice that talks to one person at 3 AM, over a dial full of static, on a station you were not sure you were supposed to find.

I make music as NoBanks Nearby and I have over a thousand finished songs. Most are instrumentals, and the title is the only words in the song. Every title is a note from the night I made it. A radio station that reads those titles out like letters found in a mailbox felt like the right home for them.

I have worked as a cinematographer since 2008 and I am an audio engineer, so I wanted the station to look and sound expensive, not like a demo.

[NEED] Ryan's own words on why Resurrection, if different from the above.

## What it does

DEAD AIR is a pirate AM station at 1714 that never goes off the air. You open the site and turn an old analog dial through the static. When you land on 1714 the signal locks and you are live with Dead John, a DJ who was on air the night the tower went down and never signed off.

- Everyone hears the same moment. There is no on-demand playlist. The station is a schedule laid on a clock, like real radio.
- Dead John talks over song intros and stops right before the music turns. He backsells songs, checks the time, reads song titles like letters, runs ads for businesses that cannot exist, and gives the ID.
- The request line lets you send a dedication and pick a song. Dead John reads it on the air a few minutes later, on every radio, and then plays your song.
- Most of the dial is static, but not all of it. Stay still on the right spots and a Logbook fills in, page by page. There is a numbers station at midnight and something happens at 3:14 AM. Find every page and someone answers who never has before.
- It keeps playing in the background and on a phone lock screen, and it installs as an app.

All 1,101 songs are original music by NoBanks Nearby.

## How we built it with Kiro

Kiro was the build process, not a last minute add-on. Everything is in `.kiro/` at the repo root.

**Specs.** Each feature started as a spec with requirements, design and tasks (`.kiro/specs/<name>/`). Requirements are written in EARS style, and the designs list correctness properties that became property-based tests.

| Spec | What it did |
|---|---|
| `station-library` | Specified the CLI that reads the master track list, encodes each song to a loudness matched MP3, analyzes talk-up timing, and writes the library index. |
| `talkup-bugfix` | A bugfix spec. The talk-up detector returned the 8 second fallback for every real song because the unit tests used synthetic tones. The spec recorded the failure, the cause and the fix. |
| `broadcast-clock` | The core of the station. A pure function from time to a schedule: songs, breaks, IDs, numbers readings and the Emergency Broadcast tone, DST safe, with no song repeated inside 24 hours. |
| `tuner-player` | The browser dial, static generator, Web Audio graph, clock sync and ducking. It also has a `TASKS_COMPLETION.md` report. |
| `the-hunt` | The hidden stations, signal strength by distance from a frequency, the Logbook and the finale. |
| `request-line` | The request form, validation rules, scheduling a few songs ahead, and the rule that a request never changes what already aired. |
| `live-stream` | The seventh spec. Mixes the schedule into one continuous MP3 at `/stream` so the radio keeps playing on a locked phone. It ends with a code review where one finding was real and fixed and two were rejected against the source. |

**Steering.** Six files in `.kiro/steering/`:

- `dead-john.md`: the DJ's bible. His backstory, voice, the real DJ craft he follows (talk-up, back-sell, front-sell, time check, station ID), running bits, and hard rules such as no em dashes and no alcohol references. Always included.
- `audio.md`: loudness targets (-14 LUFS music, -16 LUFS voice), ducking (8 to 12 dB, fast attack, smooth release) and the rule that a talk-up must end before the vocal. Scoped to audio code.
- `product.md`: the product, the Resurrection angle, library rules and the judging criteria.
- `style.md`: writing and code style.
- `tech.md`: the stack.
- `structure.md`: the directory map.

**Hooks.** `.kiro/hooks/dead-air.json` defines five command hooks that run scripts from `scripts/hooks/`:

- Library tests on save (`tools/library/src`).
- Station tests on save (`station/src`).
- A PreToolUse guard (`guard-writes.mjs`) that blocks audio files and `.env` files from being written into the repo.
- A Dead John lint (`dead-john-lint.mjs`) on `data/voicebank.json` that checks the script rules.
- "Task done means tests pass" (`all-tests.mjs`), run after a task executes.

The hook scripts have their own tests in `scripts/hooks/tests/`.

**MCP.** `.kiro/settings/mcp.json` registers `dead-air-station`, an MCP server from `station/src/mcp-server.ts`. It has six tools: `whats_on`, `find_track`, `talkup_window`, `day_summary`, `library_stats` and `signal_check`. It lets an agent ask the real schedule and library what is on air and when a talk-up must end. [NEED] Ryan to confirm how it was used while building.

**How it ran.** Per the README, Kiro CLI ran headless, one spec at a time, and every result was reviewed against the requirements and real data before it was accepted.

[NEED] Specific moments in Kiro (a vibe session, an agent hook firing, a screenshot) that Ryan wants named. Only the repo is visible to me.
[NEED] Which Kiro features were used outside the repo, such as vibe coding sessions or the Kiro IDE.

## Challenges

- **No streaming server for the clock.** Making the whole station a pure function of time meant every edge had to be exact: Los Angeles days that are 23, 24 or 25 hours long, no repeats in 24 hours, strict tiling with no gaps or overlaps.
- **Talk-ups that never hit a vocal.** The first detector failed on real music and fell back to a default for every song. The `talkup-bugfix` spec came out of that.
- **Phones.** Web Audio is suspended when a page is hidden. The `/stream` mix and a plain audio element fixed lock screen and background playback. iPhone silent switch and call resume also needed their own fixes.
- **A dial under a thumb.** A phone pixel is about 3 kHz, so the station flickered on and off. A magnet snap toward 1714 and lock hysteresis fixed it.
- **Hidden things that stay hidden.** A test fails the build if a hidden frequency ever appears in the web client code.

[NEED] Ryan's biggest personal challenge, in his words.

## Accomplishments that we're proud of

- A station that is a pure function of the clock, held together by property-based tests with fast-check.
- 1,101 original songs, loudness matched, on air with a DJ that reads their titles like letters.
- A DJ voice that is my own cloned voice, rendered locally, so voice costs nothing per month.
- Hidden signals, a request line and a Logbook with no accounts. Progress stays on your device.
- It is live now, installable, and plays on a locked phone.

[NEED] Numbers Ryan wants to claim (hours of audio, voice lines, test counts) beyond what is in the repo. Current test counts from a fresh clone: station 91, web 27, library 30 (2 skipped).

## What we learned

- Specs with correctness properties catch real bugs. Plain example tests did not catch the talk-up detector failure. A spec that said "every song" did.
- Steering is where the character lives. Putting Dead John in an always-included file kept every line, every script and every feature in his voice.
- A deterministic design is easier to test and to explain than a stateful server.
- Reviewing the agent's output against real data matters. Some findings were wrong, and the source was the judge.

[NEED] Ryan's own lessons from working with Kiro.

## What's next

- More hidden stations and more Dead John lines, each picked from four takes.
- More time-of-day bits, so the station feels different at 4 PM than at 4 AM.
- [NEED] Anything Ryan wants to say about the album, live shows or the release plan.

## Built with

- TypeScript (strict), Node.js 22
- Kiro: specs, steering, hooks and an MCP server
- Vite, vanilla DOM, Web Audio API, Media Session API, web app manifest
- Express (station server), `@modelcontextprotocol/sdk`, zod
- vitest, fast-check (property-based tests), Playwright (smoke test, skipped by default), jsdom
- ffmpeg (analysis, loudness normalization, MP3 encoding, the live stream mix)
- Python for the request line studio worker and the demo capture tools
- Qwen3-TTS and Whisper, run locally, for Dead John's voice and the check on each take
- Cloudflare tunnel for hosting at deadair.nohumannearby.com (the station runs from the author's machine)

[NEED] Confirm the hosting description above with Ryan. `tech.md` lists Cloudflare Workers and R2, but the code runs an Express server behind a tunnel.

## Music rights

All music in DEAD AIR is original, written and recorded by NoBanks Nearby. The artist is a BMI member and owns every track. The music is not covered by the MIT code license.

## Links

- Live site: https://deadair.nohumannearby.com
- Source: https://github.com/NoBanks/dead-air
- Demo video (YouTube, under 3 minutes): [NEED]
- Kiro artifacts: `.kiro/` at the repo root
- Devpost project page: [NEED]
