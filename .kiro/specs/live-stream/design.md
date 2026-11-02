# Live Stream: Design

## Architecture overview

```
wall clock
    |
    v
  tick() every 50 ms
    |  computes bytes due since t0
    |  drains pcm[], writes s16le to encoder stdin
    |
    +-- fill() (async, one at a time)
          queries schedule for next segment
          spawns ffmpeg decode per segment
          builds filter_complex for talk-up mix
          appends raw PCM to pcm[]
    |
    v
  ffmpeg encoder (s16le -> MP3 128k)
    |
    v
  broadcast(chunk)
    |  keeps sliding burst[] window (~3 s)
    |  writes to every connected res
    +-- drops clients whose writableLength > 2 MB
```

The key invariant: `written` bytes of s16le have been handed to the encoder since `t0`.
At any wall time `T`, the encoder should have received `(T - t0) * BYTES_PER_MS` bytes.
`tick()` closes that gap every 50 ms.

---

## Correctness properties

**P1. Clock alignment.** For wall time T, the number of bytes written to the encoder equals
`floor((T - t0) * BYTES_PER_MS / FRAME) * FRAME`. `tick()` computes the delta and writes it,
padding with silence if PCM is not ready. This keeps stream time locked to wall time.

**P2. Segment exact-fit.** Each decoded segment is trimmed or zero-padded to exactly
`round((ms * BYTES_PER_MS) / FRAME) * FRAME` bytes before being pushed to `pcm[]`. Segments
butt together without gaps or overlaps in the byte stream.

**P3. No concurrent fill.** The `decoding` flag prevents `fill()` re-entry. `tick()` and the
fill loop both call `fill()`, but only one runs at a time.

**P4. PCM memory cap.** The `while` loop in `fill()` exits when `pcmBytes >= MAX_PCM_BYTES`
(200 MB), preventing unbounded decode-ahead.

**P5. Client backlog cap.** `broadcast()` drops and destroys any `res` whose `writableLength`
exceeds 2 MB, preventing per-client memory growth.

**P6. Single encoder.** `start()` is only called when `!this.running`, and `attach()` checks
that flag before calling it. Only one encoder process exists at any time.

**P7. Burst replay.** `burst[]` is a sliding window capped at `BURST_BYTES` (~48 KB, 3 s at
128 kbps). A new client is sent the full burst before being added to `clients`, giving it a
head start with no special path in the encoder.

---

## Review findings

### broadcast.ts

**[BUG] Line ~106 -- `stop()` clears `idleTimer` but does not cancel a pending one.**
`stop()` sets `this.idleTimer = null` but never calls `clearTimeout(this.idleTimer)` first. If
`stop()` is called (e.g. on encoder exit) while the idle timer is still pending, the timer fires
60 s later and calls `this.stop()` again on an already-stopped instance. `this.running` is false
at that point so no harm is done today, but if `start()` was called in the meantime (because
clients reconnected) the second `stop()` will tear down the new session.

Fix: at the top of `stop()`, add:
```ts
if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
```

**[BUG] Line ~105 -- `enc.kill()` races with `enc.stdin.end()`.**
`stop()` calls `enc?.stdin?.end()` then `enc?.kill()`. The immediate `kill()` sends SIGTERM
while the stdin `end()` flush may still be in progress. The `exit` handler on the encoder checks
`this.encoder === enc`, but by the time it fires the restart path (`this.clients.size` check) may
observe a stale client set. Low probability, but if a client reconnects between the kill and the
exit callback, the new encoder will be immediately torn down by the stale exit handler.

Fix: in the `exit` handler, guard with `this.running && this.encoder === enc` (already present),
but also null out `this.encoder` at the top of `stop()` before calling `enc.stdin.end()` /
`enc.kill()`, so any late `exit` event from the old process finds `this.encoder !== enc` and
does nothing. The `encoder` field is already set to `null` in `stop()` -- the fix is to move
that assignment before the kill, not after.

**[UNBOUNDED GROWTH -- MITIGATED] Lines ~56-57 -- `burst[]` and `burstBytes`.**
`burst[]` is trimmed in `broadcast()` by popping the front while `burstBytes > BURST_BYTES`.
The `while ... && this.burst.length > 1` condition means one oversized chunk can remain if a
single MP3 chunk from the encoder exceeds `BURST_BYTES` (~48 KB). In practice ffmpeg outputs
~4 KB chunks at 128 kbps with `-flush_packets 1`, so this is fine. Noted as a theoretical edge
case; no fix required today.

**[RACE CONDITION] Line ~165 -- `fill()` is `async` but `decoding` is not reset on thrown errors.**
The `try/finally` block in `fill()` correctly sets `this.decoding = false` in `finally`. If
`this.deps.segments(...)` throws synchronously (not caught by the inner `.catch`), the `finally`
still runs. Checked: no unbounded lock possible here. Marked fine.

**[POTENTIAL ISSUE] Line ~182 -- `this.decodedUntil = seg.endMs` after trimming.**
When a decoded segment is shorter than expected AND is padded to `bytes`, `decodedUntil` is
advanced to `seg.endMs`. That is correct. But if `decode()` rejects (the `.catch` returns
`Buffer.alloc(0)`), `pcm` is zero-length, gets padded to `bytes` of silence, and `decodedUntil`
is still advanced. This means a failed decode produces the right amount of silence and the clock
stays honest. Correct behavior; no bug.

**[STYLE] Line ~144 -- `fill()` calls `void this.fill()` from inside `tick()` but `fill()` is also
called from `start()` with `void`.**
Consistent. No issue.

---

### radio-stream.ts

**[BUG] `unlockRadio()` returns early if `el` already exists, but `radioOn()` calls `unlockRadio()`
before checking whether `el` has error/stall listeners attached.**
This is fine as written because `unlockRadio()` attaches the listeners once (when `el` is first
created). Subsequent calls to `unlockRadio()` from `radioOn()` are no-ops. Checked; no bug.

**[POTENTIAL ISSUE] `recover` closure captures `wanted` and `retry` by reference.**
If `radioOff()` is called and then `radioOn()` is called quickly, `wanted` is set to `false`
then `true`. A stall event that fires between the two calls will see `wanted = true` (already
reset) and schedule a redundant retry. The retry calls `radioOn()` again, which is harmless
(idempotent `el.src` reassignment). No real bug; marked fine.

**[NONE] Retry timer leak.** `radioOff()` does not cancel the `retry` timer. If a stall fires
just before `radioOff()`, the timer fires 2 s later and calls `radioOn()` even though the user
turned it off. The `wanted` flag is `false` at that point, so `recover` checks `if (!wanted)`
and... does NOT cancel. Wait: `radioOn()` sets `wanted = true` unconditionally. So the retry
would turn the radio back on against the user's intent.

Fix: `radioOff()` should cancel the pending retry:
```ts
export function radioOff(): void {
  wanted = false;
  if (retry) { clearTimeout(retry); retry = null; }
  if (!el) return;
  el.pause();
  el.removeAttribute('src');
  el.load();
}
```

This is the one real client-side bug. The `recover` guard already checks `!wanted`, but it
fires from the event, not from the timer callback. The timer callback calls `radioOn()` directly
without checking `wanted` first.

## Review of the review (Claude, Nov 2)
Checked each finding against the code. Finding 1 (stop() does not cancel the idle timer): real, fixed. Finding 2 (encoder nulled after kill): not real, stop() nulls this.encoder before calling kill. Finding 3 (retry restarts a stopped radio): not real, the retry callback re-checks wanted before calling radioOn. Same lesson as the earlier specs: verify agent claims against the source.

