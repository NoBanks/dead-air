/**
 * Tests for nowPlaying:
 *  P-10: offsetMs identity, next exactly 5, T / T+1000 consistent.
 *  P-11: p95 < 50 ms over 1000 random times in a 10-year window.
 *  Targeted: sample /now JSON for Nov 1 2026 01:30 LA (repeated hour).
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { nowPlaying } from "../src/core/nowPlaying.js";
import { generateDay } from "../src/core/day.js";
import { stationDayIndex, stationHourOf } from "../src/core/tzoffsets.js";
import type { Track, Voicebank } from "../src/core/types.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function makeFakeLibrary(count: number): Track[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `track-${i}`,
    slug: `track-${i}`,
    title: `Track ${i}`,
    seconds: 90 + (i * 7919) % 211,
    talkup_seconds: (i * 1031) % 30,
    lufs: -14,
    made_at: new Date(2025, 0, 1 + (i % 365)).toISOString(),
    mp3: `/audio/track-${i}.mp3`,
  }));
}

const LIB = makeFakeLibrary(1100);

const VB: Voicebank = {
  clips: [
    { id: "id-01",     kind: "id",      text: "Seventeen fourteen A M.",   seconds: 3,  file: "/voice/id-01.mp3" },
    { id: "drop-01",   kind: "drop",    text: "Still breathing?",          seconds: 2,  file: "/voice/drop-01.mp3" },
    { id: "break-01",  kind: "break",   text: "Low of never.",             seconds: 3,  file: "/voice/break-01.mp3" },
    { id: "talkup-01", kind: "talkup",  text: "Coming next.",              seconds: 1.5, file: "/voice/talkup-01.mp3" },
  ],
};

// epoch = 00:00 LA on Oct 31 2026 (PDT, UTC-7 => 07:00 UTC)
const EPOCH = new Date("2026-10-31T07:00:00Z").getTime();

// Nov 1 2026 01:30 LA (first pass, before fall-back at 02:00)
// LA is UTC-7 (PDT) until 02:00 on Nov 1, then UTC-8 (PST).
// 01:30 PDT = 08:30 UTC
const NOV1_0130_LA = new Date("2026-11-01T08:30:00Z").getTime();

// ---------------------------------------------------------------------------
// P-10: offsetMs and next
// ---------------------------------------------------------------------------
describe("P-10: offsetMs and next[]", () => {
  it("offsetMs === at - segment.startMs", () => {
    const at = EPOCH + 12 * 3_600_000; // noon on day 0
    const result = nowPlaying(LIB, VB, [], EPOCH, at);
    expect(result.offsetMs).toBe(at - result.segment.startMs);
    expect(result.offsetMs).toBeGreaterThanOrEqual(0);
    expect(result.offsetMs).toBeLessThan(result.segment.endMs - result.segment.startMs);
  });

  it("next[] has exactly 5 elements when mid-day", () => {
    // At noon there are always at least 5 segments ahead in the same day.
    const at = EPOCH + 12 * 3_600_000;
    const result = nowPlaying(LIB, VB, [], EPOCH, at);
    expect(result.next).toHaveLength(5);
  });

  it("next[] spills into day+1 near end of day", () => {
    // 23:30 on day 0: likely fewer than 5 segments remain today.
    const at = EPOCH + 23 * 3_600_000 + 30 * 60_000;
    const result = nowPlaying(LIB, VB, [], EPOCH, at);
    expect(result.next.length).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// P-10b: T and T+1000 consistency
// ---------------------------------------------------------------------------
describe("P-10b: nowPlaying(T) and nowPlaying(T+1000) agree", () => {
  it("same segment or T+1000 is the immediate next segment", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 7 * 24 * 3_600_000 }),
        (offsetMs) => {
          const at1 = EPOCH + offsetMs;
          const at2 = at1 + 1000;
          const r1 = nowPlaying(LIB, VB, [], EPOCH, at1);
          const r2 = nowPlaying(LIB, VB, [], EPOCH, at2);

          const sameSegment = r1.segment.startMs === r2.segment.startMs;
          const nextSegment =
            r1.next.length > 0 &&
            r1.next[0].startMs === r2.segment.startMs;

          expect(
            sameSegment || nextSegment,
            `T=${at1}: seg=[${r1.segment.startMs},${r1.segment.endMs}), ` +
              `T+1s: seg=[${r2.segment.startMs},${r2.segment.endMs})`
          ).toBe(true);
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ---------------------------------------------------------------------------
// P-11: Performance — p95 < 50 ms over 1000 calls across 10 years
// ---------------------------------------------------------------------------
describe("P-11: Performance", () => {
  it("p95 < 50 ms for 1000 random times in a 10-year window", () => {
    const tenYearsMs = 10 * 365.25 * 86_400_000;
    const times: number[] = [];

    // Warm up JIT.
    for (let i = 0; i < 5; i++) {
      nowPlaying(LIB, VB, [], EPOCH, EPOCH + i * 86_400_000);
    }

    for (let i = 0; i < 1000; i++) {
      // Use a deterministic sequence so the test is repeatable.
      const offset = ((i * 1_000_003) % Math.floor(tenYearsMs));
      const at = EPOCH + offset;
      const t0 = performance.now();
      nowPlaying(LIB, VB, [], EPOCH, at);
      times.push(performance.now() - t0);
    }

    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)];
    const avg = times.reduce((s, x) => s + x, 0) / times.length;

    console.log(`\n  nowPlaying perf: avg=${avg.toFixed(2)} ms  p95=${p95.toFixed(2)} ms`);

    expect(p95, `p95 ${p95.toFixed(1)} ms should be < 50 ms`).toBeLessThan(50);
  });
});

// ---------------------------------------------------------------------------
// Targeted: Nov 1 2026 01:30 LA (the repeated hour on fall-back day)
// ---------------------------------------------------------------------------
describe("Sample /now for Nov 1 2026 01:30 LA", () => {
  it("returns a valid segment and prints the JSON", () => {
    const result = nowPlaying(LIB, VB, [], EPOCH, NOV1_0130_LA);

    const response = {
      server_time: NOV1_0130_LA,
      segment: result.segment,
      offset_ms: result.offsetMs,
      next: result.next,
    };

    console.log("\n  Sample /now (Nov 1 2026 01:30 LA):");
    console.log("  " + JSON.stringify(response, null, 2).replace(/\n/g, "\n  "));

    // Sanity checks.
    expect(result.segment).toBeDefined();
    expect(result.offsetMs).toBeGreaterThanOrEqual(0);
    expect(result.offsetMs).toBeLessThan(
      result.segment.endMs - result.segment.startMs
    );
    // The current time should fall inside the returned segment.
    expect(result.segment.startMs).toBeLessThanOrEqual(NOV1_0130_LA);
    expect(result.segment.endMs).toBeGreaterThan(NOV1_0130_LA);
  });
});
