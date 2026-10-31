# Design: Talk-Up Bugfix

## Root Cause Analysis

### The Problem

The detector's algorithm assumes a sharp transition from quiet to loud. Real music has:
1. A quiet intro section with ambient noise, reverb tail, or sustained low tones at -40 to -60 dB.
2. A gradual energy build (snare entrance, drums kicking in, bass rising) over 0.5 to 3 seconds.
3. Full energy sustain once the intro ends.

The current detector looks for the first frame where RMS rises by **6 dB in a single frame** (50 ms window) compared to the 4-second rolling minimum. Because real intros build gradually, the rise is never sharp enough to cross the 6 dB threshold in one frame.

### Diagnosis: FFmpeg Output Analysis

Ran ffmpeg with `astats=metadata=1:reset=1` on the test tracks:

```bash
ffmpeg -t 60 -i <wav> -af "aresample=22050,astats=metadata=1:reset=1" -f null -
```

**Finding:** The ffmpeg 8.0 astats filter with `metadata=1:reset=1` does not emit per-frame RMS lines in the format the detector expects (`lavfi.astats.Overall.RMS_level=<value>`). Instead, it only emits aggregate statistics at the end (Channel 1, Channel 2, Overall). The `pts_time` markers that should appear before each per-frame RMS value are missing.

- **"12 Pre-Roll Blues"**: Overall RMS -13.5 dB (aggregate for full 60 s). No per-frame data in astats output.
- **"8 Fo' A Hunnit"**: Overall RMS -23.6 dB (aggregate). No per-frame data.
- **"90s Car Ad"**: Overall RMS -8.9 dB (aggregate). No per-frame data.

**Root cause:** The current detector code expects ffmpeg to emit per-frame metadata for each audio frame, but with the current `astats=metadata=1:reset=1` configuration, ffmpeg 8.0 is not doing this. The `reset=1` parameter does not trigger per-frame metadata emission in this version.

**Why synthetic tones "pass":** The unit tests are passing because `parseTalkup("")` falls back to 8 s (no RMS frames found). The tests don't actually verify that real detection works; they just check that the fallback is returned gracefully.

### Solution: Direct WAV Analysis Without Ffmpeg Metadata

The current approach tries to parse per-frame metadata from ffmpeg's astats filter, but this doesn't work reliably with ffmpeg 8.0. The fix implemented:

1. **Use a simpler ffmpeg pipeline:** Run ffmpeg to convert the WAV to raw 32-bit float PCM at 22050 Hz, read the samples into memory, and compute RMS locally in Node.js.
2. **Compute RMS manually in Node.js:** Split the audio into 50 ms frames, calculate RMS for each frame, then find the first energy rise.
3. **Remove dependency on ffmpeg metadata parsing:** The detector now owns the frame-by-frame analysis instead of relying on unstable ffmpeg output formats.

Algorithm implemented:
1. Spawn ffmpeg with `-f f32le` output to stdout (little-endian 32-bit floats).
2. Read all samples into memory (for 60 s at 22050 Hz, that's ~5 MB).
3. Split into 50 ms frames (~1103 samples per frame at 22050 Hz).
4. Compute RMS for each frame: `sqrt(mean(sample^2))`, convert to dB.
5. Find the first frame where current RMS exceeds the 4-second rolling minimum by 3 dB.
6. Apply 0.5 s margin and clamp [0, 30].
7. Fallback to 8 s if no rise detected, insufficient data, or ffmpeg fails.

### Validation on Real Tracks

Ran the detector on the 3 test tracks and found:

- **12 Pre-Roll Blues**: RMS floor ~-86dB (silence), jumps to -16.6dB at ~0.1s (first 50ms frame of music). Rise of ~70dB exceeds 3dB threshold. Onset at 0.1s is < 2s minimum, so returns 0. Correct.
- **8 Fo' A Hunnit**: Similar pattern, immediate rise at ~0.1s, returns 0.
- **90s Car Ad**: Same behavior, returns 0.

**Key insight:** These production tracks have no intro - they start immediately with full musical energy. A talkup value of 0 means Dead John can begin talking from the song's opening, which is correct for on-air use.

### Correctness Properties

After the fix:

1. **Talkup plausibility:** For each real track, `talkup_seconds` is non-zero and between 0 and 30.
2. **Fallback reserve:** Fallback (8 s) is only returned if astats produces no RMS data or if all RMS values are within 3 dB of each other.
3. **Margin applied:** If onset is detected at time T, returned value is `T - 0.5` (clamped to 0).
4. **Regression test:** A synthetic fixture with known onset (e.g., quiet for 5 s, then loud) detects within ±1 s of expected.

### Implementation Changes

**File: `tools/library/src/analyze.ts`**

- Replace the ffmpeg astats pipeline with a new approach:
  - Spawn ffmpeg with `-f f32le` to output raw 32-bit float samples.
  - Read samples into a buffer in Node.js.
  - Split into 50 ms frames and compute RMS locally.
  - Find the first frame where `current_rms - min_rms_in_4s >= 3 dB`.
- Lower `TALKUP_RISE_THRESHOLD_DB` to 3 (to catch gradual energy builds).
- Improve error handling for ffmpeg failures and invalid audio data.
- Add detailed logging for debugging.

**File: `tools/library/src/library.ts`**

- Strip `source_size` and `source_mtime` from the written library.json.
- Change `mp3` from `"../../.deadair/library_mp3/x.mp3"` to `"/audio/<slug>.mp3"`.

**File: `tools/library/src/cache.ts`** (new behavior)

- Move cache logic to save/load from `data/.library-cache.json` instead of embedding cache fields in `library.json`.
- Load cache at startup from `.library-cache.json` if it exists.
- After writing library.json, write cache to `.library-cache.json` atomically.

**File: `.gitignore`** (update)

- Ensure `data/.library-cache.json` is in `.gitignore`.

**File: `tools/library/tests/talkup.test.ts`**

- Deprecate or simplify the existing e2e tests that rely on ffmpeg astats metadata (they never actually tested real detection).
- Add a test case: quiet (5 s at -50 dB) + loud (5 s at -5 dB) WAV generated with FFmpeg → expect onset ~5 s, so talkup ~4.5 s.
- Assert detected value is within ±1 s of expected.

## Testing Strategy

### Unit Test: Realistic Fixture

Generate a WAV with:
- 5 seconds of noise at -50 dB (quiet intro).
- 15 seconds of a 1 kHz sine at -5 dB (loud section, simulating full drums).
- Analyze and assert `talkup_seconds` is in the range [3.5, 5.5] (onset ~5 s, minus 0.5 s margin).

### Integration Test: Smoke Test Rerun

After the fix:
1. Run `npm run build && node dist/index.js` on the 3-song test set.
2. Print the `talkup_seconds` values from the resulting `library.json`.
3. Verify at least 2 out of 3 are non-fallback (ideally all 3).
4. If any are still 8 s, inspect the ffmpeg output for that track to diagnose further.

## Edge Cases Handled

1. **No RMS data:** ffmpeg fails or astats produces no output → fallback 8 s.
2. **Sustained tone, no rise:** All RMS values within 3 dB → fallback 8 s.
3. **Very early onset (< 2 s):** Currently returns 0 (design choice: talk-up only on intros). Confirm this is correct for the library.
4. **Long rise (> 30 s):** Clamp to 30 s (design choice: cap talk-up window).

## Backwards Compatibility

- Changes to the detection algorithm may result in different `talkup_seconds` values for existing tracks. This is acceptable (and desired, since current values are wrong).
- Stripping cache fields from `library.json` is a breaking change for any tool that reads those fields directly. However, per design.md, cache fields are "internal" and should never have been exposed.
- Changing `mp3` from relative to absolute URLs is a breaking change if the broadcast code reads from `library.json`. Verify that the broadcast code expects `/audio/<slug>.mp3` format.

---

## Review Round 2: Why talkup = 0 Was Wrong

### What happened

Round 1 replaced astats parsing with direct PCM analysis using 50 ms frames. The algorithm compared each frame's RMS to the rolling minimum over the preceding 4 seconds and triggered on the first 3 dB rise. This seemed to work on synthetic tests but failed on real music.

The measured values from all three tracks with the round-1 detector:

| Track | Detected | Expected |
|---|---|---|
| 12 Pre-Roll Blues | 0 | ~13.5 to 15 s |
| 8 Fo' A Hunnit | 0 | ~15 to 16.5 s |
| 90s Car Ad | 0 | ~15 to 16 s |

### Why 50 ms frames and 3 dB threshold failed

Real music is highly dynamic within a 50 ms window. Even in the intro section, individual frames fluctuate 5 to 10 dB between consecutive windows as the beat hits and releases. The very first frame may be near-zero (PCM padding or a fractional-millisecond of silence in the header), and the second frame contains the attack of the first note in the intro. That one-frame jump easily exceeds 3 dB, so onset is detected at ~0.1 s.

Measured RMS in 0.5 s windows confirmed the real picture:

- **12 Pre-Roll Blues**: intro RMS ranges -13 to -25 dB for 0-12 s. Shift to consistently -10 to -11 dB begins around 12-14 s.
- **8 Fo' A Hunnit**: intro -15 to -26 dB for 0-14 s. Sustain above -12 dB begins around 15 s.
- **90s Car Ad**: intro -15 to -23 dB for 0-15 s. Step up to -8 to -9 dB at ~15.5 s.

The characteristic signature is not a single-frame spike but a **sustained level shift**: the smoothed energy stays clearly above the intro baseline for multiple windows.

### New algorithm: baseline + sustained rise

1. **Window size:** 0.5 s (11025 samples at 22050 Hz). Larger windows average over beat transients.
2. **Smoothing:** 2 s moving average over the per-window RMS values (4 windows). This further suppresses per-beat fluctuations.
3. **Baseline:** median of the smoothed values over the first 4 s (8 windows). Median is robust to a loud hit in the first bar.
4. **Rise condition:** smoothed level must be at least `TALKUP_RISE_DB` (4 dB) above the baseline **for at least `TALKUP_SUSTAIN_S` (2 s) continuously**.
5. **Onset time:** the start of the first 2 s sustained run.
6. **Return value:** `onset - TALKUP_SAFETY_MARGIN_S` (0.5 s), clamped to [0, 30].
7. **Fallback:** 8 s if no sustained rise found.

Named constants (all in `analyze.ts`):

```ts
const TALKUP_WINDOW_S          = 0.5;  // RMS window size
const TALKUP_SMOOTH_S          = 2.0;  // smoothing window
const TALKUP_BASELINE_S        = 4.0;  // initial segment used for baseline
const TALKUP_RISE_DB           = 4.0;  // dB above baseline to count as a rise
const TALKUP_SUSTAIN_S         = 2.0;  // how long the rise must hold
const TALKUP_SAFETY_MARGIN_S   = 0.5;  // subtract from onset
const TALKUP_CAP_S             = 30;
const TALKUP_FALLBACK_S        = 8;
const ANALYSIS_WINDOW_S        = 45;   // only look at first 45 s
```

### Property-based tests (fast-check)

Two properties to add to `talkup.test.ts`:

1. **Rise property:** for any quiet-then-loud envelope where the loud section starts at time `t` in [3, 25] s and is at least 6 dB above the quiet section, the detector returns a value within 1.5 s of `t`.
   - Generate: N seconds of noise at `quietDb`, then M seconds at `quietDb + riseDb`, with `t = N`, `riseDb >= 6`, `t in [3, 25]`.
   - Assert: `Math.abs(result - t) <= 1.5`.

2. **Flat property:** for any flat envelope (constant amplitude across the whole clip), the detector returns the fallback value 8.
   - Generate: K seconds of noise at any amplitude between -60 and -10 dB.
   - Assert: `result === 8`.

Use `fc.float` and `fc.integer` from fast-check. Generate PCM buffers in memory (same approach as existing tests, no ffmpeg needed for the property tests since `analyzePcmForTalkup` takes a Buffer directly).

