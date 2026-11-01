---
---
inclusion: fileMatch
fileMatchPattern: "station/**,web/**,tools/library/**"
---

# Audio standards

The owner is an audio engineer and a 30 year cinematographer. The station must sound expensive.

## Loudness

- Music: every song normalized to one target in a single encode pass. Target **-14 LUFS integrated, -1 dBTP**, 256 kbps MP3, 44.1 or 48 kHz stereo.
- Voice: each Dead John clip rendered at **-16 LUFS integrated, -1.5 dBTP**, mono, with 0.35 s of silence on head and tail so the first and last words are never clipped.
- Nothing on air may jump in level between songs, voice and IDs.

## Ducking (music under voice)

- Music dips **8 to 12 dB** while Dead John talks.
- Feel of a broadcast sidechain: about 3:1, fast attack (about 10 ms), smooth release (about 250 ms). No pumping, no clicks.
- Implement with Web Audio gain automation scheduled on the audio clock (`setTargetAtTime` or linear ramps), never with JavaScript timers.

## Transitions

- Songs never hard stop. Fades are graceful.
- A talk-up must end before the vocal starts. Use the analyzed intro length of each track, minus a 0.5 s safety margin.

## Static and dial

- Static is generated (filtered noise), not a looping file, so it never audibly repeats.
- Static level follows the dial: loud far from 1714, gone when locked.
