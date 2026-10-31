# Design: station-library

## Overview

`tools/library` is a standalone Node.js CLI written in TypeScript. It runs once
per batch and produces `/data/library.json` plus a folder of MP3 files. Nothing
in this tool runs at broadcast time; it is purely an offline build step.

---

## Directory layout

```
tools/library/
  src/
    index.ts          # CLI entry point, orchestration, progress output
    csv.ts            # CSV parser, row validation
    exclude.ts        # Load and apply the blocklist
    slug.ts           # Title-to-slug conversion and dedup
    analyze.ts        # ffmpeg loudness + talkup measurement
    encode.ts         # ffmpeg two-pass loudnorm encode
    cache.ts          # Resume logic: check source size + mtime vs library.json
    library.ts        # Build and write /data/library.json
    types.ts          # Shared TypeScript interfaces
  tests/
    slug.test.ts
    csv.test.ts
    talkup.test.ts
    slug.property.test.ts   # fast-check property tests
  package.json
  tsconfig.json
```

`/data/library.json` and `$LIBRARY_OUT/*.mp3` are produced artifacts. Neither
enters git (see `.gitignore`).

---

## Module responsibilities

### `types.ts`

Defines the canonical interfaces used across all modules.

```
CsvRow          raw data from one CSV row (pre-validation)
SourceTrack     validated row ready for processing
AnalysisResult  loudness, true peak, duration, talkup_seconds
LibraryEntry    the shape of one object written to library.json
CacheRecord     source_size + source_mtime stored per slug in library.json
                (additional fields beyond the public API, stripped on write)
RunConfig       env vars + CLI flags resolved at startup
```

### `csv.ts`

- Parses the CSV using the `csv-parse` library (sync, small file).
- Validates required columns: `title`, `file`.
- Returns `SourceTrack[]`. Logs and skips invalid rows (REQ-1).

### `exclude.ts`

- Reads `/data/exclude.txt`, trims and lowercases each line.
- Exports `isExcluded(title: string): boolean`.
- Returns false without throwing when the file is absent (REQ-2).

### `slug.ts`

- Converts a title to a slug: NFD-normalize, strip non-ASCII, lowercase,
  replace non-alphanumeric runs with a single hyphen, trim leading/trailing
  hyphens.
- Accepts a `Set<string>` of already-used slugs and appends `-2`, `-3`, ... to
  resolve collisions (REQ-6).
- Falls back to `track-<n>` if the cleaned string is empty (REQ-6).

### `analyze.ts`

Two ffmpeg passes, both with `windowsHide: true` on Windows (REQ-10):

**Loudness pass** (`ffmpeg -i <wav> -af loudnorm=print_format=json -f null -`):
  - Parses the JSON block from stderr.
  - Extracts `input_i` (integrated LUFS), `input_tp` (true peak), and
    `input_dur` (duration seconds) (REQ-3).

**Talk-up pass** (using `astats` or `volumedetect` per-frame):
  - Exports per-frame RMS energy from the first 60 seconds of the file.
  - Finds the first frame where the rolling 1-second RMS rises by more than
    `TALKUP_RISE_THRESHOLD` dB (default 6 dB) compared to the minimum of the
    preceding 4 seconds.
  - Subtracts 0.5 s safety margin (REQ-4).
  - Clamps to [0, 30]. Falls back to 8 s if no rise found (REQ-4).

`ffmpeg` path comes from `RunConfig.ffmpegPath` (env var `FFMPEG`). Absence of
the binary causes immediate exit before any file is processed (REQ-3).

### `encode.ts`

Two-pass loudnorm encode (REQ-5):

1. **Measure pass**: same loudnorm JSON as `analyze.ts` (reuse if already done).
2. **Encode pass**: `ffmpeg -i <wav> -af loudnorm=I=-14:TP=-1:LRA=11:
   measured_I=<i>:measured_TP=<tp>:measured_LRA=<lra>:measured_thresh=<t>:
   linear=true -c:a libmp3lame -b:a 256k -ar 44100 -ac 2 <out.mp3>`

`$LIBRARY_OUT` is created recursively if absent (REQ-5).

### `cache.ts`

At startup, `cache.ts` reads the existing `library.json` (if any) and builds a
`Map<string, CacheRecord>` keyed by slug. A cache hit requires:

```
existingEntry.source_size === stat.size  AND
existingEntry.source_mtime === stat.mtimeMs  AND
fs.existsSync(mp3Path)
```

`--force` bypasses all cache checks (REQ-9).

### `library.ts`

- Accepts the final `LibraryEntry[]`, sorts by title (case-insensitive).
- Strips internal `CacheRecord` fields (`source_size`, `source_mtime`) before
  writing.
- Writes atomically: `library.json.tmp` then `fs.renameSync` (REQ-8).

### `index.ts`

Orchestration:
1. Resolve `RunConfig` (env vars, CLI flags). Fail fast on missing required vars.
2. Load CSV, apply exclude list.
3. Build slug map (dedup pass over all titles before processing begins).
4. Load cache from existing `library.json`.
5. Process tracks concurrently with a concurrency limit of 4 (configurable).
   Per track: check cache -> analyze -> encode -> build `LibraryEntry`.
6. After all tracks: call `library.ts` to write `library.json`.
7. Print summary (REQ-11).

Progress is rendered with a simple in-place line counter using `process.stdout.write`
and `\r`. No third-party progress-bar library needed (REQ-11).

---

## Data model

### `library.json` entry (public)

```jsonc
{
  "id":             "heal-my-mind",          // string, same as slug
  "slug":           "heal-my-mind",          // string
  "title":          "Heal My Mind",          // string, exact from CSV
  "seconds":        214.38,                  // number, 2 decimal places
  "talkup_seconds": 7.5,                     // number
  "lufs":           -18.4,                   // number, measured input LUFS
  "made_at":        "2024-03-14T02:00:00Z",  // ISO 8601 UTC
  "mp3":            "library/heal-my-mind.mp3" // relative from repo root
}
```

### Internal cache fields (stripped before write)

```
source_size:   number   // WAV file size in bytes at last encode
source_mtime:  number   // WAV file mtime in ms at last encode
```

These are kept in memory only and are never written to `library.json`. The cache
check reconstructs them from the current filesystem state on each run.

### `/data/library.json` on disk

- Top-level array of public entries sorted by `title` ascending.
- Valid JSON, two-space indented for readability and diffability.

---

## Environment variables and CLI flags

| Name          | Required | Description                                         |
|---------------|----------|-----------------------------------------------------|
| `FFMPEG`      | yes      | Absolute path to the ffmpeg binary                  |
| `LIBRARY_OUT` | yes      | Absolute path to the MP3 output folder              |
| `CSV_PATH`    | yes      | Absolute path to the source CSV                     |

| Flag      | Description                                      |
|-----------|--------------------------------------------------|
| `--force` | Re-encode all tracks, ignore cache               |
| `--dry-run` | Print what would be encoded; write nothing     |
| `--concurrency=N` | Number of parallel encode workers (default 4) |

---

## Error handling

| Failure mode                         | Behavior                                              |
|--------------------------------------|-------------------------------------------------------|
| Missing required env var             | Exit 1 before touching any files                      |
| ffmpeg binary not found              | Exit 1 before touching any files                      |
| CSV not found / unreadable           | Exit 1 with message                                   |
| Invalid CSV row (missing columns)    | Log warning, skip row, continue                       |
| WAV file not found                   | Log error for that track, skip, continue              |
| ffmpeg non-zero exit on a file       | Log stderr excerpt, mark track as errored, continue   |
| Disk full during encode              | Log error, skip remaining, print partial summary      |
| `library.json` write failure         | Attempt retry once, then exit 1 with message          |

Errors are always written to stderr. The progress display is on stdout.
The process exits 0 only if zero tracks errored; exits 1 if any track errored.

---

## Concurrency model

Tracks are processed in a pool of up to N workers (default 4). Each worker runs:
`analyze -> encode` sequentially for one track, then picks the next. This keeps
ffmpeg I/O saturated without spawning hundreds of processes at once.

The slug dedup pass and cache load happen in serial before the pool starts, so
the pool workers can read from immutable maps without locks.

---

## Testing strategy

### Unit tests (`vitest`)

**`slug.test.ts`** (REQ-6)
- `slugify("Heal My Mind")` returns `"heal-my-mind"`.
- `slugify("...!!!")` with empty fallback returns `"track-1"`.
- Accented characters are stripped: `slugify("Déjà Vu")` returns `"deja-vu"`.
- Consecutive hyphens are collapsed: `slugify("A  B")` returns `"a-b"`.
- Leading/trailing hyphens removed: `slugify("-Hello-")` returns `"hello"`.
- Dedup: two calls with the same slug in the used set produce `slug` and
  `slug-2`.

**`csv.test.ts`** (REQ-1)
- A well-formed CSV row is parsed to a `SourceTrack` with correct fields.
- A row missing `file` is skipped and a warning is emitted.
- A row missing `title` is skipped and a warning is emitted.
- Empty lines are ignored.

**`talkup.test.ts`** (REQ-4)
- Synthesize a test tone: 10 s of silence followed by a 1 kHz sine. Feed this
  to the talk-up detector. Expect `talkup_seconds` to be approximately 9.5 s
  (10 s onset minus 0.5 s margin).
- A tone that starts immediately at full volume should return `talkup_seconds`
  of 0.
- A 60 s sustained tone with no energy rise should return the 8 s fallback.

The test tone is generated programmatically in memory (a float32 PCM buffer
written to a temp WAV) so the test suite has no audio file dependencies.

### Property-based tests (`fast-check`, `slug.property.test.ts`) (REQ-6)

**Stability:** for any arbitrary string `s`, `slugify(s)` called twice returns
the same value.
```
fc.property(fc.string(), s => slugify(s) === slugify(s))
```

**Character set:** for any string `s`, the output of `slugify(s)` matches
`/^[a-z0-9]+(-[a-z0-9]+)*$|^track-\d+$/`.

**Uniqueness after dedup:** given a list of N arbitrary strings, after running
all of them through the dedup-aware slug builder, the resulting slug list has no
duplicates.
```
fc.property(
  fc.array(fc.string(), { minLength: 1, maxLength: 200 }),
  titles => {
    const used = new Set<string>();
    const slugs = titles.map((t, i) => buildSlug(t, i + 1, used));
    return new Set(slugs).size === slugs.length;
  }
)
```

**No empty output:** `slugify(s)` with a fallback index never returns an empty
string or a string of only hyphens.

### Integration smoke test

Not automated; documented in `tools/library/README.md`:
- Set `FFMPEG`, `LIBRARY_OUT`, `CSV_PATH` to a 3-track subset.
- Run `npm run build && node dist/index.js`.
- Verify `library.json` has 3 entries, MP3s exist, run again confirms all
  3 are skipped (cache hit).

---

## Correctness properties (suitable for property-based tests)

Beyond slug tests, these invariants should hold across any valid run:

1. **Completeness:** `library.json` entry count equals CSV row count minus
   excluded titles minus errored tracks.
2. **Sort order:** for any two adjacent entries `a[i]` and `a[i+1]`,
   `a[i].title.toLowerCase() <= a[i+1].title.toLowerCase()`.
3. **Slug identity:** `entry.id === entry.slug` for every entry.
4. **Slug uniqueness:** no two entries share the same `slug`.
5. **MP3 existence:** for every non-errored entry, `$LIBRARY_OUT/<slug>.mp3`
   exists on disk after the run.
6. **Talkup bounds:** `0 <= talkup_seconds <= 30` for every entry.
7. **Duration positive:** `seconds > 0` for every entry.
8. **Cache idempotence:** running the tool twice with the same input and no
   `--force` flag produces bit-identical `library.json` output and does not
   modify any MP3 file's mtime.
9. **Atomic write:** if the process is killed mid-write, no partial
   `library.json` is left behind (the `.tmp` rename ensures this).
