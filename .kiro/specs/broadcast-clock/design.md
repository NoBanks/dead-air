# Broadcast Clock: Design

## Package Layout

```
/station
  package.json          (name: "station", type: "module")
  tsconfig.json
  src/
    types.ts            data shapes, Segment union, ScheduleResult
    prng.ts             seeded PRNG (mulberry32, pure)
    day.ts              generateDay(dayIndex, library, voicebank, featured, tail) -> DaySchedule
    schedule.ts         schedule(library, voicebank, epoch, fromMs, toMs) -> Segment[]
    nowPlaying.ts       nowPlaying(library, voicebank, featured, epoch, at) -> NowPlayingResult
    handler.ts          fetch handler: GET /now?t=<ms> (Cloudflare Worker compatible)
    index.ts            re-exports public surface
  tests/
    schedule.property.test.ts   (fast-check)
    nowPlaying.test.ts
    day.test.ts
```

No file is allowed to import `fs`, `path`, `os`, `process`, or any Node-specific module. `handler.ts` may use the Web `Request`/`Response` globals only.

---

## Data Schemas

### `data/library.json` (existing)

```ts
interface Track {
  id: string;           // slug, unique
  slug: string;
  title: string;
  seconds: number;      // total duration
  talkup_seconds: number; // length of instrumental intro before the post
  lufs: number;         // integrated loudness of the encoded MP3
  made_at: string;      // ISO 8601, optional creative metadata
  mp3: string;          // URL path e.g. "/audio/title.mp3"
}
```

### `data/voicebank.json` (new, defined here)

```ts
type ClipKind =
  | "signon"    // "I'm Dead John, coming to you LIVE..."
  | "id"        // station ID, 1714 AM / DEAD AIR
  | "drop"      // short atmospheric line, no song reference
  | "talkup"    // generic talk-up over intro (no song reference)
  | "backsell"  // names the song just played
  | "setup"     // hand-made talk-up for one specific song, carries song_id
  | "break"     // full break body (weather, check-in, etc.)
  | "storm"     // "the night the storm..." running bit
  | "marty"     // Marty the engineer bit
  | "sponsor"   // fake defunct sponsor ad
  | "caller"    // request-line caller bit
  | "signal"    // Emergency Broadcast / numbers-station hand-off line

interface VoiceClip {
  id: string;           // unique slug e.g. "backsell-heal-my-mind-01"
  kind: ClipKind;
  text: string;         // the line Dead John says (used for review / subtitles)
  seconds: number;      // rendered duration at -16 LUFS
  file: string;         // URL path e.g. "/voice/backsell-heal-my-mind-01.mp3"
  song_id?: string;     // present only on kind "setup" and "backsell"
}

interface Voicebank {
  clips: VoiceClip[];
}
```

### `data/featured.json` (new, defined here)

```ts
interface FeaturedEntry {
  song_id: string;      // matches Track.id
  setup_clip_id: string; // matches VoiceClip.id where kind === "setup"
}

type Featured = FeaturedEntry[];
```

---

## Segment Union

```ts
interface BaseSegment {
  startMs: number;  // ms since epoch
  endMs: number;    // ms since epoch, exclusive
}

interface SongSegment extends BaseSegment {
  kind: "song";
  trackId: string;
  title: string;
  mp3: string;
}

interface VoiceSegment extends BaseSegment {
  kind: "voice";
  clipId: string;
  clipKind: ClipKind;
  text: string;
  file: string;
}

interface NumbersSegment extends BaseSegment {
  kind: "numbers";
}

interface EbsSegment extends BaseSegment {
  kind: "ebs";
}

type Segment = SongSegment | VoiceSegment | NumbersSegment | EbsSegment;
```

---

## PRNG

`mulberry32(seed: number): () => number`

A well-known, pure, single-integer-seeded 32-bit PRNG. Produces a float in [0, 1). No external dependencies. Seed for station day D: `epoch_day_seed ^ D` where `epoch_day_seed` is derived from the epoch ms with a fixed mixing step. This guarantees different days always produce different sequences regardless of epoch value.

---

## Day Generation (`day.ts`)

### Review Round 2

Six defects were found in the Round 1 implementation. None broke tests (tests were too weak) but all would cause on-air problems.

**D1. Station days were UTC 24h blocks, not LA calendar days.** `stationDayStart` and `stationDayEnd` returned `epoch + d * 86400000` ignoring timezone offset, so the numbers segment started at UTC midnight instead of LA midnight. Fixed: `stationDayStart(d)` and `stationDayEnd(d)` are computed from `Intl.DateTimeFormat` midnight boundaries.

**D2. DST table used a coarse month heuristic.** The old `tzoffsets.ts` approximated PDT as "April–October", misclassifying late March and early November (e.g. Nov 1 2026 is the fall-back day, 25 hours long, and would have been treated as PDT). Replaced entirely with `Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour12: false, ... })` helpers: `stationDayStart(utcMs)`, `stationDayEnd(utcMs)`, `stationDayIndex(utcMs)`, `stationHourOf(utcMs)`. Intl is available in Cloudflare Workers, so the core remains runtime-agnostic.

**D3. Dead air gaps.** When a song would have overlapped the EBS the cursor jumped forward, leaving silence. When the half ran out of songs the rest of the day was empty. `nowPlaying` papered over this with a fake "silent" segment. Fixed: the timeline is a strict tiling — every segment's `startMs` equals the previous `endMs`, first starts at `dayStart`, last ends at `dayEnd`. Song truncated at EBS continues after EBS. The final segment of the day is truncated with `truncated: true`. If the shuffled half runs out, reshuffle it with a derived seed and continue (tiny-library edge case).

**D4. Last song overlapped the next day's numbers segment.** A song starting near `dayEnd` would run past it. Fixed by strict tiling: songs are clipped to `dayEnd` with `truncated: true`.

**D5. Top-of-hour IDs were unimplemented; featured talk-ups were unimplemented.** Both are now implemented. Talk-ups are a field on `SongSegment` (not separate segments) so they never affect the strict tiling: `talkup?: { clipId, file, text, startOffsetMs }`. Featured songs use their `setup` clip if it fits within `talkup_seconds`. Non-featured songs get a random `talkup` clip if `clip.seconds <= talkup_seconds - 0.5`.

**D6. `nowPlaying` mixed relative and absolute times.** The `schedule()` call received epoch-relative `fromMs/toMs` but `at` was absolute UTC. The window arithmetic was off on days far from the epoch. Fixed: `nowPlaying` now calls `generateDay` directly (no `schedule` wrapper), working entirely in absolute UTC ms.

---

### Revised Algorithm (implement exactly this)

#### Timezone helpers (`tzoffsets.ts`)

```ts
// All return absolute UTC ms
stationDayStart(utcMs: number): number  // UTC ms of the LA midnight <= utcMs
stationDayEnd(utcMs: number): number    // UTC ms of the LA midnight > utcMs
stationDayIndex(utcMs: number): number  // integer LA calendar day index since epoch
stationHourOf(utcMs: number): number    // LA hour-of-day 0..23
```

Implemented via `Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour12: false, ... })`. Pure, no side effects, no caching needed (Intl is fast).

#### `SongSegment` with embedded talk-up

```ts
interface SongSegment extends BaseSegment {
  kind: "song";
  trackId: string;
  title: string;
  mp3: string;
  truncated?: true;      // true only for last segment of the day
  talkup?: {
    clipId: string;
    file: string;
    text: string;
    startOffsetMs: number; // ms from song.startMs; may be negative (featured setup longer than gap before song)
  };
}
```

Talk-ups do not create separate segments and do not affect the cursor.

#### `generateDay(dayIndex, library, voicebank, featured)` exact algorithm

```
dayStart = stationDayStart(epoch + dayIndex * NOMINAL_DAY)
dayEnd   = stationDayEnd(dayStart + 1000)  // +1s to land inside the same LA day

seed = daySeed(epochMs, dayIndex)
prng = mulberry32(seed)

// Deterministic EBS time for this night: between 01:00 and 04:00 LA
ebsHour = stationHourOf(dayStart + 1h)  // should be 1
ebsMs   = dayStart + 1h + floor(prng() * 3h)   // prng() call #1

// Shuffled half-library
half        = dayIndex mod 2
halfLib     = library.filter(t => hashTrackId(t.id) === half)
shuffled    = shuffle(halfLib, prng)           // uses prng calls #2..N
songQueue   = [...shuffled]
reshuffleCount = 0

breakCountdown = pick(prng, [2, 3])   // 2 or 3, prng call after shuffle
songsSinceBreak = 0
pendingId   = false   // true once we pass an hour boundary with no ID aired
lastHour    = stationHourOf(dayStart)

segments = []
cursor   = dayStart

// Numbers station: first 60 s of the day (reduced from 180 to avoid killing a full 3-minute song)
push NumbersSegment [cursor, cursor + 60_000)
cursor += 60_000

loop until cursor >= dayEnd:
  // 1. Check for new hour crossing and pending ID
  currentHour = stationHourOf(cursor)
  if currentHour != lastHour:
    lastHour   = currentHour
    pendingId  = true

  // 2. If pendingId, insert an "id" clip immediately
  if pendingId:
    idClip   = pick(prng, voicebank.clips.filter(c => c.kind === "id"))
    if idClip and cursor + idClip.seconds*1000 <= dayEnd:
      push VoiceSegment [cursor, cursor + idClip.seconds*1000)
      cursor += idClip.seconds*1000
    pendingId = false

  // 3. EBS: if cursor has just entered or passed ebsMs and EBS not yet aired
  if !ebsPlaced and cursor >= ebsMs:
    push EbsSegment [cursor, cursor + 30_000)
    cursor += 30_000
    ebsPlaced = true

  if cursor >= dayEnd: break

  // 4. Song
  song = dequeue(songQueue, reshuffleCount, prng, usedToday)
  songStart = cursor
  songEnd   = min(songStart + song.seconds*1000, dayEnd)
  truncated = songEnd < songStart + song.seconds*1000

  // Assign talk-up
  talkup = assignTalkup(song, featured, voicebank, prng)

  push SongSegment [songStart, songEnd, talkup?, truncated?]
  usedToday.add(song.id)
  cursor = songEnd
  songsSinceBreak++

  if truncated: break  // hit end of day

  // 5. Break (after every 2-3 songs)
  if songsSinceBreak >= breakCountdown:
    breakClip = pick(prng, voicebank.clips.filter(c => breakKinds.includes(c.kind)))
    if breakClip and cursor + breakClip.seconds*1000 <= dayEnd:
      push VoiceSegment [cursor, cursor + breakClip.seconds*1000)
      cursor += breakClip.seconds*1000
    breakCountdown    = pick(prng, [2, 3])
    songsSinceBreak   = 0

assert segments[0].startMs === dayStart
assert segments[last].endMs === dayEnd
assert all consecutive pairs: segments[i].endMs === segments[i+1].startMs
```

#### `nowPlaying(at)` algorithm

```
d       = stationDayIndex(at)
day     = generateDay(d, ...)
if at >= day.endMs: day = generateDay(d+1, ...)

seg     = binarySearch(day.segments, at)
next    = up to 5 segments after seg;
          if fewer than 5 remain in this day, append from generateDay(d+1)
```

All times are absolute UTC ms. No epoch-relative arithmetic in `nowPlaying`.

### Review Round 1

Original design required day D to carry over tail from day D-1, which needed D-2, recursing to the epoch. This is O(days since epoch) and violates REQ-11 (sub-50ms performance for times 10 years in future). 

**Alternating Halves Design:** partition the library into two fixed halves by hash of track ID. Day D uses only half (D mod 2). Each day is a fresh PRNG-shuffled shuffle of its half. No history needed: O(1) per day. Consecutive days use disjoint halves, so no song repeats within 24 h: REQ-3 is satisfied by construction. Edge case: if a half has fewer songs than fit in a day, continue with a second shuffle of the same half, skipping songs played in the last 24 h of that day (covered by integration test).

A "station day" is the interval `[midnight_LA, next_midnight_LA)` in UTC ms. Days can be 23 h or 25 h due to DST.

```
generateDay(
  dayIndex: number,
  library: Track[],
  voicebank: Voicebank,
  featured: Featured
) -> DaySchedule
```

No tail parameter. Song selection uses `dayIndex mod 2` to pick the half.

```ts
interface DaySchedule {
  dayIndex: number;
  startMs: number;    // UTC ms of station midnight
  endMs: number;      // UTC ms of next station midnight
  segments: Segment[];
}
```

No tailIds field.

### Song selection (Alternating Halves)

1. Compute `half = dayIndex mod 2`.
2. Filter library to tracks where `hash(track.id) mod 2 === half` (stable hash; use murmur3 or similar, not Math.random).
3. Shuffle this half with the day's PRNG seed.
4. Draw from the shuffled queue in order. If the queue runs out before the day ends, reshuffle the same half again with a sub-seed (`daySeed XOR 1`), skip any songs already played in this day, continue. This keeps the day finite and deterministic.

### Day layout algorithm

```
cursor = dayStartMs
songCount = 0
breakCountdown = pick(prng, [2, 3])   // songs until next break

while cursor < dayEndMs:
  if cursor == midnight: insert numbers segment (180 s), advance cursor
  if ebs not placed and cursor in [01:00, 04:00]: maybe place ebs at prng-chosen offset

  song = nextSong()
  schedule song at cursor
  songCount++
  cursor += song.seconds * 1000

  if songCount >= breakCountdown:
    schedule break starting at cursor
    cursor += break duration
    breakCountdown = pick(prng, [2, 3])

  if hourBoundary crossed since last id: mark hourly id needed, attach to next break
```

This runs only once per day index. The `schedule()` function calls `generateDay` only for the days that overlap `[fromMs, toMs)`, at most `ceil((toMs - fromMs) / minDayMs) + 1` days.

### Hourly ID placement

When the cursor crosses an hour boundary in `America/Los_Angeles`, the flag `pendingHourlyId` is set. It is discharged by inserting a `kind: "id"` clip at the start of the next break. DST is handled by converting each cursor position with a timezone-aware offset table baked into the module (no Intl API dependency required in the core; the handler may use Intl).

### Talk-up scheduling

For a song with a `featured.json` entry:
- Retrieve the `setup` clip.
- If `clip.seconds <= song.talkup_seconds - 0.5`: schedule clip so it ends at `song.startMs + song.talkup_seconds * 1000`. Clip start = `song.startMs + (song.talkup_seconds - clip.seconds) * 1000`.
- If clip is too long: skip talk-up silently (the song still plays).

For a non-featured song:
- Find an unused `talkup` clip from voicebank where `clip.seconds <= song.talkup_seconds - 0.5`.
- If one is found: schedule it with the same alignment as above.
- If not: no talk-up for this song.

Talk-up segments are inserted into `segments[]` at the correct sorted position; they do not advance the main `cursor` (they overlap the song intro).

---

## `schedule()` (`schedule.ts`)

```ts
function schedule(
  library: Track[],
  voicebank: Voicebank,
  featured: Featured,
  epoch: number,    // UTC ms
  fromMs: number,   // ms since epoch
  toMs: number      // ms since epoch
): Segment[]
```

1. Convert `fromMs`/`toMs` to absolute UTC by adding `epoch`.
2. Determine which station day indices are needed.
3. Compute each day: `generateDay(d, library, voicebank, featured)`. Each day is independent, O(1) per day, no history needed.
4. Filter segments to those overlapping `[fromMs + epoch, toMs + epoch)`.
5. Return sorted by `startMs`.


---

## `nowPlaying()` (`nowPlaying.ts`)

```ts
function nowPlaying(
  library: Track[],
  voicebank: Voicebank,
  featured: Featured,
  epoch: number,
  at: number   // UTC ms (wall clock, injected by caller)
): { segment: Segment; offsetMs: number; next: Segment[] }
```

Calls `schedule` for a 2-hour window centered on `at` (1 h before, 1 h after), which is always enough to return the current segment and 5 ahead. Returns the first segment where `segment.startMs <= at < segment.endMs`, `offsetMs = at - segment.startMs`, and the next 5.

---

## HTTP Handler (`handler.ts`)

```ts
export async function handleRequest(
  request: Request,
  env: { library: Track[]; voicebank: Voicebank; featured: Featured; epoch: number }
): Promise<Response>
```

- Parses `?t=` as `number`; falls back to `Date.now()` (injected as a parameter in tests, using real `Date.now()` only at the edge boundary in the Worker entry point).
- Calls `nowPlaying`.
- Returns `Response` with `Content-Type: application/json`, `Cache-Control: max-age=5`.
- On parse error: 400. On any thrown error: 500 with a plain message.

---

## Error Handling

| Condition | Behavior |
|---|---|
| `library` is empty | `schedule` returns `[]` |
| `voicebank.clips` is empty | No voice segments; music-only schedule |
| `fromMs >= toMs` | Returns `[]` |
| `setup_clip_id` in `featured.json` not found in voicebank | Log warning (stderr in Node, `console.warn` in Worker); treat as non-featured |
| Talk-up clip too long for intro | Drop silently; song still plays |
| `nowPlaying` called with `at` before `epoch` | Returns first segment of day 0 with `offsetMs: 0` |
| `?t=` is not a finite number | Use server time |

---

## Correctness Properties (numbered, tied to requirements)

**P-1** (REQ-1): For any `fromMs < toMs`, the segments returned by `schedule` form a contiguous, non-overlapping cover of `[fromMs + epoch, toMs + epoch)`. Formally: `segments[0].startMs <= fromMs + epoch`, `segments[last].endMs >= toMs + epoch`, and for all consecutive pairs `segments[i].endMs === segments[i+1].startMs`.

**P-2** (REQ-2): `schedule(L, V, F, e, f, t)` called twice with identical arguments produces arrays that are deep-equal. No segment field differs between calls.

**P-3** (REQ-3): No two `SongSegment`s within any 24-hour window of station time have the same `trackId`. This is satisfied by construction: day D uses library half `D mod 2`, and consecutive days use disjoint halves.

**P-4** (REQ-4): Between any two `SongSegment`s that are separated by 2 or 3 songs, there exists at least one `VoiceSegment` with a `clipKind` of `drop`, `break`, `marty`, `sponsor`, `caller`, or `storm`.

**P-5** (REQ-5): For every UTC hour boundary H (in `America/Los_Angeles`) that falls within the schedule window, there exists a `VoiceSegment` with `clipKind === "id"` whose `startMs` is within the duration of the first song after H.

**P-6** (REQ-6 + REQ-7): For every `VoiceSegment` that is a talk-up (overlapping a `SongSegment`'s intro), `voiceSegment.endMs <= songSegment.startMs + (song.talkup_seconds - 0.5) * 1000`.

**P-7** (REQ-7): No two `VoiceSegment`s overlap: for all pairs i < j, `segments[i].endMs <= segments[j].startMs`.

**P-8** (REQ-8): For every station midnight M in the window, exactly one `NumbersSegment` exists with `startMs === M` and `endMs === M + 180_000`.

**P-9** (REQ-9): For every station night, exactly one `EbsSegment` exists; its `startMs` falls in `[01:00, 04:00)` station time; its `endMs === startMs + 30_000`; it does not overlap any other segment.

**P-10** (REQ-10): `nowPlaying(at).offsetMs === at - nowPlaying(at).segment.startMs` and `nowPlaying(at).next` has exactly 5 elements, all starting after the current segment.

**P-11** (REQ-11): The wall-clock duration of `nowPlaying(at)` is under 50 ms for any `at` within 10 years of `epoch`, measured in a benchmark harness.
