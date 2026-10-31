/**
 * exclude.ts - Load /data/exclude.txt and gate tracks against it.
 *
 * REQ-2: Titles on the blocklist are never analyzed, encoded, or written
 * to library.json. Absence of the file is treated as an empty blocklist.
 */

import { readFileSync, existsSync } from "fs";

/**
 * Load the exclude list from `excludePath`.
 * Returns a Set of lowercased, trimmed title strings.
 * Returns an empty Set if the file does not exist.
 */
export function loadExcludeSet(excludePath: string): Set<string> {
  if (!existsSync(excludePath)) {
    return new Set();
  }

  try {
    const content = readFileSync(excludePath, "utf8");
    const lines = content
      .split(/\r?\n/)
      .map((l) => l.trim().toLowerCase())
      .filter((l) => l.length > 0);
    return new Set(lines);
  } catch {
    // Treat unreadable file as empty blocklist.
    return new Set();
  }
}

/**
 * Factory: returns an `isExcluded` predicate bound to the given exclude path.
 *
 * @param excludePath - Absolute path to exclude.txt.
 */
export function makeIsExcluded(excludePath: string): (title: string) => boolean {
  const excludeSet = loadExcludeSet(excludePath);
  return (title: string) => excludeSet.has(title.trim().toLowerCase());
}
