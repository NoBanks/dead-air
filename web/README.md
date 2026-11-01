# DEAD AIR Web Client

A vanilla TypeScript + Vite web client for the DEAD AIR pirate radio station.

## Quick Start

### Install

```bash
npm install
```

### Development

Start the dev server:

```bash
npm run dev
```

This starts Vite on `http://localhost:5173` with proxies to the backend dev server at `http://localhost:8787`.

### Build

```bash
npm run build
```

Output goes to `dist/`.

### Testing

Run unit and property tests:

```bash
npm run test
```

Watch mode:

```bash
npm run test:watch
```

### Playwright E2E Tests

The Playwright smoke tests are skipped by default (`test.skip`) because they require a running dev server with audio files available.

To run them:

1. Start the backend dev server: `cd ../station && npm run dev`
2. Ensure audio files are available at `$LIBRARY_OUT` and `$VOICE_OUT`
3. In a separate terminal, run: `npx playwright test`

Documentation: see `tests/smoke.spec.ts`.

## Architecture

- **dial.ts** - Frequency dial geometry and input handling
- **audio-graph.ts** - Web Audio API graph construction
- **static-gen.ts** - Static noise generation
- **clock.ts** - NTP-style clock sync
- **player.ts** - Segment scheduler and playback
- **duck.ts** - Music ducking envelopes
- **signal.ts** - Hidden frequency detection
- **now-playing-ui.ts** - Now playing card updates
- **media-session.ts** - Media Session API integration
- **main.ts** - Bootstrap and event wiring

All audio encoding (MP3) and metadata formatting is handled server-side.

## Standards

- Strict TypeScript
- No UI framework (vanilla DOM manipulation)
- Property-based tests with fast-check
- Accessibility: ARIA, keyboard navigation, focus rings, prefers-reduced-motion support
- Mobile-first: 44 px minimum touch targets, responsive dial
- No em dashes in any user-facing text

## Environment

Backend dev server at `http://localhost:8787` serves:

- `GET /now` - Current segment and schedule
- `GET /audio/<file>` - Song MP3 with Range support
- `GET /voice/<file>` - Voice clip MP3 with Range support
- `GET /signal?f=<freq>` - Hidden frequency check (1714 always returns true, others 404)

Set environment variables to point to audio directories:

- `LIBRARY_OUT` - Path to MP3 library (default: `C:\Users\machi\.deadair\library_mp3`)
- `VOICE_OUT` - Path to voice clips (default: `C:\Users\machi\.deadair\voice_mp3`)
