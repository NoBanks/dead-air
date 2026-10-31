# Tasks: Talk-Up Bugfix

## Phase 1: Diagnosis

- [x] **T1.1** Run ffmpeg astats on each of the 3 test tracks (from data/test-3tracks.csv). Extract RMS values and save output to temp files.
- [x] **T1.2** Inspect the astats output and document findings in design.md: ffmpeg 8.0's astats filter doesn't emit per-frame metadata to stderr despite `metadata=1:reset=1`. Updated design.md with root cause analysis.
- [x] **T1.3** Determined that the fix is to directly analyze WAV samples in Node.js rather than relying on ffmpeg metadata parsing.

## Phase 2: Fix the Detector

- [x] **T2.1** Replaced astats-based parsing with direct PCM analysis. Extract 32-bit float samples at 22050 Hz and compute RMS locally in Node.js.
- [x] **T2.2** Lowered `TALKUP_RISE_THRESHOLD_DB` from 6 to 3 to catch gradual energy builds.
- [x] **T2.3** Ran `npm run test` and all tests pass.

## Phase 3: Add Regression Test

- [x] **T3.1** Added a new test in `talkup.test.ts` that generates a realistic fixture: 5 s of quiet noise (-50 dB) + 15 s of loud tone (-5 dB).
- [x] **T3.2** Test asserts that the detected `talkup_seconds` is within 1 s of the expected value. Test detects 4.95s (expected ~4.5s, tolerance ±1s).
- [x] **T3.3** All 5 tests pass, including the new regression test.

## Phase 4: Strip Cache Fields and Fix MP3 Path

- [x] **T4.1** Updated `types.ts`: Removed `source_size` and `source_mtime` from `LibraryEntry` public interface (kept in `LibraryEntryInternal`).
- [x] **T4.2** Updated `library.ts` to strip cache fields from library.json output and map `mp3` to `/audio/<slug>.mp3`.
- [x] **T4.3** Created separate cache persistence: `loadCache` reads from `.library-cache.json` and `writeLibrary` writes both library.json and cache file atomically.
- [x] **T4.4** Updated `cache.ts` to load from `.library-cache.json` and `isCached` now returns boolean.
- [x] **T4.5** Updated `.gitignore` to include `data/.library-cache.json`.
- [x] **T4.6** `npm run build` compiles successfully with no errors.

## Phase 5: Verify Fixes

- [x] **T5.1** Ran `npm run test`. All 29 tests pass (4 test files, including 5 new/updated talkup tests).
- [x] **T5.2** Reran the 3-song smoke test. All 3 tracks encoded successfully (cache hit on re-run).
- [x] **T5.3** Inspected `data/library.json`: No `source_size` or `source_mtime` fields present. All `mp3` fields are `/audio/<slug>.mp3`.
- [x] **T5.4** Final talkup_seconds values from smoke test:
  - 12 Pre-Roll Blues: 0s (energy rise at ~0.1s, onset < 2s)
  - 8 Fo' A Hunnit: 0s (energy rise at ~0.1s, onset < 2s)
  - 90s Car Ad: 0s (energy rise at ~0.1s, onset < 2s)
- [x] **T5.5** Verified `data/.library-cache.json` exists with correct cache data (source_size, source_mtime per slug). File is gitignored.

## Notes

- All ffmpeg child processes must use `windowsHide: true` on Windows (already in place).
- Fallback of 8 s is only used if detection fails (no RMS data or no rise detected).
- Keep changes minimal; do not refactor unrelated code.
- No git commits as per user request.

## Phase 6: Round-2 Algorithm (Baseline + Look-Ahead Median)

- [x] **T6.1** Replaced `analyzePcmForTalkup` with new algorithm: 0.5 s windows, 8 s baseline, 2 s look-ahead median, 4 dB rise, 1 dB tolerance for first-window pinpointing.
- [x] **T6.2** Updated all named constants (see analyze.ts): `TALKUP_WINDOW_S`, `TALKUP_BASELINE_S`, `TALKUP_LOOKAHEAD_S`, `TALKUP_RISE_DB`, `TALKUP_TOLERANCE_DB`, `TALKUP_MIN_SCAN_S`. Removed obsolete smoothing/sustain constants.
- [x] **T6.3** Updated `detectTalkup` to force stereo output (`-ac 2`) so channel count matches `analyzePcmForTalkup` default.
- [x] **T6.4** Added property-based tests via fast-check:
  - Rise property (40 runs): quiet intro [9,25]s + rise >=6 dB -> result within 1.5 s of expected onset. PASS.
  - Flat property (40 runs): any constant-amplitude clip -> result === 8. PASS.
- [x] **T6.5** Updated e2e tests: 10s quiet at -40 dB + 25s loud fixture; "immediate onset" and "flat" tests updated.
- [x] **T6.6** `npm run build` compiles without errors.
- [x] **T6.7** `npm run test`: all 32 tests pass (slug x11, csv x6, slug-property x7, talkup x8).
- [x] **T6.8** 3-song smoke test talkup values:
  - 12 Pre-Roll Blues: **15.0s** (expected 13.5-15s) ✓
  - 8 Fo' A Hunnit:   **16.5s** (expected 16-17s) ✓
  - 90s Car Ad:       **15.0s** (expected 15-16s) ✓
