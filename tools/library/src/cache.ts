/**
 * cache.ts - Resume logic. Read existing .library-cache.json, check source WAV
 * size+mtime against cached values.
 *
 * REQ-9: Skip unchanged tracks. Force-flag bypasses all cache checks.
 */

import { readFileSync, existsSync, statSync } from "fs";
import type { CacheRecord, LibraryEntry } from "./types.js";

/**
 * Load the existing library.json (if it exists) and build a Map keyed by slug.
 * Used to retrieve previous entry data when cache-hitting.
 */
export function loadLibraryEntries(
  libraryPath: string
): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();

  if (!existsSync(libraryPath)) {
    return map;
  }

  let entries: unknown;
  try {
    const raw = readFileSync(libraryPath, "utf8");
    entries = JSON.parse(raw);
  } catch {
    // Corrupt or unreadable — treat as empty.
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
      const e = entry as Record<string, unknown>;
      map.set(e.slug as string, e);
    }
  }

  return map;
}

/**
 * Load the existing .library-cache.json (if it exists) and build a Map keyed by slug.
 * The map values are CacheRecord objects with source_size and source_mtime.
 */
export function loadCache(cacheJsonPath: string): Map<string, CacheRecord> {
  const map = new Map<string, CacheRecord>();

  if (!existsSync(cacheJsonPath)) {
    return map;
  }

  let records: unknown;
  try {
    const raw = readFileSync(cacheJsonPath, "utf8");
    records = JSON.parse(raw);
  } catch {
    // Corrupt or unreadable — treat as empty cache.
    return map;
  }

  if (!Array.isArray(records)) {
    return map;
  }

  for (const record of records) {
    if (
      typeof record === "object" &&
      record !== null &&
      typeof (record as Record<string, unknown>).slug === "string"
    ) {
      const r = record as CacheRecord;
      map.set(r.slug, r);
    }
  }

  return map;
}

/**
 * Check whether a track can be skipped (cache hit).
 *
 * A cache hit requires:
 *   1. The slug has a record in `cacheMap`.
 *   2. The WAV's current size matches the cached source_size.
 *   3. The WAV's current mtime (ms) matches the cached source_mtime.
 *   4. Both source_size and source_mtime are non-zero.
 *   5. The MP3 output file exists at `mp3Path`.
 *
 * @param slug - Track slug.
 * @param wavPath - Absolute path to the source WAV.
 * @param mp3Path - Absolute path to the expected output MP3.
 * @param cacheMap - Map built by `loadCache`.
 * @returns true if the track can be skipped, false if it needs re-encoding.
 */
export function isCached(
  slug: string,
  wavPath: string,
  mp3Path: string,
  cacheMap: Map<string, CacheRecord>
): boolean {
  const record = cacheMap.get(slug);
  if (!record) return false;
  if (record.source_size === 0 || record.source_mtime === 0) return false;
  if (!existsSync(mp3Path)) return false;

  try {
    const stat = statSync(wavPath);
    if (stat.size !== record.source_size) return false;
    if (stat.mtimeMs !== record.source_mtime) return false;
  } catch {
    return false;
  }

  return true;
}
