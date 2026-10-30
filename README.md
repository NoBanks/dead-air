# DEAD AIR

**Radio's dead. Turn it up anyway.**

*"I'm Dead John, coming to you LIVE, and this... is DEAD AIR."*

1714 AM. A pirate radio station that never goes off air. Open the site, turn an old analog tuning dial through the static, and land on 1714 AM. Dead John, the late-night AI DJ, is hosting: it knows what just played and what is coming next, talks over song intros like a real host, reads listener requests and dedications, and drops station IDs. At midnight the station drifts into a numbers station.

Built for Kiroween 2026 (Resurrection category). Built with [Kiro](https://kiro.dev): see the `.kiro/` folder for the specs, hooks and steering docs that drove the build.

## The dead tech we brought back

| Dead tech | What Dead Air does with it |
|---|---|
| The late-night AM DJ | An AI agent DJ that reads the playlist and talks like a real host |
| Analog tuning dial and static | The UI: you tune to 1714 AM through hiss and ghost voices |
| Call-in request line | Listeners send a request plus a dedication; the DJ reads it on air |
| Numbers stations | The midnight segment |
| Emergency Broadcast System | One scare moment |

## How it works

There is no 24/7 streaming server. The station is a schedule laid on a clock. Every listener's browser asks "what is playing right now?", gets the current segment plus its offset, and plays from that point. Everyone hears the same thing at the same moment, so it feels live.

## Status

Work in progress. Build started October 30, 2026.

## Music

Every song on Dead Air is an original by NoBanks Nearby (BMI). All rights reserved. The music is not covered by the code license below.

## License

Code: [MIT](LICENSE).
