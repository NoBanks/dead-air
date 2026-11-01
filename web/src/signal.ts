import { STATION_FREQ } from './constants.js';

const signalCache = new Map<number, boolean>();

/**
 * Check if a frequency is a valid station
 * Results are cached for the session
 * 1714 is always trusted without a server fetch
 */
export async function checkSignal(freqKHz: number): Promise<boolean> {
  // 1714 is always trusted
  if (freqKHz === STATION_FREQ) {
    return true;
  }

  // Check cache first
  if (signalCache.has(freqKHz)) {
    return signalCache.get(freqKHz)!;
  }

  // Fetch from server
  try {
    const response = await fetch(`/signal?f=${freqKHz}`);
    if (response.ok) {
      const data = (await response.json()) as { locked: boolean };
      signalCache.set(freqKHz, data.locked);
      return data.locked;
    } else {
      // 404 or other error = not a station
      signalCache.set(freqKHz, false);
      return false;
    }
  } catch (e) {
    console.warn(`Failed to check signal for ${freqKHz}:`, e);
    // Cache the failure for 30 seconds
    signalCache.set(freqKHz, false);
    setTimeout(() => {
      signalCache.delete(freqKHz);
    }, 30000);
    return false;
  }
}
