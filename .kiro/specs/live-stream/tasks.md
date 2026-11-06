# Live Stream: Tasks

## Status key
- [x] done (exists and working)
- [ ] open

---

## Implemented (verified by code review)

- [x] Single shared ffmpeg encoder, started on first connect, shared across all clients
- [x] Wall-clock-locked tick loop: 50 ms interval, silence on underrun, no drift
- [x] Async segment decode pipeline with `decoding` flag preventing re-entry
- [x] PCM memory cap: `fill()` stops when `pcmBytes >= MAX_PCM_BYTES` (200 MB)
- [x] Talk-up mixing: voice overlaid on song intro via `filter_complex`, music ducked 10 dB
- [x] Segment exact-fit: PCM trimmed or zero-padded to scheduled byte count
- [x] Burst replay: ~3 s of MP3 sent to new clients before live output
- [x] Per-client backlog cap: clients with > 2 MB queued are dropped and destroyed
- [x] Idle timer: encoder stays alive 60 s after last client disconnects
- [x] Encoder crash recovery: exit handler restarts if clients are still connected
- [x] `GET /stream` HTTP handler with correct headers (audio/mpeg, no-store, keep-alive)
- [x] `unlockRadio()`: plays silent WAV on first gesture to unlock iOS audio
- [x] `radioOn()`: cache-busting `?t=` param, calls `play()`
- [x] `radioOff()`: pause, clear src, call load()
- [x] `radioSounding()`: guards on `currentTime > 0.2` and `readyState >= 3`
- [x] `radioMute()`: mutes element without disconnecting (for Emergency Broadcast)
- [x] Auto-retry on error / stall / ended events, 2 s delay

---

## Bugs found in review

- [x] **`stop()` does not cancel the idle timer before nulling it** (broadcast.ts ~line 106).
  A pending timer can fire after a restart and tear down the new session.
  Fix: add `if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }` at
  the top of `stop()`.
  Already fixed, verified at station/src/broadcast.ts:141.

- [x] **`this.encoder` nulled after `enc.kill()`, not before** (broadcast.ts ~line 103-106).
  A late `exit` event from the killed process can match `this.encoder === enc` after a new
  encoder has started. Move `this.encoder = null` to before `enc?.stdin?.end()`.
  Already fixed, verified at station/src/broadcast.ts:138.

- [x] **`radioOff()` does not cancel the pending retry timer** (radio-stream.ts, `radioOff`).
  A stall event just before `radioOff()` arms a 2-second timer. That timer calls `radioOn()`
  without re-checking `wanted`, turning the radio back on after the user stopped it.
  Fix: add `if (retry) { clearTimeout(retry); retry = null; }` at the top of `radioOff()`.
  Fixed in this pass (web/src/radio-stream.ts:45). The timer already re-checked `wanted`, so it
  could not turn the radio back on by itself, but an off then on inside 2 s would still get a
  stray reload. Now the timer is cancelled.

---

## Tests

- [x] Unit test: `tick()` writes silence on PCM underrun and does not stall the encoder (station/tests/broadcast.test.ts)
- [x] Unit test: `attach()` sends burst to new client and adds it to `clients` (station/tests/broadcast.test.ts)
- [x] Unit test: `broadcast()` drops client when `writableLength > MAX_CLIENT_BACKLOG` (station/tests/broadcast.test.ts)
- [x] Unit test: `stop()` cancels idle timer (regression for bug above) (station/tests/broadcast.test.ts)
- [x] Unit test: `radioOff()` cancels retry timer (regression for bug above) (web/tests/radio-stream.test.ts)
- [x] Integration smoke test: `GET /stream` returns 200 with `audio/mpeg` and non-zero body
  (station/tests/broadcast.test.ts). Runs in-process on an ephemeral port with a stubbed
  encoder, so it needs no ffmpeg and no audio files. No skipIf needed.