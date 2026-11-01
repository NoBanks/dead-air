/**
 * Timezone helpers for America/Los_Angeles.
 *
 * Uses Intl.DateTimeFormat (available in Node >= 13 and Cloudflare Workers).
 *
 * America/Los_Angeles is always UTC-8 (PST) or UTC-7 (PDT).
 * DST transitions happen at 02:00 local on:
 *   spring-forward: second Sunday of March (02:00 → 03:00, 23 h day)
 *   fall-back:      first Sunday of November (02:00 → 01:00, 25 h day)
 *
 * Key invariant: all return values are exact UTC-second boundaries (ms % 1000 === 0).
 */

const TZ = "America/Los_Angeles";

// ---------------------------------------------------------------------------
// Core: extract LA wall-clock parts for any UTC ms.
// ---------------------------------------------------------------------------

interface LAParts {
  year: number;
  month: number; // 1–12
  day: number;   // 1–31
  hour: number;  // 0–23
  minute: number;
  second: number;
}

// Individual part formatters: more reliable than parsing a full format string.
const _yearFmt   = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year:   "numeric"  });
const _monthFmt  = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month:  "2-digit"  });
const _dayFmt    = new Intl.DateTimeFormat("en-US", { timeZone: TZ, day:    "2-digit"  });
const _hourFmt   = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour:   "2-digit", hour12: false });
const _minuteFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, minute: "2-digit"  });
const _secondFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, second: "2-digit"  });

function laPartsOf(utcMs: number): LAParts {
  // Round down to the nearest second so sub-ms noise doesn't affect the result.
  const t = utcMs - (utcMs % 1000);
  const d = new Date(t);
  const rawHour = parseInt(_hourFmt.format(d), 10);
  return {
    year:   parseInt(_yearFmt.format(d),   10),
    month:  parseInt(_monthFmt.format(d),  10),
    day:    parseInt(_dayFmt.format(d),    10),
    hour:   rawHour === 24 ? 0 : rawHour,
    minute: parseInt(_minuteFmt.format(d), 10),
    second: parseInt(_secondFmt.format(d), 10),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** LA hour-of-day (0–23) for a UTC instant. */
export function stationHourOf(utcMs: number): number {
  return laPartsOf(utcMs).hour;
}

/**
 * UTC ms of 00:00:00 LA on the calendar day that contains utcMs.
 * Result is always a multiple of 1000 (whole second).
 */
export function stationDayStart(utcMs: number): number {
  const p = laPartsOf(utcMs);
  return laMidnightUtc(p.year, p.month, p.day);
}

/**
 * UTC ms of 00:00:00 LA on the NEXT calendar day after utcMs.
 * Result is always a multiple of 1000.
 */
export function stationDayEnd(utcMs: number): number {
  // +28 h moves us safely into the next LA day even across DST.
  const inNextLaDay = stationDayStart(utcMs) + 28 * 3_600_000;
  return stationDayStart(inNextLaDay);
}

/**
 * Integer index of the LA calendar day from epochMs.
 * O(1): nominal arithmetic + ≤2 boundary corrections.
 */
export function stationDayIndex(utcMs: number, epochMs: number): number {
  const epochDayStart = stationDayStart(epochMs);
  if (utcMs < epochDayStart) return -1;

  const nominal = Math.floor((utcMs - epochDayStart) / 86_400_000);

  for (const d of [nominal - 2, nominal - 1, nominal, nominal + 1, nominal + 2, nominal + 3]) {
    if (d < 0) continue;
    const s = stationDayStartByIndex(d, epochMs);
    const e = stationDayEnd(s + 3_600_000);
    if (utcMs >= s && utcMs < e) return d;
  }

  // Wider search for times far from epoch (accumulation of DST drift).
  for (let delta = -7; delta <= 7; delta++) {
    const d = nominal + delta;
    if (d < 0) continue;
    const s = stationDayStartByIndex(d, epochMs);
    const e = stationDayEnd(s + 3_600_000);
    if (utcMs >= s && utcMs < e) return d;
  }

  // Should never reach here for reasonable inputs.
  throw new Error(`stationDayIndex: no day found for utcMs=${utcMs}, epochMs=${epochMs}`);
}

/**
 * UTC ms of the start of station day d (counted from epochMs).
 *
 * Each LA calendar day can be 23, 24 or 25 h due to DST.
 * We can't simply multiply by 86_400_000 because the cumulative drift
 * reaches ±1h by the end of a DST period.
 *
 * Strategy: compute the number of DST transitions between epoch and d to
 * adjust the nominal offset, then snap to LA midnight.
 *
 * Faster alternative used here: start from a UTC estimate that's guaranteed
 * to land INSIDE the target LA day (not before its midnight, not in the next
 * day), then snap.
 *
 * Guarantee: `epochDayStart + d * 86_400_000 + 90_000_000` adds 25h on top
 * of the nominal jump, overshooting at most 2h past the target day's noon.
 * `stationDayStart` of any time from noon to 23:59:59 on the target day
 * returns that day's midnight exactly.
 *
 * Actually the safest point is noon of the target day. We find noon by:
 *   nominal = epochDayStart + d * 86_400_000
 *   At DST boundaries nominal can be up to 1h off. Adding 13h to nominal
 *   gives a point roughly 12h into the target day (noon), which is safe.
 */
export function stationDayStartByIndex(dayIndex: number, epochMs: number): number {
  const epochDayStart = stationDayStart(epochMs);
  // Add (d * 24 + 13) hours — enough to land near noon of the target day
  // even with ±2h DST drift accumulated over many years.
  const roughNoon = epochDayStart + dayIndex * 86_400_000 + 13 * 3_600_000;
  return stationDayStart(roughNoon);
}

// ---------------------------------------------------------------------------
// laMidnightUtc: find exact UTC second of 00:00:00 LA on (year, month, day).
//
// Strategy:
//   LA is UTC-7 (PDT) or UTC-8 (PST).
//   So LA midnight is UTC midnight - offset, i.e. UTC 07:00 or UTC 08:00.
//   We try both candidates and validate with Intl.
// ---------------------------------------------------------------------------
function laMidnightUtc(year: number, month: number, day: number): number {
  // Compute UTC midnight of that Gregorian date.
  const utcMidnight = Date.UTC(year, month - 1, day); // month is 1-based

  // Candidates: UTC midnight + 7h and + 8h (the two possible offsets).
  for (const offsetH of [7, 8]) {
    const candidate = utcMidnight + offsetH * 3_600_000;
    const p = laPartsOf(candidate);
    if (
      p.year === year &&
      p.month === month &&
      p.day === day &&
      p.hour === 0 &&
      p.minute === 0 &&
      p.second === 0
    ) {
      return candidate;
    }
  }

  // On DST transition days the standard offsets may not apply at midnight
  // (midnight is always standard time: PST is UTC-8 in winter, PDT UTC-7
  // in summer). The two candidates above cover all cases for LA.
  // Fallback: scan ±1 second around the candidates.
  for (const offsetH of [7, 8]) {
    const base = utcMidnight + offsetH * 3_600_000;
    for (const delta of [-1000, 0, 1000]) {
      const candidate = base + delta;
      const p = laPartsOf(candidate);
      if (
        p.year === year &&
        p.month === month &&
        p.day === day &&
        p.hour === 0 &&
        p.minute === 0 &&
        p.second === 0
      ) {
        return candidate;
      }
    }
  }

  throw new Error(
    `laMidnightUtc: could not find midnight for ` +
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  );
}
