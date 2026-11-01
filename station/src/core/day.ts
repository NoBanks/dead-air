import type {
  Track,
  Voicebank,
  FeaturedEntry,
  Segment,
  SongSegment,
  VoiceSegment,
  NumbersSegment,
  EbsSegment,
  DaySchedule,
} from "./types.js";
import { mulberry32, daySeed, hashTrackId } from "./prng.js";
import {
  stationDayStartByIndex,
  stationDayEnd,
  stationHourOf,
} from "./tzoffsets.js";

// Kinds that count as a "break" body clip.
const BREAK_KINDS = new Set(["drop", "break", "storm", "marty", "sponsor", "caller"]);

/**
 * Generate one full station day as a strict timeline tile.
 *
 * Invariant (asserted at the end):
 *   segments[0].startMs === dayStart
 *   segments[last].endMs === dayEnd
 *   segments[i].endMs === segments[i+1].startMs for all consecutive pairs
 */
export function generateDay(
  dayIndex: number,
  library: Track[],
  voicebank: Voicebank,
  featured: FeaturedEntry[],
  epochMs: number
): DaySchedule {
  if (library.length === 0) throw new Error("generateDay: library is empty");

  const dayStart = stationDayStartByIndex(dayIndex, epochMs);
  // stationDayEnd expects a UTC time inside the day (not at midnight itself).
  const dayEnd = stationDayEnd(dayStart + 3_600_000); // 1h inside same LA day

  const segments: Segment[] = [];

  // --- Seed the PRNG -------------------------------------------------------
  const seed = daySeed(epochMs, dayIndex);
  const prng = mulberry32(seed);

  // PRNG call #1: EBS placement within 01:00–04:00 LA.
  // We compute the UTC time of 01:00 LA for this day.
  const oneAmUtc = dayStart + 3_600_000; // +1h from midnight
  const ebsOffsetMs = Math.floor(prng() * 3 * 3_600_000); // 0..3h
  const ebsTargetMs = oneAmUtc + ebsOffsetMs; // somewhere in [01:00, 04:00) LA
  let ebsPlaced = false;

  // --- Shuffled half-library -----------------------------------------------
  const half = dayIndex % 2;
  const halfLib = library.filter((t) => hashTrackId(t.id) === half);
  if (halfLib.length === 0) {
    // Edge case: all tracks ended up in the other half. Use full library.
    // This can only happen with very small libraries.
    library.forEach((t) => halfLib.push(t));
  }

  // Fisher-Yates shuffle using the day PRNG. PRNG calls #2..N.
  let songQueue = shuffle(halfLib, prng);
  const usedToday = new Set<string>();
  let reshuffleCount = 0;

  function dequeue(): Track {
    while (songQueue.length > 0) {
      const t = songQueue.shift()!;
      if (!usedToday.has(t.id)) return t;
    }
    // Queue empty: reshuffle same half with a derived seed.
    reshuffleCount++;
    const subSeed = (seed ^ (reshuffleCount * 0xdeadbeef)) >>> 0;
    songQueue = shuffle(halfLib, mulberry32(subSeed)).filter(
      (t) => !usedToday.has(t.id)
    );
    if (songQueue.length === 0) {
      // Truly exhausted (tiny library covering < 1 day): reset used set.
      usedToday.clear();
      songQueue = shuffle(halfLib, mulberry32(subSeed));
    }
    return songQueue.shift()!;
  }

  // --- Break cadence -------------------------------------------------------
  let breakCountdown = pickOne(prng, [2, 3]);
  let songsSinceBreak = 0;

  // --- Featured map --------------------------------------------------------
  const featuredMap = new Map(featured.map((f) => [f.song_id, f]));
  const voiceMap = new Map(voicebank.clips.map((c) => [c.id, c]));

  // --- Hourly ID tracking --------------------------------------------------
  let lastHour = stationHourOf(dayStart);
  let pendingId = false;

  // --- Numbers station: first 60 s of the day ------------------------------
  let cursor = dayStart;
  const numbersEnd = cursor + 60_000;
  segments.push({ kind: "numbers", startMs: cursor, endMs: numbersEnd } as NumbersSegment);
  cursor = numbersEnd;

  // --- Main loop -----------------------------------------------------------
  while (cursor < dayEnd) {
    // 1. Hour crossing: set pendingId
    const currentHour = stationHourOf(cursor);
    if (currentHour !== lastHour) {
      lastHour = currentHour;
      pendingId = true;
    }

    // 2. Discharge pendingId with an "id" clip
    if (pendingId) {
      const idClips = voicebank.clips.filter((c) => c.kind === "id");
      if (idClips.length > 0) {
        const clip = pickOne(prng, idClips);
        const clipEnd = cursor + Math.round(clip.seconds * 1000);
        if (clipEnd <= dayEnd) {
          segments.push({
            kind: "voice",
            clipId: clip.id,
            clipKind: "id",
            text: clip.text,
            file: clip.file,
            startMs: cursor,
            endMs: clipEnd,
          } as VoiceSegment);
          cursor = clipEnd;
        }
      }
      pendingId = false;
      if (cursor >= dayEnd) break;
    }

    // 3. EBS: insert as soon as cursor reaches or passes the target time
    if (!ebsPlaced && cursor >= ebsTargetMs) {
      const ebsEnd = cursor + 30_000;
      if (ebsEnd <= dayEnd) {
        segments.push({ kind: "ebs", startMs: cursor, endMs: ebsEnd } as EbsSegment);
        cursor = ebsEnd;
        ebsPlaced = true;
        if (cursor >= dayEnd) break;
        continue; // recheck hour / id after EBS
      } else {
        // EBS doesn't fit before dayEnd; place it earlier or skip
        ebsPlaced = true; // don't try again
      }
    }

    // 4. Song
    const song = dequeue();
    const songStart = cursor;
    const rawSongEnd = songStart + Math.round(song.seconds * 1000);
    const songEnd = Math.min(rawSongEnd, dayEnd);
    const truncated = songEnd < rawSongEnd;

    // 5. Talk-up metadata (does not affect timeline)
    const talkup = assignTalkup(song, featuredMap, voiceMap, voicebank, prng);

    segments.push({
      kind: "song",
      trackId: song.id,
      title: song.title,
      mp3: song.mp3,
      startMs: songStart,
      endMs: songEnd,
      ...(truncated && { truncated: true as const }),
      ...(talkup && { talkup }),
    } as SongSegment);

    usedToday.add(song.id);
    cursor = songEnd;
    songsSinceBreak++;

    if (truncated || cursor >= dayEnd) break;

    // 6. Break
    if (songsSinceBreak >= breakCountdown) {
      const breakClips = voicebank.clips.filter((c) => BREAK_KINDS.has(c.kind));
      if (breakClips.length > 0) {
        const clip = pickOne(prng, breakClips);
        const clipEnd = cursor + Math.round(clip.seconds * 1000);
        if (clipEnd <= dayEnd) {
          segments.push({
            kind: "voice",
            clipId: clip.id,
            clipKind: clip.kind,
            text: clip.text,
            file: clip.file,
            startMs: cursor,
            endMs: clipEnd,
          } as VoiceSegment);
          cursor = clipEnd;
        }
      }
      breakCountdown = pickOne(prng, [2, 3]);
      songsSinceBreak = 0;
      if (cursor >= dayEnd) break;
    }
  }

  // If EBS was never placed (e.g. day ended before target), force it at
  // ebsTargetMs within the numbers window — skip; the station already aired
  // the numbers station at that time, and on-air EBS is best-effort.

  // --- Tiling assertion ---------------------------------------------------
  // Segments must cover [dayStart, dayEnd) contiguously.
  // Repair: if there is any residual gap at the end, extend the last segment.
  if (segments.length > 0) {
    const last = segments[segments.length - 1];
    if (last.endMs < dayEnd) {
      // This happens when the day loop exits with cursor < dayEnd (e.g. no
      // more songs). Extend the last segment.
      (last as { endMs: number }).endMs = dayEnd;
    }
  }

  assertTiling(segments, dayStart, dayEnd);

  return { dayIndex, startMs: dayStart, endMs: dayEnd, segments };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assignTalkup(
  song: Track,
  featuredMap: Map<string, FeaturedEntry>,
  voiceMap: Map<string, import("./types.js").VoiceClip>,
  voicebank: Voicebank,
  prng: () => number
): SongSegment["talkup"] {
  const talkupWindowMs = song.talkup_seconds * 1000;
  if (talkupWindowMs <= 0) return undefined;

  // Featured: use the designated setup clip.
  const featuredEntry = featuredMap.get(song.id);
  if (featuredEntry) {
    const clip = voiceMap.get(featuredEntry.setup_clip_id);
    if (clip) {
      const startOffsetMs = talkupWindowMs - clip.seconds * 1000;
      // Allow negative startOffset only if it's not absurdly long (> 30 s).
      if (startOffsetMs >= -30_000) {
        return {
          clipId: clip.id,
          file: clip.file,
          text: clip.text,
          startOffsetMs,
        };
      }
    }
  }

  // Non-featured: pick any talkup clip that fits.
  const safeMs = talkupWindowMs - 500; // 0.5 s safety margin
  const candidates = voicebank.clips.filter(
    (c) => c.kind === "talkup" && c.seconds * 1000 <= safeMs
  );
  if (candidates.length === 0) return undefined;
  const clip = pickOne(prng, candidates);
  return {
    clipId: clip.id,
    file: clip.file,
    text: clip.text,
    startOffsetMs: talkupWindowMs - clip.seconds * 1000,
  };
}

function assertTiling(segments: Segment[], dayStart: number, dayEnd: number): void {
  if (segments.length === 0) return;
  if (segments[0].startMs !== dayStart) {
    throw new Error(
      `Tiling broken: first segment starts at ${segments[0].startMs}, expected ${dayStart}`
    );
  }
  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i].endMs !== segments[i + 1].startMs) {
      throw new Error(
        `Tiling broken at index ${i}: endMs=${segments[i].endMs} but next startMs=${segments[i + 1].startMs}`
      );
    }
  }
  if (segments[segments.length - 1].endMs !== dayEnd) {
    throw new Error(
      `Tiling broken: last segment ends at ${segments[segments.length - 1].endMs}, expected ${dayEnd}`
    );
  }
}

function shuffle<T>(arr: T[], prng: () => number): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(prng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function pickOne<T>(prng: () => number, arr: T[]): T {
  return arr[Math.floor(prng() * arr.length)];
}
