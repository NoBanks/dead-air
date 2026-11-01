# Tuner-Player: Requirements

## Context

The browser client lives in `/web`. It is a vanilla TypeScript single-page app built with Vite, no UI framework. It delivers the core radio experience: an analog AM dial the listener drags or taps to find the station, and the Web Audio engine that plays the broadcast in perfect sync with every other listener.

Two sub-systems are built together here:

1. **The dial.** A visual and interactive AM tuner. Dragging, scrolling, tapping, or pressing arrow keys sweeps through frequencies 520 to 1740 kHz. Static (filtered noise, never a loop file) fills the off-station air. Landing on 1714 locks the signal and joins the live broadcast.

2. **The player.** A Web Audio graph that schedules music, voice, and numbers segments sample-accurately. It syncs to the station clock via GET /now, uses an NTP-style round trip to estimate server offset, ducks music under voice, fades gracefully, and handles talk-ups.

The look and dial feel match the hand-made teaser (MIN 520, MAX 1740, STATION 1714, drag factor 0.3, tap to jump, generated static with ducking for voice). The code is written fresh, not copied.

References: #[[file:../../.kiro/steering/dead-john.md]] #[[file:../../.kiro/steering/audio.md]] #[[file:../../.kiro/steering/product.md]]

## EARS Notation Key

- **[UB]** Ubiquitous: the system shall always...
- **[EV]** Event-driven: when X occurs, the system shall...
- **[ST]** State-driven: while in state X, the system shall...
- **[OPT]** Optional feature: where supported, the system shall...

---

## Requirements

### REQ-1: Dial Geometry and Input

**[UB]** The dial shall map the frequency range 520 to 1740 kHz to a linear visual position, with 1714 kHz as the lock target.

- Dragging the dial changes frequency continuously; drag sensitivity is 0.3 (pixels per kHz, matching the teaser).
- Mouse scroll (wheel delta) tunes the dial at the same rate as dragging.
- Keyboard arrow keys (left/right) move frequency by 10 kHz per keypress.
- Tapping or clicking a position on the dial jumps frequency directly to that position.
- Frequency is clamped to [520, 1740].

---

### REQ-2: Static and Ghost Voices

**[ST]** While the dial is not locked on a station frequency, the system shall play filtered noise generated in Web Audio (a noise source into a bandpass filter near 600 Hz, Q around 1.5).

- Static is continuous, real-time generated; it is never a looping audio file.
- Static gain scales with distance from the nearest locked frequency: full at maximum distance, zero when locked.
- A faint second static stream, pitched slightly differently, provides ghost voice texture off-station. Its gain is lower (about 20% of the main static level).
- Both static streams are on the static bus (see REQ-5).

---

### REQ-3: Lock and Unlock

**[EV]** When the dial reaches within a lock threshold of a known station frequency (within 10 kHz), the system shall snap the frequency to that station.

- Locking on 1714 crossfades static out over 1.2 seconds using gain automation on the audio clock.
- While locked, the player joins the live broadcast at the correct offset (REQ-7).
- Unlocking (dragging or tapping away) immediately stops broadcast playback and restores static.
- The set of known station frequencies is fetched from GET /signal (REQ-10). Until the response arrives, only 1714 is treated as a locked frequency.

---

### REQ-4: Audio Unlock Gate

**[EV]** When the page loads, no audio shall play until a user gesture occurs.

- A visible "Turn it on" control is presented on load. Its tap or click is the first gesture.
- The AudioContext is created and resumed inside that gesture handler, satisfying mobile autoplay restrictions.
- After the gesture the control is dismissed and the dial becomes interactive.
- On browsers where autoplay is not restricted, the gate still appears: consistent UX.

---

### REQ-5: Web Audio Graph

**[UB]** The audio graph shall route all sources through named buses before a master output.

Buses:

- **music bus:** source nodes (AudioBufferSourceNode) for music segments.
- **voice bus:** source nodes for voice clips (breaks and talk-ups).
- **static bus:** the noise generator(s) from REQ-2.

Each bus connects to a **master node** that applies a gentle AM band shape: a highpass filter at 120 Hz and a lowpass filter at 5000 Hz in series, followed by a WaveShaperNode for light saturation. The master output connects to `AudioContext.destination`.

A **clean mode** toggle bypasses the AM filter and saturation by switching the master to a direct gain node, without rebuilding the graph.

---

### REQ-6: Music Ducking

**[UB]** While a voice clip is playing, the music bus gain shall be reduced by 10 dB.

- Duck attack: gain falls to the ducked level over 250 ms using `linearRampToValueAtTime` or `setTargetAtTime`.
- Duck release: gain returns to full level over 600 ms, timed to complete exactly at the song's post (the moment the instrumental intro ends and the vocal or main theme begins).
- All gain changes are scheduled on the AudioContext clock (`currentTime`), never with `setTimeout` or `setInterval`.
- The gain at the post must equal full level (no residual ducking).

---

### REQ-7: Clock Sync and Segment Scheduling

**[EV]** When the player joins the broadcast, the system shall:

1. Send three GET /now requests and compute the server clock offset using NTP-style round-trip timing (median of three `(RTT/2 + server_time)` estimates).
2. Apply the estimated offset to `Date.now()` to maintain a corrected local clock.
3. Resync every 60 seconds; if the new offset differs from the current by less than 250 ms, apply it as a smooth drift correction rather than a clock jump.
4. Fetch the current segment and its `offset_ms` from GET /now and start playback from that byte offset.

**[UB]** The system shall preload the next segment 20 seconds before the current one ends.

**[UB]** Segment transitions shall be scheduled using AudioContext time for gapless, sample-accurate playback.

---

### REQ-8: Talk-Ups

**[EV]** When the current `SongSegment` carries a `talkup` field, the system shall:

1. Schedule the voice clip on the voice bus starting at `songAudioTime + talkup.startOffsetMs / 1000`.
2. Duck the music bus for the duration of the clip (REQ-6).
3. Ensure the clip ends no later than the song's post (`song.startMs + song.talkup_seconds * 1000`).

- The post time is computed from `talkup_seconds` from the track data.
- The duck release is timed to complete at the post so music is fully back at that moment.

---

### REQ-9: Now Playing Card

**[ST]** While the station is locked and playing, the system shall display a now-playing card showing:

- For song segments: the track title and the artist name "NoBanks Nearby". If `made_at` is present, display the month and year only (e.g., "March 2021"). No raw dates.
- For voice segments: "Dead John" and nothing else. No text, no clip ID, no duration.
- For numbers and EBS segments: no card (card is hidden or shows only the station name).
- The card updates with a short cross-fade (200 ms opacity transition) when the segment changes.

---

### REQ-10: Hidden Frequencies

**[EV]** When the dial is tuned, the system shall fetch GET /signal?f=\<freq\> for candidate lock targets.

- The endpoint returns JSON `{ locked: boolean }` when a hidden frequency exists, or 404 when it does not.
- Only frequencies confirmed by the server are treated as stations. The locked behavior is identical to 1714 (REQ-3).
- The station list is never shipped in the client bundle; it is always server-authoritative.
- The stub implementation returns 404 for all frequencies except 1714. 1714 is always trusted without a server round trip.

---

### REQ-11: Mobile and Accessibility

**[UB]** The layout shall be mobile-first, usable at 360 px viewport width.

- Touch targets on the dial and controls are at least 44 px in each dimension.
- The dial is a slider role (`role="slider"`) with `aria-valuemin="520"`, `aria-valuemax="1740"`, `aria-valuenow` set to the current frequency in kHz, and `aria-label="AM frequency dial"`.
- The dial has a visible focus ring when navigated by keyboard.
- When `prefers-reduced-motion: reduce` is active, frequency animations and the lock crossfade are instant rather than animated.
- The Media Session API is populated with track title, artist ("NoBanks Nearby"), and artwork when playing a song segment, so the system media controls and lock screen show correct metadata.
- Audio keeps playing with the screen off on mobile as long as the platform allows (achieved via Media Session and keeping the AudioContext running).
