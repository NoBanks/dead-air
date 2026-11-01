# Broadcast Clock: Tasks

## Review Round 2 Fixes

- [x] **T-R1** Replace `src/core/tzoffsets.ts` with Intl-based helpers: `stationDayStart(utcMs)`, `stationDayEnd(utcMs)`, `stationDayIndex(utcMs, epochMs)`, `stationDayStartByIndex(d, epochMs)`, `stationHourOf(utcMs)`. No baked table. Correct for all DST transitions including 25 h and 23 h days. (D1, D2)

- [x] **T-R2** Add `talkup?: { clipId, file, text, startOffsetMs }` to `SongSegment` and `truncated?: true` to `SongSegment` in `types.ts`. (D3, D4, D5)

- [x] **T-R3** Rewrite `src/core/day.ts` with the exact algorithm in the Review Round 2 design: strict tiling, correct LA midnight/EBS times, hourly IDs, featured talk-ups, break variety, truncated final segment. Assert tiling invariant at end of `generateDay`. (D1–D5)

- [x] **T-R4** Rewrite `src/core/nowPlaying.ts` to work entirely in absolute UTC ms: call `generateDay` directly, use `stationDayIndex(at, epochMs)`, binary-search segments, fetch day+1 for next[]. Remove the silent fallback. Empty library throws. (D6)

- [x] **T-R5** Remove `schedule.ts` dependency from `nowPlaying.ts`. Keep `schedule.ts` for the HTTP handler window calls only.

- [x] **T-R6** Rewrite tests: strict tiling property (P-1) including 2026-11-01 (25 h) and 2027-03-14 (23 h); numbers at LA midnight (P-8); EBS in 01:00–04:00 LA (P-9); IDs within one segment after each hour (P-5); talk-up endMs correct (P-6); nowPlaying(T)/nowPlaying(T+1000) same or adjacent (P-10); p95 < 50 ms over 1000 calls in 10-year window (P-11). Add `tests/tz.test.ts` for the Intl helpers. All 25 tests pass.

- [x] **T-1** Scaffold the `/station` package: `package.json` (name `"station"`, `"type": "module"`), `tsconfig.json` targeting ESNext with `"moduleResolution": "bundler"`, no Node type references in the core. Create `src/core/` and `src/dev-server.ts` directories. Add `vitest`, `fast-check`, and `express` as dependencies. (REQ-1, REQ-11)

- [x] **T-2** Write `src/core/types.ts`: `Track`, `VoiceClip`, `ClipKind`, `Voicebank`, `FeaturedEntry`, `Segment` union (`SongSegment`, `VoiceSegment`, `NumbersSegment`, `EbsSegment`), `DaySchedule` (no tailIds), `NowPlayingResult`. No runtime code; types only. (REQ-1)

- [x] **T-3** Write the `data/voicebank.json` schema stub: an empty `{ "clips": [] }` file at the project root `data/` with the shape matching `Voicebank` in `types.ts`. Write `data/featured.json` as `[]`. These are real data files; the spec only creates the empty stubs. (REQ-6)

## Core: PRNG and time utilities

- [x] **T-4** Write `src/core/prng.ts`: export `mulberry32(seed: number): () => number`. Pure, no imports. Export `daySeed(epoch: number, dayIndex: number): number` using a fixed mixing step so every day index produces a unique seed. Export `hashTrackId(id: string): number` for stable half-partition hashing. (REQ-2)

- [x] **T-5** Write `src/core/tzoffsets.ts`: a compile-time-baked lookup table of `America/Los_Angeles` UTC offsets for years epoch through epoch + 12, covering DST transitions. Export `stationMidnights(epochMs: number, count: number): number[]` returning UTC ms of each station midnight, and `stationHour(utcMs: number, epochMs: number): number` returning the hour-of-day (0..23) in station time. No `Intl`, no Node APIs. (REQ-3, REQ-5, REQ-8, REQ-9)

## Core: Day generation

- [x] **T-6** Write `src/core/day.ts`: export `generateDay(dayIndex, library, voicebank, featured)` implementing the alternating halves design. Compute `half = dayIndex mod 2`, filter library to that half by stable hash, shuffle with day's PRNG seed, layout the day with the cursor loop. Handles break cadence, EBS, midnight numbers, hourly IDs. Returns `DaySchedule` (no tail carry-over). (REQ-2, REQ-3, REQ-4, REQ-8, REQ-9)

- [x] **T-7** Add talk-up scheduling to `generateDay`: for featured songs insert the `setup` clip aligned to `talkup_seconds`; for non-featured songs find a fitting `talkup` clip or skip. Enforce the 0.5 s safety margin. (REQ-6, REQ-7)

- [x] **T-8** Add hourly station ID logic to `generateDay`: detect hour boundaries in station time as the cursor advances; attach a `kind: "id"` clip to the next break. Handle DST days (23 h and 25 h). (REQ-5)

## Core: schedule and nowPlaying

- [x] **T-9** Write `src/core/schedule.ts`: export `schedule(library, voicebank, featured, epoch, fromMs, toMs)`. Converts the ms-since-epoch window to UTC day indices, calls `generateDay` for each needed day (each independent, no history needed), filters and returns segments overlapping the window, sorted by `startMs`. (REQ-1, REQ-11)

- [x] **T-10** Write `src/core/nowPlaying.ts`: export `nowPlaying(library, voicebank, featured, epoch, at)`. Calls `schedule` for a 2-hour window, locates the segment containing `at`, returns `{ segment, offsetMs, next }` with exactly 5 items in `next`. Handles edge cases per the error-handling table in the design doc. (REQ-10)

## HTTP handler and dev server

- [x] **T-11** Write `src/core/handler.ts`: export `handleRequest(request, env)`. Parses `?t=`, calls `nowPlaying` with `env.epoch` and injected time, returns JSON with `Cache-Control: max-age=5`. Returns 400 on bad input, 500 on errors. Uses only Web API globals (`Request`, `Response`, `URL`). (REQ-10)

- [x] **T-11b** Write `src/dev-server.ts`: a thin Node express server (windowsHide on child process) that loads `data/library.json`, `data/voicebank.json`, `data/featured.json`, serves them via `GET /now?t=<ms>` using the `handleRequest` from core. Listens on port 8787. Used for local testing only. (REQ-10)

## Property-based tests

- [x] **T-12** Write `tests/schedule.property.test.ts` using `fast-check`. Cover properties P-1 through P-3: for any `fromMs`/`toMs`, segments tile time with no gaps or overlaps; no song repeats within 24 h. Run with `npm run test -- --run`. (REQ-1, REQ-2, REQ-3)

- [x] **T-13** Write the remaining property tests in the same file. Cover P-4 through P-9: break cadence, hourly ID within first song of each hour (including DST days), talk-up never past the post, no clip-clip overlap, midnight numbers segment presence and timing, EBS within 01:00-04:00 exactly once per night. (REQ-4, REQ-5, REQ-6, REQ-7, REQ-8, REQ-9)

- [x] **T-14** Write `tests/nowPlaying.test.ts`. Cover P-10: `offsetMs` identity, `next` has exactly 5 elements, `nowPlaying(T)` and `nowPlaying(T + 1000)` are consistent (same segment or adjacent). Cover P-11: benchmark 1000 calls across random times within a 10-year window and assert all complete under 50 ms total wall time. (REQ-10, REQ-11)

- [x] **T-15** Create valid stubs: `data/voicebank.json` with a handful of real clips (signon, id, drop, talkup, backsell, setup); `data/featured.json` with one song linked to a setup clip. Write `src/core/index.ts` re-exporting the public surface. Run `npm run test -- --run`, confirm green. Report test counts, p95 time of `nowPlaying` over 1,000 random times in 10-year window, and a sample `/now` JSON. (REQ-1 through REQ-11)
