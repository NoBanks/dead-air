/**
 * hunt.ts
 *
 * Pure functions for hidden-station logic.
 * No I/O, no global state, no throws on bad input.
 *
 * All LA-time work goes through the Intl helpers in tzoffsets.ts.
 */

import { stationHourOf } from "./tzoffsets.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HuntClip {
  id: string;
  file: string;    // URL path
  seconds: number; // float
}

export interface HuntStation {
  freq: number;
  page: string;
  mode: "loop" | "hourly";
  clips: HuntClip[];
}

export interface LastMinute {
  freq: number;
  page: string;
  clip: HuntClip;
}

export interface HuntConfig {
  lock_khz: number;
  stations: HuntStation[];
  last_minute: LastMinute;
}

export interface SignalResult {
  page: string;
  clipId: string;
  file: string;
  offsetMs: number;
  remainingMs: number;
  strength: number;
}

// ---------------------------------------------------------------------------
// Numbers station
// ---------------------------------------------------------------------------

export const NUMBERS_TEXT =
  "Attention. One four one zero. Zero three one four. Attention. " +
  "Twenty three, one, twenty, five, eighteen. " +
  "Twenty, fifteen, twenty three, five, eighteen. " +
  "Nineteen, twenty, one, twenty five. " +
  "One four one zero. Zero three one four.";

// Map spelled-out number words to their integer value (1..26 for A..Z,
// plus 0, 4, 14, 15 needed to spell out "1410" and "0314").
const WORD_TO_NUM: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  "twenty-one": 21,
  "twenty-two": 22,
  "twenty-three": 23,
  "twenty-four": 24,
  "twenty-five": 25,
  "twenty-six": 26,
};

/**
 * Decode a broadcast numbers string.
 *
 * The text is divided into sentences by ".". Each sentence contains
 * comma-separated number words. Each comma-delimited token may span
 * one word ("one", "eighteen") or two words ("twenty three" = 23).
 * Only 1..26 values map to letters (A..Z); others are skipped.
 * "Attention" and non-number tokens are skipped.
 *
 * Returns an array of decoded words (one per sentence that contains letters).
 */
export function decodeNumbers(text: string): string[] {
  // Split into sentences on "."
  const sentences = text
    .toLowerCase()
    .split(".")
    .map((s) => s.trim())
    .filter(Boolean);

  const words: string[] = [];

  for (const sentence of sentences) {
    // Split sentence on commas to get individual number tokens.
    const tokens = sentence
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const letters: string[] = [];
    for (const token of tokens) {
      // Each token may be one or two words.
      const parts = token.split(/\s+/).filter(Boolean);
      let val: number | undefined;

      if (parts.length === 2) {
        // Try "twenty-<second>" (e.g. "twenty three" -> "twenty-three").
        const combined = `${parts[0]}-${parts[1]}`;
        if (combined in WORD_TO_NUM) {
          val = WORD_TO_NUM[combined];
        }
      } else if (parts.length === 1) {
        val = WORD_TO_NUM[parts[0]];
      }
      // 3+ word tokens: skip (unexpected).

      if (val !== undefined && val >= 1 && val <= 26) {
        letters.push(String.fromCharCode(64 + val));
      }
    }

    if (letters.length > 0) {
      words.push(letters.join(""));
    }
  }

  return words;
}

// ---------------------------------------------------------------------------
// Hour-start helper
// ---------------------------------------------------------------------------

/**
 * UTC ms of the start of the current LA hour for `atMs`.
 *
 * Uses the already-correct laPartsOf via stationHourOf plus straight
 * arithmetic: subtract the elapsed minutes and seconds within the hour.
 *
 * We need minute and second, not just hour, so we build them with the same
 * Intl approach used in tzoffsets.ts rather than duplicating formatters.
 */
const _minuteFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  minute: "2-digit",
});
const _secondFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  second: "2-digit",
});

function laMinuteOf(utcMs: number): number {
  return parseInt(_minuteFmt.format(new Date(utcMs)), 10);
}

function laSecondOf(utcMs: number): number {
  return parseInt(_secondFmt.format(new Date(utcMs)), 10);
}

/**
 * UTC ms of 00:mm:00 -> 00:00:00 on the current LA hour.
 * Result may have sub-ms if atMs has sub-ms; callers floor to ms themselves.
 */
function stationHourStartMs(atMs: number): number {
  const min = laMinuteOf(atMs);
  const sec = laSecondOf(atMs);
  const subSec = atMs % 1000;
  return atMs - (min * 60 + sec) * 1000 - subSec;
}

/**
 * UTC ms of 03:14:00.000 LA on the day that contains atMs.
 *
 * Rather than finding midnight (which is ambiguous on DST fall-back days),
 * we use the hour-start of the current LA hour (which must be hour 3 when
 * this is called) and add 14 minutes. stationHourStartMs correctly strips
 * sub-hour time using Intl, so it handles both PST and PDT.
 */
function la0314StartMs(atMs: number): number {
  // stationHourStartMs gives us the start of the current LA hour.
  // When called from the last_minute check we know stationHourOf(atMs) === 3.
  // Add 14 minutes to get 03:14:00.
  return stationHourStartMs(atMs) + 14 * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Floor-mod (handles negative dividends)
// ---------------------------------------------------------------------------

function floorMod(x: number, m: number): number {
  return ((x % m) + m) % m;
}

// ---------------------------------------------------------------------------
// Loop mode
// ---------------------------------------------------------------------------

function resolveLoop(
  station: HuntStation,
  atMs: number,
  epochMs: number,
  strength: number
): SignalResult {
  const totalMs = station.clips.reduce((s, c) => s + c.seconds * 1000, 0);
  const phase = floorMod(atMs - epochMs, totalMs);

  let acc = 0;
  for (const clip of station.clips) {
    const clipMs = clip.seconds * 1000;
    if (phase < acc + clipMs) {
      const offsetMs = phase - acc;
      return {
        page: station.page,
        clipId: clip.id,
        file: clip.file,
        offsetMs,
        remainingMs: clipMs - offsetMs,
        strength,
      };
    }
    acc += clipMs;
  }

  // Unreachable if totalMs > 0, but satisfy the compiler.
  const last = station.clips[station.clips.length - 1];
  const clipMs = last.seconds * 1000;
  return {
    page: station.page,
    clipId: last.id,
    file: last.file,
    offsetMs: clipMs - 1,
    remainingMs: 1,
    strength,
  };
}

// ---------------------------------------------------------------------------
// Hourly mode
// ---------------------------------------------------------------------------

function resolveHourly(
  station: HuntStation,
  atMs: number,
  strength: number
): SignalResult {
  const laHour = stationHourOf(atMs);
  const clipIndex = laHour % station.clips.length;
  const clip = station.clips[clipIndex];

  const hourStartMs = stationHourStartMs(atMs);
  const msIntoHour = atMs - hourStartMs;
  const clipMs = clip.seconds * 1000;
  const offsetMs = floorMod(msIntoHour, clipMs);

  return {
    page: station.page,
    clipId: clip.id,
    file: clip.file,
    offsetMs,
    remainingMs: clipMs - offsetMs,
    strength,
  };
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

/**
 * Return what is playing on a hidden station at `freqKHz` at time `atMs`.
 *
 * Returns null when:
 * - any input is not finite
 * - no station is within lock_khz of freqKHz
 * - freqKHz is 1714 (handled by /now)
 */
export function signalAt(
  hunt: HuntConfig,
  freqKHz: number,
  atMs: number,
  epochMs: number
): SignalResult | null {
  // Guard: bad inputs.
  if (
    !Number.isFinite(freqKHz) ||
    !Number.isFinite(atMs) ||
    !Number.isFinite(epochMs)
  ) {
    return null;
  }

  // 1714 is the main station, not a hunt station.
  if (freqKHz === 1714) return null;

  // Find closest station within lock_khz.
  let best: HuntStation | null = null;
  let bestDiff = Infinity;
  for (const st of hunt.stations) {
    const diff = Math.abs(freqKHz - st.freq);
    if (diff <= hunt.lock_khz && diff < bestDiff && st.clips.length > 0) {
      best = st;
      bestDiff = diff;
    }
  }
  if (!best) return null;

  const strength = 1 - bestDiff / hunt.lock_khz;

  // Last-minute override: applies only when the matched station's freq equals
  // last_minute.freq AND LA time is 03:14:xx.
  if (best.freq === hunt.last_minute.freq) {
    const laHour = stationHourOf(atMs);
    const laMin = laMinuteOf(atMs);
    if (laHour === 3 && laMin === 14) {
      const top314 = la0314StartMs(atMs);
      const offsetMs = atMs - top314;
      const clipMs = hunt.last_minute.clip.seconds * 1000;
      // Safety clamp: offsetMs must be in [0, clipMs).
      const safeOffset = Math.max(0, Math.min(offsetMs, clipMs - 1));
      return {
        page: hunt.last_minute.page,
        clipId: hunt.last_minute.clip.id,
        file: hunt.last_minute.clip.file,
        offsetMs: safeOffset,
        remainingMs: clipMs - safeOffset,
        strength,
      };
    }
  }

  // Normal dispatch.
  if (best.mode === "loop") {
    return resolveLoop(best, atMs, epochMs, strength);
  }
  return resolveHourly(best, atMs, strength);
}
