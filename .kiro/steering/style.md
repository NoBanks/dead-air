---
inclusion: always
---

# Writing and code style

## Words (README, UI copy, scripts, commit messages, write-ups)

- No em dashes anywhere. Use commas, periods, colons or "...".
- Plain, short sentences. Sound like a person, not a press release.
- No hype words: "revolutionary", "game-changing", "seamless", "unleash".
- No alcohol references.

## Code

- Small, readable modules. Name things for what they do on the radio (`scheduleBreak`, `duckMusic`, `talkUpWindow`).
- No secrets in the repo. Keys live in a local `.env` outside the repo.
- Audio and large media never go in git (see `.gitignore`).
- Every feature starts as a Kiro spec: requirements, design, tasks.
