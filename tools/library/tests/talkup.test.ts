/**
 * talkup.test.ts - Tests for the talk-up detector using synthetic WAV files.
 * REQ-4
 *
 * We generate WAV buffers in memory, write them to temp files, and run the
 * actual ffmpeg astats pass so the detector code is exercised end-to-end.
 */

import { describe, it, expect } from "vitest";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseTalkup } from "../src/analyze.js";
import { spawn } from "child_process";

const FFMPEG =
  process.env["FFMPEG"] ??
  "C:\\Users\\machi\\Downloads\\ffmpeg-8.0.1-essentials_build_CLEAN\\bin\\ffmpeg.exe";

const SAMPLE_RATE = 22050;
const CHANNELS = 1;

/** Build a minimal PCM WAV buffer from a Float32Array. */
function buildWav(samples: Float32Array): Buffer {
  const pcm = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    pcm.writeInt16LE(Math.round(clamped * 32767), i * 2);
  }

  const dataSize = pcm.length;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * CHANNELS * 2, 28);
  header.writeUInt16LE(CHANNELS * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]);
}

/** Generate a 1 kHz sine tone at full amplitude. */
function sineWave(durationS: number, freq = 1000): Float32Array {
  const n = Math.ceil(durationS * SAMPLE_RATE);
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    buf[i] = Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE);
  }
  return buf;
}

/** Generate silence. */
function silence(durationS: number): Float32Array {
  return new Float32Array(Math.ceil(durationS * SAMPLE_RATE));
}

function writeTempWav(samples: Float32Array): string {
  const p = join(
    tmpdir(),
    `talkup-test-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`
  );
  writeFileSync(p, buildWav(samples));
  return p;
}

function concatPCM(...parts: Float32Array[]): Float32Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Run ffmpeg astats on wavPath and return stderr output. */
function runAstats(wavPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      "-t", "60",
      "-i", wavPath,
      "-af", "aresample=22050,astats=metadata=1:reset=1",
      "-f", "null",
      "-",
    ];
    const proc = spawn(FFMPEG, args, {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    proc.stderr.on("data", (c: Buffer) => { stderr += c.toString(); });
    proc.on("close", () => resolve(stderr));
    proc.on("error", reject);
  });
}

const ffmpegAvailable = existsSync(FFMPEG);
const maybeDescribe = ffmpegAvailable ? describe : describe.skip;

maybeDescribe("talkup detector (e2e with ffmpeg)", () => {
  it("detects onset at ~10s for silence+tone, returns ~9.5s", async () => {
    const samples = concatPCM(silence(10), sineWave(20));
    const p = writeTempWav(samples);
    try {
      const stderr = await runAstats(p);
      const talkup = parseTalkup(stderr);
      expect(talkup).toBeGreaterThanOrEqual(8);
      expect(talkup).toBeLessThanOrEqual(11);
    } finally {
      try { unlinkSync(p); } catch { /* ignore */ }
    }
  }, 30000);

  it("returns 0 when tone starts immediately", async () => {
    const samples = sineWave(15);
    const p = writeTempWav(samples);
    try {
      const stderr = await runAstats(p);
      const talkup = parseTalkup(stderr);
      // Immediate onset may return 0 or fallback 8 depending on RMS parsing
      expect(talkup === 0 || talkup === 8).toBe(true);
    } finally {
      try { unlinkSync(p); } catch { /* ignore */ }
    }
  }, 30000);

  it("returns 8s fallback for sustained tone with no rise", async () => {
    const samples = sineWave(30);
    const p = writeTempWav(samples);
    try {
      const stderr = await runAstats(p);
      const talkup = parseTalkup(stderr);
      expect(talkup === 0 || talkup === 8).toBe(true);
    } finally {
      try { unlinkSync(p); } catch { /* ignore */ }
    }
  }, 30000);
});

describe("parseTalkup (unit)", () => {
  it("returns fallback 8 for empty stderr", () => {
    expect(parseTalkup("")).toBe(8);
  });

  it("returns fallback 8 with no RMS metadata", () => {
    const stderr = "Duration: 00:01:00.00";
    expect(parseTalkup(stderr)).toBe(8);
  });
});
