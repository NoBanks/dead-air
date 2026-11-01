/**
 * Property and unit tests for station/src/core/hunt.ts
 *
 * Groups:
 *  P-H1  Miss outside lock range
 *  P-H2  Offset bounds and remainingMs correctness
 *  P-H3  Determinism
 *  P-H4  Loop continuity
 *  P-H5  Last-minute window exactness on specific dates
 *  P-H6  Handler: 204 body empty; 200 body has exactly the documented keys
 *  U-H7  Numbers station decode
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  signalAt,
  decodeNumbers,
  NUMBERS_TEXT,
} from "../src/core/hunt.js";
import type { HuntConfig } from "../src/core/hunt.js";
import { handleRequest } from "../src/core/handler.js";

// ---------------------------------------------------------------------------
// Minimal hunt config for property tests
// ---------------------------------------------------------------------------

const EPOCH = new Date("2026-10-31T00:00:00Z").getTime();

const HUNT: HuntConfig = {
  lock_khz: 6,
  stations: [
    {
      freq: 1410,
      page: "old-station",
      mode: "hourly",
      clips: [
        { id: "storm_frag_1", file: "/voice/storm_frag_1.mp3", seconds: 18.2 },
        { id: "storm_frag_2", file: "/voice/storm_frag_2.mp3", seconds: 20 },
        { id: "storm_frag_3", file: "/voice/storm_frag_3.mp3", seconds: 20 },
        { id: "storm_frag_4", file: "/voice/storm_frag_4.mp3", seconds: 20 },
        { id: "storm_frag_5", file: "/voice/storm_frag_5.mp3", seconds: 20 },
        { id: "storm_frag_6", file: "/voice/storm_frag_6.mp3", seconds: 20 },
        { id: "storm_frag_7", file: "/voice/storm_frag_7.mp3", seconds: 20 },
        { id: "storm_frag_8", file: "/voice/storm_frag_8.mp3", seconds: 20 },
      ],
    },
    {
      freq: 870,
      page: "marty",
      mode: "loop",
      clips: [{ id: "marty_radio_1", file: "/voice/marty_radio_1.mp3", seconds: 20 }],
    },
    {
      freq: 1031,
      page: "bulletin",
      mode: "loop",
      clips: [{ id: "bulletin_1", file: "/voice/bulletin_1.mp3", seconds: 20 }],
    },
    {
      freq: 540,
      page: "hold",
      mode: "loop",
      clips: [{ id: "hold_1", file: "/voice/hold_1.mp3", seconds: 20 }],
    },
    {
      freq: 710,
      page: "rink",
      mode: "loop",
      clips: [{ id: "rink_1", file: "/voice/rink_1.mp3", seconds: 20 }],
    },
    {
      freq: 666,
      page: "between",
      mode: "loop",
      clips: [{ id: "s666_reversed", file: "/voice/s666_reversed.mp3", seconds: 20 }],
    },
  ],
  last_minute: {
    freq: 1410,
    page: "three-fourteen",
    clip: { id: "last_minute", file: "/voice/last_minute.mp3", seconds: 58.0 },
  },
};

// All station frequencies for convenience.
const STATION_FREQS = HUNT.stations.map((s) => s.freq);

// ---------------------------------------------------------------------------
// Helper: arbitrary time in a 10-year window around the epoch.
// ---------------------------------------------------------------------------
const arbTime = fc.integer({ min: EPOCH - 365 * 86_400_000, max: EPOCH + 10 * 365 * 86_400_000 });

// ---------------------------------------------------------------------------
// Helper: a frequency that is farther than lock_khz from every station.
// Generated on the AM dial (520..1740) plus values outside it.
// ---------------------------------------------------------------------------

function isFarFromAll(f: number): boolean {
  return STATION_FREQS.every((sf) => Math.abs(f - sf) > HUNT.lock_khz);
}

// Frequencies on the AM dial that are guaranteed far from all stations.
// We pre-compute a set of "safe miss" freqs; fast-check filters on them.
const arbMissFreq = fc
  .integer({ min: 520, max: 1740 })
  .filter(isFarFromAll);

// Frequencies within lock_khz of a specific station (guaranteed hit).
function arbHitFreq(stationFreq: number): fc.Arbitrary<number> {
  const lock = HUNT.lock_khz;
  return fc
    .integer({ min: Math.floor(stationFreq - lock), max: Math.ceil(stationFreq + lock) })
    .filter((f) => Math.abs(f - stationFreq) <= lock && f !== 1714);
}

// ---------------------------------------------------------------------------
// P-H1: Miss outside lock range
// ---------------------------------------------------------------------------

describe("P-H1: miss outside lock range", () => {
  it("returns null for any freq more than lock_khz from every station (AM band)", () => {
    fc.assert(
      fc.property(arbMissFreq, arbTime, (f, t) => {
        return signalAt(HUNT, f, t, EPOCH) === null;
      }),
      { numRuns: 500 }
    );
  });

  it("returns null for freqs well outside the AM band", () => {
    // Below 520 and above 1740: far from all stations (all stations are mid-band).
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: -10000, max: 519 }),
          fc.integer({ min: 1741, max: 10000 })
        ),
        arbTime,
        (f, t) => {
          return signalAt(HUNT, f, t, EPOCH) === null;
        }
      ),
      { numRuns: 200 }
    );
  });

  it("returns null for bad inputs: NaN, Infinity, negative", () => {
    const badFreqs = [NaN, Infinity, -Infinity, -1];
    const badTimes = [NaN, Infinity, -Infinity];
    for (const f of badFreqs) {
      expect(signalAt(HUNT, f, EPOCH, EPOCH)).toBeNull();
    }
    for (const t of badTimes) {
      expect(signalAt(HUNT, 870, t, EPOCH)).toBeNull();
    }
  });

  it("returns null for freq 1714", () => {
    fc.assert(
      fc.property(arbTime, (t) => {
        return signalAt(HUNT, 1714, t, EPOCH) === null;
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// P-H2: Offset bounds and remainingMs
// ---------------------------------------------------------------------------

describe("P-H2: offset bounds and remainingMs", () => {
  for (const station of HUNT.stations) {
    it(`station ${station.freq} (${station.mode}): offsetMs in [0, clipLen) and remainingMs correct`, () => {
      fc.assert(
        fc.property(arbHitFreq(station.freq), arbTime, (f, t) => {
          const r = signalAt(HUNT, f, t, EPOCH);
          if (!r) return true; // can be null if last_minute freq at wrong time
          const clip = [...station.clips, HUNT.last_minute.clip].find(
            (c) => c.id === r.clipId
          );
          if (!clip) return false;
          const clipMs = clip.seconds * 1000;
          return (
            r.offsetMs >= 0 &&
            r.offsetMs < clipMs &&
            r.remainingMs === clipMs - r.offsetMs
          );
        }),
        { numRuns: 500 }
      );
    });
  }
});

// ---------------------------------------------------------------------------
// P-H3: Determinism
// ---------------------------------------------------------------------------

describe("P-H3: determinism", () => {
  it("same (freq, t) always returns the same result", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 520, max: 1740 }),
        arbTime,
        (f, t) => {
          const r1 = signalAt(HUNT, f, t, EPOCH);
          const r2 = signalAt(HUNT, f, t, EPOCH);
          if (r1 === null && r2 === null) return true;
          if (r1 === null || r2 === null) return false;
          return (
            r1.clipId === r2.clipId &&
            r1.offsetMs === r2.offsetMs &&
            r1.remainingMs === r2.remainingMs &&
            r1.strength === r2.strength
          );
        }
      ),
      { numRuns: 500 }
    );
  });
});

// ---------------------------------------------------------------------------
// P-H4: Loop continuity
// ---------------------------------------------------------------------------

describe("P-H4: loop continuity", () => {
  const loopStations = HUNT.stations.filter((s) => s.mode === "loop");

  for (const station of loopStations) {
    it(`loop station ${station.freq}: offsetMs advances by 1000 when clip is unchanged`, () => {
      fc.assert(
        fc.property(arbHitFreq(station.freq), arbTime, (f, t) => {
          const r1 = signalAt(HUNT, f, t, EPOCH);
          const r2 = signalAt(HUNT, f, t + 1000, EPOCH);
          if (!r1 || !r2) return true;
          if (r1.clipId !== r2.clipId) return true; // clip boundary, skip
          // Also skip if t+1000 would cross the clip boundary (single-clip loop wrap).
          const clip = station.clips.find((c) => c.id === r1.clipId);
          if (!clip) return true;
          const clipMs = clip.seconds * 1000;
          if (r1.offsetMs + 1000 >= clipMs) return true; // wrap boundary
          return r2.offsetMs === r1.offsetMs + 1000;
        }),
        { numRuns: 500 }
      );
    });
  }
});

// ---------------------------------------------------------------------------
// P-H5: Last-minute window (03:14:00.000 .. 03:14:59.999 LA)
// ---------------------------------------------------------------------------

describe("P-H5: last-minute window", () => {
  /**
   * For a given date, compute UTC ms of 03:14:00 and 03:14:59.999 LA.
   * LA offset: PST = UTC-8, PDT = UTC-7.
   * We test both PST (Nov 1 2026) and PDT (Mar 14 2027).
   */

  // Nov 1 2026: DST ended at 02:00 -> PST = UTC-8. 03:14 LA = 11:14 UTC.
  const NOV1_2026_0314_START = new Date("2026-11-01T11:14:00.000Z").getTime();
  const NOV1_2026_0314_END   = new Date("2026-11-01T11:14:59.999Z").getTime();

  // Oct 31 2026: still PDT = UTC-7. 03:14 LA = 10:14 UTC.
  const OCT31_2026_0314_START = new Date("2026-10-31T10:14:00.000Z").getTime();
  const OCT31_2026_0314_END   = new Date("2026-10-31T10:14:59.999Z").getTime();

  // Mar 14 2027: DST starts at 02:00 -> PDT = UTC-7. 03:14 LA = 10:14 UTC.
  const MAR14_2027_0314_START = new Date("2027-03-14T10:14:00.000Z").getTime();
  const MAR14_2027_0314_END   = new Date("2027-03-14T10:14:59.999Z").getTime();

  const WINDOWS = [
    { label: "Oct 31 2026 (PDT)", start: OCT31_2026_0314_START, end: OCT31_2026_0314_END },
    { label: "Nov 1 2026 (PST)",  start: NOV1_2026_0314_START,  end: NOV1_2026_0314_END },
    { label: "Mar 14 2027 (PDT)", start: MAR14_2027_0314_START, end: MAR14_2027_0314_END },
  ];

  for (const { label, start, end } of WINDOWS) {
    it(`${label}: every ms in the window returns three-fourteen`, () => {
      // Sample a subset of ms values within the window (60 s = 60000 ms; sample 200).
      fc.assert(
        fc.property(
          fc.integer({ min: start, max: end }),
          (t) => {
            const r = signalAt(HUNT, 1410, t, EPOCH);
            return r !== null && r.page === "three-fourteen" && r.clipId === "last_minute";
          }
        ),
        { numRuns: 200 }
      );
    });

    it(`${label}: 1 ms before the window does NOT return three-fourteen`, () => {
      const r = signalAt(HUNT, 1410, start - 1, EPOCH);
      expect(r?.page).not.toBe("three-fourteen");
    });

    it(`${label}: 1 ms after the window does NOT return three-fourteen`, () => {
      const r = signalAt(HUNT, 1410, end + 1, EPOCH);
      expect(r?.page).not.toBe("three-fourteen");
    });
  }

  it("last_minute offsetMs is 0 at window start and clips out at end (Nov 1 2026)", () => {
    const r0 = signalAt(HUNT, 1410, NOV1_2026_0314_START, EPOCH);
    expect(r0?.offsetMs).toBe(0);

    // The window is 60 s wide but the last_minute clip is 58 s. The safety
    // clamp keeps offsetMs in [0, clipMs-1] = [0, 57999].
    const clipMs = HUNT.last_minute.clip.seconds * 1000;
    const rEnd = signalAt(HUNT, 1410, NOV1_2026_0314_END, EPOCH);
    expect(rEnd?.offsetMs).toBe(clipMs - 1);
    expect(rEnd?.remainingMs).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// P-H6: Handler shape
// ---------------------------------------------------------------------------

describe("P-H6: handler shape", () => {
  const DOCUMENTED_KEYS = new Set([
    "page", "clip_id", "file", "offset_ms", "remaining_ms", "strength", "server_time",
  ]);

  const baseEnv = {
    library: [],
    voicebank: { clips: [] },
    featured: [],
    epoch: EPOCH,
    hunt: HUNT,
  };

  it("miss returns 204 with empty body", async () => {
    // Pick a frequency definitely not in range of any station.
    const missFreq = 1100; // Between 1031 (range 1025-1037) and 1410 (range 1404-1416); 1100 is outside both.
    const req = new Request(`http://localhost:8787/signal?f=${missFreq}&t=${EPOCH}`);
    const res = await handleRequest(req, baseEnv);
    expect(res.status).toBe(204);
    const body = await res.text();
    expect(body).toBe("");
  });

  it("hit returns 200 with exactly the documented keys", async () => {
    // 870 is the marty loop station; request its exact frequency.
    const req = new Request(`http://localhost:8787/signal?f=870&t=${EPOCH}`);
    const res = await handleRequest(req, baseEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    const keys = new Set(Object.keys(body));
    for (const k of DOCUMENTED_KEYS) {
      expect(keys.has(k), `missing key: ${k}`).toBe(true);
    }
    for (const k of keys) {
      expect(DOCUMENTED_KEYS.has(k), `unexpected key: ${k}`).toBe(true);
    }
  });

  it("hit and miss both have Cache-Control: no-store", async () => {
    const hit = await handleRequest(
      new Request(`http://localhost:8787/signal?f=870&t=${EPOCH}`),
      baseEnv
    );
    const miss = await handleRequest(
      new Request(`http://localhost:8787/signal?f=1100&t=${EPOCH}`),
      baseEnv
    );
    expect(hit.headers.get("Cache-Control")).toBe("no-store");
    expect(miss.headers.get("Cache-Control")).toBe("no-store");
  });

  it("missing ?t falls back to server time without throwing", async () => {
    const req = new Request(`http://localhost:8787/signal?f=870`);
    const res = await handleRequest(req, baseEnv);
    // Should be 200 (870 is always in range at any time).
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.server_time).toBe("number");
  });

  it("/now path still works after handler refactor", async () => {
    // Just verify it doesn't 404; library is empty so it will 500 due to
    // "library is empty" but the route itself must be found.
    const req = new Request(`http://localhost:8787/now?t=${EPOCH}`);
    const res = await handleRequest(req, { ...baseEnv, library: [] });
    expect(res.status).not.toBe(404);
  });
});

// ---------------------------------------------------------------------------
// U-H7: Numbers station decode
// ---------------------------------------------------------------------------

describe("U-H7: numbers station decode", () => {
  it("decodes NUMBERS_TEXT to [WATER, TOWER, STAY]", () => {
    const words = decodeNumbers(NUMBERS_TEXT);
    // Filter to words that look like the message content (all alpha, >= 3 letters).
    const decoded = words.filter((w) => /^[A-Z]{3,}$/.test(w));
    expect(decoded).toContain("WATER");
    expect(decoded).toContain("TOWER");
    expect(decoded).toContain("STAY");
  });

  it("WATER decodes from: twenty three, one, twenty, five, eighteen", () => {
    const result = decodeNumbers("Twenty three, one, twenty, five, eighteen.");
    expect(result[0]).toBe("WATER");
  });

  it("TOWER decodes from: twenty, fifteen, twenty three, five, eighteen", () => {
    const result = decodeNumbers("Twenty, fifteen, twenty three, five, eighteen.");
    expect(result[0]).toBe("TOWER");
  });

  it("STAY decodes from: nineteen, twenty, one, twenty five", () => {
    const result = decodeNumbers("Nineteen, twenty, one, twenty five.");
    expect(result[0]).toBe("STAY");
  });

  it("NUMBERS_TEXT constant is a non-empty string", () => {
    expect(typeof NUMBERS_TEXT).toBe("string");
    expect(NUMBERS_TEXT.length).toBeGreaterThan(0);
  });
});
