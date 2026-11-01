import type { Track, Voicebank, FeaturedEntry, Segment } from "./types.js";
import { generateDay } from "./day.js";
import { stationDayIndex, stationDayStartByIndex } from "./tzoffsets.js";

/**
 * Return all segments overlapping [fromAbsMs, toAbsMs) in chronological order.
 * Both bounds are absolute UTC ms.
 * Used by the HTTP handler to fetch a window of segments.
 */
export function schedule(
  library: Track[],
  voicebank: Voicebank,
  featured: FeaturedEntry[],
  epochMs: number,
  fromAbsMs: number,
  toAbsMs: number
): Segment[] {
  if (fromAbsMs >= toAbsMs) return [];
  if (library.length === 0) throw new Error("schedule: library is empty");

  const fromDayIdx = Math.max(0, stationDayIndex(fromAbsMs, epochMs));
  const toDayIdx = stationDayIndex(toAbsMs - 1, epochMs); // -1: toAbsMs is exclusive

  const segments: Segment[] = [];

  for (let d = fromDayIdx; d <= toDayIdx; d++) {
    const day = generateDay(d, library, voicebank, featured, epochMs);
    for (const seg of day.segments) {
      if (seg.endMs > fromAbsMs && seg.startMs < toAbsMs) {
        segments.push(seg);
      }
    }
  }

  segments.sort((a, b) => a.startMs - b.startMs);
  return segments;
}
