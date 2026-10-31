# Requirements: station-library

## Overview

The station-library tool builds and maintains the on-disk music library that the
DEAD AIR broadcast engine reads at runtime. It reads a master track list, encodes
each WAV to a loudness-normalized MP3, analyzes each track for talk-up timing,
and writes a single JSON index the scheduler can consume. The tool is designed to
run locally on the engineer's machine; output audio never enters the git repository.

---

## User Stories and Acceptance Criteria

### REQ-1: Read and validate the source CSV

**As a** station engineer,
**I want** the tool to load the master track list from a CSV file,
**so that** I have one authoritative source of truth for every song in the library.

WHEN the tool is invoked with a valid CSV path,
THE SYSTEM SHALL parse every row and expose: title, seconds, mstr flag, ext,
versions count, file size in MB, and the absolute path to the WAV file.

WHEN a CSV row is missing required columns (title, file),
THE SYSTEM SHALL log a warning that names the row number and skip that row
without halting the run.

WHEN the CSV file does not exist or cannot be read,
THE SYSTEM SHALL exit with a non-zero code and a human-readable error message.

---

### REQ-2: Exclude titles on the blocklist

**As a** station engineer,
**I want** certain titles kept off air permanently,
**so that** tracks that are not ready or not appropriate are never encoded or
broadcast.

WHEN a track's title exactly matches a line in `/data/exclude.txt`
(case-insensitive, trimmed),
THE SYSTEM SHALL skip that track entirely: no analysis, no encoding, no entry
in `library.json`.

WHEN `/data/exclude.txt` does not exist,
THE SYSTEM SHALL treat the blocklist as empty and continue without error.

WHEN a title is removed from `/data/exclude.txt` and the tool is re-run,
THE SYSTEM SHALL process that title as a new track on the next run.

---

### REQ-3: Measure loudness, true peak, and duration

**As a** station engineer,
**I want** each WAV's integrated loudness, true peak, and exact duration measured
before encoding,
**so that** the normalized output meets the -14 LUFS / -1 dBTP broadcast standard.

WHEN the tool processes a WAV file,
THE SYSTEM SHALL invoke ffmpeg's `loudnorm` filter in measurement mode and
extract: integrated LUFS, true peak dBTP, and duration in seconds.

WHEN ffmpeg is not found at the path given by the `FFMPEG` environment variable,
THE SYSTEM SHALL exit immediately with a clear error message before processing
any files.

WHEN ffmpeg returns a non-zero exit code for a specific file,
THE SYSTEM SHALL log the error with the file path, skip that file, and continue
with the remaining tracks.

---

### REQ-4: Detect the talk-up window

**As a** Dead John voice script generator,
**I want** to know how many seconds from the start of a song a DJ can safely talk
before the music demands attention,
**so that** Dead John's talk-ups always hit the post without stepping on a
significant musical moment.

WHEN the tool analyzes a WAV file,
THE SYSTEM SHALL compute `talkup_seconds`: the time in seconds from the start of
the track until the first point where audio energy rises sharply (the post), minus
a 0.5-second safety margin.

WHEN the detected post falls before 2 seconds from the start,
THE SYSTEM SHALL record `talkup_seconds` as 0, indicating no safe talk-up window.

WHEN the detected post is beyond 30 seconds from the start,
THE SYSTEM SHALL cap `talkup_seconds` at 30 seconds.

WHEN the WAV contains no detectable energy rise (e.g., a fade-in track),
THE SYSTEM SHALL fall back to a default of 8 seconds and log a notice.

---

### REQ-5: Encode each track to a normalized MP3

**As a** broadcast engineer,
**I want** each track encoded once to a loudness-normalized 256 kbps MP3,
**so that** the station never broadcasts a track that is too quiet or too loud
relative to the others.

WHEN the tool encodes a track,
THE SYSTEM SHALL produce a 256 kbps MP3 at 44.1 kHz stereo, normalized to
-14 LUFS integrated and -1 dBTP true peak, using a two-pass loudnorm encode.

WHEN encoding completes successfully,
THE SYSTEM SHALL write the MP3 to `$LIBRARY_OUT/<slug>.mp3`.

WHEN `$LIBRARY_OUT` does not exist,
THE SYSTEM SHALL create it (recursively) before writing the first file.

WHEN the `LIBRARY_OUT` environment variable is not set,
THE SYSTEM SHALL exit with a non-zero code and a clear error message before
encoding any files.

---

### REQ-6: Generate a stable URL-safe slug for each track

**As a** web developer,
**I want** every track identified by a stable, URL-safe slug derived from its title,
**so that** MP3 file names and JSON IDs are predictable and do not change between
runs unless the title changes.

WHEN the tool slugifies a title,
THE SYSTEM SHALL produce a lowercase string containing only `a-z`, `0-9`, and
hyphens, with no leading or trailing hyphens and no consecutive hyphens.

WHEN two distinct titles produce the same slug,
THE SYSTEM SHALL append a numeric suffix (`-2`, `-3`, ...) to the later slug to
ensure uniqueness within a single run.

WHEN a title contains only characters that are stripped by the slug algorithm
(e.g., all punctuation),
THE SYSTEM SHALL fall back to `track-<n>` where `<n>` is the 1-based row index.

---

### REQ-7: Record the mastered-at timestamp

**As a** Dead John script generator,
**I want** to know when each song was mastered,
**so that** Dead John can say things like "This one's from a night in March, two
years back."

WHEN the tool processes a WAV file,
THE SYSTEM SHALL read the file's last-modified time from the filesystem and store
it as `made_at` in ISO 8601 UTC format (e.g., `"2024-03-14T02:00:00.000Z"`).

---

### REQ-8: Write the library JSON index

**As a** broadcast scheduler,
**I want** a single JSON file listing all encoded tracks with their metadata,
**so that** the scheduler can build the broadcast clock without reading individual
audio files.

WHEN all tracks have been processed,
THE SYSTEM SHALL write `/data/library.json` containing an array of track objects
sorted alphabetically by title (case-insensitive).

WHEN `/data/library.json` already exists,
THE SYSTEM SHALL overwrite it atomically (write to a temp file, then rename).

Each track object in `library.json` SHALL contain exactly these fields:

| Field            | Type   | Description                                         |
|------------------|--------|-----------------------------------------------------|
| `id`             | string | Same as `slug`                                      |
| `slug`           | string | URL-safe stable identifier                          |
| `title`          | string | Exact title from the CSV                            |
| `seconds`        | number | Duration in seconds, rounded to two decimal places  |
| `talkup_seconds` | number | Safe talk-up window in seconds                      |
| `lufs`           | number | Measured integrated loudness of the source WAV      |
| `made_at`        | string | ISO 8601 UTC timestamp from WAV file mtime          |
| `mp3`            | string | Relative path from repo root to the MP3 file        |

---

### REQ-9: Resumable incremental runs

**As a** station engineer,
**I want** the tool to skip tracks that are already encoded and unchanged,
**so that** adding a few new tracks to the library does not require re-encoding
all 1,100 songs.

WHEN a track's MP3 already exists in `$LIBRARY_OUT` AND the source WAV's file
size and mtime match the values recorded in the existing `library.json`,
THE SYSTEM SHALL skip analysis and encoding for that track and reuse the existing
entry.

WHEN the source WAV has changed (different size or mtime),
THE SYSTEM SHALL re-analyze and re-encode that track and update its entry.

WHEN `--force` is passed on the command line,
THE SYSTEM SHALL re-encode all tracks regardless of cached state.

---

### REQ-10: Windows-safe ffmpeg invocation

**As a** Windows developer,
**I want** ffmpeg to run without a visible console window,
**so that** the tool's own progress output is not obscured by flashing ffmpeg
windows during a long batch run.

WHEN the tool spawns an ffmpeg child process on Windows,
THE SYSTEM SHALL pass `windowsHide: true` to Node's `child_process.spawn`.

WHEN the tool spawns an ffmpeg child process on any platform,
THE SYSTEM SHALL capture stderr (where ffmpeg writes its output) and never
forward it to the parent process's stdout or stderr unless an error occurs.

---

### REQ-11: Progress reporting

**As a** station engineer running a 1,100-track batch,
**I want** a live progress display in the terminal,
**so that** I can see how many tracks are done, how many remain, and whether any
have errored.

WHEN the tool is processing tracks,
THE SYSTEM SHALL display a progress line that updates in place showing:
`[done/total] title... (skipped | encoding | error)`.

WHEN the run completes,
THE SYSTEM SHALL print a summary: total tracks, encoded, skipped, errored.
