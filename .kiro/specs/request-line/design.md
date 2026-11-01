# Design: Request Line

## Overview

The request line is three loosely-coupled pieces:

1. **Web form** in the browser, already inside `web/`.
2. **Worker endpoint** (`POST /request`, `GET /request/<ticket>`) in `station/src/core/handler.ts`, backed by Cloudflare KV for queue and rate-limit state.
3. **Studio worker** (`tools/studio/`), a Python script on Ryan's laptop that polls KV, calls `studio.py` for TTS, verifies with Whisper, and writes the clip to R2.

They share no runtime coupling. The worker assigns `airAt`; `generateDay` consumes it.

---

## Data model

```ts
// Stored in KV under key  req:<ticket>
interface RequestRecord {
  ticket: string;          // UUID v4
  from: string;
  to: string;
  message: string;
  songId: string;
  songTitle: string;
  ip: string;              // hashed with HMAC-SHA256; never stored in plain text
  status: "queued" | "rendered" | "scheduled" | "aired" | "dropped";
  createdAt: number;       // Unix ms
  renderedAt?: number;
  clipFile?: string;       // R2 object key
  clipSeconds?: number;
  airAt?: number;          // Unix ms, break boundary
  dayIndex?: number;
}
```

KV secondary indexes:
- `rate:ip:<hash>` -> list of timestamps (TTL 1 h), for per-IP limiting.
- `rate:station` -> list of timestamps (TTL 1 h), for station-wide limiting.
- `airAt:<dayIndex>:<airAtMs>` -> ticket, to enforce the 10-minute spacing rule.

---

## Validation pipeline (server, `POST /request`)

```
parse body
  -> field presence check
  -> length caps (REQ-06, REQ-07)
  -> character allowlist (REQ-06, REQ-07)
  -> pattern reject: URL, email, @handle, digit run >= 5 (REQ-07)
  -> blocklist scan (REQ-08)   -- server only, blocklist never sent to browser
  -> rate limit: IP (REQ-10), station-wide (REQ-11)
  -> store RequestRecord{status:"queued"} in KV
  -> return 202 {ticket, message}
```

On any check failure, respond 400 (or 429) with a reason phrase in Dead John's voice. The reason phrases are a static table in the worker code; they do not reference the submitted text.

Dead John failure phrases (examples, not exhaustive):
- Generic: "Something about that one didn't sit right with me. Try again."
- Too long: "That message ran a little long, even for me."
- Suspicious pattern: "I don't do phone numbers on the air."
- Rate limited: "You just called. I haven't forgotten. Give it a few minutes."

---

## `generateDay` extension

Current signature:
```ts
generateDay(dayIndex, library, voicebank, featured, epochMs): DaySchedule
```

New signature:
```ts
generateDay(dayIndex, library, voicebank, featured, epochMs, inserts?: Insert[]): DaySchedule
```

```ts
interface Insert {
  airAt: number;   // Unix ms, break boundary, >= 5 min after render
  clip: VoiceClip; // the rendered request read
  songId: string;  // the requested song
}
```

Insert consumption at the break step (replacing step 6 in the main loop):

```
if (songsSinceBreak >= breakCountdown):
  pendingInsert = inserts.find(i => i.airAt <= cursor && not yet consumed)
  if pendingInsert:
    push VoiceSegment from pendingInsert.clip
    mark pendingInsert consumed
    nextSong = pendingInsert.songId not in usedToday
               ? library track matching songId
               : dequeue()
    push SongSegment for nextSong
    usedToday.add(nextSong.id)
    reset songsSinceBreak = 0
    breakCountdown = pickOne([2,3])
  else:
    (existing break logic)
```

All PRNG calls before `cursor < airAt` are untouched; inserting a request only adds segments at or after `airAt`.

---

## Studio worker flow (`tools/studio/worker.py`)

```
loop every 30 s:
  records = KV.list(prefix="req:", filter status=="queued")
  for record in records (oldest first):
    script = build_script(record)
    clip = studio.render(script)
    if clip.duration > 30:
        KV.update(record.ticket, status="dropped")
        continue
    score = whisper_match(clip, script)
    if score < 0.85:
        clip = studio.render(script)   # one retry
        score = whisper_match(clip, script)
    if score < 0.85:
        KV.update(record.ticket, status="dropped")
        continue
    r2_key = upload_to_r2(clip)
    air_at = assign_air_at(record.createdAt, KV)
    KV.update(record.ticket,
              status="rendered",
              clipFile=r2_key,
              clipSeconds=clip.duration,
              airAt=air_at)
```

`assign_air_at`: finds the first break boundary (multiples of ~3 min) at least 5 min from now, with no existing `airAt:<dayIndex>:<ms>` KV key within 600 000 ms.

---

## Status tracking

```
queued   -> worker picks it up
rendered -> clip stored, airAt assigned; handler.ts injects into generateDay inserts
scheduled -> generateDay placed the segment; set by the handler when it builds the day
aired    -> set when cursor passes airAt + clip.seconds
dropped  -> set on render failure, Whisper failure, or clip > 30 s
```

`GET /request/<ticket>` reads the KV record and returns the public view (status + airAt formatted for display if status is `scheduled`). It never returns `clipFile`, `ip`, or internal fields.

---

## Correctness properties

**P1: No retroactive change.**
Inserting an insert with `airAt = T` does not change any segment with `startMs < T`. All PRNG calls that produce segments before `T` execute identically whether or not inserts is provided, because insert consumption is conditional on `cursor >= airAt` and PRNG state is only advanced inside the break/song loop in cursor order.

**P2: Tiling invariant is preserved.**
The existing `assertTiling` check runs after `generateDay` returns. An insert replaces one break clip and adds one song; both are pushed sequentially onto `segments` with `startMs = cursor` and `endMs = cursor + duration`, so the contiguous-cover invariant is maintained.

**P3: At most one request per break; two requests at least 10 minutes apart.**
`assign_air_at` scans KV for any `airAt` key within 600 000 ms of the candidate time and advances until the gap is satisfied. The insert loop marks each insert consumed on first use, so a single break cursor can trigger at most one insert.

**P4: A rejected request never reaches the studio queue.**
The validation pipeline in the worker returns before any KV write on any check failure. The blocklist is loaded from `data/blocklist.txt` at worker startup and lives only in server memory.

**P5: The read clip always fits the break.**
A clip longer than 30 s is dropped before the `airAt` is assigned, so it never enters `generateDay` as an insert. The existing break timing already keeps voice segments short; the 30-second hard cap is enforced at render time.

**P6: The blocklist never ships to the browser.**
The web form does no blocklist validation. All blocklist logic is in the worker handler, which does not expose `/blocklist` or include blocklist content in any response.

---

## File map

| File | Role |
|---|---|
| `station/src/core/types.ts` | Add `Insert` type |
| `station/src/core/day.ts` | Accept and consume `inserts` param |
| `station/src/core/handler.ts` | `POST /request`, `GET /request/<ticket>`, KV ops |
| `data/blocklist.txt` | Server-only phrase list |
| `tools/studio/worker.py` | Poll queue, render, Whisper check, assign airAt |
| `web/src/request-form.ts` | Form UI, song search, ticket display |
| `web/index.html` | Add form section |

## Review notes (Claude, Nov 1)
- Storage: the station currently runs on Ryan's laptop behind a tunnel, not on Workers. Put KV behind a small interface (get, put, list by prefix) with a JSON-file adapter for the laptop and a KV adapter for Cloudflare.
- airAt does not need to sit on a real break boundary: inserts are consumed at the first break whose cursor is at or after airAt, so any time at least 5 minutes ahead works.

