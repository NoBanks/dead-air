import {
  FREQ_MIN,
  FREQ_MAX,
  STATION_FREQ,
  LOCK_THRESHOLD,
} from './constants.js';
import { buildGraph } from './audio-graph.js';
import { createStaticGenerator, updateStaticGain } from './static-gen.js';
import {
  joinBroadcast,
  stopPlayback,
  type PlayerState,
} from './player.js';
import { updateMediaSession } from './media-session.js';
import { createHuntTuner, type HuntTuner } from './hunt.js';
import { record, heardAd, heardNumbers, finaleDue, markFinale, foundCount, TOWN_ADS } from './logbook.js';
import { mountLogbook } from './logbook-ui.js';
import { mountRequestLine } from './request-form.js';
import type { Segment, SongSegment, VoiceSegment, AudioGraph } from './types.js';

const MIN = FREQ_MIN;
const MAX = FREQ_MAX;
const STATION = STATION_FREQ;
const WIDTH = LOCK_THRESHOLD;

// -------------------------------------------------------------------
// Module-level state
// -------------------------------------------------------------------
let freq = 640;
let on = false;
let wasLocked = false;

let audioCtx: AudioContext | null = null;
let graph: AudioGraph | null = null;
let hunt: HuntTuner | null = null;
// The Emergency Broadcast this device turned into the finale (start time), if any.
let finaleAt: number | null = null;

const playerState: PlayerState = {
  offset: 0,
  currentSegment: null,
  scheduledNodes: [],
  preloadInterval: null,
  resyncStop: null,
  // Keep the card and lock screen in step with what is on air, and feed the Logbook.
  onSegment: (seg) => {
    if (seg?.kind === 'voice' && (seg as VoiceSegment).clipId in TOWN_ADS) heardAd((seg as VoiceSegment).clipId);
    if (seg?.kind === 'numbers') heardNumbers();
    if (seg?.kind === 'ebs' && seg.startMs === finaleAt) markFinale();
    applyNowPlaying(seg);
    updateMediaSession(seg?.kind === 'song' ? ({ title: (seg as SongSegment).title } as any) : undefined);
  },
  // All pages found: the next Emergency Broadcast is Marty, close and clear for the first time.
  ebsUrl: (seg) => {
    if (finaleAt === null && finaleDue()) finaleAt = seg.startMs;
    return seg.startMs === finaleAt ? '/voice/finale.mp3' : null;
  },
};

// -------------------------------------------------------------------
// Expose real state for automated testing / devtools
// -------------------------------------------------------------------
(window as any).__deadair = {
  get ctxState(): string {
    return audioCtx ? audioCtx.state : 'closed';
  },
  get freq(): number {
    return freq;
  },
  get locked(): boolean {
    return wasLocked;
  },
  get segmentKind(): string | null {
    return playerState.currentSegment ? playerState.currentSegment.kind : null;
  },
  get title(): string | null {
    const seg = playerState.currentSegment;
    if (!seg) return null;
    if (seg.kind === 'song') return (seg as SongSegment).title;
    if (seg.kind === 'voice') return (seg as VoiceSegment).text.slice(0, 60);
    return seg.kind;
  },
  get musicGain(): number {
    return graph ? graph.musicBus.gain.value : 0;
  },
  get voiceGain(): number {
    return graph ? graph.voiceBus.gain.value : 0;
  },
  get staticGain(): number {
    // Static level lives on the generator's own gain node, not the bus
    const g = graph ? ((graph as any)._staticGain1 as GainNode | undefined) : undefined;
    return g ? g.gain.value : 0;
  },
  get huntPage(): string | null {
    return hunt?.current()?.page ?? null;
  },
  get huntStrength(): number {
    return hunt ? hunt.strength() : 0;
  },
  get logbook(): number {
    return foundCount();
  },
  get playing(): boolean {
    // A source is "playing" when at least one node is scheduled and the
    // AudioContext is running.
    return (
      !!audioCtx &&
      audioCtx.state === 'running' &&
      playerState.scheduledNodes.length > 0
    );
  },
};

// -------------------------------------------------------------------
// DOM helpers
// -------------------------------------------------------------------
const $ = (id: string): HTMLElement => document.getElementById(id)!;

function pos(f: number): number {
  return 4 + ((f - MIN) / (MAX - MIN)) * 92;
}

function freqAt(clientX: number): number {
  const r = $('glass').getBoundingClientRect();
  return MIN + (((clientX - r.left) / r.width) * 100 - 4) / 92 * (MAX - MIN);
}

function clamp(f: number): number {
  return Math.min(MAX, Math.max(MIN, f));
}

// -------------------------------------------------------------------
// Now-playing card: drives #title / #meta / #quote from real segment
// -------------------------------------------------------------------
function segmentLabel(seg: Segment | null): {
  title: string;
  meta: string;
  quote: string;
} {
  if (!seg) {
    return {
      title: 'Nothing but static',
      meta: on
        ? 'Tap the dial near 1714, then slide slowly.'
        : 'Turn on the radio. Then tap the dial near 1714.',
      quote: '',
    };
  }

  if (seg.kind === 'song') {
    const song = seg as SongSegment;
    // made_at comes from the schedule; if the segment carries it via NowPlayingResult
    // lookup we use it. The segment itself only has title and mp3; made_at lives on
    // the Track in the library. We carry it through the extended result below.
    const madeAt = (song as any).__madeAt as string | undefined;
    let meta = 'NoBanks Nearby';
    if (madeAt) {
      try {
        const d = new Date(madeAt);
        const formatted = d.toLocaleDateString('en-US', {
          month: 'long',
          year: 'numeric',
        });
        meta = `NoBanks Nearby  \u00B7  ${formatted}`;
      } catch {
        // keep plain
      }
    }
    return { title: song.title, meta, quote: '' };
  }

  if (seg.kind === 'voice' && (seg as VoiceSegment).clipKind === 'request') {
    return { title: 'Dead John', meta: 'On the request line', quote: (seg as VoiceSegment).text };
  }

  if (seg.kind === 'voice') {
    return { title: 'Dead John', meta: '1714 AM', quote: '' };
  }

  if (seg.kind === 'numbers') {
    return { title: '\u2666\u2666\u2666\u2666\u2666', meta: 'Numbers Station', quote: '' };
  }

  if (seg.kind === 'ebs' && seg.startMs === finaleAt) {
    return { title: 'Marty', meta: '1714 AM', quote: "Signal's good, John." };
  }

  if (seg.kind === 'ebs') {
    return {
      title: 'Emergency Broadcast',
      meta: '1714 AM',
      quote: 'This is not a test.',
    };
  }

  return { title: '', meta: '', quote: '' };
}

function applyNowPlaying(seg: Segment | null): void {
  const { title, meta, quote } = segmentLabel(seg);
  $('title').textContent = title;
  $('meta').textContent = meta;
  $('quote').textContent = quote;
}

// -------------------------------------------------------------------
// Static gain: map lock amount (0..1) to distance, feed updateStaticGain
// -------------------------------------------------------------------
function applyStaticGain(lock: number): void {
  if (!graph || !audioCtx) return;
  // lock=0 -> full static (distance MAX), lock=1 -> silence (distance 0)
  const distanceKHz = (1 - lock) * 200;
  updateStaticGain(distanceKHz, graph, audioCtx);
}

// -------------------------------------------------------------------
// Lock / unlock handlers
// -------------------------------------------------------------------
let lockPending = false;

async function onLock(): Promise<void> {
  if (lockPending) return;
  lockPending = true;
  try {
    if (!audioCtx || !graph) return;
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }
    // Sync clock and join broadcast; onSegment keeps the card current from here on
    await joinBroadcast(graph, audioCtx, playerState);
  } catch (e) {
    console.error('joinBroadcast failed:', e);
  } finally {
    lockPending = false;
  }
}

function onUnlock(): void {
  stopPlayback(playerState);
  // Show static/seeking UI
  applyNowPlaying(null);
  updateMediaSession(undefined);
}

// -------------------------------------------------------------------
// Main render: called on every dial move and power toggle
// -------------------------------------------------------------------
function render(): void {
  $('needle').style.left = pos(freq) + '%';
  $('freq').textContent = Math.round(freq).toString();
  $('glass').setAttribute('aria-valuenow', Math.round(freq).toString());

  const distance = Math.abs(freq - STATION);
  const lock = Math.max(0, 1 - distance / WIDTH);
  ($('radio') as any).style.setProperty('--lock', lock.toFixed(3));

  const isLive = on && lock > 0.85;
  $('onair').classList.toggle('live', isLive);

  // Off 1714 the Hunt asks the station what (if anything) is at this exact spot.
  hunt?.tune(freq, on && !isLive);
  // Hidden stations are faint: they never pull more than about 60% through the static.
  const faint = on && !isLive ? (hunt?.strength() ?? 0) * 0.6 : 0;
  const signal = Math.max(lock, faint);

  $('sig').style.width = (signal * 100) + '%';
  $('stat').style.width = ((1 - signal) * 100) + '%';

  // Apply static gain via real nodes when available, otherwise visual only
  if (graph && audioCtx) {
    applyStaticGain(on ? signal : 0);
  }

  // Lock / unlock transitions
  if (isLive && !wasLocked) {
    wasLocked = true;
    void onLock();
  } else if (!isLive && wasLocked) {
    wasLocked = false;
    onUnlock();
  }

  // If not locked, drive the text directly from context
  if (!isLive) {
    if (on && faint > 0) {
      $('title').textContent = 'something faint...';
      $('meta').textContent = 'hold still. listen.';
      $('quote').textContent = '';
    } else if (on && lock > 0.2) {
      $('title').textContent = "something's there...";
      $('meta').textContent = 'keep turning, slowly';
      $('quote').textContent = '';
    } else {
      applyNowPlaying(null);
    }
  }
}

// -------------------------------------------------------------------
// Audio startup (on first power-on gesture)
// -------------------------------------------------------------------
function startAudio(): void {
  if (audioCtx) return;

  const AC =
    (window as any).AudioContext ||
    (window as any).webkitAudioContext;
  if (!AC) return;

  audioCtx = new AC() as AudioContext;
  graph = buildGraph(audioCtx);
  createStaticGenerator(audioCtx, graph); // runs for the life of the page
  hunt = createHuntTuner(
    audioCtx,
    graph,
    (hit, f) => { record(hit.page, f); },
    () => render() // a signal came in or faded: update meters, static and text
  );
}

// -------------------------------------------------------------------
// Scale construction
// -------------------------------------------------------------------
function buildScale(): void {
  const scale = $('scale');

  for (let f = 550; f <= MAX; f += 10) {
    const t = document.createElement('div');
    t.className = 'tick';
    t.style.left = pos(f) + '%';
    t.style.height = (f % 100 === 0 ? 26 : 12) + 'px';
    scale.appendChild(t);
  }

  const addLabel = (f: number, pirate = false): void => {
    const l = document.createElement('div');
    l.className = 'label' + (pirate ? ' pirate' : '');
    l.style.left = pos(f) + '%';
    l.textContent = f.toString();
    scale.appendChild(l);
  };

  [550, 700, 900, 1100, 1300, 1500].forEach(f => addLabel(f));
  addLabel(STATION, true);

  const end = document.createElement('div');
  end.className = 'endband';
  end.style.left = pos(1700) + '%';
  const endText = document.createElement('span');
  endText.textContent = 'END OF DIAL';
  end.appendChild(endText);
  scale.appendChild(end);
}

// -------------------------------------------------------------------
// Bootstrap
// -------------------------------------------------------------------
function main(): void {
  buildScale();
  mountLogbook();
  mountRequestLine();

  const glass = $('glass');
  const powerBtn = $('power');

  powerBtn.addEventListener('click', () => {
    if (!on) {
      // First turn-on: create AudioContext (requires user gesture)
      startAudio();
    }
    on = !on;
    powerBtn.textContent = on ? 'TURN IT OFF' : 'TURN ON THE RADIO';
    powerBtn.classList.toggle('ghost', on);

    if (!on) {
      // Radio off: stop everything
      stopPlayback(playerState);
      wasLocked = false;
      if (audioCtx) {
        void audioCtx.suspend();
      }
    }

    glass.focus({ preventScroll: true });
    render();
  });

  // Dial input
  let dragging = false;
  let lastX = 0;

  glass.addEventListener('pointerdown', (e: PointerEvent) => {
    dragging = true;
    lastX = e.clientX;
    glass.setPointerCapture((e as any).pointerId);
    freq = clamp(freqAt(e.clientX));
    render();
  });

  glass.addEventListener('pointermove', (e: PointerEvent) => {
    if (!dragging) return;
    const delta = e.clientX - lastX;
    freq = clamp(
      freq + (delta / glass.getBoundingClientRect().width) * (MAX - MIN) * 0.3
    );
    lastX = e.clientX;
    render();
  });

  const stop = (): void => { dragging = false; };
  glass.addEventListener('pointerup', stop);
  glass.addEventListener('pointercancel', stop);

  glass.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      e.preventDefault();
      freq = clamp(freq + Math.sign(e.deltaY) * 3);
      render();
    },
    { passive: false }
  );

  glass.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      freq = clamp(freq + (e.shiftKey ? 50 : 1));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      freq = clamp(freq - (e.shiftKey ? 50 : 1));
    } else if (e.key === 'Home') {
      freq = MIN;
    } else if (e.key === 'End') {
      freq = MAX;
    } else if (e.key === 'PageUp') {
      freq = clamp(freq + 50);
    } else if (e.key === 'PageDown') {
      freq = clamp(freq - 50);
    } else {
      return;
    }
    e.preventDefault();
    render();
  });

  // Clock
  const updateClock = (): void => {
    const time = new Date().toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/Los_Angeles',
    });
    $('clock').textContent = time + ' PT';
  };
  setInterval(updateClock, 1000);
  updateClock();

  render();
}

main();
