# Tasks: Request Line

Status key: all tasks are [ ] (not started).

---

## Server tasks

- [ ] **S-1: Add `Insert` type to `station/src/core/types.ts`**
  Add `Insert` interface (`airAt`, `clip`, `songId`) and update `ClipKind` with `"request"` if needed.
  _Covers: P1, P2 (type safety for generateDay extension)_

- [ ] **S-2: Extend `generateDay` to accept and consume inserts**
  Add optional `inserts?: Insert[]` param. At each break, check whether the next unconsumed insert's `airAt <= cursor`; if so, use its clip and inject its song (or the next queued song if the requested one already aired). Do not alter any segment before `airAt`.
  _Covers: P1 (no retroactive change), P2 (tiling preserved), P3 (at most one request per break)_

- [ ] **S-3: `POST /request` handler**
  In `station/src/core/handler.ts`: parse body, run validation pipeline (field lengths, character allowlist, URL/email/@handle/digit-run patterns, blocklist scan against `data/blocklist.txt`), apply per-IP and station-wide rate limits from KV, store `RequestRecord` with status `queued`, return 202 or 400/429 with a Dead John reason phrase.
  _Covers: P4 (rejected request never queued), P6 (blocklist never sent to browser)_

- [ ] **S-4: `GET /request/<ticket>` handler**
  Read KV record by ticket; return public status view. When `scheduled`, format `airAt` as `HH:MM AM/PM` in the timezone given by `TZ` query param (default `America/Los_Angeles`). Never return `ip`, `clipFile`, or reason for `dropped`.
  _Covers: REQ-14_

- [ ] **S-5: KV schema and `airAt` index**
  Define KV key patterns (`req:<ticket>`, `rate:ip:<hash>`, `rate:station`, `airAt:<dayIndex>:<ms>`). Document TTLs. Provide a helper module `station/src/core/kv.ts` with typed read/write wrappers.
  _Covers: P3 (10-minute spacing enforced at write time)_

- [ ] **S-6: `data/blocklist.txt`**
  Create the file with an initial set of blocked phrases. One phrase per line, lowercase, no regex.
  _Covers: P4, P6_

---

## Studio worker tasks

- [ ] **W-1: `tools/studio/worker.py` scaffold**
  Poll KV every 30 s for `status == "queued"` records (oldest first). Structure the main loop, add graceful shutdown, and wire up the KV client and R2 client.

- [ ] **W-2: Script builder**
  Given a `RequestRecord`, produce the render script: "Got a call on the request line. This one's from {from}, for {to}. {message} Here's {song-title}." Pass through the station pronunciation lexicon before handing to `studio.py`.
  _Covers: REQ-16_

- [ ] **W-3: Render and Whisper verification**
  Call `studio.py`, check duration (<= 30 s), run Whisper word-match (>= 0.85), retry once on failure, set `dropped` if still below threshold or over duration limit.
  _Covers: P5 (clip always fits break), REQ-17, REQ-18_

- [ ] **W-4: `assign_air_at` function**
  Find the first break boundary >= 5 min after render time that has no existing `airAt` KV key within 600 000 ms. Write the `airAt` key atomically. Update record to `rendered`.
  _Covers: P3 (10-minute spacing), REQ-20, REQ-25_

- [ ] **W-5: R2 upload**
  Encode the verified clip at -16 LUFS, -1.5 dBTP, mono, 256 kbps MP3 (same as existing voice spec). Upload to R2, store key in `clipFile`.
  _Covers: REQ-NF-02_

---

## Web form tasks

- [ ] **F-1: `web/src/request-form.ts`**
  Build the form component: four fields (from-name, to-name, message, song search). Song search queries the library client-side and shows a pick list. On submit, POST /request and handle 202/400/429.
  _Covers: REQ-01, REQ-02, REQ-03_

- [ ] **F-2: Ticket display**
  On 202, show the ticket URL and a friendly note ("Dead John will read your request around {airAt} -- keep it on."). On 4xx, show the server's reason phrase verbatim; do not echo submitted text.
  _Covers: REQ-04, REQ-05_

- [ ] **F-3: Wire form into `web/index.html`**
  Add the "CALL THE REQUEST LINE" section after the tuner. Gate it behind the locked-signal state so it only appears after the listener has tuned in.

---

## Test tasks

- [ ] **T-1: `generateDay` insert property test** (`station/tests/schedule.property.test.ts`)
  Property: for any valid `inserts` list, `generateDay` with inserts produces the same segments before the first `airAt` as `generateDay` without inserts.
  _Covers: P1_

- [ ] **T-2: Tiling-with-inserts test** (`station/tests/schedule.property.test.ts`)
  Property: `assertTiling` passes for any `generateDay` call with 0-5 random inserts.
  _Covers: P2_

- [ ] **T-3: One-request-per-break unit test** (`station/tests/schedule.property.test.ts`)
  Assert that no two consecutive voice segments both have `clipKind == "request"` and that all pairs of request-clip start times are >= 600 000 ms apart.
  _Covers: P3_

- [ ] **T-4: Validation unit tests** (`station/tests/request-validation.test.ts`)
  Cover: all allowlist edge cases, URL/email/@handle/digit-run rejection, blocklist match, field length boundaries.
  _Covers: P4_

- [ ] **T-5: Blocklist server-only test** (`station/tests/request-validation.test.ts`)
  Assert that the `POST /request` response body on a blocklist hit contains no substring from the submitted text and no substring from `blocklist.txt`.
  _Covers: P6_

- [ ] **T-6: Clip duration cap test** (`tools/studio/tests/worker.test.py`)
  Mock a render that returns a 31-second clip; assert the record is set to `dropped` and `airAt` is never written to KV.
  _Covers: P5_

- [ ] **T-7: Whisper re-render and drop test** (`tools/studio/tests/worker.test.py`)
  Mock Whisper returning 0.80 on first render and 0.80 on retry; assert status becomes `dropped`.
  _Covers: REQ-17_

- [ ] **T-8: `assign_air_at` spacing test** (`tools/studio/tests/worker.test.py`)
  Given two requests rendered within 2 minutes of each other, assert their assigned `airAt` values differ by >= 600 000 ms.
  _Covers: P3, REQ-25_

- [ ] **T-9: Rate limit tests** (`station/tests/request-handler.test.ts`)
  Assert 429 on the 2nd POST from the same IP within 10 minutes, and on the 31st POST station-wide within 60 minutes.
  _Covers: REQ-10, REQ-11_
