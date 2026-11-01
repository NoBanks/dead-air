# Tuner-Player: Tasks

Tasks are ordered by dependency. Each task is self-contained and cites the requirements it satisfies. No implementation code is written before these tasks are approved.

---

## Phase 1: Project Scaffold

- [x] **Task 1: Vite project scaffold** (REQ-1, REQ-11)
  Create `/web` with `package.json` (name: "web", type: "module"), `tsconfig.json` (strict, target ES2022, lib DOM+ES2022), `vite.config.ts`, and a minimal `index.html` with a single `<script type="module" src="/src/main.ts">`. Add `vitest` as a dev dependency. Confirm `vite build` and `vitest --run` both exit 0 on an empty test file.

- [x] **Task 2: Constants and types** (REQ-1, REQ-5, REQ-6, REQ-7)
  Create `src/constants.ts` with all named constants from the design (FREQ_MIN, FREQ_MAX, STATION_FREQ, LOCK_THRESHOLD, DRAG_FACTOR, LOCK_FADE_S, DUCK_DB, DUCK_ATTACK_S, DUCK_RELEASE_S, PRELOAD_AHEAD_S, RESYNC_INTERVAL_S, DRIFT_THRESHOLD_MS). Create `src/types.ts` re-exporting station `Segment`, `SongSegment`, `VoiceSegment`, `Track`, and `NowPlayingResult` from `../../station/src/core/types.ts`, plus a client-local `DialState` and `AudioGraph` interface.

---

## Phase 2: Dial Math

- [x] **Task 3: Dial geometry functions and unit tests** (REQ-1)
  Create `src/dial.ts` with `freqToPosition`, `positionToFreq`, and `pixelDeltaToFreqDelta`. Write `tests/dial.test.ts` with:
  - Exact value tests (520 maps to 0, 1740 maps to 1, 1714 maps correctly).
  - Round-trip property test with `fast-check`: for any `f` in [520, 1740], `Math.abs(positionToFreq(freqToPosition(f)) - f) < 0.001` (Property 1).
  All tests pass before moving on.

- [x] **Task 4: Dial input binding** (REQ-1, REQ-11)
  Add `bindDial(el, state, onChange)` to `dial.ts`. Handles pointer drag (with `setPointerCapture`), mouse wheel, ArrowLeft/ArrowRight keydown, and tap-to-jump. Updates `aria-valuenow` on every change. Frequency is clamped to [520, 1740]. No audio code here; fires `onChange` with the new frequency.

---

## Phase 3: Web Audio Graph

- [x] **Task 5: Audio graph construction** (REQ-5)
  Create `src/audio-graph.ts` implementing `buildGraph(ctx: AudioContext): AudioGraph`. Constructs music bus, voice bus, static bus as GainNodes. Wires them through the master chain: HighpassFilter (120 Hz) -> LowpassFilter (5000 Hz) -> WaveShaper (soft-clip curve) -> master GainNode -> destination. Implements `setCleanMode(clean)` to bypass or restore the filter chain without rebuilding nodes. No sources are attached here.

- [x] **Task 6: Static noise generator** (REQ-2, REQ-3)
  Create `src/static-gen.ts`. Generates two noise buffers (2 s each, white noise, prime-length offset between them) and connects each through a BiquadFilter (bandpass, 600 Hz) into the static bus. Exports `updateStaticGain(distanceKHz, graph, ctx)` which maps distance to a gain value and applies it via `setTargetAtTime` with a 50 ms time constant. Ghost channel gain is 20% of main.

---

## Phase 4: Clock Sync

- [x] **Task 7: NTP offset estimation and unit tests** (REQ-7)
  Create `src/clock.ts` with `estimateOffset(): Promise<number>` (three sequential GET /now fetches, median of RTT/2 estimates) and `correctedNow(offset): number`. Write `tests/clock.test.ts` with:
  - Exact median test with known inputs.
  - Property test: for any three samples where one deviates by up to 500 ms, the median is within 1 ms of the true pair median (Property 2).
  - Sanity bound test for `correctedNow` (Property 7).

- [x] **Task 8: Drift correction and resync loop** (REQ-7)
  Add `startResyncLoop(onOffset: (o: number) => void): void` to `clock.ts`. Calls `estimateOffset()` every 60 s. If new offset differs from current by < 250 ms, applies smooth lerp over 10 s. If >= 250 ms, calls `onOffset` immediately (hard resync).

---

## Phase 5: Duck Envelope

- [x] **Task 9: Duck envelope and unit tests** (REQ-6, REQ-8)
  Create `src/duck.ts` with `scheduleDuck(musicBus, ctx, startAudioTime, postAudioTime)`. Uses `setTargetAtTime` for the attack and `linearRampToValueAtTime` ending exactly at `postAudioTime = 1.0`. Write `tests/duck.test.ts` with:
  - Test that gain at `postAudioTime` is scheduled to 1.0 (Property 3).
  - Test that attack and release events are in the correct AudioContext time order.
  - Property test: for any non-overlapping sequence of duck intervals, gain events do not overlap (Property 5).

---

## Phase 6: Player Core

- [x] **Task 10: Segment scheduler and broadcast join** (REQ-7, REQ-8)
  Create `src/player.ts` with `joinBroadcast(graph, ctx, offset)`. Fetches GET /now, maps `server_time + offset_ms` to an AudioContext start time using `wallToAudioTime`, decodes the MP3, and starts the source node. Handles all segment kinds (song, voice, numbers, EBS stubs). Schedules talk-up voice clips when `talkup` is present, calling `scheduleDuck` for the envelope.

- [x] **Task 11: Preload loop and gapless transitions** (REQ-7)
  Add a preload loop to `player.ts`: a 1 s `setInterval` checks whether the time to the next segment boundary is under 20 s. If so, fetches and decodes the next segment MP3 and schedules its `AudioBufferSourceNode` using AudioContext time for a gapless join. On hard resync (offset delta >= 250 ms), reschedule nodes that have not yet started.

---

## Phase 7: Lock, Unlock, and Signal

- [x] **Task 12: Lock/unlock flow and hidden frequencies** (REQ-3, REQ-10)
  Create `src/signal.ts` with `checkSignal(freqKHz): Promise<boolean>` (GET /signal, session cache, 1714 hardcoded true). In `dial.ts` onChange handler: when the new frequency is within `LOCK_THRESHOLD` of a known station, snap and call `player.joinBroadcast`. When unlocking, stop playback and fade static in. Apply the 1.2 s static crossfade using `linearRampToValueAtTime` on the static bus (or instant if `prefers-reduced-motion`).

---

## Phase 8: UI, Media Session, and Audio Gate

- [x] **Task 13: Now playing card** (REQ-9)
  Create `src/now-playing-ui.ts` with `updateCard(segment, track?)`. Updates the `#now-playing` DOM element. Song: title + "NoBanks Nearby" + formatted `made_at`. Voice: "Dead John" only. Numbers/EBS: hide the card. Applies 200 ms opacity cross-fade via CSS class toggle (skipped under `prefers-reduced-motion`). Populates `aria-live="polite"` region.

- [x] **Task 14: Media Session API and audio gate** (REQ-4, REQ-11)
  Create `src/media-session.ts` with `updateMediaSession(track?: Track)`. Sets `navigator.mediaSession.metadata` with title, artist, and artwork. Called from the player on each song segment. In `src/main.ts`, wire up the "Turn it on" gate: show the button on load, create and resume `AudioContext` inside the click handler, then hide the button and start the dial. Ensure the button is 44 px tall and labeled for screen readers.

---

## Phase 9: Integration and Accessibility

- [x] **Task 15: Accessibility audit and ARIA** (REQ-11)
  Verify dial has `role="slider"`, `aria-valuemin`, `aria-valuemax`, `aria-valuenow` (updated live), `aria-label`, and a visible CSS focus ring. Verify the now-playing region has `aria-live="polite"`. Verify the audio gate button has an accessible label. Test keyboard-only navigation: Tab to dial, arrow keys tune, Enter/Space activates gate button.

- [x] **Task 16: Playwright smoke test scaffold** (REQ-3, REQ-7, REQ-9)
  Add Playwright as a dev dependency. Write `tests/smoke.spec.ts` (skipped in CI until a dev server is available):
  - Page loads, "Turn it on" button is visible.
  - Clicking the button dismisses the gate and the dial is focusable.
  - Dialing to 1714 (simulated pointer drag) shows the now-playing card with "NoBanks Nearby".
  Mark the test file with `test.skip` so `vitest --run` still exits 0. Document the manual run command in `/web/README.md`.

