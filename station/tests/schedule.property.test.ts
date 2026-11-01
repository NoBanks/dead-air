/**
 * Property-based tests for the broadcast clock.
 * Uses a generated library of 1,100 fake songs (durations 90–300 s,
 * talkup 0–30 s) matching the real-library size target.
 * Also loads data/library.json when it has more than 100 songs.
 */
import { describe, it, expect, beforeAll } from "vitest";
import * as fc from "fast-check";
import { generateDay, CLIP_COOLDOWN_MS, SHORT_NUMBERS_MS } from "../src/core/day.js";
import type { Track, Voicebank, SongSegment, VoiceSegment } from "../src/core/types.js";
import {
  stationDayStart,
  stationDayEnd,
  stationDayIndex,
  stationHourOf,
  stationDayStartByIndex,
} from "../src/core/tzoffsets.js";
import { readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeFakeLibrary(count: number): Track[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `track-${i}`,
    slug: `track-${i}`,
    title: `Track ${i}`,
    // Durations 90–300 s, varied enough to mix short and long tracks.
    seconds: 90 + (i * 7919) % 211, // prime step for good spread
    talkup_seconds: (i * 1031) % 30, // 0–29 s
    lufs: -14,
    made_at: new Date(2025, 0, 1 + (i % 365)).toISOString(),
    mp3: `/audio/track-${i}.mp3`,
  }));
}

const LIBRARY_1100 = makeFakeLibrary(1100);

// Load real library if available and large enough.
let realLibrary: Track[] = [];
try {
  const __dir = fileURLToPath(new URL("..", import.meta.url));
  const raw = readFileSync(resolve(__dir, "data", "library.json"), "utf-8");
  const parsed: Track[] = JSON.parse(raw);
  if (parsed.length > 100) realLibrary = parsed;
} catch {
  // Not available — fine.
}

const TEST_LIBRARY = realLibrary.length > 100 ? realLibrary : LIBRARY_1100;

const VOICEBANK: Voicebank = {
  clips: [
    { id: "id-01",      kind: "id",      text: "Seventeen fourteen A M.",   seconds: 3,   file: "/voice/id-01.mp3" },
    { id: "id-02",      kind: "id",      text: "You're listening to DEAD AIR.", seconds: 4, file: "/voice/id-02.mp3" },
    { id: "drop-01",    kind: "drop",    text: "Still breathing out there?", seconds: 2.5, file: "/voice/drop-01.mp3" },
    { id: "drop-02",    kind: "drop",    text: "Fog rolling in off nothing.", seconds: 2,   file: "/voice/drop-02.mp3" },
    { id: "talkup-01",  kind: "talkup",  text: "Coming next.",              seconds: 1.5,  file: "/voice/talkup-01.mp3" },
    { id: "talkup-02",  kind: "talkup",  text: "Stay close.",               seconds: 1.8,  file: "/voice/talkup-02.mp3" },
    { id: "break-01",   kind: "break",   text: "Low of never.",             seconds: 3,    file: "/voice/break-01.mp3" },
    { id: "marty-01",   kind: "marty",   text: "Marty's not there.",        seconds: 3.5,  file: "/voice/marty-01.mp3" },
    { id: "sponsor-01", kind: "sponsor", text: "Prescott's Pharmacy.",      seconds: 4,    file: "/voice/sponsor-01.mp3" },
  ],
};

// Epoch = station midnight Oct 31 2026 LA time.
const EPOCH_MS = new Date("2026-10-31T07:00:00Z").getTime(); // 07:00 UTC = 00:00 LA (PDT ended Nov 1 so Oct 31 is still PDT = UTC-7)

// Key DST dates for targeted tests.
const NOV1_2026_MIDNIGHT_LA = new Date("2026-11-01T07:00:00Z").getTime(); // 00:00 LA on fall-back day (25 h)
const MAR14_2027_MIDNIGHT_LA = new Date("2027-03-14T08:00:00Z").getTime(); // 00:00 LA on spring-forward day (23 h)

// ---------------------------------------------------------------------------
// Helper: check strict tiling
// ---------------------------------------------------------------------------
function assertTiling(segments: ReturnType<typeof generateDay>["segments"], label: string) {
  expect(segments.length, `${label}: no segments`).toBeGreaterThan(0);
  for (let i = 0; i < segments.length - 1; i++) {
    expect(segments[i].endMs, `${label}: gap/overlap at index ${i}`).toBe(
      segments[i + 1].startMs
    );
  }
}

// ---------------------------------------------------------------------------
// P-1: Strict tiling — every day including DST days
// ---------------------------------------------------------------------------
describe("P-1: Strict tiling", () => {
  it("tiles correctly on a normal day", () => {
    const d = stationDayIndex(EPOCH_MS, EPOCH_MS);
    const day = generateDay(d, TEST_LIBRARY, VOICEBANK, [], EPOCH_MS);
    const dayStart = stationDayStartByIndex(d, EPOCH_MS);
    const dayEnd = stationDayEnd(dayStart + 3_600_000);

    expect(day.segments[0].startMs).toBe(dayStart);
    expect(day.segments[day.segments.length - 1].endMs).toBe(dayEnd);
    assertTiling(day.segments, "normal day");
  });

  it("tiles correctly on 2026-11-01 (25 h fall-back day)", () => {
    const d = stationDayIndex(NOV1_2026_MIDNIGHT_LA, EPOCH_MS);
    const day = generateDay(d, TEST_LIBRARY, VOICEBANK, [], EPOCH_MS);
    const dayStart = stationDayStartByIndex(d, EPOCH_MS);
    const dayEnd = stationDayEnd(dayStart + 3_600_000);

    const dayLengthHours = (dayEnd - dayStart) / 3_600_000;
    expect(dayLengthHours, "fall-back day should be 25 h").toBe(25);

    expect(day.segments[0].startMs).toBe(dayStart);
    expect(day.segments[day.segments.length - 1].endMs).toBe(dayEnd);
    assertTiling(day.segments, "2026-11-01");
  });

  it("tiles correctly on 2027-03-14 (23 h spring-forward day)", () => {
    const d = stationDayIndex(MAR14_2027_MIDNIGHT_LA, EPOCH_MS);
    const day = generateDay(d, TEST_LIBRARY, VOICEBANK, [], EPOCH_MS);
    const dayStart = stationDayStartByIndex(d, EPOCH_MS);
    const dayEnd = stationDayEnd(dayStart + 3_600_000);

    const dayLengthHours = (dayEnd - dayStart) / 3_600_000;
    expect(dayLengthHours, "spring-forward day should be 23 h").toBe(23);

    expect(day.segments[0].startMs).toBe(dayStart);
    expect(day.segments[day.segments.length - 1].endMs).toBe(dayEnd);
    assertTiling(day.segments, "2027-03-14");
  });

  it("tiles for random days in a 10-year window (fast-check)", () => {
    const tenYearsMs = 10 * 365.25 * 86_400_000;
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: Math.floor(tenYearsMs / 86_400_000) }),
        (dayIndex) => {
          const day = generateDay(dayIndex, LIBRARY_1100, VOICEBANK, [], EPOCH_MS);
          assertTiling(day.segments, `day ${dayIndex}`);
          expect(day.segments[0].startMs).toBe(day.startMs);
          expect(day.segments[day.segments.length - 1].endMs).toBe(day.endMs);
        }
      ),
      { numRuns: 30 }
    );
  });
});

// ---------------------------------------------------------------------------
// P-2: Determinism
// ---------------------------------------------------------------------------
describe("P-2: Determinism", () => {
  it("two calls with same dayIndex produce identical output", () => {
    const d = stationDayIndex(EPOCH_MS, EPOCH_MS);
    const a = generateDay(d, TEST_LIBRARY, VOICEBANK, [], EPOCH_MS);
    const b = generateDay(d, TEST_LIBRARY, VOICEBANK, [], EPOCH_MS);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ---------------------------------------------------------------------------
// P-3: No song repeats within 24 h (alternating halves)
// ---------------------------------------------------------------------------
describe("P-3: No song repeats within any 24 h window", () => {
  it("no duplicates within a single day", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10 }), (dayIndex) => {
        const day = generateDay(dayIndex, LIBRARY_1100, VOICEBANK, [], EPOCH_MS);
        const songIds = day.segments
          .filter((s) => s.kind === "song")
          .map((s) => (s as SongSegment).trackId);
        const unique = new Set(songIds);
        expect(unique.size).toBe(songIds.length);
      }),
      { numRuns: 10 }
    );
  });

  it("no song appears in both day D and day D+1 (disjoint halves)", () => {
    for (let d = 0; d < 6; d++) {
      const dayA = generateDay(d, LIBRARY_1100, VOICEBANK, [], EPOCH_MS);
      const dayB = generateDay(d + 1, LIBRARY_1100, VOICEBANK, [], EPOCH_MS);
      const idsA = new Set(
        dayA.segments.filter((s) => s.kind === "song").map((s) => (s as SongSegment).trackId)
      );
      const idsB = dayB.segments
        .filter((s) => s.kind === "song")
        .map((s) => (s as SongSegment).trackId);
      for (const id of idsB) {
        expect(idsA.has(id), `${id} appears on both day ${d} and ${d + 1}`).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// P-5: Station ID within one segment after each top-of-hour
// ---------------------------------------------------------------------------
describe("P-5: Station IDs at top of hour", () => {
  it("every LA hour gets an id clip within the next segment", () => {
    // Check 3 consecutive days including the fall-back day.
    for (const dayStart of [EPOCH_MS, NOV1_2026_MIDNIGHT_LA]) {
      const d = stationDayIndex(dayStart, EPOCH_MS);
      const day = generateDay(d, TEST_LIBRARY, VOICEBANK, [], EPOCH_MS);

      // Find all hour boundaries within this day.
      let lastHour = stationHourOf(day.startMs);
      const missedHours: number[] = [];

      for (let i = 0; i < day.segments.length; i++) {
        const seg = day.segments[i];
        const segHour = stationHourOf(seg.startMs);
        if (segHour !== lastHour) {
          // Hour crossed at or before this segment. The id clip should be
          // within this segment or the very next one.
          const window = day.segments.slice(i, i + 2);
          const hasId = window.some(
            (s) => s.kind === "voice" && (s as VoiceSegment).clipKind === "id"
          );
          if (!hasId) missedHours.push(segHour);
          lastHour = segHour;
        }
      }

      expect(
        missedHours,
        `Day ${d} missing IDs for hours: ${missedHours.join(", ")}`
      ).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// P-6: Talk-up end == song.startMs + talkup_seconds * 1000
// ---------------------------------------------------------------------------
describe("P-6: Talk-up never past the post", () => {
  it("talkup.endMs === song.startMs + talkup_seconds exactly", () => {
    const libWithTalkup = makeFakeLibrary(200).map((t) => ({
      ...t,
      talkup_seconds: 15, // ensure a window exists
    }));

    const d = stationDayIndex(EPOCH_MS, EPOCH_MS);
    const day = generateDay(d, libWithTalkup, VOICEBANK, [], EPOCH_MS);

    for (const seg of day.segments) {
      if (seg.kind !== "song") continue;
      const song = seg as SongSegment;
      if (!song.talkup) continue;

      const track = libWithTalkup.find((t) => t.id === song.trackId)!;
      const expectedEndMs = song.startMs + track.talkup_seconds * 1000;
      const actualEndMs = song.startMs + song.talkup.startOffsetMs +
        VOICEBANK.clips.find((c) => c.id === song.talkup!.clipId)!.seconds * 1000;

      expect(
        Math.abs(actualEndMs - expectedEndMs),
        `talkup for ${song.trackId} ends at wrong time`
      ).toBeLessThanOrEqual(1); // allow 1 ms rounding
    }
  });
});

// ---------------------------------------------------------------------------
// P-10: No voice line repeats too soon (Ryan heard "Don't touch that dial" twice in a row)
// ---------------------------------------------------------------------------
describe("P-10: Clip rotation", () => {
  const libWithTalkup = makeFakeLibrary(1100).map((t) => ({ ...t, talkup_seconds: 15 }));

  function airings(dayIndex: number) {
    const day = generateDay(dayIndex, libWithTalkup, VOICEBANK, [], EPOCH_MS);
    const out: { id: string; kind: string; at: number; songIdx: number }[] = [];
    let songIdx = 0;
    for (const seg of day.segments) {
      if (seg.kind === "voice") {
        const v = seg as VoiceSegment;
        out.push({ id: v.clipId, kind: v.clipKind, at: v.startMs, songIdx });
      } else if (seg.kind === "song") {
        songIdx++;
        const s = seg as SongSegment;
        if (s.talkup) out.push({ id: s.talkup.clipId, kind: "talkup", at: s.startMs, songIdx });
      }
    }
    return out;
  }

  it("a talk-up clip never airs again within its cooldown, and never on back-to-back songs", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 400 }), (d) => {
        const talkups = airings(d).filter((a) => a.kind === "talkup");
        for (let i = 1; i < talkups.length; i++) {
          expect(talkups[i].songIdx - talkups[i - 1].songIdx).toBeGreaterThan(1);
          for (let j = 0; j < i; j++) {
            if (talkups[j].id === talkups[i].id) {
              expect(talkups[i].at - talkups[j].at).toBeGreaterThanOrEqual(CLIP_COOLDOWN_MS.talkup);
            }
          }
        }
      }),
      { numRuns: 30 }
    );
  });

  it("the same voice clip never airs twice in a row", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 400 }), (d) => {
        const all = airings(d);
        for (let i = 1; i < all.length; i++) {
          expect(all[i].id, `clip ${all[i].id} aired back to back`).not.toBe(all[i - 1].id);
        }
      }),
      { numRuns: 30 }
    );
  });
});

// ---------------------------------------------------------------------------
// P-11: Time-pinned lines air only when they make sense
// ---------------------------------------------------------------------------
describe("P-11: Time-pinned lines", () => {
  const TIMED: Voicebank = {
    clips: [
      ...VOICEBANK.clips,
      { id: "time_314", kind: "break", text: "It's fourteen past three.", seconds: 3, file: "/voice/time_314.mp3", air: "0314" },
      { id: "weather_night", kind: "break", text: "Weather for the overnight.", seconds: 3, file: "/voice/w.mp3", air: "night" },
      { id: "midnight_handoff", kind: "midnight", text: "It's midnight.", seconds: 8, file: "/voice/mh.mp3" },
      { id: "midnight_return", kind: "midnight", text: "I'm back.", seconds: 4, file: "/voice/mr.mp3" },
    ],
  };
  const la = (ms: number) => {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(ms);
    return { h: +p.find((x) => x.type === "hour")!.value, m: +p.find((x) => x.type === "minute")!.value };
  };

  it("3:14 line airs once, between 3:14 and 3:34 AM LA; night lines only 7 PM to 6 AM; midnight lines bracket the numbers station", () => {
    for (const utcMs of [EPOCH_MS, NOV1_2026_MIDNIGHT_LA, MAR14_2027_MIDNIGHT_LA, EPOCH_MS + 40 * 86_400_000]) {
      const d = stationDayIndex(utcMs, EPOCH_MS);
      const day = generateDay(d, LIBRARY_1100, TIMED, [], EPOCH_MS);
      const voices = day.segments.filter((s) => s.kind === "voice") as VoiceSegment[];

      const at314 = voices.filter((v) => v.clipId === "time_314");
      expect(at314.length).toBe(1);
      const t = la(at314[0].startMs);
      expect(t.h).toBe(3);
      expect(t.m).toBeGreaterThanOrEqual(14);
      expect(t.m).toBeLessThan(34);

      for (const v of voices.filter((v) => v.clipId === "weather_night")) {
        const h = la(v.startMs).h;
        expect(h >= 19 || h < 6, `night line at hour ${h}`).toBe(true);
      }

      // Short numbers: once per LA hour, between :14 and :34, never in the 3 AM hour.
      const shorts = day.segments.filter((s) => s.kind === "numbers" && (s as { short?: boolean }).short);
      const hours = shorts.map((s) => la(s.startMs).h);
      expect(new Set(hours).size).toBe(hours.length);
      expect(hours).not.toContain(3);
      expect(shorts.length).toBeGreaterThanOrEqual(20);
      for (const s of shorts) {
        const t = la(s.startMs);
        expect(t.m >= 14 && t.m < 34, `short numbers at ${t.h}:${t.m}`).toBe(true);
        expect(s.endMs - s.startMs).toBe(SHORT_NUMBERS_MS);
      }

      expect(day.segments[1]).toMatchObject({ kind: "voice", clipId: "midnight_return", startMs: day.startMs + 60_000 });
      expect(day.segments[day.segments.length - 1]).toMatchObject({ kind: "voice", clipId: "midnight_handoff", endMs: day.endMs });
    }
  });
});

// ---------------------------------------------------------------------------
// P-8: Numbers segment starts exactly at LA midnight
// ---------------------------------------------------------------------------
describe("P-8: Numbers segment at LA midnight", () => {
  it("numbers segment starts at dayStart and lasts 60 s", () => {
    for (const utcMs of [EPOCH_MS, NOV1_2026_MIDNIGHT_LA, MAR14_2027_MIDNIGHT_LA]) {
      const d = stationDayIndex(utcMs, EPOCH_MS);
      const day = generateDay(d, TEST_LIBRARY, VOICEBANK, [], EPOCH_MS);

      const numbers = day.segments[0];
      expect(numbers.kind, "first segment is numbers").toBe("numbers");
      expect(numbers.startMs, "numbers starts at dayStart").toBe(day.startMs);
      expect(numbers.endMs - numbers.startMs, "numbers lasts 60 s").toBe(60_000);

      // day.startMs must be LA midnight (hour === 0)
      expect(stationHourOf(day.startMs), "dayStart is LA midnight").toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// P-9: EBS once per day, between 01:00 and 04:00 LA
// ---------------------------------------------------------------------------
describe("P-9: EBS in 01:00–04:00 LA, exactly once", () => {
  it("EBS exists and falls in the correct LA hour window", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 20 }), (dayIndex) => {
        const day = generateDay(dayIndex, LIBRARY_1100, VOICEBANK, [], EPOCH_MS);
        const ebsSegs = day.segments.filter((s) => s.kind === "ebs");

        expect(ebsSegs.length, `day ${dayIndex}: exactly one EBS`).toBe(1);
        const ebs = ebsSegs[0];
        expect(ebs.endMs - ebs.startMs, "EBS duration 30 s").toBe(30_000);

        const ebsHour = stationHourOf(ebs.startMs);
        expect(ebsHour, `EBS hour ${ebsHour} should be 1, 2, or 3`).toBeGreaterThanOrEqual(1);
        expect(ebsHour, `EBS hour ${ebsHour} should be < 4`).toBeLessThan(4);
      }),
      { numRuns: 20 }
    );
  });
});

// ---------------------------------------------------------------------------
// P-3b / cross-day: no song appears in the last 24 h window at day boundary
// ---------------------------------------------------------------------------
describe("P-3b: No repeat across day boundary (alternating halves)", () => {
  it("day D songs are disjoint from day D+1 songs for all tested days", () => {
    for (let d = 0; d < 4; d++) {
      const a = generateDay(d, LIBRARY_1100, VOICEBANK, [], EPOCH_MS);
      const b = generateDay(d + 1, LIBRARY_1100, VOICEBANK, [], EPOCH_MS);
      const setA = new Set(a.segments.filter((s) => s.kind === "song").map((s) => (s as SongSegment).trackId));
      const setB = b.segments.filter((s) => s.kind === "song").map((s) => (s as SongSegment).trackId);
      for (const id of setB) {
        expect(setA.has(id), `${id} on both day ${d} and ${d + 1}`).toBe(false);
      }
    }
  });
});
