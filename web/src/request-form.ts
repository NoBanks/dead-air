// The request line form (request-line spec F-1 to F-3). Sends only the four fields, shows Dead
// John's reply as given, and never echoes back what the caller typed.

interface Song { id: string; title: string }
interface Ticket { ticket: string; song: string; at: number }

const KEY = 'deadair.request.v1';
const myZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles';
  } catch {
    return 'America/Los_Angeles';
  }
};
const loadTicket = (): Ticket | null => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    return null;
  }
};
const saveTicket = (t: Ticket): void => {
  try { localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* the form still works */ }
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

function field(label: string, input: HTMLInputElement | HTMLTextAreaElement): HTMLLabelElement {
  const l = el('label', 'rq-field');
  l.append(el('span', '', label), input);
  return l;
}

export function mountRequestLine(): void {
  const open = el('button', 'btn ghost rq-open', 'CALL THE REQUEST LINE');
  open.type = 'button';
  document.querySelector('.lb-open')?.after(open);

  const dlg = el('dialog', 'rq');
  dlg.setAttribute('aria-label', 'Request line');
  document.body.append(dlg);

  let songs: Song[] | null = null;
  let picked: Song | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;

  const from = Object.assign(el('input'), { maxLength: 20, autocomplete: 'given-name', required: true });
  const to = Object.assign(el('input'), { maxLength: 20, required: true });
  const msg = Object.assign(el('textarea'), { maxLength: 140, rows: 3 });
  const search = Object.assign(el('input'), { placeholder: 'search the stack by title', autocomplete: 'off' });
  const results = el('div', 'rq-results');
  const status = el('p', 'rq-status');
  status.setAttribute('role', 'status');
  const send = el('button', 'btn', 'CALL IT IN');
  send.type = 'submit';
  const close = el('button', 'lb-x', 'HANG UP');
  close.type = 'button';
  close.onclick = () => dlg.close();

  const form = el('form');
  form.method = 'dialog';
  const head = el('header', 'lb-head');
  head.append(el('h2', '', 'REQUEST LINE'), close);
  form.append(
    head,
    el('p', 'rq-note', 'Tell me who it\'s from, who it\'s for, and what you want them to hear. I\'ll read it on the air in a few minutes, on every radio tuned to 1714.'),
    field('From (first name)', from),
    field('For', to),
    field('Your message (140 max)', msg),
    field('Song', search),
    results,
    send,
    status
  );
  dlg.append(form);

  const showResults = (): void => {
    results.replaceChildren();
    const q = search.value.trim().toLowerCase();
    if (!songs || !q || (picked && picked.title.toLowerCase() === q)) return;
    for (const s of songs.filter((s) => s.title.toLowerCase().includes(q)).slice(0, 8)) {
      const b = el('button', 'rq-song', s.title);
      b.type = 'button';
      b.onclick = () => {
        picked = s;
        search.value = s.title;
        results.replaceChildren();
      };
      results.append(b);
    }
  };
  search.addEventListener('input', () => {
    picked = null;
    showResults();
  });

  const watch = (t: Ticket): void => {
    const check = async (): Promise<void> => {
      try {
        const r = await fetch(`/request/${t.ticket}?tz=${encodeURIComponent(myZone())}`, { cache: 'no-store' });
        const s = (await r.json()) as { status: string; airAt?: string };
        status.textContent =
          s.status === 'scheduled' ? `You're on. Listen for it at ${s.airAt}, then "${t.song}".`
          : s.status === 'aired' ? 'Your call went out on the air.'
          : s.status === 'dropped' ? 'The line went dead on that one. Try again later.'
          : 'Dead John has your call. Stay tuned.';
        if (s.status !== 'queued' && poll) {
          clearInterval(poll);
          poll = null;
        }
      } catch {
        // offline for a moment: try again on the next tick
      }
    };
    void check();
    if (poll) clearInterval(poll);
    poll = setInterval(check, 20_000);
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!picked) {
      status.textContent = 'Pick a song from the list first.';
      return;
    }
    send.disabled = true;
    try {
      const r = await fetch('/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: from.value, to: to.value, message: msg.value, songId: picked.id }),
      });
      const body = (await r.json()) as { ticket?: string; message?: string; reason?: string };
      if (r.status === 202 && body.ticket) {
        const t = { ticket: body.ticket, song: picked.title, at: Date.now() };
        saveTicket(t);
        form.reset();
        picked = null;
        status.textContent = body.message ?? '';
        watch(t);
      } else {
        status.textContent = body.reason ?? 'The line is busy. Try again in a bit.';
      }
    } catch {
      status.textContent = 'The line is down. Try again in a bit.';
    } finally {
      send.disabled = false;
    }
  });

  open.onclick = async () => {
    dlg.showModal();
    const t = loadTicket();
    if (t && Date.now() - t.at < 3 * 3_600_000) watch(t);
    if (!songs) {
      try {
        songs = (await (await fetch('/songs')).json()) as Song[];
      } catch {
        songs = [];
      }
    }
  };
}
