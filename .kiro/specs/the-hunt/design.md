# The Hunt: Design

## Overview

The Hunt adds six hidden AM stations to the dial. The server exposes a single
new endpoint, `GET /signal`, that answers "what is playing at this frequency right
now?" No hidden frequencies are ever sent to the client unprompted.

All station-time logic delegates to the existing `tzoffsets.ts` helpers.

---

## Data: data/hunt.json

Loaded once at dev-server start (and at Worker start). Never mutated at runtime.

```typescript
interface HuntClip {
  id: string;
  file: string;     // URL path, e.g. "/voice/storm_frag_1.mp3"
  seconds: number;  // duration as float
}

interface HuntStation {
  freq: number;     // kHz
  page: string;     // Logbook page key
  mode: "loop" | "hourly";
  clips: HuntClip[];
}

interface LastMinute {
  freq: number;     // 1410
  page: string;     // "three-fourteen"
  clip: HuntClip;
}

interface HuntConfig {
  lock_khz: number;
  stations: HuntStation[];
  last_minute: LastMinute;
}
```

---

## Pure core: station/src/core/hunt.ts

### Exported types

```typescript
export type { HuntConfig, HuntStation, HuntClip, LastMinute, SignalResult };
```

### signalAt

```
signalAt(hunt, freqKHz, atMs, epochMs): SignalResult | null
```

1. Guard: if any of `freqKHz`, `atMs`, `epochMs` is not finite, return null.
2. Find station with `|freqKHz - station.freq| <= hunt.lock_khz`.
   If none, return null. If multiple tie, pick lowest `|diff|`.
3. Compute strength = `1 - |diff| / hunt.lock_khz`.
4. Check last_minute override (only for station whose freq === last_minute.freq):
   - Get LA parts for `atMs`.
   - If hour===3, minute===14: compute UTC ms of 03:14:00 on that LA day,
     return last_minute clip, page "three-fourteen", offsetMs = atMs - top314,
     remainingMs = last_minute.clip.seconds*1000 - offsetMs.
5. Dispatch by mode: loop or hourly.
6. Return `{ page, clipId, file, offsetMs, remainingMs, strength }`.

### Loop mode

```
totalMs = sum(clip.seconds * 1000)
phase = (atMs - epochMs) mod totalMs   // handles negative via floor-mod
```

Walk clips until cumulative length >= phase to find the clip and intra-clip offset.

Floor-mod for negative inputs: `((x % m) + m) % m`.

### Hourly mode

```
laHour = stationHourOf(atMs)
clipIndex = laHour mod clips.length
```

Top of that LA hour:

```
hourStartMs = stationHourStart(atMs)   // new helper below
msIntoHour = atMs - hourStartMs
clipLenMs = clip.seconds * 1000
offsetMs = msIntoHour mod clipLenMs
```

### stationHourStart (unexported helper)

Finds the UTC ms of the start of the current LA hour by subtracting the LA minute
and second from atMs:

```
parts = laPartsOf(atMs)
offsetWithinHour = (parts.minute * 60 + parts.second) * 1000 + (atMs % 1000)
return atMs - offsetWithinHour
```

This is purely arithmetic over the already-correct `laPartsOf` result; it does
not require DST knowledge beyond what `stationHourOf` already provides.

### decodeNumbers

Takes a string of spelled-out numbers (space-separated words). Recognises
"one".."twenty-six" (with hyphen), "twenty one".."twenty six" (two words).
Returns an array of decoded words under A=1..Z=26.

Groups are separated by non-number content; the function splits on "." and
processes each segment independently.

### NUMBERS_TEXT constant

The exact broadcast text exported for use in tests:
```
"Attention. One four one zero. Zero three one four. Attention. ..."
```

---

## HTTP handler extension (station/src/core/handler.ts)

Route by `url.pathname`:
- `/now` -> existing logic (unchanged)
- `/signal` -> new signalHandler
- anything else -> 404

### signalHandler

```
f = url.searchParams.get("f")
t = url.searchParams.get("t")
freqKHz = parseInt(f)   // NaN if missing/bad
atMs = parseFloat(t); if not finite -> Date.now()
if (!isFinite(freqKHz)) -> 204
result = signalAt(hunt, freqKHz, atMs, env.epoch)
if null -> 204
else -> 200 JSON { page, clip_id, file, offset_ms, remaining_ms, strength, server_time }
```

Headers: `Cache-Control: no-store`, `Content-Type: application/json` (hit only).

---

## Dev server (station/src/dev-server.ts)

- Load `data/hunt.json` at startup alongside library/voicebank/featured.
- Pass `hunt` into the new `handleRequest` overload that accepts it.
- Replace the stub `/signal` route with the real handler.

---

## Correctness properties (for property tests)

1. **Coverage null**: for all `f` with `min(|f - station.freq|) > lock_khz`,
   `signalAt` returns null.

2. **Offset bounds**: for any station and any finite `atMs`,
   `offsetMs in [0, clipLenMs)` and `remainingMs = clipLenMs - offsetMs`.

3. **Determinism**: `signalAt(hunt, f, t, e) === signalAt(hunt, f, t, e)`.

4. **Continuity (loop)**: if `signalAt(hunt, f, t, e)` and `signalAt(hunt, f, t+1000, e)`
   return the same clipId, then `result2.offsetMs === result1.offsetMs + 1000`.

5. **Last-minute window**: for all `t` in [03:14:00.000, 03:14:59.999] LA,
   `signalAt` for freq 1410 returns page "three-fourteen" and uses
   `last_minute.clip`. For `t` exactly 1 ms before or after the window,
   it does not.

6. **Handler shape**: a 204 has empty body; a 200 body has exactly the
   documented keys and no extras.

---

## Files changed

| File | Action |
|------|--------|
| `data/hunt.json` | Create |
| `station/src/core/hunt.ts` | Create |
| `station/src/core/handler.ts` | Extend (route by pathname) |
| `station/src/core/types.ts` | No change |
| `station/src/dev-server.ts` | Load hunt.json; pass to handler; replace stub route |
| `station/tests/hunt.property.test.ts` | Create |

---

## Web client (shipped)

Changed Nov 6: this section was added so the design describes what shipped.

### Tuner playback (REQ-14)

- `web/src/hunt.ts` asks `/signal` 220 ms after the dial settles, and again at `remaining_ms + 50` (min 250 ms) when the clip ends. No 5 s poll: two requests per clip is cheaper and the server is stateless anyway.
- Static gain and the signal meter use `1 - max(lock, strength * 0.6)`. A hidden station at full strength still leaves 40% static, so it always sounds far off.

### Logbook UI (REQ-11)

- Found page: number, title, flavor text. Text only.
- Locked page: number, a blurred smudge, and the hint line. The title stays hidden.

### Share card (REQ-13)

- `web/src/share-card.ts`: `buildShareCard(foundIds)` returns the card data: `station`, `band`, `summary`, eight `marks` (`{ n, found }`), footer, site and share text. Pure, no canvas.
- Marks carry no titles at all (Claude review Nov 6: a found title still tells a friend which page exists, so the card keeps the original rule: how many, never which). No title, hint, flavor text or frequency is read, so none can leak. The footer is the finale line once the finale has played. The only number of three or more digits is 1714.
- `web/src/logbook-ui.ts`: `drawShareCard(card)` paints a 1200x630 canvas with the tuner palette (`--bg`, `--panel`, `--edge`, `--amber`, `--amber-dim`, `--ink`, `--muted`) and the Oswald and Special Elite fonts. `shareCard()` then calls `navigator.share({ files, text })` if `canShare` allows it, else downloads `dead-air-logbook.png`. No network calls.
- Tests: `web/tests/share-card.test.ts`, including a property test over any set of found pages that checks no number run of 3+ digits except 1714, no page title, no flavor text and no hint.