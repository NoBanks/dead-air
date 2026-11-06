import {
  PAGES,
  TOWN_ADS,
  foundCount,
  foundInfo,
  isFound,
  adsHeard,
  numbersHeard,
  finaleDone,
  onLogbookChange,
  type Page,
} from './logbook.js';
import { buildShareCard, type ShareCardData } from './share-card.js';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

function stationTime(ms: number): string {
  return new Date(ms).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function pageCard(p: Page, n: number): HTMLElement {
  const card = el('article', 'lb-page' + (isFound(p.id) ? ' found' : ''));
  card.append(el('div', 'lb-num', String(n).padStart(2, '0')));
  if (!isFound(p.id)) {
    card.append(el('div', 'lb-smudge'));
    card.append(el('div', 'lb-hint', p.hint));
    if (p.id === 'three-fourteen' && numbersHeard()) card.append(el('div', 'lb-torn', 'A=1'));
    if (p.id === 'town' && adsHeard().length) {
      card.append(el('div', 'lb-hint', `${adsHeard().length} of ${Object.keys(TOWN_ADS).length} sponsors heard`));
    }
    return card;
  }
  const info = foundInfo(p.id)!;
  card.append(el('h3', 'lb-title', p.title));
  card.append(el('p', 'lb-entry', p.entry));
  if (p.id === 'town') {
    const ul = el('ul', 'lb-town');
    for (const id of adsHeard()) ul.append(el('li', '', TOWN_ADS[id]));
    card.append(ul);
  }
  card.append(el('div', 'lb-when', `logged ${stationTime(info.at)}${p.id === 'town' ? '' : `, ${info.freq} on the dial`}`));
  return card;
}

/** A spoiler-free PNG: how many pages, never where. Content comes from buildShareCard. */
function drawShareCard(card: ShareCardData): HTMLCanvasElement {
  const W = 1200, H = 630;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const mono = '"Special Elite", monospace';
  const sans = '"Oswald", system-ui, sans-serif';
  const AMBER = '#ff7a1a', DIM = '#6b3a12', INK = '#e9e3d4', MUTED = '#7f7a70';

  g.fillStyle = '#050607';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#0f1112';
  g.fillRect(30, 30, W - 60, H - 60);
  g.strokeStyle = '#23272a';
  g.lineWidth = 2;
  g.strokeRect(30, 30, W - 60, H - 60);

  g.textBaseline = 'alphabetic';
  g.fillStyle = AMBER;
  g.font = `600 88px ${sans}`;
  g.fillText(card.station, 80, 140);
  g.font = `44px ${mono}`;
  g.fillText(card.band, 80, 195);
  g.fillStyle = INK;
  g.font = `38px ${mono}`;
  g.textAlign = 'right';
  g.fillText(card.summary, W - 80, 140);
  g.textAlign = 'left';

  card.marks.forEach((m, i) => {
    const x = 80 + (i % 4) * 265, y = 235 + Math.floor(i / 4) * 150;
    g.lineWidth = 3;
    g.strokeStyle = m.found ? AMBER : DIM;
    g.strokeRect(x, y, 235, 125);
    g.fillStyle = m.found ? 'rgba(255,122,26,0.12)' : 'rgba(0,0,0,0)';
    g.fillRect(x, y, 235, 125);
    g.fillStyle = m.found ? AMBER : MUTED;
    g.font = `20px ${mono}`;
    g.fillText(String(m.n).padStart(2, '0'), x + 14, y + 30);
    if (m.found) {
      g.fillStyle = INK;
      g.font = `26px ${mono}`;
      g.fillText('LOGGED', x + 14, y + 80);
    }
  });

  g.fillStyle = MUTED;
  g.font = `26px ${mono}`;
  g.fillText(card.footer, 80, 570);
  g.textAlign = 'right';
  g.fillText(card.site, W - 80, 570);
  return c;
}

async function shareCard(): Promise<void> {
  const card = buildShareCard(PAGES.filter((p) => isFound(p.id)).map((p) => p.id), finaleDone());
  await Promise.all([
    document.fonts.load('40px "Special Elite"'),
    document.fonts.load('600 40px "Oswald"'),
  ]).catch(() => undefined);
  const c = drawShareCard(card);
  const blob: Blob | null = await new Promise((r) => c.toBlob(r, 'image/png'));
  if (!blob) return;
  const file = new File([blob], 'dead-air-logbook.png', { type: 'image/png' });
  const text = card.shareText;
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text });
      return;
    }
  } catch {
    // Share sheet dismissed: fall through to a download.
  }
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function mountLogbook(): void {
  const open = el('button', 'btn ghost lb-open');
  open.type = 'button';
  const radio = document.getElementById('radio')!;
  radio.after(open);

  const dlg = el('dialog', 'lb');
  dlg.setAttribute('aria-label', 'Logbook');
  document.body.append(dlg);

  const toast = el('div', 'lb-toast');
  toast.setAttribute('role', 'status');
  document.body.append(toast);

  const label = (): void => {
    open.textContent = `LOGBOOK  ${foundCount()} / ${PAGES.length}`;
  };

  const render = (): void => {
    dlg.replaceChildren();
    const head = el('header', 'lb-head');
    head.append(el('h2', '', 'LOGBOOK'), el('span', 'lb-count', `${foundCount()} of ${PAGES.length}`));
    const close = el('button', 'lb-x', 'CLOSE');
    close.type = 'button';
    close.onclick = () => dlg.close();
    head.append(close);
    dlg.append(head);
    if (finaleDone()) {
      const post = el('div', 'lb-postcard');
      post.append(el('div', 'lb-post-big', 'Ember Hollow.'), el('div', '', 'Everyone made it out.'));
      dlg.append(post);
    }
    const grid = el('div', 'lb-grid');
    PAGES.forEach((p, i) => grid.append(pageCard(p, i + 1)));
    dlg.append(grid);
    const share = el('button', 'btn lb-share', 'SHARE LOGBOOK');
    share.type = 'button';
    share.onclick = () => void shareCard();
    dlg.append(share);
  };

  open.onclick = () => {
    render();
    dlg.showModal();
  };

  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  onLogbookChange((page) => {
    label();
    if (dlg.open) render();
    if (!page) return;
    toast.textContent = `Logbook: "${page.title}" written down. (${foundCount()} of ${PAGES.length})`;
    toast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 4500);
  });
  label();
}
