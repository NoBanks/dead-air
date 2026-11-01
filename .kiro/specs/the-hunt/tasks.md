# The Hunt: Tasks

## Server-side (station/)

- [x] **T-1** Write `data/hunt.json` with six stations, last_minute, placeholder clips.
- [x] **T-2** Create `station/src/core/hunt.ts`: `HuntConfig` types, `signalAt`, `decodeNumbers`, `NUMBERS_TEXT`.
- [x] **T-3** Extend `station/src/core/handler.ts`: route by pathname; add `/signal` endpoint.
- [x] **T-4** Update `station/src/dev-server.ts`: load `hunt.json`; pass to handler; replace stub `/signal` route.
- [x] **T-5** Write `station/tests/hunt.property.test.ts` with all six property groups and numbers decode test.

## Web-side (web/, implement later)

- [ ] **T-6** Hidden-station audio playback in the tuner: client calls `/signal` at its current frequency every 5 s; plays the returned clip from `offset_ms`; mixes static noise by `1 - strength`.
- [ ] **T-7** Logbook UI: 8 pages (`old-station`, `marty`, `bulletin`, `hold`, `town`, `three-fourteen`, `rink`, `between`). Each page shows art + flavor text. Locked pages show static. State in localStorage.
- [ ] **T-8** "town" detection: mark `town` found client-side when all six `ad_*` sponsor clips have appeared in the now-playing feed (track by clip kind "sponsor" with id prefix "ad_").
- [ ] **T-9** Finale: when all 8 pages are found, override the next EBS segment on that device to play `/voice/finale.mp3`.
- [ ] **T-10** Share card: generate a PNG share image that shows the listener's found pages without revealing any hidden frequency.
