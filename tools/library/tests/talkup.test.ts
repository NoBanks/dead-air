/**
 * talkup.test.ts - Tests for the talk-up detector.
 * REQ-4
 *
 * E2E tests run ffmpeg to extract PCM, then call analyzePcmForTalkup.
 * Property tests use fast-check with in-memory PCM buffers (no ffmpeg needed).
 *
 * The detector uses:
 *   - 0.5 s RMS windows (stereo = 22050 floats per window)
 *   - 8 s baseline from the first 16 windows
 *   - 2 s look-ahead median threshold of +4 dB above baseline
 *   - 0.5 s safety margin subtracted from onset
 */

import { describe, it, expect } from "vitest";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as fc from "fast-check";
import { analyzePcmForTalkup } from "../src/analyze.js";
import { spawn } from "child_process";

const FFMPEG =
  process.env["FFMPEG"] ??
  "C:\\Users\\machi\\Downloads\\ffmpeg-8.0.1-essentials_build_CLEAN\\bin\\ffmpeg.exe";

const SAMPLE_RATE = 22050;
const CHANNELS = 1; // WAVs generated in these tests are mono

// ---------------------------------------------------------------------------
// PCM / WAV helpers
// ---------------------------------------------------------------------------

/** Build a minimal 16-bit PCM WAV buffer from a Float32Array. */
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

/** 1 kHz sine tone at amplitude ~amplitude (linear, 0..1). */
function sineWave(durationS: number, amplitude = 1.0): Float32Array {
  const n = Math.ceil(durationS * SAMPLE_RATE);
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    buf[i] = amplitude * Math.sin((2 * Math.PI * 1000 * i) / SAMPLE_RATE);
  }
  return buf;
}

/** White noise at amplitude ~amplitude. */
function noise(durationS: number, amplitude = 1.0): Float32Array {
  const n = Math.ceil(durationS * SAMPLE_RATE);
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    buf[i] = amplitude * (Math.random() * 2 - 1);
  }
  return buf;
}

function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

function concatPCM(...parts: Float32Array[]): Float32Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}

function writeTempWav(samples: Float32Array): string {
  const p = join(tmpdir(), `talkup-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
  writeFileSync(p, buildWav(samples));
  return p;
}

/** Run ffmpeg to extract 32-bit float PCM at 22050 Hz stereo. */
function extractPcm(wavPath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, ["-t", "60", "-i", wavPath, "-af", "aresample=22050", "-ac", "2", "-f", "f32le", "-"], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    proc.stdout.on("data", (c: Buffer) => { chunks.push(c); });
    proc.on("close", () => resolve(Buffer.concat(chunks)));
    proc.on("error", reject);
  });
}

/**
 * Build a raw float32 stereo PCM Buffer directly (no WAV header, no ffmpeg).
 * Both channels carry the same signal.
 */
function makeStereoBuffer(mono: Float32Array): Buffer {
  const buf = Buffer.alloc(mono.length * 2 * 4); // 2 channels, 4 bytes each
  for (let i = 0; i < mono.length; i++) {
    const v = mono[i];
    buf.writeFloatLE(v, (i * 2 + 0) * 4); // L
    buf.writeFloatLE(v, (i * 2 + 1) * 4); // R
  }
  return buf;
}

// ---------------------------------------------------------------------------
// E2E tests (require ffmpeg)
// ---------------------------------------------------------------------------

const ffmpegAvailable = existsSync(FFMPEG);
const maybeDescribe = ffmpegAvailable ? describe : describe.skip;

maybeDescribe("talkup detector (e2e with ffmpeg)", () => {
  it("detects onset at ~10s for quiet(10s) + loud(25s), returns ~9.5s", async () => {
    // 10 s intro at -40 dB (well below any baseline), 25 s body at -5 dB.
    // Baseline (first 8s) will be ~-40dB; rise of 35dB exceeds threshold.
    const samples = concatPCM(
      noise(10, dbToLinear(-40)),
      sineWave(25, dbToLinear(-5)),
    );
    const p = writeTempWav(samples);
    try {
      const pcm = await extractPcm(p);
      const talkup = analyzePcmForTalkup(pcm, 2); // ffmpeg outputs stereo
      // Onset ~10s, margin 0.5s -> expected ~9.5s. Allow ±1.5s.
      expect(talkup).toBeGreaterThanOrEqual(8.0);
      expect(talkup).toBeLessThanOrEqual(11.0);
    } finally {
      try { unlinkSync(p); } catch { /* ignore */ }
    }
  }, 30000);

  it("returns 8s fallback for flat sustained tone", async () => {
    const samples = sineWave(30, dbToLinear(-10));
    const p = writeTempWav(samples);
    try {
      const pcm = await extractPcm(p);
      const talkup = analyzePcmForTalkup(pcm, 2);
      expect(talkup).toBe(8);
    } finally {
      try { unlinkSync(p); } catch { /* ignore */ }
    }
  }, 30000);
});

// ---------------------------------------------------------------------------
// Unit tests (no ffmpeg needed — synthetic stereo PCM buffers)
// ---------------------------------------------------------------------------

describe("analyzePcmForTalkup (unit)", () => {
  it("returns fallback 8 for empty buffer", () => {
    expect(analyzePcmForTalkup(Buffer.alloc(0))).toBe(8);
  });

  it("returns fallback 8 for too-short buffer", () => {
    expect(analyzePcmForTalkup(Buffer.alloc(16))).toBe(8);
  });

  it("detects onset in a quiet+loud stereo fixture", () => {
    // 10s quiet at -45dB, 25s loud at -5dB. Stereo at 22050 Hz.
    const quietMono = noise(10, dbToLinear(-45));
    const loudMono  = sineWave(25, dbToLinear(-5));
    const buf = makeStereoBuffer(concatPCM(quietMono, loudMono));
    const talkup = analyzePcmForTalkup(buf, 2);
    // Onset at 10s, minus 0.5s margin = 9.5s. Allow ±1.5s.
    expect(talkup).toBeGreaterThanOrEqual(8.0);
    expect(talkup).toBeLessThanOrEqual(11.0);
  });

  it("returns fallback 8 for flat signal (no rise)", () => {
    const flatMono = noise(30, dbToLinear(-12));
    const buf = makeStereoBuffer(flatMono);
    const talkup = analyzePcmForTalkup(buf, 2);
    expect(talkup).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// Property-based tests (fast-check)
// ---------------------------------------------------------------------------

describe("analyzePcmForTalkup (property tests)", () => {
  /**
   * Rise property:
   * For any quiet-then-loud envelope where:
   *   - quiet duration Q in [9, 25] s (must be > baseline window of 8s)
   *   - rise >= 6 dB (well above the 4 dB threshold)
   *   - quiet level in [-60, -25] dB
   * The detector must return a value within 1.5 s of (Q - 0.5).
   */
  it("detects known-onset fixture within 1.5s (rise property)", () => {
    fc.assert(
      fc.property(
        fc.float({ min: 9, max: 25, noNaN: true }),      // quiet duration
        fc.float({ min: -55, max: -25, noNaN: true }),   // quiet level dB
        fc.float({ min: 6, max: 20, noNaN: true }),      // rise amount dB
        (quietS, quietDb, riseDb) => {
          const loudDb = quietDb + riseDb;
          // Clamp loud to max -1 dB to stay inside float range.
          const loudDbClamped = Math.min(-1, loudDb);
          // Total duration: quietS + 15s of loud section.
          const quietMono = noise(quietS, dbToLinear(quietDb));
          const loudMono  = noise(15, dbToLinear(loudDbClamped));
          const buf = makeStereoBuffer(concatPCM(quietMono, loudMono));
          const talkup = analyzePcmForTalkup(buf, 2);
          const expectedTalkup = quietS - 0.5; // onset at quietS, minus margin
          return Math.abs(talkup - expectedTalkup) <= 1.5;
        }
      ),
      { numRuns: 40, seed: 12345 }
    );
  });

  /**
   * Flat property:
   * For any flat envelope (constant amplitude across the whole clip),
   * the detector must return the fallback value 8.
   */
  it("returns fallback 8 for any flat envelope (flat property)", () => {
    fc.assert(
      fc.property(
        fc.float({ min: -60, max: -5, noNaN: true }),   // amplitude dB
        fc.float({ min: 20, max: 40, noNaN: true }),    // duration
        (ampDb, durationS) => {
          const flatMono = noise(durationS, dbToLinear(ampDb));
          const buf = makeStereoBuffer(flatMono);
          return analyzePcmForTalkup(buf, 2) === 8;
        }
      ),
      { numRuns: 40, seed: 99999 }
    );
  });
});
