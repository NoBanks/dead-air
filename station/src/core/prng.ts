// Mulberry32: a pure 32-bit PRNG seeded by a single integer
// Returns a PRNG function that produces [0, 1) floats
export function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Compute a deterministic seed for a given station day
// Uses epoch ms to derive a base seed, then XORs with dayIndex
export function daySeed(epochMs: number, dayIndex: number): number {
  // Mix the epoch to produce a stable base seed
  let base = epochMs | 0;
  base = Math.imul(base ^ (base >>> 16), 0x85ebca6b);
  base ^= base >>> 13;

  // XOR with day index to ensure each day is unique
  return (base ^ dayIndex) >>> 0;
}

// Stable hash of a track ID for partitioning into two halves
// Uses a simple multiplicative hash
export function hashTrackId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    const char = id.charCodeAt(i);
    hash = ((hash << 5) - hash) ^ char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return (hash >>> 0) % 2;
}
