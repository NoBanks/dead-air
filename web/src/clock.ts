/**
 * Estimate the server clock offset using NTP-style round-trip timing
 * Sends three sequential GET /now requests and returns the median offset
 */
export async function estimateOffset(): Promise<number> {
  const offsets: number[] = [];

  for (let i = 0; i < 3; i++) {
    const t1 = Date.now();
    try {
      const response = await fetch('/now');
      const t4 = Date.now();
      // The station's /now sends "server_time" (ms); a missing field would make every offset NaN
      const data = await response.json() as { server_time: number };
      const serverTime = data.server_time;
      const rtt = t4 - t1;
      const offset = serverTime - t1 - rtt / 2;
      if (Number.isFinite(offset)) offsets.push(offset);
    } catch (e) {
      // If a fetch fails, continue to next attempt
      console.warn('estimateOffset fetch failed:', e);
    }
  }

  // Return median of offsets
  if (offsets.length === 0) {
    return 0;
  }
  offsets.sort((a, b) => a - b);
  return offsets[Math.floor(offsets.length / 2)];
}

/**
 * Return the current time corrected by the offset
 */
export function correctedNow(offset: number): number {
  return Date.now() + offset;
}

/**
 * Start a resync loop that updates the offset every 60 seconds
 * @param onOffset - Callback fired on hard resync (offset delta >= 250 ms)
 */
export function startResyncLoop(onOffset: (offset: number) => void): () => void {
  let currentOffset = 0;
  let resyncTimer: NodeJS.Timeout | null = null;

  const RESYNC_INTERVAL_MS = 60 * 1000;
  const DRIFT_THRESHOLD_MS = 250;
  const SMOOTH_DURATION_MS = 10 * 1000;

  const doResync = async (): Promise<void> => {
    try {
      const newOffset = await estimateOffset();
      const delta = Math.abs(newOffset - currentOffset);

      if (delta < DRIFT_THRESHOLD_MS) {
        // Smooth drift correction over 10 seconds
        const startOffset = currentOffset;
        const startTime = Date.now();
        const smoothInterval = setInterval(() => {
          const elapsed = Date.now() - startTime;
          if (elapsed >= SMOOTH_DURATION_MS) {
            currentOffset = newOffset;
            clearInterval(smoothInterval);
          } else {
            const progress = elapsed / SMOOTH_DURATION_MS;
            currentOffset = startOffset + (newOffset - startOffset) * progress;
          }
        }, 100);
      } else {
        // Hard resync: apply immediately
        currentOffset = newOffset;
        onOffset(newOffset);
      }
    } catch (e) {
      console.warn('Resync failed:', e);
    }
  };

  // Initial resync
  void doResync();

  // Set up periodic resync
  resyncTimer = setInterval(() => {
    void doResync();
  }, RESYNC_INTERVAL_MS);

  return () => {
    if (resyncTimer) clearInterval(resyncTimer);
  };
}
