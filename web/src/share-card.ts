// What goes on the share card. Pure data, no canvas, so it can be tested.
// Spoiler rule: how many pages, never which or where. Every mark is just found or not.
// Never a page title, hidden frequency, flavor text, hint, or how to find a page.
import { PAGES, type Page } from './logbook.js';

export interface ShareMark {
  n: number;
  found: boolean;
}

export interface ShareCardData {
  station: string;
  band: string;
  summary: string;
  marks: ShareMark[];
  footer: string;
  site: string;
  shareText: string;
}

export const SHARE_SITE = 'deadair.nohumannearby.com';

export function buildShareCard(foundIds: Iterable<string>, finale = false, pages: readonly Page[] = PAGES): ShareCardData {
  const found = new Set(foundIds);
  const marks: ShareMark[] = pages.map((p, i) => ({ n: i + 1, found: found.has(p.id) }));
  const count = marks.filter((m) => m.found).length;
  const summary = `${count} of ${pages.length} pages found`;
  return {
    station: 'DEAD AIR',
    band: '1714 AM',
    summary,
    marks,
    footer: finale ? 'Everyone made it out.' : 'Tune in to 1714. Something is out there.',
    site: SHARE_SITE,
    shareText: `I found ${count} of ${pages.length} pages in the DEAD AIR logbook. https://${SHARE_SITE}`,
  };
}
