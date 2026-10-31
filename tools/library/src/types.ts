/**
 * types.ts - Shared TypeScript interfaces for station-library.
 * These types flow through every module; keep them stable.
 */

/** Raw data from one CSV row before validation. */
export interface CsvRow {
  title?: string;
  file?: string;
  seconds?: string | number;
  mstr?: string | boolean;
  ext?: string;
  versions?: string | number;
  file_size_mb?: string | number;
  [key: string]: string | number | boolean | undefined;
}

/** Validated row ready for analysis and encoding. */
export interface SourceTrack {
  title: string;
  file: string;
  seconds: number;
  mstr: boolean;
  ext: string;
  versions: number;
  fileSizeMb: number;
}

/** Output of the ffmpeg loudness and talk-up analysis pass. */
export interface AnalysisResult {
  lufs: number;
  truePeak: number;
  seconds: number;
  talkupSeconds: number;
  madeAt: string;
  /** Intermediate loudnorm values for the encode pass. */
  measuredI: number;
  measuredTp: number;
  measuredLra: number;
  measuredThresh: number;
}

/**
 * One entry in library.json (public shape, written to disk).
 * Internal cache fields are stripped before write and stored separately in .library-cache.json.
 */
export interface LibraryEntry {
  id: string;
  slug: string;
  title: string;
  seconds: number;
  talkup_seconds: number;
  lufs: number;
  made_at: string;
  mp3: string; // Public URL: "/audio/<slug>.mp3"
}

/**
 * Extended internal shape that also carries cache fields.
 * Never written directly; source_size and source_mtime are stripped by library.ts.
 */
export interface LibraryEntryInternal extends LibraryEntry {
  source_size: number;
  source_mtime: number;
}

/** Fields stored per-slug in the separate cache file (.library-cache.json). */
export interface CacheRecord {
  slug: string;
  source_size: number;
  source_mtime: number;
}

/** Resolved environment variables and CLI flags for a single run. */
export interface RunConfig {
  ffmpegPath: string;
  libraryOut: string;
  csvPath: string;
  dataDir: string;
  libraryJsonPath: string;
  force: boolean;
  dryRun: boolean;
  concurrency: number;
}
