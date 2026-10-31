/**
 * analyze.ts - ffmpeg-based loudness measurement and talk-up detection.
 *
 * REQ-3: Measure integrated LUFS, true peak, duration.
 * REQ-4: Detect the talk-up window (first energy rise, minus 0.5 s margin).
 * REQ-7: Read WAV mtime as made_at.
 * REQ-10: windowsHide: true on all child processes.
 */

import { spawn } from "child_process";
import { statSync } from "fs";
import type { AnalysisResult } from "./types.js";

// --- Talk-up detection constants ---
// RMS is measured in 0.5 s windows at 22050 Hz stereo.
const TALKUP_WINDOW_S         = 0.5;
// Baseline is computed from the first N windows' median.
const TALKUP_BASELINE_S       = 8.0;   // 16 windows
// Look-ahead width: for each candidate position, take the median of
// the next TALKUP_LOOKAHEAD_S seconds. If that median exceeds
// baseline + TALKUP_RISE_DB, scan forward to find the first window
// in the look-ahead that crosses (baseline + TALKUP_RISE_DB - TALKUP_TOLERANCE_DB).
const TALKUP_LOOKAHEAD_S      = 2.0;   // 4 windows
// How far above the baseline the look-ahead median must sit.
const TALKUP_RISE_DB          = 4.0;
// Tolerance when pinpointing the first window inside the look-ahead block.
const TALKUP_TOLERANCE_DB     = 1.0;
// Don't scan before this many seconds into the track.
const TALKUP_MIN_SCAN_S       = 5.0;   // 10 windows
// Subtract from onset timestamp before returning.
const TALKUP_SAFETY_MARGIN_S  = 0.5;
// Hard cap on the returned value.
const TALKUP_CAP_S            = 30;
// Returned when no sustained rise is found.
const TALKUP_FALLBACK_S       = 8;
// Only analyse the first N seconds.
const ANALYSIS_WINDOW_S       = 45;

interface LoudnormJson {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
}

/**
 * Run ffmpeg to measure loudness of `wavPath`.
 * Returns the raw loudnorm JSON and duration.
 */
async function measureLoudness(
  ffmpegPath: string,
  wavPath: string
): Promise<{
  lufs: number;
  truePeak: number;
  seconds: number;
  measuredI: number;
  measuredTp: number;
  measuredLra: number;
  measuredThresh: number;
}> {
  return new Promise((resolve, reject) => {
    const args = [
      "-i",
      wavPath,
      "-af",
      "loudnorm=print_format=json",
      "-f",
      "null",
      "-",
    ];

    const proc = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `ffmpeg loudnorm exited ${code} for ${wavPath}\n${stderr.slice(-1000)}`
          )
        );
        return;
      }

      // Extract the JSON block from stderr.
      const jsonMatch = stderr.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/);
      if (!jsonMatch) {
        reject(new Error(`No loudnorm JSON found for ${wavPath}`));
        return;
      }

      let parsed: LoudnormJson;
      try {
        parsed = JSON.parse(jsonMatch[0]) as LoudnormJson;
      } catch (e) {
        reject(new Error(`Failed to parse loudnorm JSON: ${String(e)}`));
        return;
      }

      // Also extract duration from the ffmpeg header.
      const durMatch = stderr.match(/Duration:\s+(\d+):(\d+):(\d+)\.(\d+)/);
      let seconds = 0;
      if (durMatch) {
        const h = parseInt(durMatch[1], 10);
        const m = parseInt(durMatch[2], 10);
        const s = parseInt(durMatch[3], 10);
        const cs = parseInt(durMatch[4], 10);
        seconds = h * 3600 + m * 60 + s + cs / 100;
      }

      // Fall back to input_dur if the duration header is absent.
      if (seconds === 0) {
        const durField = (parsed as unknown as Record<string, string>)[
          "input_dur"
        ];
        if (durField) seconds = parseFloat(durField);
      }

      resolve({
        lufs: parseFloat(parsed.input_i),
        truePeak: parseFloat(parsed.input_tp),
        seconds: Math.round(seconds * 100) / 100,
        measuredI: parseFloat(parsed.input_i),
        measuredTp: parseFloat(parsed.input_tp),
        measuredLra: parseFloat(parsed.input_lra),
        measuredThresh: parseFloat(parsed.input_thresh),
      });
    });

    proc.on("error", (err) => reject(err));
  });
}

/**
 * Run the talk-up detector on `wavPath`.
 * Extracts raw PCM samples via ffmpeg and applies the baseline+sustained-rise
 * algorithm via `analyzePcmForTalkup`.
 *
 * Returns talkup_seconds clamped to [0, 30], falling back to 8 s.
 */
async function detectTalkup(
  ffmpegPath: string,
  wavPath: string
): Promise<number> {
  return new Promise((resolve) => {
    // Extract raw 32-bit float samples at 22050 Hz stereo, limit to ANALYSIS_WINDOW_S.
    const args = [
      "-t",
      String(ANALYSIS_WINDOW_S),
      "-i",
      wavPath,
      "-af",
      "aresample=22050",
      "-ac",
      "2",
      "-f",
      "f32le",
      "-",
    ];

    const proc = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const chunks: Buffer[] = [];

    proc.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        process.stderr.write(
          `[analyze] ffmpeg PCM extraction failed (exit ${code}), using fallback ${TALKUP_FALLBACK_S}s\n`
        );
        resolve(TALKUP_FALLBACK_S);
        return;
      }

      const samples = Buffer.concat(chunks);
      const result = analyzePcmForTalkup(samples);
      resolve(result);
    });

    proc.on("error", () => {
      process.stderr.write(
        `[analyze] ffmpeg PCM extraction error, using fallback ${TALKUP_FALLBACK_S}s\n`
      );
      resolve(TALKUP_FALLBACK_S);
    });
  });
}

/**
 * Analyze raw 32-bit float PCM samples (22050 Hz stereo, interleaved L/R)
 * to detect the talk-up onset.
 *
 * Algorithm (baseline + look-ahead median):
 *   1. Compute RMS in TALKUP_WINDOW_S (0.5 s) windows (22050 floats each for stereo).
 *   2. Baseline = median of the first TALKUP_BASELINE_S (8 s) of windows.
 *   3. Scan forward from TALKUP_MIN_SCAN_S (5 s). At each position i, take the
 *      median of the next TALKUP_LOOKAHEAD_S (2 s) of windows. When that median
 *      exceeds baseline + TALKUP_RISE_DB (4 dB), walk forward through the block
 *      to find the first window whose raw dB >=
 *      baseline + TALKUP_RISE_DB - TALKUP_TOLERANCE_DB (3 dB). That window is the onset.
 *   4. Return onset - TALKUP_SAFETY_MARGIN_S, clamped to [0, TALKUP_CAP_S].
 *   5. Fallback: TALKUP_FALLBACK_S (8) if no trigger is found.
 *
 * Exported for unit and property testing.
 *
 * @param samples Buffer of 32-bit little-endian floats at 22050 Hz STEREO
 *                (2 floats per frame: L then R).
 * @param channels Number of channels in the PCM data (default 2).
 * @returns talkup_seconds.
 */
export function analyzePcmForTalkup(
  samples: Buffer,
  channels = 2
): number {
  const SAMPLE_RATE    = 22050;
  const WINDOW_SAMPLES = Math.round(TALKUP_WINDOW_S * SAMPLE_RATE * channels);
  const BASELINE_WINS  = Math.round(TALKUP_BASELINE_S  / TALKUP_WINDOW_S); // 16
  const LOOKAHEAD_WINS = Math.round(TALKUP_LOOKAHEAD_S / TALKUP_WINDOW_S); // 4
  const MIN_SCAN_WINS  = Math.round(TALKUP_MIN_SCAN_S   / TALKUP_WINDOW_S); // 10

  const numFloats = Math.floor(samples.length / 4);

  if (numFloats < WINDOW_SAMPLES * (BASELINE_WINS + LOOKAHEAD_WINS)) {
    process.stderr.write(
      `[analyze] insufficient audio data, using fallback ${TALKUP_FALLBACK_S}s\n`
    );
    return TALKUP_FALLBACK_S;
  }

  // --- Step 1: per-window RMS in dB ---
  const windowRmsDb: number[] = [];
  for (
    let start = 0;
    start + WINDOW_SAMPLES <= numFloats;
    start += WINDOW_SAMPLES
  ) {
    let sumSq = 0;
    for (let i = start; i < start + WINDOW_SAMPLES; i++) {
      const s = samples.readFloatLE(i * 4);
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / WINDOW_SAMPLES);
    windowRmsDb.push(rms > 0 ? 20 * Math.log10(rms) : -100);
  }

  if (windowRmsDb.length < BASELINE_WINS + MIN_SCAN_WINS) {
    process.stderr.write(
      `[analyze] too few windows (${windowRmsDb.length}), using fallback ${TALKUP_FALLBACK_S}s\n`
    );
    return TALKUP_FALLBACK_S;
  }

  // --- Step 2: baseline = median of first BASELINE_WINS windows ---
  const baselineSlice = windowRmsDb.slice(0, BASELINE_WINS).slice().sort((a, b) => a - b);
  const bMid = Math.floor(baselineSlice.length / 2);
  const baseline =
    baselineSlice.length % 2 === 0
      ? (baselineSlice[bMid - 1] + baselineSlice[bMid]) / 2
      : baselineSlice[bMid];

  const riseThresh  = baseline + TALKUP_RISE_DB;
  const crossThresh = riseThresh - TALKUP_TOLERANCE_DB;

  // --- Step 3: scan from MIN_SCAN_WINS ---
  for (
    let i = MIN_SCAN_WINS;
    i + LOOKAHEAD_WINS <= windowRmsDb.length;
    i++
  ) {
    const ahead = windowRmsDb.slice(i, i + LOOKAHEAD_WINS).slice().sort((a, b) => a - b);
    const aMid = Math.floor(ahead.length / 2);
    const aheadMed =
      ahead.length % 2 === 0
        ? (ahead[aMid - 1] + ahead[aMid]) / 2
        : ahead[aMid];

    if (aheadMed >= riseThresh) {
      // Walk forward to find the first window actually crossing the softer threshold.
      let onsetIdx = i;
      for (let j = i; j < i + LOOKAHEAD_WINS; j++) {
        if (windowRmsDb[j] >= crossThresh) {
          onsetIdx = j;
          break;
        }
      }

      const onsetS  = onsetIdx * TALKUP_WINDOW_S;
      const talkup  = Math.min(TALKUP_CAP_S, Math.max(0, onsetS - TALKUP_SAFETY_MARGIN_S));
      process.stderr.write(
        `[analyze] talkup onset ${onsetS.toFixed(2)}s` +
        ` (look-ahead median ${aheadMed.toFixed(1)}dB, baseline ${baseline.toFixed(1)}dB,` +
        ` rise ${(aheadMed - baseline).toFixed(1)}dB) -> ${talkup.toFixed(2)}s\n`
      );
      return Math.round(talkup * 100) / 100;
    }
  }

  process.stderr.write(
    `[analyze] no talkup rise found (baseline ${baseline.toFixed(1)}dB),` +
    ` using fallback ${TALKUP_FALLBACK_S}s\n`
  );
  return TALKUP_FALLBACK_S;
}

/**
 * Full analysis of `wavPath`: loudness + talk-up + mtime.
 *
 * @param ffmpegPath - Absolute path to the ffmpeg binary.
 * @param wavPath - Absolute path to the source WAV file.
 * @returns AnalysisResult.
 */
export async function analyzeTrack(
  ffmpegPath: string,
  wavPath: string
): Promise<AnalysisResult> {
  const [loudness, talkupSeconds, stat] = await Promise.all([
    measureLoudness(ffmpegPath, wavPath),
    detectTalkup(ffmpegPath, wavPath),
    Promise.resolve(statSync(wavPath)),
  ]);

  const madeAt = new Date(stat.mtimeMs).toISOString();

  return {
    lufs: loudness.lufs,
    truePeak: loudness.truePeak,
    seconds: loudness.seconds,
    talkupSeconds,
    madeAt,
    measuredI: loudness.measuredI,
    measuredTp: loudness.measuredTp,
    measuredLra: loudness.measuredLra,
    measuredThresh: loudness.measuredThresh,
  };
}
