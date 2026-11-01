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
  VoiceClip,
} from "./types.js";
import { mulberry32, daySeed, hashTrackId } from "./prng.js";
import {
  stationDayStartByIndex,
  stationDayEnd,
  stationHourOf,
} from "./tzoffsets.js";

// Kinds that count as a "break" body clip.
const BREAK_KINDS = new Set(["drop", "break", "storm", "marty", "sponsor", "caller"]);

// Length of the :14-past short numbers reading (numbers_short.mp3).
export const SHORT_NUMBERS_MS = 10_000;

// A clip may not air again until this long after it last aired.
// Talk-ups are the most noticeable repeat, so they rest the longest per clip
// and never land on back-to-back songs.
export const CLIP_COOLDOWN_MS = {
  id: 3 * 3_600_000,
  break: 90 * 60_000,
  talkup: 60 * 60_000,
} as const;

/**
 * Remembers when each clip last aired so the day never repeats a line too soon.
 * Picks randomly (day PRNG) among clips that are off cooldown.
 */
function makeRotation(prng: () => number) {
  const lastAired = new Map<string, number>();
  let lastClipId: string | null = null;

  function rested(clips: VoiceClip[], now: number, cooldownMs: number): VoiceClip[] {
    return clips.filter((c) => {
      const t = lastAired.get(c.id);
      return t === undefined || now - t >= cooldownMs;
    });
  }

  return {
    /** A rested clip, or undefined when every candidate aired too recently. */
    pick(clips: VoiceClip[], now: number, cooldownMs: number): VoiceClip | undefined {
      const ok = rested(clips, now, cooldownMs);
      return ok.length > 0 ? pickOne(prng, ok) : undefined;
    },
    /** Like pick, but when nothing is rested take the longest-rested clip that was not the last one aired. */
    pickOrOldest(clips: VoiceClip[], now: number, cooldownMs: number): VoiceClip | undefined {
      const ok = rested(clips, now, cooldownMs);
      if (ok.length > 0) return pickOne(prng, ok);
      const others = clips.filter((c) => c.id !== lastClipId);
      const pool = others.length > 0 ? others : clips;
      return [...pool].sort((a, b) => (lastAired.get(a.id) ?? 0) - (lastAired.get(b.id) ?? 0))[0];
    },
    lastId(): string | null {
      return lastClipId;
    },
    aired(clipId: string, at: number): void {
      lastAired.set(clipId, at);
      lastClipId = clipId;
    },
  };
}

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

  // A listener's requested song jumps the queue once (if it has not aired today).
  let requestedSong: Track | null = null;

  function dequeue(): Track {
    if (requestedSong) {
      const t = requestedSong;
      requestedSong = null;
      if (!usedToday.has(t.id)) return t;
    }
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

  // --- Clip rotation (no line repeats too soon) ----------------------------
  const rotation = makeRotation(prng);
  const idClips = voicebank.clips.filter((c) => c.kind === "id");
  const breakClips = voicebank.clips.filter((c) => BREAK_KINDS.has(c.kind) && c.air !== "0314");
  const isNight = (ms: number) => {
    const h = stationHourOf(ms);
    return h >= 19 || h < 6;
  };
  const breakPool = (ms: number) => breakClips.filter((c) => c.air !== "night" || isNight(ms));
  // Dead John just spoke (break or talk-up): let the next song start clean.
  let djJustSpoke = false;

  // --- Time-pinned lines ---------------------------------------------------
  // 3:14 AM LA: first song boundary inside 03:14 to 03:34.
  const clip314 = voicebank.clips.find((c) => c.air === "0314");
  let hour3Start = dayStart;
  while (stationHourOf(hour3Start) !== 3 && hour3Start < dayStart + 6 * 3_600_000) hour3Start += 3_600_000;
  const t314 = hour3Start + 14 * 60_000;
  let placed314 = !clip314;
  let shortNumbersHour = -1;
  let breakCount = 0;
  // Requests due today, in air order; consumed one per break.
  const inserts = (voicebank.inserts ?? [])
    .filter((i) => i.airAt < dayEnd && i.airAt >= dayStart)
    .sort((a, b) => a.airAt - b.airAt);
  let nextInsert = 0;
  // Midnight: Dead John hands the mic to the numbers station and comes back after it.
  const handoff = voiceMap.get("midnight_handoff");
  const comeback = voiceMap.get("midnight_return");
  const airEnd = dayEnd - (handoff ? Math.round(handoff.seconds * 1000) : 0);

  // --- Hourly ID tracking --------------------------------------------------
  let lastHour = stationHourOf(dayStart);
  let pendingId = false;

  // --- Numbers station: first 60 s of the day ------------------------------
  let cursor = dayStart;
  const numbersEnd = cursor + 60_000;
  segments.push({ kind: "numbers", startMs: cursor, endMs: numbersEnd } as NumbersSegment);
  cursor = numbersEnd;
  if (comeback) {
    const end = cursor + Math.round(comeback.seconds * 1000);
    segments.push({
      kind: "voice",
      clipId: comeback.id,
      clipKind: comeback.kind,
      text: comeback.text,
      file: comeback.file,
      startMs: cursor,
      endMs: end,
    } as VoiceSegment);
    cursor = end;
    djJustSpoke = true;
  }

  // --- Main loop -----------------------------------------------------------
  // Everything before airEnd; the midnight handoff (if any) fills [airEnd, dayEnd).
  while (cursor < airEnd) {
    // 1. Hour crossing: set pendingId
    const currentHour = stationHourOf(cursor);
    if (currentHour !== lastHour) {
      lastHour = currentHour;
      pendingId = true;
    }

    // 2. Discharge pendingId with an "id" clip
    // (A requested song goes straight after its read; the ID waits until after the song.)
    if (pendingId && !requestedSong) {
      const clip = rotation.pickOrOldest(idClips, cursor, CLIP_COOLDOWN_MS.id);
      if (clip) {
        const clipEnd = cursor + Math.round(clip.seconds * 1000);
        if (clipEnd <= airEnd) {
          rotation.aired(clip.id, cursor);
          djJustSpoke = true;
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
      if (cursor >= airEnd) break;
    }

    // 2b. 3:14 AM line, once, at the first boundary in its 20-minute window
    if (!placed314 && cursor >= t314) {
      placed314 = true;
      const clipEnd = cursor + Math.round(clip314!.seconds * 1000);
      if (cursor < t314 + 20 * 60_000 && clipEnd <= airEnd) {
        segments.push({
          kind: "voice",
          clipId: clip314!.id,
          clipKind: clip314!.kind,
          text: clip314!.text,
          file: clip314!.file,
          startMs: cursor,
          endMs: clipEnd,
        } as VoiceSegment);
        rotation.aired(clip314!.id, cursor);
        cursor = clipEnd;
        djJustSpoke = true;
        if (cursor >= airEnd) break;
      }
    }

    // 2c. Short numbers reading at :14 past each hour (not 3 AM, which belongs to John's 3:14 line).
    // LA offsets are whole hours, so the UTC minute is the LA minute.
    const minute = new Date(cursor).getUTCMinutes();
    if (currentHour !== shortNumbersHour && currentHour !== 3 && minute >= 14 && minute < 34) {
      shortNumbersHour = currentHour;
      const end = cursor + SHORT_NUMBERS_MS;
      if (end <= airEnd) {
        segments.push({ kind: "numbers", short: true, startMs: cursor, endMs: end } as NumbersSegment);
        cursor = end;
        if (cursor >= airEnd) break;
      }
    }

    // 3. EBS: insert as soon as cursor reaches or passes the target time
    if (!ebsPlaced && cursor >= ebsTargetMs) {
      const ebsEnd = cursor + 30_000;
      if (ebsEnd <= airEnd) {
        segments.push({ kind: "ebs", startMs: cursor, endMs: ebsEnd } as EbsSegment);
        cursor = ebsEnd;
        ebsPlaced = true;
        if (cursor >= airEnd) break;
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
    const songEnd = Math.min(rawSongEnd, airEnd);
    const truncated = songEnd < rawSongEnd;

    // 5. Talk-up metadata (does not affect timeline)
    const talkup = assignTalkup(song, songStart, featuredMap, voiceMap, voicebank, rotation, djJustSpoke);
    if (talkup) rotation.aired(talkup.clipId, songStart);
    djJustSpoke = !!talkup;

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

    if (truncated || cursor >= airEnd) break;

    // 6. Break
    if (songsSinceBreak >= breakCountdown) {
      // Every third break is a sponsor read, like real radio (and the Hunt's Town page needs them heard).
      breakCount++;
      const sponsors = breakPool(cursor).filter((c) => c.kind === "sponsor" && c.id !== rotation.lastId());
      const pool = breakCount % 3 === 0 && sponsors.length > 0 ? sponsors : breakPool(cursor);
      // A listener request that is due takes this break, and its song plays next.
      // Checked before any PRNG use so nothing before airAt can change.
      const due = nextInsert < inserts.length && inserts[nextInsert].airAt <= cursor ? inserts[nextInsert++] : null;
      if (due?.songId) requestedSong = library.find((t) => t.id === due.songId) ?? null;
      const clip = due ? due.clip : rotation.pickOrOldest(pool, cursor, CLIP_COOLDOWN_MS.break);
      if (clip) {
        const clipEnd = cursor + Math.round(clip.seconds * 1000);
        if (clipEnd <= airEnd) {
          rotation.aired(clip.id, cursor);
          djJustSpoke = true;
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
      if (cursor >= airEnd) break;
    }
  }

  // --- Midnight handoff: Dead John steps away right before the numbers station.
  if (handoff && cursor < dayEnd) {
    segments.push({
      kind: "voice",
      clipId: handoff.id,
      clipKind: handoff.kind,
      text: handoff.text,
      file: handoff.file,
      startMs: cursor,
      endMs: dayEnd,
    } as VoiceSegment);
    cursor = dayEnd;
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
  songStart: number,
  featuredMap: Map<string, FeaturedEntry>,
  voiceMap: Map<string, VoiceClip>,
  voicebank: Voicebank,
  rotation: ReturnType<typeof makeRotation>,
  djJustSpoke: boolean
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

  // Non-featured: only when Dead John did not just speak, and only a rested clip that fits.
  if (djJustSpoke) return undefined;
  const safeMs = talkupWindowMs - 500; // 0.5 s safety margin
  const candidates = voicebank.clips.filter(
    (c) => c.kind === "talkup" && c.seconds * 1000 <= safeMs
  );
  const clip = rotation.pick(candidates, songStart, CLIP_COOLDOWN_MS.talkup);
  if (!clip) return undefined;
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
