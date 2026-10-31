/**
 * csv.test.ts - Unit tests for parseCsv().
 * REQ-1
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseCsv } from "../src/csv.js";

function writeTempCsv(content: string): string {
  const p = join(tmpdir(), `csv-test-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`);
  writeFileSync(p, content, "utf8");
  return p;
}

describe("parseCsv", () => {
  const paths: string[] = [];

  afterEach(() => {
    for (const p of paths.splice(0)) {
      try { unlinkSync(p); } catch { /* ignore */ }
    }
  });

  it("parses a well-formed CSV row into a SourceTrack with correct fields", () => {
    const p = writeTempCsv(
      `title,file,seconds,mstr,ext,versions,file_size_mb\n` +
      `Heal My Mind,/music/heal.wav,214.38,true,wav,1,26.5\n`
    );
    paths.push(p);

    const tracks = parseCsv(p);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].title).toBe("Heal My Mind");
    expect(tracks[0].file).toBe("/music/heal.wav");
    expect(tracks[0].seconds).toBe(214.38);
    expect(tracks[0].mstr).toBe(true);
    expect(tracks[0].ext).toBe("wav");
    expect(tracks[0].versions).toBe(1);
    expect(tracks[0].fileSizeMb).toBe(26.5);
  });

  it("skips a row missing the 'file' column and emits a warning", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const p = writeTempCsv(
      `title,file,seconds\n` +
      `Missing File,,0\n`
    );
    paths.push(p);

    const tracks = parseCsv(p);
    expect(tracks).toHaveLength(0);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("missing \"file\" column")
    );
    stderrSpy.mockRestore();
  });

  it("skips a row missing the 'title' column and emits a warning", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const p = writeTempCsv(
      `title,file,seconds\n` +
      `,/music/track.wav,100\n`
    );
    paths.push(p);

    const tracks = parseCsv(p);
    expect(tracks).toHaveLength(0);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("missing \"title\" column")
    );
    stderrSpy.mockRestore();
  });

  it("skips blank lines without error", () => {
    const p = writeTempCsv(
      `title,file,seconds\n` +
      `\n` +
      `Good Track,/music/good.wav,120\n` +
      `\n`
    );
    paths.push(p);

    const tracks = parseCsv(p);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].title).toBe("Good Track");
  });

  it("throws on a non-existent file path", () => {
    expect(() => parseCsv("/non/existent/path.csv")).toThrow(/Cannot read CSV file/);
  });

  it("parses multiple valid rows", () => {
    const p = writeTempCsv(
      `title,file\n` +
      `Track A,/a.wav\n` +
      `Track B,/b.wav\n` +
      `Track C,/c.wav\n`
    );
    paths.push(p);

    const tracks = parseCsv(p);
    expect(tracks).toHaveLength(3);
    expect(tracks.map((t) => t.title)).toEqual(["Track A", "Track B", "Track C"]);
  });
});
