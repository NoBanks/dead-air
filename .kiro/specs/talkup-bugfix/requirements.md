# Requirements: Talk-Up Bugfix

## Summary
The talk-up detector (`tools/library/src/analyze.ts`) fails to find real energy rises in production music files, returning the fallback value of 8 seconds for every track in the 3-song smoke test. Additionally, `library.json` incorrectly includes internal cache fields and uses filesystem-relative paths for MP3 URLs instead of the public `/audio/<slug>.mp3` format.

## Background

The station needs to know where each song's intro ends so Dead John can talk over the instrumental without hitting the vocal (the "post"). The detector runs `ffmpeg astats` to extract per-frame RMS energy from the first 60 seconds of each WAV file, then looks for the first frame where energy jumps more than 6 dB compared to the preceding 4-second rolling minimum.

Current state:
- The 3-song smoke test (data/test-3tracks.csv) shows all songs with `talkup_seconds: 8` (fallback).
- Unit tests pass because they use synthetic tones with sharp transitions.
- Real music has gradual energy buildup that the detector misses.

## EARS Criteria

### Effectiveness
- Detector finds a real (non-fallback) value for each of the 3 production tracks.
- Detected onset is physically plausible: within the first 30 seconds of the track.
- A regression test confirms detection works on a realistic fixture (quiet intro + sudden loud section).

### Accuracy
- Detected talkup is within ±1 second of the visually measured energy rise when inspected with ffmpeg.
- Safety margin (0.5 s) is consistently applied.
- Clamp to [0, 30] is respected.
- Fallback (8 s) is only used when detection truly fails (e.g., sustained tone with no rise).

### Efficiency
- Analysis runs in a single ffmpeg pass (astats metadata mode) per file.
- No additional round trips to the ffmpeg binary.
- Child processes use `windowsHide: true` on Windows.

### Resilience
- When ffmpeg fails or astats output is malformed, the detector falls back to 8 s.
- No uncaught exceptions during parsing.

### Simplicity
- The detection algorithm is clear: find the first frame where current RMS exceeds the 4-second rolling minimum by the threshold.
- Root cause analysis and fix are documented in design.md.

## Out of Scope
- Tuning the 6 dB threshold for different music genres.
- Analyzing the full file instead of the first 60 seconds (by design, we only talk over intros).
- Exposing `talkup_seconds` as a tunable field in library.json (it is read-only, computed).

## Acceptance Criteria

1. **Diagnosis complete:** Run ffmpeg astats on each of the 3 test tracks. Document the actual RMS output and explain why the current detector fails.
2. **Detector fixed:** Modify `analyze.ts` so at least one track returns a non-fallback value; ideally all three.
3. **Regression test added:** Write a test in `tests/talkup.test.ts` that generates a realistic fixture (quiet intro + loud section) and asserts the detected value is within 1 s of expected.
4. **Cache fields stripped:** `library.json` written to disk contains no `source_size` or `source_mtime` fields. Cache is persisted separately in `data/.library-cache.json` (gitignored).
5. **MP3 path fixed:** Each entry's `mp3` field is a public URL: `/audio/<slug>.mp3` instead of a relative filesystem path.
6. **Tests pass:** `npm run test` (vitest) runs green.
7. **Smoke test rerun:** After fixes, run the 3-song test again and report the three `talkup_seconds` values. All should be non-fallback.
