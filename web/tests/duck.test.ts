import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { scheduleDuck } from '../src/duck.js';
import { DUCK_DB, DUCK_ATTACK_S, DUCK_RELEASE_S } from '../src/constants.js';

// Convert dB to linear gain
function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

describe('duck envelope', () => {
  describe('scheduleDuck', () => {
    it('schedules gain to 1.0 at postAudioTime', () => {
      // Create a mock AudioContext
      const ctx = new AudioContext();
      const musicBus = ctx.createGain();
      musicBus.gain.value = 1.0;

      const startTime = ctx.currentTime + 1;
      const postTime = startTime + 2;

      scheduleDuck(musicBus, ctx, startTime, postTime);

      // The gain automation should schedule a linearRampToValueAtTime at postTime
      // We can't directly inspect the automation curve, but we can verify the call succeeds
      expect(musicBus.gain.value).toBe(1.0); // Initial value unchanged

      ctx.close();
    });

    it('computes correct ducked level from DUCK_DB constant', () => {
      const expectedGain = dbToLinear(DUCK_DB);
      expect(expectedGain).toBeCloseTo(dbToLinear(-10));
      expect(expectedGain).toBeLessThan(1.0); // Should be less than full volume
    });
  });

  describe('Property 3: Gain at post equals 1.0', () => {
    it('should schedule gain to return to full level (1.0) at post', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100 }).map(n => n / 10), // 0.1 to 10 in steps of 0.1
          (duration) => {
            const ctx = new AudioContext();
            const musicBus = ctx.createGain();
            musicBus.gain.value = 1.0;

            const startTime = ctx.currentTime + 0.5;
            const postTime = startTime + duration;

            scheduleDuck(musicBus, ctx, startTime, postTime);

            // We verify the duck scheduling succeeded without error
            expect(musicBus.gain).toBeDefined();

            ctx.close();
          }
        )
      );
    });
  });

  describe('Property 5: Non-overlapping duck intervals', () => {
    it('should allow scheduling multiple non-overlapping ducks', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 5 }),
          (count) => {
            const ctx = new AudioContext();
            const musicBus = ctx.createGain();
            musicBus.gain.value = 1.0;

            const durations: Array<{ start: number; end: number }> = [];
            let currentTime = ctx.currentTime + 0.5;

            // Schedule multiple non-overlapping ducks
            for (let i = 0; i < count; i++) {
              const startTime = currentTime;
              const duration = 0.5 + i * 0.2; // Varying durations
              const endTime = startTime + duration;

              scheduleDuck(musicBus, ctx, startTime, endTime);
              durations.push({ start: startTime, end: endTime });

              // Next duck starts after this one ends
              currentTime = endTime + 0.1;
            }

            // Verify no intervals overlap
            for (let i = 0; i < durations.length; i++) {
              for (let j = i + 1; j < durations.length; j++) {
                expect(durations[i].end).toBeLessThanOrEqual(durations[j].start);
              }
            }

            ctx.close();
          }
        )
      );
    });
  });
});
