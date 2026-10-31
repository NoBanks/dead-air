/**
 * library.ts - Build and write /data/library.json.
 *
 * REQ-8: Sort by title (case-insensitive), strip internal cache fields,
 * write atomically via .tmp + rename.
 */

import { writeFileSync, renameSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import type { LibraryEntry, LibraryEntryInternal } from "./types.js";

/**
 * Write the final library JSON to `outputPath`.
 *
 * Accepts an array of `LibraryEntryInternal` (which may carry source_size and
 * source_mtime), strips those fields, sorts by title, and writes atomically.
 *
 * @param entries - Full internal entries (cache fields included).
 * @param outputPath - Absolute path to library.json.
 */
export function writeLibrary(
  entries: LibraryEntryInternal[],
  outputPath: string
): void {
  // Ensure the parent directory exists.
  const dir = dirname(outputPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Sort case-insensitively by title.
  const sorted = [...entries].sort((a, b) =>
    a.title.toLowerCase().localeCompare(b.title.toLowerCase())
  );

  // Strip internal fields before writing, except source_size/source_mtime which are needed for cache.
  const publicEntries: Array<LibraryEntry & { source_size?: number; source_mtime?: number }> = sorted.map((e) => ({
    id: e.id,
    slug: e.slug,
    title: e.title,
    seconds: Math.round(e.seconds * 100) / 100,
    talkup_seconds: Math.round(e.talkup_seconds * 100) / 100,
    lufs: Math.round(e.lufs * 100) / 100,
    made_at: e.made_at,
    mp3: e.mp3,
    source_size: e.source_size,
    source_mtime: e.source_mtime,
  }));

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
}
