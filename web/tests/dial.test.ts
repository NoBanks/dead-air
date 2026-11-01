import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { freqToPosition, positionToFreq, pixelDeltaToFreqDelta } from '../src/dial.js';
import { FREQ_MIN, FREQ_MAX, DRAG_FACTOR } from '../src/constants.js';

describe('dial geometry', () => {
  describe('freqToPosition', () => {
    it('maps FREQ_MIN to 0', () => {
      expect(freqToPosition(FREQ_MIN)).toBe(0);
    });

    it('maps FREQ_MAX to 1', () => {
      expect(freqToPosition(FREQ_MAX)).toBe(1);
    });

    it('maps 1714 (STATION_FREQ) correctly', () => {
      const pos = freqToPosition(1714);
      const expected = (1714 - FREQ_MIN) / (FREQ_MAX - FREQ_MIN);
      expect(pos).toBeCloseTo(expected);
    });

    it('maps 520 to 0', () => {
      expect(freqToPosition(520)).toBe(0);
    });

    it('maps 1740 to 1', () => {
      expect(freqToPosition(1740)).toBe(1);
    });
  });

  describe('positionToFreq', () => {
    it('maps 0 to FREQ_MIN', () => {
      expect(positionToFreq(0)).toBe(FREQ_MIN);
    });

    it('maps 1 to FREQ_MAX', () => {
      expect(positionToFreq(1)).toBe(FREQ_MAX);
    });

    it('maps 0.5 to the midpoint', () => {
      const expected = FREQ_MIN + (FREQ_MAX - FREQ_MIN) * 0.5;
      expect(positionToFreq(0.5)).toBeCloseTo(expected);
    });
  });

  describe('pixelDeltaToFreqDelta', () => {
    it('converts pixels to frequency delta using DRAG_FACTOR', () => {
      const px = 100;
      const expected = px * DRAG_FACTOR;
      expect(pixelDeltaToFreqDelta(px)).toBe(expected);
    });
  });

  describe('Property 1: Round-trip accuracy', () => {
    it('round-trip accuracy: Math.abs(positionToFreq(freqToPosition(f)) - f) < 0.001', () => {
      fc.assert(
        fc.property(fc.integer({ min: FREQ_MIN, max: FREQ_MAX }), (freq) => {
          const roundTrip = positionToFreq(freqToPosition(freq));
          expect(Math.abs(roundTrip - freq)).toBeLessThan(0.001);
        })
      );
    });
  });
});
