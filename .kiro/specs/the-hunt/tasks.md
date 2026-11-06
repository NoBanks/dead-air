# The Hunt: Tasks

## Server-side (station/)

- [x] **T-1** Write `data/hunt.json` with six stations, last_minute, placeholder clips.
- [x] **T-2** Create `station/src/core/hunt.ts`: `HuntConfig` types, `signalAt`, `decodeNumbers`, `NUMBERS_TEXT`.
- [x] **T-3** Extend `station/src/core/handler.ts`: route by pathname; add `/signal` endpoint.
- [x] **T-4** Update `station/src/dev-server.ts`: load `hunt.json`; pass to handler; replace stub `/signal` route.
- [x] **T-5** Write `station/tests/hunt.property.test.ts` with all six property groups and numbers decode test.

## Web-side (web/, implement later)

- [ ] **T-6** Hidden-station audio playback in the tuner: client calls `/signal` at its current frequency every 5 s; plays the returned clip from `offset_ms`; mixes static noise by `1 - strength`.
  - Open. Differs from the text in two places.
  - Not every 5 s: the client asks once, 220 ms after the dial settles (`web/src/hunt.ts:16`, `:141`), then asks again when the clip ends, `remaining_ms + 50`, min 250 ms (`web/src/hunt.ts:118`). No 5 s poll exists.
  - Static is not `1 - strength`: the meter and static gain use `1 - max(lock, strength * 0.6)` (`web/src/main.ts:285-289`, `:293`), so a full-strength hidden station still leaves 40% static.
  - Met: calls `/signal` at the current frequency (`web/src/hunt.ts:84`, `web/src/main.ts:283`); plays the returned clip from `offset_ms` plus fetch delay (`web/src/hunt.ts:107-112`).
- [ ] **T-7** Logbook UI: 8 pages (`old-station`, `marty`, `bulletin`, `hold`, `town`, `three-fourteen`, `rink`, `between`). Each page shows art + flavor text. Locked pages show static. State in localStorage.
  - Open. Two clauses differ.
  - Art: no page has any art. A found page shows number, title and flavor text only (`web/src/logbook-ui.ts:31`, `:42-43`).
  - Locked pages: they show a blurred smudge plus a hint line, not static (`web/src/logbook-ui.ts:33-34`, `web/src/style.css:372`).
  - Met: the 8 page ids match, in order (`web/src/logbook.ts:11-28`); flavor text on found pages (`web/src/logbook-ui.ts:43`); state in localStorage under one key (`web/src/logbook.ts:47`, read `:61`, write `:71`).
- [x] **T-8** "town" detection: mark `town` found client-side when all six `ad_*` sponsor clips have appeared in the now-playing feed (track by clip kind "sponsor" with id prefix "ad_").
  - Town is marked found client-side when the sixth distinct ad is heard: `web/src/logbook.ts:112-117` (`record('town', 1714)` at `:116`).
  - Fed from the on-air segment stream: `web/src/main.ts:53` (voice segment whose `clipId` is in `TOWN_ADS`), via `web/src/player.ts:228`, `:253`.
  - The six ids are the six `ad_*` clips of kind `sponsor` in `data/voicebank.json`. The code matches an explicit id list (`web/src/logbook.ts:30-37`) instead of the `ad_` prefix; same set today.
- [x] **T-9** Finale: when all 8 pages are found, override the next EBS segment on that device to play `/voice/finale.mp3`.
  - All 8 found: `complete()` at `web/src/logbook.ts:98-100`, `finaleDue()` at `:134-136`.
  - Next EBS on this device is overridden: `web/src/main.ts:55` calls `playFinale`, which mutes the stream for the EBS (`:74`, `:88`) and plays `/voice/finale.mp3` (`:78-86`).
  - Plays once: `finaleAt` (`web/src/main.ts:73`) and `markFinale` (`:56`, `web/src/logbook.ts:137-141`).
- [ ] **T-10** Share card: generate a PNG share image that shows the listener's found pages without revealing any hidden frequency.
