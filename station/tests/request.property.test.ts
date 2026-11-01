/**
 * request-line spec, properties 1 to 3 (design.md): listener requests are inserted into the
 * deterministic day without changing anything that already aired.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { generateDay } from "../src/core/day.js";
import { stationDayIndex, stationDayStartByIndex } from "../src/core/tzoffsets.js";
import type { Track, Voicebank, Insert, VoiceSegment, SongSegment } from "../src/core/types.js";

const EPOCH_MS = new Date("2026-10-31T07:00:00Z").getTime();

const LIB: Track[] = Array.from({ length: 1100 }, (_, i) => ({
  id: `track-${i}`,
  slug: `track-${i}`,
  title: `Track ${i}`,
  seconds: 90 + ((i * 7919) % 211),
  talkup_seconds: 12,
  lufs: -14,
  made_at: new Date(2025, 0, 1 + (i % 365)).toISOString(),
  mp3: `/audio/track-${i}.mp3`,
}));

const VB: Voicebank = {
  clips: [
    { id: "id-01", kind: "id", text: "Seventeen fourteen.", seconds: 3, file: "/voice/id-01.mp3" },
    { id: "id-02", kind: "id", text: "DEAD AIR.", seconds: 4, file: "/voice/id-02.mp3" },
    { id: "drop-01", kind: "drop", text: "Still breathing?", seconds: 2.5, file: "/voice/d1.mp3" },
    { id: "drop-02", kind: "drop", text: "Fog.", seconds: 2, file: "/voice/d2.mp3" },
    { id: "break-01", kind: "break", text: "Low of never.", seconds: 3, file: "/voice/b1.mp3" },
    { id: "sponsor-01", kind: "sponsor", text: "Prescott's.", seconds: 4, file: "/voice/s1.mp3" },
    { id: "talkup-01", kind: "talkup", text: "Coming next.", seconds: 1.5, file: "/voice/t1.mp3" },
  ],
};

const request = (airAt: number, n: number, songId?: string): Insert => ({
  airAt,
  clip: { id: `req-${n}`, kind: "request", text: `Request ${n}`, seconds: 12, file: `/requests/req-${n}.mp3` },
  songId,
});

describe("request-line: inserts", () => {
  it("P-R1: an insert never changes any segment that starts before its airAt", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 300 }), fc.double({ min: 0.02, max: 0.97, noNaN: true }), (d, frac) => {
        const base = generateDay(d, LIB, VB, [], EPOCH_MS);
        const airAt = Math.round(base.startMs + (base.endMs - base.startMs) * frac);
        const withReq = generateDay(d, LIB, { ...VB, inserts: [request(airAt, 1, "track-7")] }, [], EPOCH_MS);
        const before = (segs: typeof base.segments) => segs.filter((s) => s.startMs < airAt);
        expect(before(withReq.segments)).toEqual(before(base.segments));
      }),
      { numRuns: 40 }
    );
  });

  it("P-R2/R3: the request airs at the first break at or after airAt and its song plays next; tiling holds", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 300 }), fc.double({ min: 0.05, max: 0.9, noNaN: true }), (d, frac) => {
        const base = generateDay(d, LIB, VB, [], EPOCH_MS);
        const airAt = Math.round(base.startMs + (base.endMs - base.startMs) * frac);
        const aired = new Set(base.segments.filter((s) => s.kind === "song").map((s) => (s as SongSegment).trackId));
        const want = LIB.find((t) => !aired.has(t.id))!.id; // a song that has not aired today
        const day = generateDay(d, LIB, { ...VB, inserts: [request(airAt, 2, want)] }, [], EPOCH_MS);

        for (let i = 0; i < day.segments.length - 1; i++) expect(day.segments[i].endMs).toBe(day.segments[i + 1].startMs);

        const idx = day.segments.findIndex((s) => s.kind === "voice" && (s as VoiceSegment).clipId === "req-2");
        expect(idx).toBeGreaterThan(0);
        expect(day.segments[idx].startMs).toBeGreaterThanOrEqual(airAt);
        // No break boundary between airAt and the read was skipped.
        const skipped = day.segments.slice(0, idx).filter(
          (s) => s.kind === "voice" && s.startMs >= airAt && (s as VoiceSegment).clipKind !== "id"
        );
        expect(skipped).toEqual([]);
        const next = day.segments.slice(idx + 1).find((s) => s.kind === "song") as SongSegment;
        expect(next.trackId).toBe(want);
      }),
      { numRuns: 40 }
    );
  });

  it("two requests both air, in order, one per break", () => {
    const d = stationDayIndex(EPOCH_MS + 3 * 86_400_000, EPOCH_MS);
    const start = stationDayStartByIndex(d, EPOCH_MS);
    const day = generateDay(d, LIB, { ...VB, inserts: [request(start + 14 * 3_600_000, 4), request(start + 10 * 3_600_000, 3)] }, [], EPOCH_MS);
    const reads = day.segments.filter((s) => s.kind === "voice" && (s as VoiceSegment).clipKind === "request") as VoiceSegment[];
    expect(reads.map((r) => r.clipId)).toEqual(["req-3", "req-4"]);
  });
});
