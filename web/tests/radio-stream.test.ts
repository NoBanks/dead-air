import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A tiny stand-in for HTMLAudioElement. jsdom does not play media.
class FakeAudio extends EventTarget {
  static last: FakeAudio;
  preload = '';
  src = '';
  muted = false;
  paused = true;
  currentTime = 0;
  readyState = 0;
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
  load = vi.fn();
  removeAttribute = vi.fn();
  constructor() {
    super();
    FakeAudio.last = this;
  }
}

describe('radio-stream', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubGlobal('Audio', FakeAudio);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('radioOff() cancels a pending retry timer', async () => {
    const { radioOn, radioOff } = await import('../src/radio-stream.js');
    await radioOn();
    const audio = FakeAudio.last;
    const playsBefore = audio.play.mock.calls.length;
    audio.dispatchEvent(new Event('stalled')); // arms the 2 s retry
    expect(vi.getTimerCount()).toBe(1);
    radioOff();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(audio.play.mock.calls.length).toBe(playsBefore); // nothing came back on
  });

  it('retries after a stall while the radio is wanted', async () => {
    const { radioOn } = await import('../src/radio-stream.js');
    await radioOn();
    const audio = FakeAudio.last;
    const playsBefore = audio.play.mock.calls.length;
    audio.dispatchEvent(new Event('stalled'));
    vi.advanceTimersByTime(2000);
    expect(audio.play.mock.calls.length).toBe(playsBefore + 1);
  });
});
