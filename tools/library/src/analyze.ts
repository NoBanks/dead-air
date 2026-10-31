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

const TALKUP_RISE_THRESHOLD_DB = 6; // dB rise to count as "the post"
const TALKUP_SAFETY_MARGIN_S = 0.5;
const TALKUP_MIN_ONSET_S = 2; // onset before this -> return 0
const TALKUP_CAP_S = 30;
const TALKUP_FALLBACK_S = 8;
const ANALYSIS_WINDOW_S = 60; // only look at first 60 s for talk-up
const FRAME_SIZE_S = 0.05; // astats uses ~50 ms frames at default

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
 * Uses ffmpeg astats to export per-frame RMS energy, then finds the first
 * sharp rise.
 *
 * Returns talkup_seconds clamped to [0, 30], falling back to 8 s.
 */
async function detectTalkup(
  ffmpegPath: string,
  wavPath: string
): Promise<number> {
  return new Promise((resolve) => {
    // Limit analysis to first ANALYSIS_WINDOW_S seconds.
    const args = [
      "-t",
      String(ANALYSIS_WINDOW_S),
      "-i",
      wavPath,
      "-af",
      "aresample=22050,astats=metadata=1:reset=1",
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

    proc.on("close", () => {
      const result = parseTalkup(stderr);
      resolve(result);
    });

    proc.on("error", () => {
      // Analysis failure -> use fallback.
      process.stderr.write(`[analyze] talk-up detection failed, using fallback ${TALKUP_FALLBACK_S}s\n`);
      resolve(TALKUP_FALLBACK_S);
    });
  });
}

/**
 * Parse astats stderr output and compute talkup_seconds.
 * Exported for testing.
 */
export function parseTalkup(stderr: string): number {
  // astats emits lines like:
  //   lavfi.astats.Overall.RMS_level=-inf
  //   lavfi.astats.1.RMS_level=-23.5
  // We also see pts_time lines that tell us the frame timestamp:
  //   pts_time:0.046440
  // Or from the metadata filter:
  //   frame:0 pts:1024 pts_time:0.046440

  const rmsValues: Array<{ time: number; rmsDb: number }> = [];

  const lines = stderr.split("\n");
  let currentTime = 0;

  for (const line of lines) {
    const timeMatch = line.match(/pts_time:([\d.]+)/);
    if (timeMatch) {
      currentTime = parseFloat(timeMatch[1]);
    }

    // Match the overall RMS level from astats.
    const rmsMatch = line.match(/lavfi\.astats\.(?:Overall|1)\.RMS_level=([^\s]+)/);
    if (rmsMatch) {
      const val = rmsMatch[1];
      if (val === "-inf" || val === "nan") {
        rmsValues.push({ time: currentTime, rmsDb: -80 });
      } else {
        const db = parseFloat(val);
        if (!isNaN(db)) {
          rmsValues.push({ time: currentTime, rmsDb: db });
        }
      }
    }
  }

  if (rmsValues.length === 0) {
    process.stderr.write(
      `[analyze] no RMS frames found, using fallback ${TALKUP_FALLBACK_S}s\n`
    );
    return TALKUP_FALLBACK_S;
  }

  // Find the minimum RMS in any 4-second rolling window preceding the current
  // frame, then detect the first frame where RMS exceeds that min by the
  // threshold.
  const WINDOW_FRAMES = Math.ceil(4 / FRAME_SIZE_S);

  for (let i = 1; i < rmsValues.length; i++) {
    const { time, rmsDb } = rmsValues[i];
    const windowStart = Math.max(0, i - WINDOW_FRAMES);
    const windowRms = rmsValues.slice(windowStart, i).map((r) => r.rmsDb);
    const minRms = Math.min(...windowRms);

    if (rmsDb - minRms >= TALKUP_RISE_THRESHOLD_DB) {
      // Found the post.
      const onset = time;
      if (onset < TALKUP_MIN_ONSET_S) {
        return 0;
      }
      const talkup = Math.min(
        TALKUP_CAP_S,
        Math.max(0, onset - TALKUP_SAFETY_MARGIN_S)
      );
      return Math.round(talkup * 100) / 100;
    }
  }

  // No detectable rise -> fallback.
  process.stderr.write(
    `[analyze] no energy rise detected, using fallback ${TALKUP_FALLBACK_S}s\n`
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
