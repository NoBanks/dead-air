/**
 * slug.ts - Title-to-slug conversion with dedup logic.
 *
 * REQ-6: Stable, URL-safe slugs. No consecutive hyphens, no leading/trailing
 * hyphens, fallback to "track-<n>" when nothing survives the strip.
 */

/**
 * Convert a title string to a URL-safe slug.
 * - NFD-normalize to decompose accented characters.
 * - Strip non-ASCII (covers diacritics after decomposition).
 * - Lowercase.
 * - Replace runs of non-alphanumeric characters with a single hyphen.
 * - Trim leading/trailing hyphens.
 *
 * @param title - Raw title string from the CSV.
 * @param fallbackIndex - 1-based row index used when no alphanumeric chars survive.
 * @returns A slug string.
 */
export function slugify(title: string, fallbackIndex: number = 1): string {
  const cleaned = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // non-alphanumeric runs -> single hyphen
    .replace(/^-+|-+$/g, ""); // trim leading/trailing hyphens

  if (cleaned.length === 0) {
    return `track-${fallbackIndex}`;
  }

  return cleaned;
}

/**
 * Produce a unique slug for one track, given the set of slugs already assigned
 * earlier in the same run.
 *
 * Appends "-2", "-3", ... until the result is not in `usedSet`, then adds the
 * chosen slug to `usedSet` before returning.
 *
 * @param title - Raw title from the CSV.
 * @param index - 1-based row index for the fallback.
 * @param usedSet - Mutable set of already-assigned slugs; updated in place.
 * @returns The unique slug.
 */
export function buildSlug(
  title: string,
  index: number,
  usedSet: Set<string>
): string {
  const base = slugify(title, index);

  if (!usedSet.has(base)) {
    usedSet.add(base);
    return base;
  }

  let counter = 2;
  while (true) {
    const candidate = `${base}-${counter}`;
    if (!usedSet.has(candidate)) {
      usedSet.add(candidate);
      return candidate;
    }
    counter++;
  }
}
