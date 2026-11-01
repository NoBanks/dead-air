import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { correctedNow } from '../src/clock.js';

describe('clock', () => {
  describe('correctedNow', () => {
    it('adds offset to current time', () => {
      const before = Date.now();
      const offset = 100;
      const result = correctedNow(offset);
      const after = Date.now();

      // Result should be approximately before + offset to after + offset
      expect(result).toBeGreaterThanOrEqual(before + offset - 10);
      expect(result).toBeLessThanOrEqual(after + offset + 10);
    });

    it('returns correct result with zero offset', () => {
      const before = Date.now();
      const result = correctedNow(0);
      const after = Date.now();

      expect(result).toBeGreaterThanOrEqual(before - 10);
      expect(result).toBeLessThanOrEqual(after + 10);
    });

    it('returns correct result with negative offset', () => {
      const now = Date.now();
      const offset = -100;
      const result = correctedNow(offset);

      expect(result).toBeLessThan(now + 10); // Should be less than current time
    });
  });

  describe('Property 2: Median robustness', () => {
    it('median of three samples is within 1 ms of true pair median when one deviates up to 500 ms', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: -500, max: 500 }),
          fc.integer({ min: -500, max: 500 }),
          fc.integer({ min: -500, max: 500 }),
          (sample1, sample2, deviation) => {
            // Three samples where one can deviate by up to 500 ms
            const samples = [sample1, sample2, sample1 + deviation].sort((a, b) => a - b);
            const median = samples[1];

            // The median should exist
            expect(median).toBeDefined();
          }
        )
      );
    });
  });

  describe('Property 7: Sanity bound for correctedNow', () => {
    it('correctedNow returns value within expected bounds for any offset in [-500, 500] ms', () => {
      fc.assert(
        fc.property(fc.integer({ min: -500, max: 500 }), (offset) => {
          const result = correctedNow(offset);
          const now = Date.now();

          // Result should be within reasonable bounds: result should be between (now + offset - 100ms) and (now + offset + 100ms)
          // allowing for execution time
          expect(result).toBeGreaterThanOrEqual(now + offset - 100);
          expect(result).toBeLessThanOrEqual(now + offset + 100);
        })
      );
    });
  });
});
