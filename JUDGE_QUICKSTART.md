# Judge Quickstart: DEAD AIR in under 3 minutes

DEAD AIR is a pirate radio station at 1714 AM, hosted by an AI late night DJ named Dead John. Use headphones or speakers. Sound is required.

## Fastest path (about 1 minute)

1. Open **https://deadair.nohumannearby.com/** (the address set in the site's own page metadata; the README does not list a live URL).
2. Click **TURN ON THE RADIO**. Browsers block audio until you click.
3. Drag the dial, or use the left and right arrow keys, toward **1714**.

What you should see: an analog radio with a glowing needle, a SIGNAL meter rising and a STATIC meter falling as you near 1714, and an **ON AIR** light. The NOW PLAYING card fills in with a song title.

What you should hear: AM static that fades out as you approach 1714, then Dead John. Typical things he does: station IDs ("this... is DEAD AIR"), talks over a song intro and stops right before the vocals start, reads out the time, and runs fake ads for businesses that cannot exist. Songs are all originals by NoBanks Nearby. Everyone listening hears the same moment, so refresh in another tab and it will match.

## Things worth trying (2 more minutes)

- **Request line.** Open the request form, send a dedication to a friend and pick a song. Dead John reads it on the air a few minutes later, then plays your song. Names should be letters only; links and numbers are refused by design.
- **The hunt.** Most of the dial is static, not all. Slide slowly through the dial and hold still when a faint voice comes in; after about 2 seconds the **Logbook** records a page. There are eight pages in total. Try around the 1400s, the 1000s and the 500s to 800s.
- **Time based events.** A numbers station airs at midnight (Los Angeles time) and briefly at 14 past every hour. Something special happens at 3:14 AM. If you are judging at another hour, the quarter past window is the one to catch.

## Running it yourself

The repo does not contain the audio (MP3s and `data/library.json` are generated locally and gitignored), so a local run has the schedule, tuner and static but no music. To check the code:

```bash
# Node 22
cd station && npm ci && npx vitest run     # schedule, hunt and request rules (property tests)
cd ../web && npm ci && npx vitest run && npx vite build
```

To see the tuner shell locally:

```bash
cd station && HOST=127.0.0.1 npm run dev   # API on :8787
cd web && npx vite                          # tuner on :5173
```

Without the library, `/now` answers with an error and the tuner shows only static. See `docs/QA_REPORT.md` for known issues.

## Built with Kiro

Specs, steering, hooks and an MCP server live in `.kiro/`. See the README for the table of what each did.
