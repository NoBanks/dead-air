import type {
  Track,
  Voicebank,
  FeaturedEntry,
  NowPlayingResult,
  Segment,
} from "./types.js";
import { generateDay } from "./day.js";
import { stationDayIndex, stationDayStartByIndex, stationDayEnd } from "./tzoffsets.js";

/**
 * Return the current segment and the next 5 for a given wall-clock time.
 *
 * All times are absolute UTC ms. No epoch-relative arithmetic here.
 * Throws if library is empty.
 */
export function nowPlaying(
  library: Track[],
  voicebank: Voicebank,
  featured: FeaturedEntry[],
  epochMs: number,
  at: number
): NowPlayingResult {
  if (library.length === 0) throw new Error("nowPlaying: library is empty");

  const dayIdx = stationDayIndex(at, epochMs);
  const safeIdx = Math.max(0, dayIdx);

  const day = generateDay(safeIdx, library, voicebank, featured, epochMs);

  // Binary search for the containing segment.
  let lo = 0;
  let hi = day.segments.length - 1;
  let foundIdx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const s = day.segments[mid];
    if (at >= s.startMs && at < s.endMs) {
      foundIdx = mid;
      break;
    } else if (at < s.startMs) {
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }

  // If not found in this day (e.g. at is exactly dayEnd), use day+1.
  if (foundIdx === -1) {
    if (at >= day.endMs) {
      const nextDay = generateDay(safeIdx + 1, library, voicebank, featured, epochMs);
      foundIdx = 0;
      const seg = nextDay.segments[0];
      const next = collectNext(nextDay.segments, 0, safeIdx + 1, library, voicebank, featured, epochMs);
      return { segment: seg, offsetMs: at - seg.startMs, next };
    }
    // at is before dayStart (before epoch); return first segment with offsetMs=0
    const seg = day.segments[0];
    const next = collectNext(day.segments, 0, safeIdx, library, voicebank, featured, epochMs);
    return { segment: seg, offsetMs: 0, next };
  }

  const seg = day.segments[foundIdx];
  const next = collectNext(day.segments, foundIdx, safeIdx, library, voicebank, featured, epochMs);
  return { segment: seg, offsetMs: at - seg.startMs, next };
}

/** Collect up to 5 segments after foundIdx, spilling into the next day if needed. */
function collectNext(
  segments: Segment[],
  foundIdx: number,
  dayIdx: number,
  library: Track[],
  voicebank: Voicebank,
  featured: FeaturedEntry[],
  epochMs: number
): Segment[] {
  const next: Segment[] = [];
  let i = foundIdx + 1;
  while (next.length < 5) {
    if (i < segments.length) {
      next.push(segments[i++]);
    } else {
      // Spill into next day.
      const nextDay = generateDay(dayIdx + 1, library, voicebank, featured, epochMs);
      for (const s of nextDay.segments) {
        if (next.length >= 5) break;
        next.push(s);
      }
      break;
    }
  }
  return next;
}
