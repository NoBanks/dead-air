# The Hunt: Requirements

DEAD AIR is a pirate AM station at 1714. Most of the dial is static. A few exact
frequencies pull in faint hidden stations that have been bleeding through since the
night the tower went down. Finding one fills a page of the listener's Logbook.
Filling all pages unlocks a finale. Progress lives only on the listener's device.
No accounts.

All times use America/Los_Angeles via the Intl helpers in `station/src/core/tzoffsets.ts`.

---

## REQ-1: Hunt configuration (data/hunt.json)

WHEN the server loads,
IT SHALL read `data/hunt.json` which defines:
- `lock_khz`: maximum dial distance at which a hidden station is receivable
- `stations[]`: list of hidden stations, each with `freq`, `page`, `mode`, and `clips[]`
- `last_minute`: special override object with `freq`, `page`, and a single `clip`

EACH clip in `stations[].clips` and `last_minute.clip` SHALL have:
`id`, `file` (URL path), `seconds` (float, duration in seconds).

The code SHALL handle any number of clips per station (one or more).

---

## REQ-2: Hidden stations

The six hidden station frequencies SHALL be:
| Freq (kHz) | Page         | Mode   |
|------------|--------------|--------|
| 1410       | old-station  | hourly |
| 870        | marty        | loop   |
| 1031       | bulletin     | loop   |
| 540        | hold         | loop   |
| 710        | rink         | loop   |
| 666        | between      | loop   |

1714 is NOT a hunt station. The main station is handled by `/now`.

---

## REQ-3: Signal strength

WHEN the client asks for frequency `f` kHz,
IF `|f - station.freq| <= lock_khz` THEN strength = `1 - |f - station.freq| / lock_khz` (range 0..1].
OTHERWISE strength is absent and the station is not found.

---

## REQ-4: Loop mode

WHEN a station has `mode: "loop"`,
IT SHALL play its clips back-to-back forever.
The phase SHALL be `(t - epochMs) mod totalLengthMs` where totalLengthMs is the
sum of all clip durations in milliseconds.
Everyone in the world hears the same clip at the same offset at time `t`.

WHEN the phase advances into the next second,
`offsetMs` SHALL advance by exactly 1000 ms (continuity property).

---

## REQ-5: Hourly mode

WHEN a station has `mode: "hourly"`,
IT SHALL select `clipIndex = laHour(t) mod clips.length` where `laHour` is the
America/Los_Angeles hour (0-23) at time `t`.
The selected clip SHALL loop within the hour.
`offsetMs = (milliseconds elapsed since the top of the current LA hour) mod (clip.seconds * 1000)`.

---

## REQ-6: Last-minute override (03:14 AM LA)

WHEN `t` is in the range [03:14:00.000, 03:14:59.999] LA on any day,
AND the station at frequency 1410 is requested,
IT SHALL return the `last_minute` clip, page `"three-fourteen"`,
with `offsetMs = t - (UTC ms of 03:14:00 on that LA day)`.

This range is half-open on the right: t=03:15:00.000 LA returns to normal hourly.
The rule SHALL be correct on DST transition days:
- Nov 1 2026: clocks fall back. 1:xx repeats, but 3:14 AM happens once (in PST).
- Mar 14 2027: clocks spring forward. 3:14 AM exists (in PDT, just before spring-forward is for 2:00 AM).

---

## REQ-7: SignalResult shape

A successful `signalAt` call SHALL return:
```
{ page, clipId, file, offsetMs, remainingMs, strength }
```
- `offsetMs` in [0, clip.seconds * 1000)
- `remainingMs = clip.seconds * 1000 - offsetMs`
- `strength` in (0, 1]

A miss (no station within range, or 1714, or bad input) SHALL return `null`.
`signalAt` SHALL never throw; NaN, Infinity, and negative inputs return `null`.

---

## REQ-8: HTTP endpoint GET /signal

WHEN a client sends `GET /signal?f=<kHz>&t=<ms>`,
IF a hidden station is within range at frequency f at time t,
IT SHALL respond 200 with JSON:
```json
{ "page": "...", "clip_id": "...", "file": "...", "offset_ms": ..., "remaining_ms": ..., "strength": ..., "server_time": ... }
```
IF no station is within range,
IT SHALL respond 204 with an empty body.

Both responses SHALL include `Cache-Control: no-store`.
IF `t` is missing or not a finite number, the server SHALL use `Date.now()`.

The response SHALL NOT contain the list of frequencies or any clip that is not
the one currently playing (spoiler rule).

---

## REQ-9: Spoiler rule

No hidden station frequency or clip ID other than the one currently playing
SHALL appear in any web/ client code. The client learns about a station only by
asking `/signal` for the frequency it happens to be tuned to.

---

## REQ-10: Numbers station decode

The numbers read by the numbers station encode three words under A=1, Z=26:
"Attention. One four one zero. Zero three one four. Attention.
Twenty three, one, twenty, five, eighteen. Twenty, fifteen, twenty three, five, eighteen.
Nineteen, twenty, one, twenty, five. One four one zero. Zero three one four."

The three groups SHALL decode to: WATER, TOWER, STAY.

A `decodeNumbers(text: string): string[]` function SHALL be exported from
`station/src/core/hunt.ts` and tested against the constant `NUMBERS_TEXT`.

---

## REQ-11: Logbook pages (web, later)

Eight Logbook pages SHALL exist:
`old-station`, `marty`, `bulletin`, `hold`, `town`, `three-fourteen`, `rink`, `between`.

`town` fills when all six `ad_*` sponsor clips have been heard on 1714 (not a
hidden station; detected client-side from the now-playing feed).

Progress is stored only in localStorage. No server state.

A found page SHALL show its number, title and flavor text, as text only (no art).
A locked page SHALL show a smudge and a hint line.
Changed Nov 6: found pages are text-only and locked pages use a smudge instead of static, by design.

---

## REQ-12: Finale (web, later)

WHEN all 8 Logbook pages are found on a device,
IT SHALL play `/voice/finale.mp3` during the next EBS segment.

---

Changed Nov 6: REQ-11 now says what the Logbook shows (text-only found pages, smudge and hint for locked pages). REQ-14 added for the tuner behavior that shipped.

---

## REQ-13: Share card (web)

WHEN the listener presses SHARE LOGBOOK,
THE client SHALL draw a PNG on a canvas in the browser showing: the station name DEAD AIR, 1714 AM, "N of 8 pages found", and eight marks, one per page.
- Each mark SHALL show only its number and whether it is found. The card SHALL NOT show any page title, found or locked: it says how many, never which or where.
- The card SHALL NOT show or encode any hidden frequency, flavor text, hint, or how to find a page. The only frequency on it is 1714. The footer SHALL read "Everyone made it out." once the finale has played, else "Tune in to 1714. Something is out there."
- The card SHALL use the tuner look (colors and fonts from `web/src/style.css`).

IF `navigator.share` accepts files, THE client SHALL share the PNG with it. OTHERWISE it SHALL download the PNG.
THE card SHALL make no network calls and need no new dependencies.

---

## REQ-14: Hidden-station playback (web)

WHEN the dial settles on a frequency, THE client SHALL ask `/signal` once for that frequency.
WHEN a hidden clip ends while the dial is still on that frequency, THE client SHALL ask again.
THE client SHALL NOT poll on a fixed timer.
WHILE a hidden station is received, static SHALL stay at or above 40% of full level, so the station sounds like a weak, far-off signal even at full strength.