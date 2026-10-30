---
inclusion: always
---

# Product: DEAD AIR, 1714 AM

**Tagline:** Radio's dead. Turn it up anyway.

DEAD AIR is a pirate AM radio station that never goes off air. A listener opens the site, turns an analog tuning dial through static, and lands on 1714 AM. Dead John (see `dead-john.md`) is hosting a late night show over a library of original music by NoBanks Nearby.

**Kiroween category:** Resurrection. We bring back dead radio tech: the late night AM DJ, the analog dial and static, the call-in request line, the numbers station, the Emergency Broadcast tone.

## Core experience

1. **Tune in.** Dark screen, an analog dial. Turning it plays static and ghost voices. Landing on 1714 locks the signal. That turn is also the user gesture that unlocks browser audio.
2. **It is live.** Every listener hears the same thing at the same moment. There is no streaming server: the station is a schedule laid on a clock. The browser asks "what is on at time T?" and plays from that offset.
3. **Dead John talks.** Breaks every 2 to 3 songs: back-sells, talk-ups over intros, time checks, IDs, bits. Music ducks under his voice and comes back up smoothly.
4. **Call the station.** A request form. The request gets scheduled a few songs ahead and Dead John reads the dedication on air.
5. **Midnight.** The numbers station takes over the frequency for a few minutes.
6. **Once in a while.** The Emergency Broadcast tone.

## Library

- Only the MSTR (finished master) versions of NoBanks Nearby songs. About 1,100 tracks, about 50 hours, no duplicates.
- Source WAVs never leave the laptop. The station streams 256 kbps MP3s, loudness matched.
- All music is original, owned by NoBanks Nearby (BMI). Say so in the README, the app's about screen, and the video description.

## Hosting

- Domain: `deadair.nohumannearby.com`.
- Cost target: $0 per month for voice (all speech is rendered locally ahead of time), as close to $0 as possible for hosting.

## Judging (equal weight, design for all five)

Potential Impact, Technological Implementation, Design, Innovation, Presentation. Kiro use is checked: specs, hooks, steering and MCP must show real work in `/.kiro`.
