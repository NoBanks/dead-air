# Live Stream: Requirements

## Context

Phones suspend Web Audio when the page is hidden or the screen locks. To keep 1714 AM playing on
the lock screen and in the background, the station is mixed once on the server into a single
continuous MP3. Every listener connects to `GET /stream` and receives the same moment in the
broadcast. The browser plays it through a plain `<audio>` element, which the OS keeps alive.

---

## Functional requirements

### Server stream

1. **WHEN** a client sends `GET /stream`, **THE SYSTEM SHALL** respond with `Content-Type: audio/mpeg`
   and stream MP3 audio continuously until the client disconnects.

2. **WHEN** a second (or nth) client connects while the stream is already running, **THE SYSTEM SHALL**
   attach that client to the single shared encoder, not start a second encode chain.

3. **WHEN** the stream is running and the last client disconnects, **THE SYSTEM SHALL** keep the
   encoder running for at least 60 seconds so the next connection starts immediately.

4. **WHEN** a new client attaches, **THE SYSTEM SHALL** send it a burst of already-encoded MP3 data
   (roughly 3 seconds worth) before switching to live output, so playback starts fast.

5. **WHEN** a client's write buffer exceeds 2 MB (frozen tab, dead connection), **THE SYSTEM SHALL**
   drop that client and destroy its socket rather than holding a growing backlog.

6. **WHEN** the ffmpeg encoder process exits unexpectedly, **THE SYSTEM SHALL** restart the encoder
   and resume streaming to any still-connected clients.

### Schedule alignment

7. **WHEN** the stream produces audio for a time window, **THE SYSTEM SHALL** use exactly the audio
   the schedule assigns to that window, so every listener hears the same segment at the same wall
   clock time.

8. **WHEN** a song segment carries a talk-up, **THE SYSTEM SHALL** mix the voice clip over the
   instrumental intro with the music ducked 10 dB (DUCK = 0.316 linear), and the voice starting at
   `talkup.startOffsetMs` relative to the segment start.

9. **WHEN** the decoded PCM for a segment is shorter or longer than the scheduled duration,
   **THE SYSTEM SHALL** pad with silence or trim so the byte count matches the schedule exactly.

10. **WHEN** decoded PCM is not yet ready for a scheduled time slot, **THE SYSTEM SHALL** output
    silence for that slot and continue advancing the clock, never stalling the encoder.

### Browser client

11. **WHEN** the user performs the first tap or dial gesture, **THE SYSTEM SHALL** unlock the
    `<audio>` element by playing a silent WAV, so that subsequent `play()` calls succeed on iOS.

12. **WHEN** `radioOn()` is called, **THE SYSTEM SHALL** set the source to `/stream?t={timestamp}`
    and call `play()`, where the timestamp cache-busts any stale CDN response.

13. **WHEN** the stream errors, stalls, or ends unexpectedly, **THE SYSTEM SHALL** automatically
    retry `radioOn()` after a 2-second delay, provided `wanted` is still true.

14. **WHEN** `radioOff()` is called, **THE SYSTEM SHALL** pause the element, clear its `src`, and
    call `load()` to release the network connection.

15. **WHEN** `radioSounding()` is queried, **THE SYSTEM SHALL** return `true` only after the element
    has played past 0.2 seconds of audio and has sufficient data buffered (`readyState >= 3`).

16. **WHEN** the Emergency Broadcast sequence triggers a local mute, **THE SYSTEM SHALL** mute the
    `<audio>` element without pausing or disconnecting it.

### Loudness and format

17. **WHEN** encoding the stream, **THE SYSTEM SHALL** output 128 kbps MP3, 44.1 kHz, stereo (the
    source MP3s are already loudness-matched at -14 LUFS; the stream does not re-normalize).

---

## Non-functional requirements

- **Memory:** PCM held in memory at any one time shall not exceed 200 MB (`MAX_PCM_BYTES`).
- **Latency:** a new client shall begin hearing audio within approximately 3 seconds of connecting.
- **Reliability:** a single decode failure shall not kill the stream; the segment is replaced with
  silence and the next segment is attempted.
- **Drift:** the stream clock shall not drift from wall time; silence is inserted for any underrun
  rather than slowing or speeding the encoder.
