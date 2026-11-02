/** QA pass: checkSignal with fetch mocked. Never touches the network. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let checkSignal: (f: number) => Promise<boolean>;

beforeEach(async () => {
  vi.resetModules();
  ({ checkSignal } = await import('../src/signal.js'));
});
afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, ok = true) => ({ ok, json: async () => body });

describe('checkSignal', () => {
  it('always trusts 1714 without fetching', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    expect(await checkSignal(1714)).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });

  it('returns the server answer and caches it', async () => {
    const f = vi.fn().mockResolvedValue(json({ locked: true })); vi.stubGlobal('fetch', f);
    expect(await checkSignal(1410)).toBe(true);
    expect(await checkSignal(1410)).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe('/signal?f=1410');
  });

  it('treats a non-ok response as static and caches it', async () => {
    const f = vi.fn().mockResolvedValue(json({}, false)); vi.stubGlobal('fetch', f);
    expect(await checkSignal(900)).toBe(false);
    expect(await checkSignal(900)).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('survives a network error and retries after the 30s window', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = vi.fn().mockRejectedValue(new Error('offline')); vi.stubGlobal('fetch', f);
    expect(await checkSignal(800)).toBe(false);
    expect(await checkSignal(800)).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_001);
    await checkSignal(800);
    expect(f).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
