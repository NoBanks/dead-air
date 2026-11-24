/** QA pass: shipped config under data/ is well formed and consistent. Pure file reads. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";

const data = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "data");
const load = (f: string) => JSON.parse(readFileSync(resolve(data, f), "utf-8"));

describe("data/hunt.json", () => {
  const h = load("hunt.json");
  it("has a sane lock radius and unique in-band frequencies", () => {
    expect(h.lock_khz).toBeGreaterThan(0);
    const freqs = h.stations.map((s: any) => s.freq);
    expect(new Set(freqs).size).toBe(freqs.length);
    for (const f of freqs) { expect(f).toBeGreaterThanOrEqual(520); expect(f).toBeLessThanOrEqual(1740); }
  });
  it("never puts a hidden station inside the main station's lock window", () => {
    for (const s of h.stations) expect(Math.abs(s.freq - 1714)).toBeGreaterThan(12);
  });
  it("every station has clips with positive durations and a unique page", () => {
    const pages = h.stations.map((s: any) => s.page);
    expect(new Set(pages).size).toBe(pages.length);
    for (const s of h.stations) {
      expect(s.clips.length).toBeGreaterThan(0);
      for (const c of s.clips) { expect(c.seconds).toBeGreaterThan(0); expect(c.file).toMatch(/^\/voice\/.+\.mp3$/); }
    }
    expect(h.last_minute.clip.seconds).toBeGreaterThan(0);
  });
});

describe("data/voicebank.json", () => {
  const v = load("voicebank.json");
  it("has unique ids, positive durations and voice-relative mp3 paths", () => {
    const ids = v.clips.map((c: any) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of v.clips) {
      expect(c.seconds).toBeGreaterThan(0);
      expect(c.text.length).toBeGreaterThan(0);
      expect(c.file).toMatch(/^\/voice\/.+\.mp3$/);
    }
  });
  it("contains the clip kinds the scheduler needs", () => {
    const kinds = new Set(v.clips.map((c: any) => c.kind));
    for (const k of ["id", "signon"]) expect(kinds.has(k)).toBe(true);
  });
  it("contains no em dashes", () => {
    expect(JSON.stringify(v)).not.toContain(String.fromCharCode(0x2014));
  });
});
