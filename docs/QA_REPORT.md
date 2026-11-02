# QA Report (cloud pass, 2026-11-02)

Branch `cloud/qa-pass`, from `main`. Fresh Linux container, Node 22.23, no audio files, no `data/library.json` (it is gitignored). Nothing here touched network services or TTS.

## 1. What runs

| Check | Result |
|---|---|
| `station`: `npm ci` | ok |
| `station`: `npx vitest run` (before this PR) | 88 pass, **3 fail** (all in `tests/mcp.test.ts`, see 2a) |
| `station`: `npx tsc --noEmit` (`npm run build`) | **fails, 23 errors** (see 2b) |
| `web`: `npx tsc --noEmit` | ok |
| `web`: `npx vitest run` (before this PR) | 27 pass |
| `web`: `npx vite build` | ok, 16 modules, JS 25.9 kB (10.4 kB gzip), CSS 7.5 kB, HTML 3.2 kB |
| `tools/library`: `npx tsc --noEmit`, `npx vitest run` | ok, 30 pass, 2 skipped |
| `scripts/hooks` (`node --test scripts/hooks/tests/*.test.mjs`) | 27 pass |
| `scripts/hooks/all-tests.mjs` | **fails**: it runs `npm run tsc`, a script that does not exist in `station` or `tools/library` (see 2c) |
| `tools/studio/tests/test_worker.py` (unittest) | **errors** on import in this container (see 2d); pytest is not installed |
| `web` Playwright e2e (`e2e/smoke.spec.ts`) | not run: needs a live dev server plus audio; file contains a bare `test.skip;` that does nothing |
| No lint script exists in any package | n/a |

After this PR: station 98 pass / 3 fail (same 3), web 31 pass.

## 2. What fails

### a. station MCP tests (3 failures), environmental
`tests/mcp.test.ts` spawns `src/mcp-server.ts`, which reads `data/library.json`. That file is gitignored, so on any fresh clone (or CI) the library is empty, tools return plain-text errors such as `nowPlaying: library is empty`, and the test dies on `JSON.parse` with a confusing "Unexpected token" message. The other 88 station tests build a fake library and are unaffected. Fix: skip the three tests when `data/library.json` is absent (`describe.skipIf`), or have the test point at a small fixture library.

### b. station typecheck, 23 errors
- `@types/express` is missing from `devDependencies`, so `express` is implicitly `any` (TS7016). The remaining TS7006 "implicit any" errors in `src/dev-server.ts` follow from that.
- `src/dev-server.ts:108`: `Headers` is not iterable under the current `lib`/`target` (TS2488). Adding `"DOM.Iterable"` to `lib` or using `headers.forEach` fixes it.
`npm run build` therefore fails. `tsx` ignores types, so the server still runs.

### c. `scripts/hooks/all-tests.mjs` can never pass
It calls `npm --prefix station run tsc` and `npm --prefix tools/library run tsc`; neither package defines a `tsc` script (they define `build`). Since the hook is the "a task isn't done until all tests pass" gate in `.kiro/hooks/dead-air.json`, it will always report failure. Fix: change to `run build` (after fixing 2b for station) or `npx tsc --noEmit`.

### d. studio worker test
`python3 -m unittest discover -s tools/studio/tests` errors on import here. Likely the worker needs optional heavy deps or a layout assumption; not investigated further to stay non-invasive. Worth a look on the laptop.

## 3. Behavior notes from running the server

- `dev-server.ts` binds to `::` by default. In this container (no IPv6) it crashes with `EAFNOSUPPORT`. `HOST=127.0.0.1` works. Judges on odd hosts or some Docker setups could hit this.
- With no library, `/now` returns HTTP 500 `{"error":"nowPlaying: library is empty"}`. Reasonable, but the tuner has no friendly state for it.
- `/signal?f=1410` returns 200 with a hit and the hidden-station contract works.
- Hard coded Windows paths as defaults: `LIBRARY_OUT`, `VOICE_OUT`, `FFMPEG` in `station/src/dev-server.ts:70,71,119`, and `tools/demo/capture.py:19`. Harmless in production if env vars are set, but a judge cloning the repo cannot run it without reading the code.

## 4. Flaky spots

- `station/tests/nowPlaying.test.ts` P-11 asserts p95 < 50 ms over 1000 random times. Wall-clock assertions can flake on a loaded CI box. All station tests passed on every run here (4.5 s total).
- `tools/library` talkup test prints a fallback warning and has 2 skipped tests; not flaky, but skipped coverage.
- `web/src/signal.ts` `checkSignal` sends the `/signal` 204 miss response to `response.json()`, which throws on an empty body. It is currently unused (`grep` finds no callers), so no user impact, but it would log a warning on every miss and expects a `{locked}` shape the server never returns. Candidate for deletion. Covered by new tests that pin its current contract.

## 5. Secrets and large files

- No API keys, tokens or passwords found (regex scan of tracked files and a check for `.env`, key, and audio extensions). `.gitignore` excludes `.env*`, `*.wav|mp3|flac`, `data/library.json`.
- Largest tracked files are lockfiles (112 KB max). Total tracked size about 1.2 MB. Nothing large committed.
- Committed junk: `tools/studio/__pycache__/worker.cpython-311.pyc` and `tools/studio/tests/__pycache__/test_worker.cpython-311.pyc`. Not secret. Add `__pycache__/` to `.gitignore` and `git rm --cached` them. Left alone here.
- Personal info, report only: `data/test-3tracks.csv` and the defaults noted in section 3 contain a local Windows username and OneDrive paths. Not a credential.

## 6. What a judge would hit

1. **No offline path.** The repo alone cannot play audio: MP3s, `library.json` and voice files are not committed (by design). A judge cloning the repo gets a tuner with no music. The hosted site is the only real experience; the README does not link it. The only URL in the repo is `https://deadair.nohumannearby.com/` in `web/index.html` OG tags. (This container's proxy blocked that host, so I could not confirm it is up.) Add the live URL to the README top and the Devpost entry.
2. **Autoplay gate.** Audio needs a click on "TURN ON THE RADIO". Fine, and the copy explains it, but the first screen says nothing about sound being required or to unmute.
3. **Dial accessibility.** `#glass` has `role="slider"` with aria min/max/now and is keyboard focusable (arrow keys per README). Good. Gaps: the static/signal meters have no text alternative, `aria-valuenow` does update on dial moves (dial.ts, main.ts), and `style.css` has no `prefers-reduced-motion` rule. The hunt is audio only, so deaf or hard-of-hearing judges get no equivalent; the now-playing card helps for 1714 only.
4. **Load time.** Bundle is small (10 kB gzip JS). Costs are the Google Fonts request (render blocking stylesheet, with preconnect) and decoding the first MP3. Not measured against the live site.
5. **Mobile.** Viewport meta, manifest and touch icons exist. Not exercised in a real browser here.
6. **First-run time dependence.** What plays depends on the time of day (numbers station at midnight and :14, 3:14 AM event). Judges at other hours will not see them unless told; the quickstart covers this.

## 7. Prioritized fix list for the laptop session

P0 (before judging)
1. Put the live URL at the top of README and in Devpost. Confirm the site is up and plays within a few seconds of the click.
2. Fix `all-tests.mjs` (`run tsc` does not exist), since that hook is the done-gate.

P1
3. Add `@types/express` and fix the `Headers` iteration error so `npm run build` in `station` passes.
4. Make `tests/mcp.test.ts` skip (or use a fixture) when `data/library.json` is missing, so a fresh clone is green.
5. Default `HOST` to `127.0.0.1` (or fall back from `::`) in `dev-server.ts`.
6. Add `prefers-reduced-motion` styles and text alternatives for the meters.

P2
7. `.gitignore` `__pycache__/` and untrack the two `.pyc` files.
8. Remove or wire up `web/src/signal.ts` `checkSignal`.
9. Replace the Windows default paths with env-only config and a clear error.
10. Fix `e2e/smoke.spec.ts` (`test.skip;` is a no-op expression) and add a CI workflow (`.github` does not exist) running station, web and tools/library tests.
11. Loosen the P-11 timing assertion or make it a soft warning.

## 8. Tests added by this PR

All new files, no existing file edited, no network or TTS.
- `station/tests/request-store.test.ts`: `JsonFileStore` round trip, overwrite by ticket, no leftover temp file, corrupt file recovery.
- `station/tests/data-config.test.ts`: `hunt.json` and `voicebank.json` shape checks (unique frequencies and ids, in-band, outside the 1714 lock window, positive durations, `/voice/*.mp3` paths, no em dashes in voice text).
- `web/tests/signal.test.ts`: `checkSignal` with `fetch` mocked: 1714 trusted, caching, non-ok handling, error retry after 30 s.
