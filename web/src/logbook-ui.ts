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

const SITE = 'deadair.nohumannearby.com';

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

/** A spoiler-free PNG: how many pages, never where. */
async function shareCard(): Promise<void> {
  const c = document.createElement('canvas');
  c.width = 1200;
  c.height = 630;
  const g = c.getContext('2d')!;
  await document.fonts.load('40px "Special Elite"').catch(() => undefined);
  g.fillStyle = '#e8dcc0';
  g.fillRect(0, 0, 1200, 630);
  for (let y = 120; y < 630; y += 34) {
    g.strokeStyle = 'rgba(70,90,140,0.18)';
    g.beginPath(); g.moveTo(60, y); g.lineTo(1140, y); g.stroke();
  }
  g.fillStyle = '#2a1d10';
  g.font = '64px "Special Elite", monospace';
  g.fillText('DEAD AIR LOGBOOK', 80, 110);
  g.font = '40px "Special Elite", monospace';
  const n = foundCount();
  g.fillText(`${n} of ${PAGES.length} pages found`, 80, 200);
  PAGES.forEach((p, i) => {
    const x = 80 + (i % 4) * 260, y = 250 + Math.floor(i / 4) * 150;
    g.strokeStyle = '#2a1d10';
    g.lineWidth = 3;
    g.strokeRect(x, y, 220, 120);
    if (isFound(p.id)) {
      g.fillStyle = '#ff7a1a';
      g.fillRect(x + 6, y + 6, 208, 108);
    }
  });
  g.fillStyle = '#2a1d10';
  g.font = '32px "Special Elite", monospace';
  g.fillText(finaleDone() ? 'Everyone made it out.' : 'Tune in to 1714. Something is out there.', 80, 590);
  g.textAlign = 'right';
  g.fillText(SITE, 1120, 590);

  const blob: Blob | null = await new Promise((r) => c.toBlob(r, 'image/png'));
  if (!blob) return;
  const file = new File([blob], 'dead-air-logbook.png', { type: 'image/png' });
  const text = `I found ${n} of ${PAGES.length} pages in the DEAD AIR logbook. https://${SITE}`;
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
    const share = el('button', 'btn lb-share', 'SHARE MY LOGBOOK');
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
