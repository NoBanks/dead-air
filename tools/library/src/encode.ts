/**
 * encode.ts - Two-pass loudnorm MP3 encode.
 *
 * REQ-5: 256 kbps, 44.1 kHz stereo, -14 LUFS / -1 dBTP.
 * REQ-10: windowsHide: true on all child processes.
 */

import { spawn } from "child_process";
import { mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import type { AnalysisResult } from "./types.js";

/**
 * Encode `wavPath` to a loudness-normalized 256 kbps MP3 at `outPath`.
 *
 * Uses the measured loudnorm values from `analysis` for a linear two-pass
 * encode (no seek, single ffmpeg invocation).
 *
 * @param ffmpegPath - Absolute path to the ffmpeg binary.
 * @param wavPath - Absolute path to the source WAV file.
 * @param outPath - Absolute path for the output MP3.
 * @param analysis - Loudness measurements from `analyzeTrack()`.
 */
export async function encodeTrack(
  ffmpegPath: string,
  wavPath: string,
  outPath: string,
  analysis: AnalysisResult
): Promise<void> {
  // Ensure the output directory exists.
  const outDir = dirname(outPath);
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  const loudnormFilter = [
    "loudnorm=I=-14:TP=-1:LRA=11",
    `measured_I=${analysis.measuredI}`,
    `measured_TP=${analysis.measuredTp}`,
    `measured_LRA=${analysis.measuredLra}`,
    `measured_thresh=${analysis.measuredThresh}`,
    "linear=true",
    "print_format=none",
  ].join(":");

  const args = [
    "-y", // overwrite without prompt
    "-i",
    wavPath,
    "-af",
    loudnormFilter,
    "-c:a",
    "libmp3lame",
    "-b:a",
    "256k",
    "-ar",
    "44100",
    "-ac",
    "2",
    outPath,
  ];

  return new Promise((resolve, reject) => {
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
            `ffmpeg encode exited ${code} for ${wavPath}\n${stderr.slice(-1000)}`
          )
        );
        return;
      }
      resolve();
    });

    proc.on("error", (err) => {
      reject(new Error(`ffmpeg encode spawn error: ${err.message}`));
    });
  });
}
