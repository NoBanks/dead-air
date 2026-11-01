import { DUCK_DB, DUCK_ATTACK_S, DUCK_RELEASE_S } from './constants.js';

/**
 * Convert dB to linear gain
 */
function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * Schedule a duck on musicBus starting at audioTime, releasing at postTime.
 * The gain falls to the ducked level over DUCK_ATTACK_S, then returns to 1.0
 * over DUCK_RELEASE_S, completing exactly at postTime.
 */
export function scheduleDuck(
  musicBus: GainNode,
  ctx: AudioContext,
  startAudioTime: number,
  postAudioTime: number
): void {
  const duckedGain = dbToLinear(DUCK_DB);

  // Attack: fall to ducked level using exponential ramp
  musicBus.gain.setTargetAtTime(
    duckedGain,
    startAudioTime,
    DUCK_ATTACK_S / 3 // time constant
  );

  // Release: linear ramp back to full level, ending exactly at postAudioTime
  const releaseStartTime = postAudioTime - DUCK_RELEASE_S;
  musicBus.gain.linearRampToValueAtTime(1.0, postAudioTime);
}
