/**
 * index.ts - CLI entry point for station-library.
 *
 * Orchestrates: config resolution, CSV parse, exclude filter, slug dedup,
 * cache load, concurrent encode pool, progress display, library.json write.
 *
 * REQ-3, REQ-5, REQ-9, REQ-10, REQ-11
 */

import { existsSync, statSync } from "fs";
import { join, resolve, relative } from "path";
import { fileURLToPath } from "url";
import { parseCsv } from "./csv.js";
import { makeIsExcluded } from "./exclude.js";
import { buildSlug } from "./slug.js";
import { loadCache, isCached, loadLibraryEntries } from "./cache.js";
import { analyzeTrack } from "./analyze.js";
import { encodeTrack } from "./encode.js";
import { writeLibrary } from "./library.js";
import type { RunConfig, LibraryEntryInternal } from "./types.js";

// ---------------------------------------------------------------------------
// Config resolution (Tasks 11)
// ---------------------------------------------------------------------------

function parseArgs(args: string[]): {
  force: boolean;
  dryRun: boolean;
  concurrency: number;
} {
  let force = false;
  let dryRun = false;
  let concurrency = 4;

  for (const arg of args) {
    if (arg === "--force") force = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg.startsWith("--concurrency=")) {
      const n = parseInt(arg.slice("--concurrency=".length), 10);
      if (!isNaN(n) && n > 0) concurrency = n;
    }
  }

  return { force, dryRun, concurrency };
}

function resolveConfig(): RunConfig {
  const args = process.argv.slice(2);
  const { force, dryRun, concurrency } = parseArgs(args);

  const ffmpegPath =
    process.env["FFMPEG"] ??
    "C:\\Users\\machi\\Downloads\\ffmpeg-8.0.1-essentials_build_CLEAN\\bin\\ffmpeg.exe";

  const libraryOut = process.env["LIBRARY_OUT"] ?? "";
  const csvPath = process.env["CSV_PATH"] ?? "";

  const errors: string[] = [];

  if (!ffmpegPath) {
    errors.push("FFMPEG environment variable is not set.");
  } else if (!existsSync(ffmpegPath)) {
    errors.push(`ffmpeg binary not found at: ${ffmpegPath}`);
  }

  if (!libraryOut) {
    errors.push("LIBRARY_OUT environment variable is not set.");
  }

  if (!csvPath) {
    errors.push("CSV_PATH environment variable is not set.");
  }

  if (errors.length > 0) {
    for (const e of errors) process.stderr.write(`[config] ERROR: ${e}\n`);
    process.exit(1);
  }

  // data/ dir is two levels up from dist/index.js -> repo root -> data/
  const __dirname = fileURLToPath(new URL(".", import.meta.url));
  const repoRoot = resolve(__dirname, "..", "..", "..");
  const dataDir = join(repoRoot, "data");
  const libraryJsonPath = join(dataDir, "library.json");
  const cacheJsonPath = join(dataDir, ".library-cache.json");

  return {
    ffmpegPath,
    libraryOut,
    csvPath,
    dataDir,
    libraryJsonPath,
    force,
    dryRun,
    concurrency,
  };
}

// ---------------------------------------------------------------------------
// Progress display (Task 14)
// ---------------------------------------------------------------------------

let progressLine = "";

function progress(done: number, total: number, title: string, status: string): void {
  const truncated = title.length > 40 ? title.slice(0, 37) + "..." : title;
  progressLine = `[${done}/${total}] ${truncated}... ${status}`;
  process.stdout.write(`\r${progressLine.padEnd(80)}`);
}

function clearProgress(): void {
  process.stdout.write(`\r${" ".repeat(progressLine.length + 2)}\r`);
}

// ---------------------------------------------------------------------------
// Concurrency pool (Task 13)
// ---------------------------------------------------------------------------

interface TrackJob {
  index: number;
  title: string;
  slug: string;
  file: string;
}

interface JobResult {
  slug: string;
  entry?: LibraryEntryInternal;
  skipped: boolean;
  error?: string;
}

async function processTrack(
  job: TrackJob,
  config: RunConfig,
  cacheMap: ReturnType<typeof loadCache>,
  libraryEntries: ReturnType<typeof loadLibraryEntries>,
  doneRef: { count: number },
  total: number
): Promise<JobResult> {
  const { title, slug, file } = job;
  const wavPath = file;
  const mp3FileName = `${slug}.mp3`;
  const mp3AbsPath = join(config.libraryOut, mp3FileName);

  // Compute the mp3 path relative to the repo root for the JSON entry.
  const __dirname = fileURLToPath(new URL(".", import.meta.url));
  const repoRoot = resolve(__dirname, "..", "..", "..");
  // Use forward slashes for the stored path (web-friendly).
  const mp3RelPath = relative(repoRoot, mp3AbsPath).replace(/\\/g, "/");

  // Check WAV exists.
  if (!existsSync(wavPath)) {
    doneRef.count++;
    progress(doneRef.count, total, title, "error: WAV not found");
    return { slug, skipped: false, error: `WAV not found: ${wavPath}` };
  }

  // Cache check (skip if --force).
  if (!config.force) {
    if (isCached(slug, wavPath, mp3AbsPath, cacheMap)) {
      doneRef.count++;
      progress(doneRef.count, total, title, "skipped");
      const stat = statSync(wavPath);
      // Use the previous entry data from library.json if available.
      const prevEntry = libraryEntries.get(slug);
      if (prevEntry && typeof prevEntry === "object") {
        return {
          slug,
          skipped: true,
          entry: {
            id: slug,
            slug,
            title: String(prevEntry.title ?? title),
            seconds: Number(prevEntry.seconds ?? 0),
            talkup_seconds: Number(prevEntry.talkup_seconds ?? 0),
            lufs: Number(prevEntry.lufs ?? 0),
            made_at: String(prevEntry.made_at ?? new Date().toISOString()),
            mp3: `/audio/${slug}.mp3`,
            source_size: stat.size,
            source_mtime: stat.mtimeMs,
          },
        };
      }
      // Fallback if no previous entry found (shouldn't happen if cache checks pass)
      return {
        slug,
        skipped: true,
        entry: {
          id: slug,
          slug,
          title,
          seconds: 0,
          talkup_seconds: 0,
          lufs: 0,
          made_at: new Date().toISOString(),
          mp3: `/audio/${slug}.mp3`,
          source_size: stat.size,
          source_mtime: stat.mtimeMs,
        },
      };
    }
  }

  if (config.dryRun) {
    doneRef.count++;
    progress(doneRef.count, total, title, "dry-run");
    return { slug, skipped: false };
  }

  // Analyze.
  progress(doneRef.count, total, title, "analyzing...");
  let analysis;
  try {
    analysis = await analyzeTrack(config.ffmpegPath, wavPath);
  } catch (err: unknown) {
    doneRef.count++;
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`\n[encode] ERROR analyze ${title}: ${msg}\n`);
    progress(doneRef.count, total, title, "error");
    return { slug, skipped: false, error: msg };
  }

  // Encode.
  progress(doneRef.count, total, title, "encoding...");
  try {
    await encodeTrack(config.ffmpegPath, wavPath, mp3AbsPath, analysis);
  } catch (err: unknown) {
    doneRef.count++;
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`\n[encode] ERROR encode ${title}: ${msg}\n`);
    progress(doneRef.count, total, title, "error");
    return { slug, skipped: false, error: msg };
  }

  // Read final WAV stat for cache.
  const stat = statSync(wavPath);

  doneRef.count++;
  progress(doneRef.count, total, title, "done");

  const entry: LibraryEntryInternal = {
    id: slug,
    slug,
    title,
    seconds: Math.round(analysis.seconds * 100) / 100,
    talkup_seconds: Math.round(analysis.talkupSeconds * 100) / 100,
    lufs: Math.round(analysis.lufs * 100) / 100,
    made_at: analysis.madeAt,
    mp3: `/audio/${slug}.mp3`,
    source_size: stat.size,
    source_mtime: stat.mtimeMs,
  };

  return { slug, skipped: false, entry };
}

async function runPool(
  jobs: TrackJob[],
  config: RunConfig,
  cacheMap: ReturnType<typeof loadCache>,
  libraryEntries: ReturnType<typeof loadLibraryEntries>
): Promise<JobResult[]> {
  const results: JobResult[] = new Array(jobs.length);
  const doneRef = { count: 0 };
  const total = jobs.length;
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < jobs.length) {
      const i = nextIndex++;
      results[i] = await processTrack(
        jobs[i],
        config,
        cacheMap,
        libraryEntries,
        doneRef,
        total
      );
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < config.concurrency; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  return results;
}

// ---------------------------------------------------------------------------
// Main (Tasks 11-15)
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const config = resolveConfig();

  // Load CSV.
  let tracks;
  try {
    tracks = parseCsv(config.csvPath);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[csv] ERROR: ${msg}\n`);
    process.exit(1);
  }

  // Apply exclude list.
  const isExcluded = makeIsExcluded(
    join(config.dataDir, "exclude.txt")
  );
  const included = tracks.filter((t) => !isExcluded(t.title));

  const excluded = tracks.length - included.length;
  if (excluded > 0) {
    process.stderr.write(`[exclude] Skipping ${excluded} excluded title(s).\n`);
  }

  // Build slug map (dedup pass — serial, before workers start).
  const usedSlugs = new Set<string>();
  const jobs: TrackJob[] = included.map((track, i) => ({
    index: i + 1,
    title: track.title,
    slug: buildSlug(track.title, i + 1, usedSlugs),
    file: track.file,
  }));

  const total = jobs.length;
  process.stdout.write(
    `station-library: ${total} tracks to process (concurrency=${config.concurrency}${config.force ? ", force" : ""}${config.dryRun ? ", dry-run" : ""})\n`
  );

  // Load cache and existing library entries.
  const cacheJsonPath = join(config.dataDir, ".library-cache.json");
  const cacheMap = loadCache(cacheJsonPath);
  const libraryEntries = loadLibraryEntries(config.libraryJsonPath);

  // Process tracks.
  const results = await runPool(jobs, config, cacheMap, libraryEntries);

  clearProgress();

  // Tally results.
  let encoded = 0;
  let skipped = 0;
  let errored = 0;
  const entries: LibraryEntryInternal[] = [];

  for (const r of results) {
    if (r.error) {
      errored++;
      process.stderr.write(`[summary] ERROR: ${r.slug}: ${r.error}\n`);
    } else if (r.skipped) {
      skipped++;
      if (r.entry) entries.push(r.entry);
    } else {
      encoded++;
      if (r.entry) entries.push(r.entry);
    }
  }

  // Write library.json and cache file (Task 15).
  if (!config.dryRun && entries.length > 0) {
    try {
      const cacheJsonPath = join(config.dataDir, ".library-cache.json");
      writeLibrary(entries, config.libraryJsonPath, cacheJsonPath);
      process.stdout.write(
        `[library] Wrote ${entries.length} entries to ${config.libraryJsonPath}\n`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[library] ERROR writing library.json: ${msg}\n`);
      process.exit(1);
    }
  }

  // Summary (Task 14).
  process.stdout.write(
    `\nDone. total=${total}  encoded=${encoded}  skipped=${skipped}  errored=${errored}\n`
  );

  process.exit(errored > 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[fatal] ${msg}\n`);
  process.exit(1);
});
