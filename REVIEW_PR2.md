# Review of PR #2 (QA fixes)

Read-only review. PR #2 was not merged, modified or rebased. I fetched `pull/2/head` (commit `06c82dc`) and ran it in a separate worktree next to a fresh clone of `main` (`afe401d`). The PR is based directly on current `main`, so it needs no rebase.

## What it changes

Six commits, 11 files, +207 / -11.

| Change | Files | Safe to merge? |
|---|---|---|
| Station MCP tests fall back to a committed sample library when `data/library.json` is missing. `mcp-server.ts` now reads an optional `DEAD_AIR_LIBRARY` env var (default is unchanged). | `station/src/mcp-server.ts`, `station/tests/mcp.test.ts`, `station/tests/fixtures/library.sample.json` | Yes. Default behavior is identical. The fixture holds 8 fake tracks used only by tests. The titles are made-up placeholders and are not real NoBanks Nearby songs. See note 1. |
| Add `@types/express` pinned to 4.17.21 and replace `for (const [k, v] of response.headers)` with `headers.forEach`. Makes `tsc --noEmit` clean. | `station/package.json`, `station/package-lock.json`, `station/src/dev-server.ts` | Yes. The `forEach` form is equivalent. The new package is dev-only and exact-pinned. |
| `dev-server` falls back to `0.0.0.0` when the `::` bind fails with `EAFNOSUPPORT` or `EADDRNOTAVAIL`. Only applies when `HOST` is unset. | `station/src/dev-server.ts`, `README.md` | Yes, with one caution (note 2). Production sets `HOST=127.0.0.1`, so it never takes the new path. |
| `all-tests.mjs` hook runs real `tsc --noEmit` and the web tests. The old script called `npm run tsc`, which does not exist in any package, so the hook could never pass. | `scripts/hooks/all-tests.mjs` | Yes. This is the "task done means tests pass" Kiro hook. It now works. It lives in `scripts/`, not `.kiro/`. |
| Untrack two committed `.pyc` files and ignore `__pycache__/` and `*.pyc`. | `.gitignore`, `tools/studio/**/__pycache__` | Yes. |
| Add the live URL to the README. | `README.md` | Yes. The URL matches `og:url` in `web/index.html`. |

No app audio, `.kiro/` content, workflow, deployment config or secret is touched.

## What I verified

On a fresh clone of `main` (`npm ci` in each package, no `data/library.json`, no audio):

- `station`: 3 of 91 tests fail (all in `mcp.test.ts`, because the MCP server prints a "could not load library" message instead of JSON). `tsc --noEmit` fails with many implicit-any errors in `dev-server.ts` (missing `@types/express`).
- `web`: 27 of 27 tests pass, `tsc --noEmit` clean.
- `tools/library`: 30 pass, 2 skipped (they need ffmpeg and real audio), `tsc --noEmit` clean.
- `node scripts/hooks/all-tests.mjs` cannot go green on `main`.

On the PR branch with the same setup:

- `station`: 91 of 91 pass. `tsc --noEmit` clean.
- `node scripts/hooks/all-tests.mjs` prints `all tests pass (6/6)`.
- `npx tsx src/dev-server.ts` starts, loads 39 voice clips and 6 hidden stations, and binds.

So the PR fixes the three failures a judge would see when they clone the repo and run the tests.

## Would anything break a fresh clone?

Nothing in the PR does. Problems that remain after it (none are caused by it):

1. The audio is not in the repo, and `data/library.json` is gitignored. A fresh clone starts but has no songs, so there is nothing to hear locally. The live site is the way to experience it.
2. `dev-server.ts` still defaults `LIBRARY_OUT`, `VOICE_OUT` and `FFMPEG` to `C:\Users\machi\...` paths. On Linux or macOS they must be set by hand. The PR does not change this.
3. `web/README.md` points to `tests/smoke.spec.ts`, but the file is `web/e2e/smoke.spec.ts`.

## Notes and cautions

1. The fixture only needs to satisfy the tests. If `data/library.json` exists on a machine, the real file is still used first, so the author's local runs are unchanged.
2. The fallback in `dev-server.ts` calls `server.listen` a second time inside the `error` handler of the first. It works in my run, but it is the one piece of new logic in the PR and it is not covered by a test. Low risk, since production pins `HOST`.
3. Merge order: the docs branch rewrites the README "Run it locally" block, and PR #2 edits one line inside it (the `npm run dev` line) plus the tagline area. Expect a small README conflict whichever merges second. Resolve it by keeping the docs branch block and PR #2's live URL line.
4. The README in this branch says the repo has seven specs. PR #2 does not touch that part.

## Recommendation

**Yes, merge PR #2.** It is small, dev-only, and makes the test suite and the Kiro "tests must pass" hook go green on a fresh clone, which is something a judge may try. It should be merged by Ryan. I did not merge it.
