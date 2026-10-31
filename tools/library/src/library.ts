/**
 * library.ts - Build and write /data/library.json and /data/.library-cache.json.
 *
 * REQ-8: Sort by title (case-insensitive), strip internal cache fields,
 * write atomically via .tmp + rename.
 *
 * Cache fields (source_size, source_mtime) are written to a separate
 * .library-cache.json file for resume logic on subsequent runs.
 */

import { writeFileSync, renameSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import type { LibraryEntry, LibraryEntryInternal, CacheRecord } from "./types.js";

/**
 * Write the final library JSON to `outputPath` and cache to `cacheJsonPath`.
 *
 * Accepts an array of `LibraryEntryInternal` (which may carry source_size and
 * source_mtime), strips those fields from the public library.json, sorts by
 * title, and writes both files atomically.
 *
 * @param entries - Full internal entries (cache fields included).
 * @param outputPath - Absolute path to library.json.
 * @param cacheJsonPath - Absolute path to .library-cache.json (gitignored).
 */
export function writeLibrary(
  entries: LibraryEntryInternal[],
  outputPath: string,
  cacheJsonPath: string
): void {
  // Ensure parent directories exist.
  const dir = dirname(outputPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Sort case-insensitively by title.
  const sorted = [...entries].sort((a, b) =>
    a.title.toLowerCase().localeCompare(b.title.toLowerCase())
  );

  // Build public library entries (no cache fields) and extract cache records.
  const publicEntries: LibraryEntry[] = [];
  const cacheRecords: CacheRecord[] = [];

  for (const e of sorted) {
    publicEntries.push({
      id: e.id,
      slug: e.slug,
      title: e.title,
      seconds: Math.round(e.seconds * 100) / 100,
      talkup_seconds: Math.round(e.talkup_seconds * 100) / 100,
      lufs: Math.round(e.lufs * 100) / 100,
      made_at: e.made_at,
      mp3: `/audio/${e.slug}.mp3`, // Public URL path
    });

    cacheRecords.push({
      slug: e.slug,
      source_size: e.source_size,
      source_mtime: e.source_mtime,
    });
  }

  // Write library.json
  const json = JSON.stringify(publicEntries, null, 2);
  const tmpPath = `${outputPath}.tmp`;

  try {
    writeFileSync(tmpPath, json, "utf8");
    renameSync(tmpPath, outputPath);
  } catch (err: unknown) {
    // Attempt a retry once.
    try {
      writeFileSync(tmpPath, json, "utf8");
      renameSync(tmpPath, outputPath);
    } catch (retryErr: unknown) {
      const msg = retryErr instanceof Error ? retryErr.message : String(retryErr);
      throw new Error(`Failed to write library.json after retry: ${msg}`);
    }
  }

  // Write cache file
  const cacheJson = JSON.stringify(cacheRecords, null, 2);
  const cacheTmpPath = `${cacheJsonPath}.tmp`;

  try {
    writeFileSync(cacheTmpPath, cacheJson, "utf8");
    renameSync(cacheTmpPath, cacheJsonPath);
  } catch (err: unknown) {
    // Log warning but don't fail the whole operation if cache write fails.
    process.stderr.write(`[library] warning: failed to write cache: ${err}\n`);
  }
}
