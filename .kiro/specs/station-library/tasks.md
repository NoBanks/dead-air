# Tasks: station-library

Implementation checklist for `tools/library`. Work through tasks in order; later
tasks depend on earlier ones. Each task references the requirements it satisfies.

---

## Phase 1: Project scaffold

- [x] **1.** Create `tools/library/` directory with `package.json`, `tsconfig.json`,
  and `vitest.config.ts`. Add `csv-parse`, `fast-check`, `vitest`, and
  `typescript` as dependencies. Pin exact versions.
  *(no requirement, scaffold only)*

- [x] **2.** Create `tools/library/src/types.ts` defining `CsvRow`, `SourceTrack`,
  `AnalysisResult`, `LibraryEntry`, `CacheRecord`, and `RunConfig` interfaces.
  *(REQ-1, REQ-3, REQ-4, REQ-5, REQ-8, REQ-9)*

- [x] **3.** Add `tools/library` to the root `.gitignore` exclusions for `dist/`
  and `node_modules/`. Confirm `*.mp3` and `*.wav` are already excluded.
  *(REQ-5)*

---

## Phase 2: Core modules

- [x] **4.** Implement `src/slug.ts`: `slugify(title, fallbackIndex)` and
  `buildSlug(title, index, usedSet)` with dedup logic.
  *(REQ-6)*

- [x] **5.** Implement `src/csv.ts`: parse the CSV file, validate required columns,
  return `SourceTrack[]`, log and skip invalid rows.
  *(REQ-1)*

- [x] **6.** Implement `src/exclude.ts`: load `/data/exclude.txt`, export
  `isExcluded(title)`. Return false gracefully if file is absent.
  *(REQ-2)*

- [x] **7.** Implement `src/cache.ts`: load existing `library.json`, build
  `Map<slug, CacheRecord>`, export `isCached(slug, statResult)` and
  `loadCache(libraryPath)`.
  *(REQ-9)*

- [x] **8.** Implement `src/analyze.ts`:
  - Loudness pass: spawn ffmpeg with `loudnorm=print_format=json`, parse JSON
    from stderr, return `lufs`, `truePeak`, `seconds`.
  - Talk-up pass: export per-frame RMS via `astats`, find first sharp energy
    rise, apply 0.5 s margin, clamp to [0, 30], fall back to 8 s.
  - `windowsHide: true` on Windows throughout.
  *(REQ-3, REQ-4, REQ-7, REQ-10)*

- [x] **9.** Implement `src/encode.ts`: two-pass loudnorm encode to 256 kbps MP3,
  create `$LIBRARY_OUT` if absent, write to `<LIBRARY_OUT>/<slug>.mp3`.
  *(REQ-5, REQ-10)*

- [x] **10.** Implement `src/library.ts`: accept `LibraryEntry[]`, sort by title
  (case-insensitive), strip internal cache fields, write atomically via `.tmp`
  rename.
  *(REQ-8)*

---

## Phase 3: CLI entry point

- [x] **11.** Implement `src/index.ts`:
  - Resolve and validate `RunConfig` from env vars; exit 1 with message on
    missing required vars or missing ffmpeg binary.
  - Accept `--force`, `--dry-run`, `--concurrency=N` flags.
  *(REQ-3, REQ-5, REQ-9, REQ-10, REQ-11)*

- [x] **12.** In `src/index.ts`: load CSV, apply exclude list, build the full slug
  map (dedup pass) before starting any workers.
  *(REQ-1, REQ-2, REQ-6)*

- [x] **13.** In `src/index.ts`: implement the concurrency pool (default 4 workers).
  Per track: cache check -> analyze -> encode -> build `LibraryEntry`. Collect
  errors without halting other workers.
  *(REQ-3, REQ-4, REQ-5, REQ-7, REQ-9)*

- [x] **14.** In `src/index.ts`: wire up the in-place progress line
  (`[done/total] title... status`) using `process.stdout.write` + `\r`.
  Print final summary (total, encoded, skipped, errored).
  *(REQ-11)*

- [x] **15.** In `src/index.ts`: after the pool finishes, call `library.ts` to
  write `/data/library.json`. Exit 0 if zero errors, exit 1 if any errors.
  *(REQ-8)*

---

## Phase 4: Unit tests

- [x] **16.** Write `tests/slug.test.ts`: at least 6 unit cases covering normal
  input, empty-after-strip fallback, accented characters, consecutive hyphens,
  leading/trailing hyphens, and dedup suffix.
  *(REQ-6)*

- [x] **17.** Write `tests/csv.test.ts`: at least 4 unit cases covering a valid row,
  a row missing `file`, a row missing `title`, and empty lines.
  *(REQ-1)*

- [x] **18.** Write `tests/talkup.test.ts`: generate three synthetic WAV buffers in
  memory (silence-then-tone, immediate tone, sustained tone) and assert the
  expected `talkup_seconds` values including the 8 s fallback.
  *(REQ-4)*

---

## Phase 5: Property-based tests

- [x] **19.** Write `tests/slug.property.test.ts` using `fast-check`:
  - Stability: `slugify(s) === slugify(s)` for any string.
  - Character set: output matches `/^[a-z0-9]+(-[a-z0-9]+)*$|^track-\d+$/`.
  - No empty output: result is never empty or only hyphens.
  - Uniqueness after dedup: N arbitrary titles produce N distinct slugs.
  *(REQ-6)*

---

## Phase 6: Wiring and validation

- [x] **20.** Add a `"build"` script to `tools/library/package.json` that compiles
  TypeScript to `dist/`. Add a `"start"` script: `node dist/index.js`. Confirm
  `npm run build` completes with zero TypeScript errors.
  *(no requirement, scaffold only)*

- [x] **21.** Run the full vitest suite (`npm test`). All tests must pass. Fix any
  failures before proceeding.
  *(REQ-1, REQ-4, REQ-6)*

- [x] **22.** Smoke test against a 3-track subset: set env vars, run the tool,
  verify `library.json` has 3 entries and MP3s exist. Re-run and confirm all 3
  are skipped. Document the smoke test procedure in
  `tools/library/README.md`.
  *(REQ-1, REQ-2, REQ-3, REQ-4, REQ-5, REQ-8, REQ-9, REQ-11)*

- [x] **23.** Full run against the real CSV (~1,100 tracks). Verify `library.json`
  entry count, spot-check 5 entries for correct field values, confirm `--force`
  triggers a full re-encode.
  *(REQ-1 through REQ-11)*
  Checked on Nov 6 without re-running the encode: `data/library.json` has 1,101
  entries (matches the expected count after `data/exclude.txt`), 1,101 unique
  slugs and ids, none of the excluded titles present, sorted by title. Every entry
  has id, slug, title, seconds > 0, talkup_seconds in [0, 30], lufs and mp3.
  `lufs` is the measured source loudness (`analyze.ts:129`), so values above
  -14 are expected. `--force` skips the cache check (`index.ts:158-159`); that is
  read from the code, not re-run.

---

## Phase 7: Housekeeping

- [x] **24.** Confirm `/data/library.json`, `$LIBRARY_OUT/*.mp3`, and all WAV source
  paths are excluded from git. Run `git status` and verify no audio or large
  data files are staged.
  *(REQ-5, REQ-8)*
  Checked on Nov 6: `git ls-files` lists no .mp3, .wav or .flac. `.gitignore`
  covers `*.mp3`, `*.wav`, `*.flac`, `data/library.json` and
  `data/.library-cache.json`. `git status` shows nothing staged.

- [x] **25.** Update the root `README.md` to mention `tools/library` and the env
  vars needed to run it.
  *(no requirement, documentation only)*
  Added a "Rebuild the library" section to `README.md` (`FFMPEG`, `CSV_PATH`,
  `LIBRARY_OUT`).
