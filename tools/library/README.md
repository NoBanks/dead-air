# tools/library: Station Library Builder

TypeScript Node CLI that builds the DEAD AIR on-disk music library. Reads a master CSV track list, analyzes each WAV for loudness and talk-up timing, encodes to MP3 (256 kbps, -14 LUFS), and writes a JSON index.

## Setup

```bash
cd tools/library
npm install
npm run build
```

## Usage

Set environment variables:

```bash
export FFMPEG=/path/to/ffmpeg          # ffmpeg binary
export CSV_PATH=/path/to/tracks.csv    # source CSV
export LIBRARY_OUT=/path/to/output     # MP3 output folder
```

Then run:

```bash
npm start [--force] [--dry-run] [--concurrency=N]
```

Flags:
- `--force`: Re-encode all tracks (ignore cache).
- `--dry-run`: Print what would be encoded; write nothing.
- `--concurrency=N`: Number of parallel workers (default 4).

## Smoke Test (3 tracks)

```bash
export FFMPEG="C:\Users\machi\Downloads\ffmpeg-8.0.1-essentials_build_CLEAN\bin\ffmpeg.exe"
export CSV_PATH="C:\Users\machi\apps\dead-air\data\test-3tracks.csv"
export LIBRARY_OUT="C:\Users\machi\.deadair\library_mp3"

npm start
# First run:  encoded=3, skipped=0
# Second run: encoded=0, skipped=3 (cache works)
```

Output: `../../.deadair/library_mp3/*.mp3` and `/data/library.json`.

## CSV Format

Required columns: `title`, `file`. Optional: `seconds`, `mstr`, `ext`, `versions`, `file_size_mb`.

```
title,file,seconds,mstr,ext,versions,file_size_mb
My Song,/music/my-song.wav,120,true,wav,1,50.0
```

## Output: library.json

Array of tracks sorted by title (case-insensitive):

```json
[
  {
    "id": "my-song",
    "slug": "my-song",
    "title": "My Song",
    "seconds": 120.00,
    "talkup_seconds": 10.5,
    "lufs": -14.0,
    "made_at": "2026-03-14T02:00:00.000Z",
    "mp3": "../../.deadair/library_mp3/my-song.mp3",
    "source_size": 5000000,
    "source_mtime": 1742014800000
  }
]
```

Internal fields (`source_size`, `source_mtime`) enable resumable incremental runs: unchanged tracks are skipped on re-run.

## Tests

```bash
npm test             # Run all tests
npm run test:watch   # Watch mode
```

- **slug.test.ts**: 11 tests (normalization, dedup, fallback).
- **csv.test.ts**: 6 tests (parsing, validation, error handling).
- **talkup.test.ts**: 5 tests (synthetic WAV generation, energy rise detection).
- **slug.property.test.ts**: 7 tests (property-based with fast-check).

All 29 tests pass.

## References

- Spec: `.kiro/specs/station-library/`
- Steering: `.kiro/steering/audio.md` (loudness targets, ducking)
