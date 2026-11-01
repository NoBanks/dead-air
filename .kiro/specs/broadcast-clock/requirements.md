# Broadcast Clock: Requirements

## Context

The station has no streaming server. The schedule is deterministic: given the library, the voicebank, and a station epoch, every listener computes the same timeline from the same clock. The browser asks "what is playing at time T?" and the answer is always the same.

The core lives in `/station`, a small TypeScript package later deployed as a Cloudflare Worker. The core must be pure and runtime-agnostic: no `fs`, no Node APIs, no `Date.now`, no `Math.random`.

## EARS Notation Key

- **[UB]** Ubiquitous: the system shall always...
- **[EV]** Event-driven: when X occurs, the system shall...
- **[ST]** State-driven: while in state X, the system shall...
- **[OPT]** Optional feature: where supported, the system shall...

---

## Requirements

### REQ-1: Schedule Function Signature

**[UB]** The system shall expose a pure function `schedule(library, voicebank, epoch, fromMs, toMs)` that returns an ordered array of non-overlapping `Segment` objects whose combined time range covers the half-open interval `[fromMs, toMs)` exactly, with no gaps.

- `epoch` is the Unix timestamp (ms) of station day 0, midnight `America/Los_Angeles`.
- `fromMs` and `toMs` are milliseconds elapsed since `epoch`.
- The function takes no other inputs and reads no external state.

---

### REQ-2: Determinism

**[UB]** The system shall produce byte-identical output when `schedule` is called twice with the same arguments.

- The system shall use a seeded PRNG keyed by the station day index (integer days since epoch) for any randomized ordering or placement.
- The system shall never call `Math.random`, `Date.now`, `performance.now`, or any platform clock inside the core module.

---

### REQ-3: Song No-Repeat Window

**[UB]** The system shall not schedule the same song twice within any 24-hour window of station time (`America/Los_Angeles`).

- The library is partitioned into two fixed halves by a stable hash of track ID (half = `hash(id) mod 2`).
- Day D uses only half (D mod 2).
- Consecutive station days use disjoint halves, guaranteeing no song repeats within 24 hours by construction.
- If a day's half runs out of songs before the day is full, continue with a second shuffle of the same half, skipping songs already used that day.

---

### REQ-4: Break Cadence

**[UB]** After every 2 to 3 songs, the system shall insert a Dead John break: one or more voice clips from the voicebank.

- A break consists of: an optional back-sell clip for the song just played, then one body clip (`drop`, `break`, `marty`, `sponsor`, `caller`, `storm`), then an optional front-sell or tease clip.
- Clip selection within a break uses the day-keyed PRNG so it is deterministic.
- No clip kind shall repeat back-to-back across consecutive breaks.

---

### REQ-5: Hourly Station ID

**[EV]** When a new hour begins in station time (`America/Los_Angeles`), the system shall include a `kind: "id"` clip from the voicebank within the first song of that hour.

- The ID is inserted as a break segment, not over the music. It may be attached to the break before or after the hour boundary song, whichever keeps it closest to the top of the hour.
- On DST transition days the system shall still emit exactly one ID per clock hour.

---

### REQ-6: Featured Song Talk-Up

**[EV]** When the library entry for a scheduled song has a matching entry in `featured.json`, the system shall use the clip referenced by `setup_clip_id` as the talk-up for that song.

- The `setup` clip shall be scheduled so that it ends at exactly `song_start_ms + talkup_seconds * 1000`, overlapping the song's intro.
- The `setup` clip shall not extend past `song_start_ms + (talkup_seconds - 500) ms` of the post.

**[EV]** For non-featured songs, the system shall attach a generic `talkup` clip only if `clip.seconds * 1000 <= (song.talkup_seconds - 0.5) * 1000`.

---

### REQ-7: Clip Non-Overlap

**[UB]** No two clips shall overlap each other in time. A clip shall not begin before the previous clip ends.

- Clips within a break are packed sequentially with no gap smaller than 0 ms and no overlap.
- A talk-up clip over a song intro shall be verified against `talkup_seconds` before being scheduled; if it does not fit it is dropped silently.

---

### REQ-8: Midnight Numbers Station

**[EV]** When station time crosses midnight (`00:00 America/Los_Angeles`), the system shall insert a segment of `kind: "numbers"` beginning at the exact midnight boundary.

- The `numbers` segment is a placeholder: it has a fixed duration of 180 seconds.
- No music or voice clips shall overlap the `numbers` segment.

---

### REQ-9: EBS Tone

**[UB]** The system shall schedule exactly one segment of `kind: "ebs"` per station night, placed at a deterministic pseudo-random point between `01:00` and `04:00` station time.

- The placement uses the day-keyed seeded PRNG (REQ-2); the result must be the same on every call for the same station day.
- The `ebs` segment has a fixed duration of 30 seconds.
- No music or voice clips shall overlap the `ebs` segment.

---

### REQ-10: `nowPlaying` and HTTP Handler

**[EV]** When called with a wall-clock time `at` (ms), `nowPlaying(at)` shall return:

```ts
{ segment: Segment, offsetMs: number, next: Segment[] }
```

where `next` contains the following 5 segments in order and `offsetMs` is the number of milliseconds elapsed since `segment.startMs`.

**[EV]** When the HTTP handler receives `GET /now?t=<ms>` (or omitting `t`, using server time), it shall return:

```json
{ "server_time": <ms>, "segment": {...}, "offset_ms": <n>, "next": [...] }
```

with `Content-Type: application/json` and `Cache-Control: max-age=5`. The handler shall be stateless: it derives its response entirely from the clock and the loaded data files.

---

### REQ-11: Performance

**[UB]** Computing `nowPlaying` for any wall-clock time within 10 years of the station epoch shall complete in under 50 ms on a modern single CPU core.

- The implementation shall not simulate every day from the epoch forward to reach an arbitrary day.
- Each station day is computed independently from its day index using the alternating halves design (REQ-3). No history from previous days is needed.
- Day generation is O(library.length) for one shuffle and segment layout, constant in the day index itself.
- Lookup of a time T to the containing day is O(1) arithmetic; segment lookup within a day is O(log(segments)).

