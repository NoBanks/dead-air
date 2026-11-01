import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

// logbook.ts reads storage at import time, so each test gets a fresh module.
async function fresh() {
  vi.resetModules();
  return import('../src/logbook.js');
}

describe('Logbook', () => {
  beforeEach(() => localStorage.clear());

  it('records a page once and counts it', async () => {
    const lb = await fresh();
    expect(lb.record('old-station', 1410)).toBe(true);
    expect(lb.record('old-station', 1411)).toBe(false);
    expect(lb.foundCount()).toBe(1);
    expect(lb.record('not-a-page', 1)).toBe(false);
  });

  it('survives a reload through localStorage', async () => {
    (await fresh()).record('marty', 870);
    expect((await fresh()).isFound('marty')).toBe(true);
  });

  it('fills the Town page only after all six sponsor ads are heard', async () => {
    const lb = await fresh();
    const ads = Object.keys(lb.TOWN_ADS);
    ads.slice(0, 5).forEach((a) => lb.heardAd(a));
    lb.heardAd(ads[0]);
    expect(lb.isFound('town')).toBe(false);
    lb.heardAd(ads[5]);
    expect(lb.isFound('town')).toBe(true);
  });

  it('the finale is due once, only when every page is found', async () => {
    const lb = await fresh();
    lb.PAGES.slice(0, -1).forEach((p) => lb.record(p.id, 1));
    expect(lb.finaleDue()).toBe(false);
    lb.record(lb.PAGES[lb.PAGES.length - 1].id, 1);
    expect(lb.finaleDue()).toBe(true);
    lb.markFinale();
    expect(lb.finaleDue()).toBe(false);
  });

  it('two tabs merge progress instead of overwriting each other', async () => {
    const tabA = await fresh();
    const tabB = await fresh(); // loaded before A finds anything
    tabA.record('marty', 870);
    tabB.heardNumbers(); // B saves with its stale memory
    expect((await fresh()).isFound('marty')).toBe(true);
    expect((await fresh()).numbersHeard()).toBe(true);
  });

  it('still works when storage throws (private windows)', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const lb = await fresh();
    expect(lb.record('bulletin', 1031)).toBe(true);
    spy.mockRestore();
  });
});

describe('Spoiler rule', () => {
  it('no hidden frequency appears in the web source', () => {
    const dir = resolve(__dirname, '..', 'src');
    const hidden = ['1410', '870', '1031', '540', '710', '666'];
    for (const f of readdirSync(dir)) {
      const src = readFileSync(resolve(dir, f), 'utf-8');
      for (const h of hidden) {
        expect(new RegExp(`\\b${h}\\b`).test(src), `${h} found in web/src/${f}`).toBe(false);
      }
    }
  });
});
