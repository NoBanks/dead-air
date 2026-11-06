import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { PAGES } from '../src/logbook.js';
import { buildShareCard } from '../src/share-card.js';

const ids = PAGES.map((p) => p.id);

describe('share card data', () => {
  it('counts found pages and lists all eight marks', () => {
    const card = buildShareCard(['marty', 'rink']);
    expect(card.station).toBe('DEAD AIR');
    expect(card.band).toBe('1714 AM');
    expect(card.summary).toBe('2 of 8 pages found');
    expect(card.marks).toHaveLength(8);
    expect(card.marks.filter((m) => m.found)).toHaveLength(2);
  });

  it('shows the finale line only after the finale', () => {
    expect(buildShareCard(ids, true).footer).toBe('Everyone made it out.');
    expect(buildShareCard(ids, false).footer).toBe('Tune in to 1714. Something is out there.');
  });

  it('ignores ids that are not pages', () => {
    expect(buildShareCard(['nope', 'marty']).summary).toBe('1 of 8 pages found');
  });

  it('never carries a frequency other than 1714, a page title, flavor text, or a hint', () => {
    fc.assert(
      fc.property(fc.subarray(ids), fc.boolean(), (found, finale) => {
        const text = JSON.stringify(buildShareCard(found, finale));
        // Any run of 3+ digits must be 1714.
        for (const run of text.match(/\d{3,}/g) ?? []) expect(run).toBe('1714');
        for (const p of PAGES) {
          expect(text.includes(p.title)).toBe(false);
          expect(text.includes(p.entry)).toBe(false);
          expect(text.includes(p.hint)).toBe(false);
        }
      }),
    );
  });
});
