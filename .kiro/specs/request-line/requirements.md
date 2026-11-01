# Requirements: Request Line

## Background

Listeners can call the request line, send a dedication, and hear Dead John read it on air a few minutes later. Every listener hears the same read at the same moment because it is baked into the schedule, not streamed live.

## Functional requirements

### Web form (REQ-01 through REQ-05)

REQ-01: The tuner page SHALL include a form labeled "CALL THE REQUEST LINE" with four fields: from-name (1-20 letters), to-name (1-20 letters), message (0-140 characters), and song (search the library by title).

REQ-02: The song field SHALL perform a client-side title search against the library and let the listener pick one track by title. No track ID is shown to the user.

REQ-03: The form SHALL submit a POST /request with the four field values and nothing else.

REQ-04: On a 202 response the form SHALL display a ticket URL of the form /request/<ticket> and tell the listener roughly when to listen.

REQ-05: On a 400 response the form SHALL display the `reason` from the response body without modification. It SHALL NOT echo the text the listener submitted.

### Server validation (REQ-06 through REQ-14)

REQ-06: The server SHALL reject any from-name or to-name that is not 1-20 characters of letters, spaces, hyphens, or apostrophes.

REQ-07: The server SHALL reject any message longer than 140 characters or containing URLs (http/https/www), email patterns, @handles, or runs of 5 or more consecutive digits.

REQ-08: The server SHALL reject any field whose content matches a phrase in `data/blocklist.txt`. The blocklist SHALL NOT be sent to the browser.

REQ-09: When validation fails the server SHALL respond with HTTP 400 and a JSON body `{ "reason": "<message in Dead John's voice>" }`. The response SHALL NOT echo any of the submitted text.

REQ-10: The server SHALL enforce a per-IP rate limit of 1 request per 10 minutes. Exceeding this limit returns 429 with a reason in Dead John's voice.

REQ-11: The server SHALL enforce a station-wide rate limit of 30 requests per rolling 60 minutes. Exceeding this limit returns 429.

REQ-12: A valid submission SHALL be stored in a request queue with status `queued` and assigned a unique ticket ID (UUID v4).

REQ-13: The POST /request response on success SHALL be HTTP 202 with `{ "ticket": "<uuid>", "message": "<friendly note>" }`.

REQ-14: GET /request/<ticket> SHALL return `{ "status": "queued" | "scheduled" | "aired" | "dropped" }`. When status is `scheduled` the response SHALL also include `{ "airAt": "<HH:MM AM/PM>" }` in the listener's local timezone (derived from the `TZ` query param if present, defaulting to America/Los_Angeles). The response SHALL NOT give a reason for `dropped`.

### Studio worker (REQ-15 through REQ-20)

REQ-15: The studio worker SHALL poll the request queue for items with status `queued`.

REQ-16: For each queued request the worker SHALL render Dead John reading the script template: "Got a call on the request line. This one's from {from-name}, for {to-name}. {message} Here's {song-title}." using the existing voice clone (studio.py) and the station pronunciation lexicon.

REQ-17: The worker SHALL verify the render with Whisper transcription. Word match MUST be >= 0.85. On failure the worker SHALL re-render once. If the second render also fails the request is set to `dropped`.

REQ-18: A rendered clip that is longer than 30 seconds SHALL be dropped without re-render.

REQ-19: A successfully verified clip SHALL be stored in R2 and the request record updated with `status: rendered`, `clipFile`, and `clipSeconds`.

REQ-20: The worker SHALL assign `airAt` to the first break boundary that is at least 5 minutes after render completion and is not already owned by another request.

### Scheduling (REQ-21 through REQ-25)

REQ-21: `generateDay` SHALL accept an optional fourth argument `inserts: Insert[]` where `Insert = { airAt: number; clip: VoiceClip; songId: string }`, sorted ascending by `airAt`.

REQ-22: When a break boundary cursor time is >= an insert's `airAt`, the insert's clip SHALL replace the normally-selected break clip, and the requested song SHALL play immediately after that break, counted as the next song in the sequence.

REQ-23: If the requested song already aired earlier in the same day, the insert's clip is still played at the break but the next song from the normal queue plays instead. The read SHALL NOT mention the song title when this substitution occurs.

REQ-24: Inserting a request SHALL NOT alter any segment whose `startMs` is before `airAt`.

REQ-25: Two requests SHALL be separated by at least 10 minutes (600 000 ms) in their `airAt` values. The worker enforces this when assigning `airAt`.

### Status tracking (REQ-26)

REQ-26: The request record SHALL move through exactly these statuses in order: `queued` -> `rendered` -> `scheduled` -> `aired` -> (terminal). It may skip to `dropped` from any non-terminal state only if a hard failure occurs.

## Non-functional requirements

REQ-NF-01: The blocklist file SHALL live at `data/blocklist.txt`, one phrase per line, loaded server-side only.

REQ-NF-02: All rendered request clips SHALL be encoded at -16 LUFS, -1.5 dBTP, mono, 256 kbps MP3, matching the existing voice spec.

REQ-NF-03: The station schedule clock continues to be the sole authority for "what is on now." No live streaming is introduced.

REQ-NF-04: The request system SHALL NOT require any persistent server process. The queue and rate-limit state MAY live in a Cloudflare KV namespace.
