/**
 * cache.ts - Resume logic. Read existing library.json, check source WAV
 * size+mtime against cached values.
 *
 * REQ-9: Skip unchanged tracks. Force-flag bypasses all cache checks.
 */

import { readFileSync, existsSync, statSync } from "fs";
import type { CacheRecord, LibraryEntry } from "./types.js";

/**
 * Load the existing library.json (if it exists) and build a Map keyed by slug.
 * The map values are CacheRecord objects combining the public LibraryEntry with
 * reconstructed source_size and source_mtime.
 *
 * NOTE: The public library.json does NOT store source_size / source_mtime (they
 * are stripped on write). If those fields are absent in the file, the returned
 * CacheRecord will have 0 for both, so the cache check in `isCached` will miss
 * and re-encode — which is the correct safe fallback.
 */
export function loadCache(libraryPath: string): Map<string, CacheRecord> {
  const map = new Map<string, CacheRecord>();

  if (!existsSync(libraryPath)) {
    return map;
  }

  let entries: unknown;
  try {
    const raw = readFileSync(libraryPath, "utf8");
    entries = JSON.parse(raw);
  } catch {
    // Corrupt or unreadable — treat as empty cache.
    return map;
  }

  if (!Array.isArray(entries)) {
    return map;
  }

  for (const entry of entries) {
    if (
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as Record<string, unknown>).slug === "string"
    ) {
      const e = entry as LibraryEntry & {
        source_size?: number;
        source_mtime?: number;
      };
      map.set(e.slug, {
        slug: e.slug,
        source_size: typeof e.source_size === "number" ? e.source_size : 0,
        source_mtime: typeof e.source_mtime === "number" ? e.source_mtime : 0,
        entry: {
          id: e.id,
          slug: e.slug,
          title: e.title,
          seconds: e.seconds,
          talkup_seconds: e.talkup_seconds,
          lufs: e.lufs,
          made_at: e.made_at,
          mp3: e.mp3,
        },
      });
    }
  }

  return map;
}

/**
 * Check whether a track can be skipped (cache hit).
 *
 * A cache hit requires:
 *   1. The slug has a record in `cacheMap`.
 *   2. The WAV's current size matches `source_size`.
 *   3. The WAV's current mtime (ms) matches `source_mtime`.
 *   4. Both source_size and source_mtime are non-zero.
 *   5. The MP3 output file exists at `mp3Path`.
 *
 * @param slug - Track slug.
 * @param wavPath - Absolute path to the source WAV.
 * @param mp3Path - Absolute path to the expected output MP3.
 * @param cacheMap - Map built by `loadCache`.
 * @returns The cached LibraryEntry if hit, null if miss.
 */
export function isCached(
  slug: string,
  wavPath: string,
  mp3Path: string,
  cacheMap: Map<string, CacheRecord>
): CacheRecord["entry"] | null {
  const record = cacheMap.get(slug);
  if (!record) return null;
  if (record.source_size === 0 || record.source_mtime === 0) return null;
  if (!existsSync(mp3Path)) return null;

  try {
    const stat = statSync(wavPath);
    if (stat.size !== record.source_size) return null;
    if (stat.mtimeMs !== record.source_mtime) return null;
  } catch {
    return null;
  }

  return record.entry;
}
