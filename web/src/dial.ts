import { FREQ_MIN, FREQ_MAX, DRAG_FACTOR } from './constants.js';
import type { DialState } from './types.js';

/**
 * Map frequency to normalized [0, 1] position
 */
export function freqToPosition(freq: number): number {
  return (freq - FREQ_MIN) / (FREQ_MAX - FREQ_MIN);
}

/**
 * Map normalized position back to frequency
 */
export function positionToFreq(pos: number): number {
  return pos * (FREQ_MAX - FREQ_MIN) + FREQ_MIN;
}

/**
 * Map pixel delta to frequency delta
 */
export function pixelDeltaToFreqDelta(px: number): number {
  return px * DRAG_FACTOR;
}

/**
 * Bind dial input handlers to an element
 * @param el - The dial element (slider)
 * @param state - The dial state object
 * @param onChange - Callback fired when frequency changes, with the new frequency
 */
export function bindDial(
  el: HTMLElement,
  state: DialState,
  onChange: (freq: number) => void
): void {
  let dragging = false;
  let lastX = 0;

  const clamp = (f: number): number => Math.min(FREQ_MAX, Math.max(FREQ_MIN, f));

  const updateFreq = (newFreq: number): void => {
    state.freqKHz = clamp(newFreq);
    el.setAttribute('aria-valuenow', String(Math.round(state.freqKHz)));
    onChange(state.freqKHz);
  };

  // Pointer drag handling
  el.addEventListener('pointerdown', (e: PointerEvent) => {
    dragging = true;
    lastX = e.clientX;
    el.setPointerCapture(e.pointerId);
    
    // Tap-to-jump on initial click
    const rect = el.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const jumpFreq = FREQ_MIN + ratio * (FREQ_MAX - FREQ_MIN);
    updateFreq(jumpFreq);
  });

  el.addEventListener('pointermove', (e: PointerEvent) => {
    if (!dragging) return;
    const deltaFreq = pixelDeltaToFreqDelta(e.clientX - lastX);
    updateFreq(state.freqKHz + deltaFreq);
    lastX = e.clientX;
  });

  const stopDrag = (): void => {
    dragging = false;
  };
  el.addEventListener('pointerup', stopDrag);
  el.addEventListener('pointercancel', stopDrag);

  // Mouse wheel for scroll tuning
  el.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      e.preventDefault();
      const direction = Math.sign(e.deltaY);
      updateFreq(state.freqKHz + direction * 3);
    },
    { passive: false }
  );

  // Keyboard arrow keys
  el.addEventListener('keydown', (e: KeyboardEvent) => {
    let delta = 0;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      delta = e.shiftKey ? 10 : 1;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      delta = e.shiftKey ? -10 : -1;
    } else {
      return;
    }
    e.preventDefault();
    updateFreq(state.freqKHz + delta);
  });
}
