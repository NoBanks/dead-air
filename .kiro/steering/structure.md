# Project Structure

## Directory Map

```
dead-air/
├── tools/library/          Library analysis, encoding, and track metadata
│   ├── src/
│   │   ├── analyze.ts      Audio analysis (duration, intro, fade analysis)
│   │   ├── encode.ts       MP3 encoding to loudness spec
│   │   ├── library.ts      Library loading and caching
│   │   ├── csv.ts          CSV parsing (track metadata input)
│   │   ├── slug.ts         URL-safe identifiers from track titles
│   │   ├── cache.ts        JSON caching layer
│   │   ├── exclude.ts      Exclusion rules
│   │   ├── index.ts        CLI entry point
│   │   └── types.ts        Shared types
│   └── tests/
├── station/                Station core logic (schedule, now playing, time)
│   ├── src/core/
│   │   ├── schedule.ts     Build and query broadcast schedule
│   │   ├── nowPlaying.ts   What's playing at time T
│   │   ├── handler.ts      HTTP endpoints (Cloudflare Worker)
│   │   ├── day.ts          Day/date helpers
│   │   ├── index.ts        Export public API
│   │   └── types.ts        Type definitions
│   └── tests/
├── web/                    (Coming) Browser client
├── data/                   Shared data and metadata
│   ├── library.json        Master track library
│   ├── voicebank.json      Dead John voice lines
│   ├── featured.json       Featured/current tracks
│   └── exclude.txt         Tracks to skip
├── scripts/hooks/          Kiro hook automation scripts
│   ├── dead-john-lint.mjs  Validate Dead John script rules
│   ├── guard-writes.mjs    Block audio and .env commits
│   ├── all-tests.mjs       Run full test suite
│   └── tests/              Hook script unit tests
├── .kiro/
│   ├── steering/           Shared guidelines and architecture docs
│   └── hooks/              Automation hook configurations
└── README.md               Project overview
```

## Key Files

- `package.json` at each module level (tools/library, station)
- `tsconfig.json` for strict TypeScript
- `vitest.config.ts` for test setup
- `.gitignore` excludes audio, .env, node_modules, build artifacts
