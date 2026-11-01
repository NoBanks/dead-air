# Tuner-Player: Design

## Package Layout

```
/web
  index.html              Entry point. Single <script type="module">.
  package.json            name: "web", type: "module", vite dev/build scripts.
  tsconfig.json           Strict TypeScript, target ES2022, lib: ["DOM","ES2022"].
  vite.config.ts          Build config. Static output to /web/dist.
  src/
    main.ts               Bootstrap: creates AudioContext on gesture, wires modules.
    dial.ts               Dial geometry, input handling, frequency state.
    static-gen.ts         Static noise generator (Web Audio nodes, never a file).
    player.ts             Segment scheduler, clock sync, buffer loading, playback.
    audio-graph.ts        Web Audio graph construction and bus management.
    duck.ts               Music ducking: gain automation helpers.
    clock.ts              NTP-style server offset estimation and drift correction.
    signal.ts             GET /signal fetch helper, hidden frequency cache.
    now-playing-ui.ts     Now playing card DOM updates.
    media-session.ts      Media Session API metadata updates.
    types.ts              Client-side type aliases (re-uses station Segment types).
    constants.ts          FREQ_MIN, FREQ_MAX, STATION_FREQ, DRAG_FACTOR, etc.
  tests/
    dial.test.ts          Unit tests: freq-to-position math, round-trip property.
    clock.test.ts         Unit tests: offset estimation, median robustness property.
    duck.test.ts          Unit tests: gain envelope at the post.
```

No UI framework. All DOM manipulation is direct. Each file does one thing.

---

## Constants (`constants.ts`)

```ts
export const FREQ_MIN    = 520;    // kHz
export const FREQ_MAX    = 1740;   // kHz
export const STATION_FREQ = 1714;  // kHz, always trusted
export const LOCK_THRESHOLD = 10;  // kHz, snap radius
export const DRAG_FACTOR  = 0.3;   // kHz per pixel
export const LOCK_FADE_S  = 1.2;   // seconds, static fade on lock
export const DUCK_DB      = -10;   // dB, music reduction under voice
export const DUCK_ATTACK_S  = 0.25;  // seconds
export const DUCK_RELEASE_S = 0.60;  // seconds
export const PRELOAD_AHEAD_S = 20;   // seconds before segment end
export const RESYNC_INTERVAL_S = 60; // seconds between clock resyncs
export const DRIFT_THRESHOLD_MS = 250; // smooth vs. jump
```

---

## Web Audio Graph

```
                ┌─────────────────────────────────────────────────┐
                │                 AudioContext                     │
                │                                                  │
  AudioBuffer   │  ┌──────────────┐                               │
  SourceNode ──►│  │  music bus   │ GainNode                      │
  (per segment) │  └──────┬───────┘                               │
                │         │                                        │
  AudioBuffer   │  ┌──────▼───────┐                               │
  SourceNode ──►│  │  voice bus   │ GainNode                      │
  (clips)       │  └──────┬───────┘      ┌──────────────────────┐ │
                │         │              │     master chain      │ │
  BufferSource  │  ┌──────▼───────┐      │ ┌──────────────────┐ │ │
  (noise x2) ──►│  │  static bus  │ ─────►│ │  HighpassFilter  │ │ │
                │  └──────────────┘      │ │  @120 Hz          │ │ │
                │                        │ └────────┬─────────┘ │ │
                │                        │ ┌────────▼─────────┐ │ │
                │                        │ │  LowpassFilter   │ │ │
                │                        │ │  @5000 Hz        │ │ │
                │                        │ └────────┬─────────┘ │ │
                │                        │ ┌────────▼─────────┐ │ │
                │                        │ │  WaveShaper      │ │ │
                │                        │ │  (saturation)    │ │ │
                │                        │ └────────┬─────────┘ │ │
                │                        │ ┌────────▼─────────┐ │ │
                │                        │ │  Master Gain     │ │ │
                │                        │ └────────┬─────────┘ │ │
                │                        └──────────┼───────────┘ │
                │                                   │             │
                │                       destination◄┘             │
                └─────────────────────────────────────────────────┘

Clean mode: static bus and music/voice buses bypass the filter chain
and connect directly to the master gain node.
```

### Node construction (`audio-graph.ts`)

`buildGraph(ctx: AudioContext): AudioGraph`

Returns:

```ts
interface AudioGraph {
  musicBus:   GainNode;  // gain: 1.0 (full) or ~0.316 (ducked, -10 dB)
  voiceBus:   GainNode;  // gain: 1.0 always
  staticBus:  GainNode;  // gain: 0.0..1.0, follows distance from station
  master:     GainNode;  // gain: 1.0 always, final output
  setCleanMode(clean: boolean): void;
}
```

The saturation curve is a mild soft-clip: `y = (3/2) * x - (1/2) * x^3`, clipped to [-1, 1]. Baked into a `Float32Array` of 256 points.

---

## Dial Module (`dial.ts`)

### State

```ts
interface DialState {
  freqKHz: number;       // current frequency, clamped [520, 1740]
  locked: boolean;       // true when snapped to a station
  lockedFreq: number;    // the station frequency, if locked
}
```

### Geometry

```ts
// Map frequency to normalized [0, 1] position
function freqToPosition(freq: number): number {
  return (freq - FREQ_MIN) / (FREQ_MAX - FREQ_MIN);
}

// Map normalized position back to frequency
function positionToFreq(pos: number): number {
  return pos * (FREQ_MAX - FREQ_MIN) + FREQ_MIN;
}

// Map pixel delta to frequency delta
function pixelDeltaToFreqDelta(px: number): number {
  return px * DRAG_FACTOR;
}
```

Round-trip property: `Math.abs(positionToFreq(freqToPosition(f)) - f) < 0.001` for any `f` in [520, 1740].

### Input binding

`bindDial(el: HTMLElement, state: DialState, onChange: (freq: number) => void): void`

Attaches:
- `pointerdown` / `pointermove` / `pointerup` for drag (uses `setPointerCapture`).
- `wheel` for scroll tuning.
- `keydown` (ArrowLeft/ArrowRight) for ±10 kHz steps; fires only when the dial has focus.
- `click` for tap-to-jump (pixel offset within element mapped to frequency via `freqToPosition`).

ARIA attributes (`aria-valuenow`) are updated on every frequency change.

---

## Static Generator (`static-gen.ts`)

Two noise channels, each:

```
AudioBufferSourceNode (white noise, loop: true, buffer: 2s of random samples)
  → BiquadFilterNode (bandpass, freq: 600 Hz, Q: 1.5 for main / Q: 0.8 for ghost)
  → GainNode (channel gain, animated by dial position)
  → staticBus GainNode
```

The noise buffers are generated once by filling a `Float32Array` with `Math.random() * 2 - 1` samples. They loop at a prime-length offset so the two channels never phase-align audibly.

`updateStaticGain(distanceKHz: number, graph: AudioGraph, ctx: AudioContext): void`

Converts `distanceKHz` to a gain value (linear interpolation from distance 0 = gain 0, to distance >= 200 kHz = gain 1) and calls `setTargetAtTime` on the static bus with a 50 ms time constant.

---

## Clock Module (`clock.ts`)

### NTP-style offset estimation

```ts
async function estimateOffset(): Promise<number>
```

Sends three sequential GET /now requests. For each:

```
t1 = Date.now()
response = await fetch("/now")
t4 = Date.now()
serverTime = response.server_time
rtt = t4 - t1
offset = serverTime - t1 - rtt / 2
```

Returns the median of the three offset values. Median is robust to one outlier (a slow request).

### Corrected clock

```ts
function correctedNow(offset: number): number {
  return Date.now() + offset;
}
```

### Resync

Every 60 seconds, `estimateOffset()` is called again. If the new offset differs from the stored offset by less than `DRIFT_THRESHOLD_MS`, the stored offset is updated smoothly by lerping over the next 10 seconds (1 s ticks). If the difference is >= 250 ms, the offset is applied immediately (hard resync).

---

## Player Module (`player.ts`)

### Responsibilities

- Maintain a queue of upcoming `Segment` objects.
- For each segment: fetch the MP3, decode it, schedule an `AudioBufferSourceNode` to start at the exact AudioContext time that corresponds to `segment.startMs`.
- Handle talk-ups: schedule the voice clip node and the duck envelope.
- Preload 20 s ahead: when `AudioContext.currentTime + 20 >= scheduledEnd`, fetch and decode the next segment.
- On clock resync: adjust scheduled start times by the delta if the drift is small.

### AudioContext time alignment

```ts
// Map a wall-clock UTC ms to an AudioContext time
function wallToAudioTime(wallMs: number, offset: number, ctx: AudioContext): number {
  const corrected = wallMs + offset;
  const deltaFromNow = corrected - Date.now();
  return ctx.currentTime + deltaFromNow / 1000;
}
```

All source nodes use `source.start(audioTime, bufferOffset)`. The buffer offset is derived from `offsetMs` on the initial join, and 0 for subsequent scheduled segments.

### Segment type routing

| Segment kind | Action |
|---|---|
| `song` | Decode MP3, schedule on music bus. Check for `talkup` field, schedule voice clip + duck. |
| `voice` | Decode MP3, schedule on voice bus. Apply duck to music bus. |
| `numbers` | Play a generated tone sequence (or silence stub) on voice bus. |
| `ebs` | Play EBS tone (generated) on voice bus. |

---

## Duck Module (`duck.ts`)

```ts
interface DuckEnvelope {
  /** Schedule a duck on musicBus starting at audioTime, releasing at postTime. */
  scheduleDuck(
    musicBus: GainNode,
    ctx: AudioContext,
    startAudioTime: number,
    postAudioTime: number
  ): void;
}
```

Implementation:

```
at startAudioTime:
  musicBus.gain.setTargetAtTime(linearFromDb(-10), startAudioTime, DUCK_ATTACK_S / 3)

at postAudioTime - DUCK_RELEASE_S:
  musicBus.gain.linearRampToValueAtTime(1.0, postAudioTime)
```

The release ramp is scheduled so it completes exactly at `postAudioTime`. The gain value at the post equals 1.0 exactly (a `linearRampToValueAtTime` guarantee).

---

## Now Playing Card (`now-playing-ui.ts`)

```ts
function updateCard(segment: Segment, track?: Track): void
```

DOM structure (created once, updated in place):

```html
<div id="now-playing" aria-live="polite">
  <span class="title">...</span>
  <span class="artist">...</span>
  <span class="made-at">...</span>
</div>
```

- Song: title = track.title, artist = "NoBanks Nearby", made-at = formatted month+year from `track.made_at` (if present).
- Voice: title = "Dead John", artist = "", made-at = "".
- Numbers/EBS: card is hidden (`display: none`).
- Transition: CSS `opacity` from 0 to 1 over 200 ms via class toggle. Skipped when `prefers-reduced-motion: reduce`.

---

## Signal Module (`signal.ts`)

```ts
async function checkSignal(freqKHz: number): Promise<boolean>
```

Fetches `GET /signal?f=<freqKHz>`. Returns `true` if the response is 200 with `{ locked: true }`, `false` on 404 or any error. Results are cached in a `Map<number, boolean>` for the session (no re-fetch for the same frequency).

`1714` is hardcoded as `true` and never fetched.

---

## Data Flow

```
User gesture
  └── main.ts: AudioContext.resume()
        └── clock.ts: estimateOffset() x3
              └── player.ts: join broadcast
                    ├── GET /now → NowPlayingResult
                    ├── fetch + decode current segment MP3
                    ├── schedule AudioBufferSourceNode at audioTime
                    ├── if talkup: schedule voice clip + duck
                    └── preload loop (every 1 s)
                          ├── if time to next < 20 s: fetch + decode next
                          └── schedule next source node

Dial input
  └── dial.ts: freqKHz update
        ├── static-gen.ts: updateStaticGain(distance)
        ├── signal.ts: checkSignal(freq) → locked?
        │     ├── yes: player.ts: join broadcast, fade static out
        │     └── no:  player.ts: stop, fade static in
        └── now-playing-ui.ts: updateCard(null) if unlocked

Clock resync (every 60 s)
  └── clock.ts: estimateOffset()
        └── if delta < 250 ms: smooth drift
            else: hard resync, reschedule upcoming nodes
```

---

## Error Handling

| Condition | Behavior |
|---|---|
| GET /now fetch fails | Retry after 2 s, up to 3 times. After 3 failures, show "signal lost" in the now-playing card. |
| Audio decode fails (bad MP3) | Skip segment, advance to next. Log to console. |
| AudioContext suspended after gesture | Call `ctx.resume()` again on the next user interaction. |
| GET /signal fetch fails or times out | Treat frequency as unlocked. No retry storm: cache the failure for 30 s. |
| Clock drift >= 250 ms | Hard resync: update offset immediately. If an AudioBufferSourceNode is already scheduled within 1 s, let it play; reschedule later nodes. |
| `talkup.startOffsetMs` places clip before segment start | Clamp clip start to segment start. Log warning. |
| prefers-reduced-motion | Skip all CSS transitions and audio cross-fades; use instant gain changes. |

---

## Correctness Properties

**Property 1:** For any frequency `f` in [520, 1740], `Math.abs(positionToFreq(freqToPosition(f)) - f) < 0.001`. Validates: REQ-1.

**Property 2:** For any three offset samples where one sample deviates from the true offset by up to 500 ms, the median of the three samples returns a value within 1 ms of the non-outlier samples' median. Validates: REQ-7.

**Property 3:** For any voice clip scheduled with `scheduleDuck(musicBus, ctx, startTime, postTime)`, the gain value at `postTime` equals 1.0 (full level) and at no point during `[startTime + DUCK_ATTACK_S, postTime - DUCK_RELEASE_S]` does the gain exceed the ducked level (`linearFromDb(-10)`). Validates: REQ-6.

**Property 4:** For any `distanceKHz` of 0, `updateStaticGain` schedules the static bus gain toward 0.0. For any `distanceKHz` >= 200, it schedules toward 1.0. For values in between the gain is monotonically increasing. Validates: REQ-2, REQ-3.

**Property 5:** For any sequence of `scheduleDuck` calls with non-overlapping `[startTime, postTime]` intervals, the gain automation events on the music bus form a sequence where each release completes before the next attack begins (no gain event overlap). Validates: REQ-6.

**Property 6:** For any `SongSegment` with a `talkup` field, `talkup.startOffsetMs / 1000 + clipDuration <= talkup_seconds - 0.5`. If this condition fails, the clip is not scheduled. Validates: REQ-8.

**Property 7:** `correctedNow(offset)` returns a value strictly between `Date.now() - 1000` and `Date.now() + 1000` for any offset in the range [-500, 500] ms. This is a sanity bound; real offsets are expected smaller. Validates: REQ-7.
