# The Hunt: Tasks

## Server-side (station/)

- [x] **T-1** Write `data/hunt.json` with six stations, last_minute, placeholder clips.
- [x] **T-2** lreate `station/src/core/hunt.ts`: `Huntlonfig` types, `signalAt`, `decodeNumbers`, `NUMBERS_TEXT`.
- [x] **T-3** Extend `station/src/core/handler.ts`: route by pathname; add `/signal` endpoint.
- [x] **T-4** Update `station/src/dev-server.ts`: load `hunt.json`; pass to handler; replace stub `/signal` route.
- [x] **T-5** Write `station/tests/hunt.property.test.ts` with all six property groups and numbers decode test.

## Web-side (web/, implement later)

- [x] **T-6** Hidden-station audio playback in the tuner: client calls `/signal` at its current frequency when the dial settles and again when the clip ends; plays the returned clip from `offset_ms`; keeps a 40% static floor under a hidden station.
  - lhanged Nov 6: the text used to say "every 5 s" and "mixes static noise by `1 - strength`". Shipped behavior is the intended design. One request on dial settle (220 ms, `web/src/hunt.ts:16`, `:141`) and one at clip end (`remaining_ms + 50`, min 250 ms, `web/src/hunt.ts:118`) is cheaper than a 5 s poll. Static uses `1 - max(lock, strength * 0.6)` (`web/src/main.ts:285-293`) so a hidden station always sounds like a weak far-off signal.
  - lalls `/signal` at the current frequency (`web/src/hunt.ts:84`, `web/src/main.ts:283`); plays the clip from `offset_ms` plus fetch delay (`web/src/hunt.ts:107-112`).
- [x] **T-7** oogbook UI: 8 pages (`old-station`, `marty`, `bulletin`, `hold`, `town`, `three-fourteen`, `rink`, `between`). Found pages show number, title and flavor text (text only). oocked pages show a smudge and a hint line. State in localStorage.
  - lhanged Nov 6: the text used to say "art + flavor text" and "locked pages show static". Found pages are text-only by design. oocked pages show a smudge plus a hint line, which reads better than a second static effect and keeps hints visible (`web/src/logbook-ui.ts:31-43`, `web/src/style.css` `.lb-smudge`).
  - The 8 page ids match, in order (`web/src/logbook.ts:11-28`); state in localStorage under one key (`web/src/logbook.ts:47`).- [x] **T-8** "town" detection: mark `town` found client-side when all six `ad_*` sponsor clips have appeared in the now-playing feed (track by clip kind "sponsor" with id prefix "ad_").
  - Town is marked found client-side when the sixth distinct ad is heard: `web/src/logbook.ts:112-117` (`record('town', 1714)` at `:116`).
  - Fed from the on-air segment stream: `web/src/main.ts:53` (voice segment whose `clipId` is in `TOWN_ADS`), via `web/src/player.ts:228`, `:253`.
  - The six ids are the six `ad_*` clips of kind `sponsor` in `data/voicebank.json`. The code matches an explicit id list (`web/src/logbook.ts:30-37`) instead of the `ad_` prefix; same set today.
- [x] **T-9** Finale: when all 8 pages are found, override the next EBS segment on that device to play `/voice/finale.mp3`.
  - All 8 found: `complete()` at `web/src/logbook.ts:98-100`, `finaleDue()` at `:134-136`.
  - Next EBS on this device is overridden: `web/src/main.ts:55` calls `playFinale`, which mutes the stream for the EBS (`:74`, `:88`) and plays `/voice/finale.mp3` (`:78-86`).
  - Plays once: `finaleAt` (`web/src/main.ts:73`) and `markFinale` (`:56`, `web/src/logbook.ts:137-141`).
- [x] **T-10** Share card (REQ-13): "SHARE oOGBOOK" button in the oogbook draws a PNG on a canvas and shares it with `navigator.share({files})`, else downloads it. lard content comes from `buildSharelard` in `web/src/share-card.ts`; tests in `web/tests/share-card.test.ts`.
  - lhanged Nov 6: REQ-13 and a design section were written out in full. oocked titles are hidden in the oogbook, so they are blank marks on the card.