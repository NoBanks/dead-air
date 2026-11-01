import { STATION_FREQ } from './constants.js';
import type { AudioGraph } from './types.js';

// What /signal answers when something is out there. The client never knows the hidden
// frequencies; it only asks about the one it is tuned to.
export interface HuntHit {
  page: string;
  clip_id: string;
  file: string;
  offset_ms: number;
  remaining_ms: number;
  strength: number;
  server_time: number;
}

const ASK_DELAY_MS = 220;   // let the dial settle before asking
const DWELL_TO_LOG_MS = 2000; // hold a signal this long to log it
const MIN_LOG_STRENGTH = 0.3;

export interface HuntTuner {
  /** Call on every dial move. */
  tune(freq: number, on: boolean): void;
  stop(): void;
  /** 0..1, 0 when nothing is coming in. */
  strength(): number;
  current(): HuntHit | null;
}

export function createHuntTuner(
  ctx: AudioContext,
  graph: AudioGraph,
  onLog: (hit: HuntHit, freq: number) => void,
  onChange: (hit: HuntHit | null) => void
): HuntTuner {
  // Hidden stations come in faint and thin: their own gain into the voice bus (which runs through the AM chain).
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 1100;
  band.Q.value = 0.7;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  band.connect(gain);
  gain.connect(graph.voiceBus);

  const buffers = new Map<string, Promise<AudioBuffer>>();
  let source: AudioBufferSourceNode | null = null;
  let hit: HuntHit | null = null;
  let tunedFreq = 0;
  let askTimer: ReturnType<typeof setTimeout> | null = null;
  let nextTimer: ReturnType<typeof setTimeout> | null = null;
  let dwellTimer: ReturnType<typeof setTimeout> | null = null;
  let gen = 0;

  const load = (url: string): Promise<AudioBuffer> => {
    let p = buffers.get(url);
    if (!p) {
      p = fetch(url).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b));
      p.catch(() => buffers.delete(url));
      buffers.set(url, p);
    }
    return p;
  };

  const silence = (): void => {
    gen++;
    for (const t of [askTimer, nextTimer, dwellTimer]) if (t) clearTimeout(t);
    askTimer = nextTimer = dwellTimer = null;
    gain.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
    if (source) {
      const s = source;
      setTimeout(() => { try { s.stop(); } catch { /* already stopped */ } }, 600);
      source = null;
    }
    if (hit) {
      hit = null;
      onChange(null);
    }
  };

  const ask = async (freq: number): Promise<void> => {
    const my = ++gen;
    let res: Response;
    try {
      res = await fetch(`/signal?f=${freq}`, { cache: 'no-store' });
    } catch {
      return;
    }
    if (my !== gen) return;
    if (res.status !== 200) {
      silence();
      return;
    }
    const next = (await res.json()) as HuntHit;
    const asked = performance.now();
    if (my !== gen) return;

    const sameClip = hit && source && hit.clip_id === next.clip_id;
    const wasPage = hit?.page;
    hit = next;
    gain.gain.setTargetAtTime(0.25 + 0.75 * next.strength, ctx.currentTime, 0.2);
    onChange(next);

    if (!sameClip) {
      const buffer = await load(next.file).catch(() => null);
      if (!buffer || my !== gen) return;
      if (source) { try { source.stop(); } catch { /* fine */ } }
      const offset = (next.offset_ms + (performance.now() - asked)) / 1000;
      if (offset < buffer.duration) {
        source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(band);
        source.start(ctx.currentTime + 0.02, offset);
      }
    }
    // Ask again when this clip ends so the station keeps going (loops, 3:14, next fragment).
    // Every ask bumps gen, so this must be re-armed even when the clip did not change.
    if (nextTimer) clearTimeout(nextTimer);
    nextTimer = setTimeout(() => { if (my === gen) void ask(tunedFreq); }, Math.max(250, next.remaining_ms + 50));

    // Holding still on a real signal logs the page.
    if (next.strength >= MIN_LOG_STRENGTH && (wasPage !== next.page || !dwellTimer)) {
      if (dwellTimer) clearTimeout(dwellTimer);
      const page = next.page;
      dwellTimer = setTimeout(() => {
        if (hit && hit.page === page && hit.strength >= MIN_LOG_STRENGTH) onLog(hit, tunedFreq);
      }, DWELL_TO_LOG_MS);
    }
  };

  return {
    tune(freq: number, on: boolean): void {
      const f = Math.round(freq);
      if (!on || Math.abs(f - STATION_FREQ) < 12) {
        tunedFreq = 0;
        silence();
        return;
      }
      if (f === tunedFreq) return;
      tunedFreq = f;
      if (askTimer) clearTimeout(askTimer);
      askTimer = setTimeout(() => void ask(f), ASK_DELAY_MS);
    },
    stop(): void {
      tunedFreq = 0;
      silence();
    },
    strength(): number {
      return hit ? hit.strength : 0;
    },
    current(): HuntHit | null {
      return hit;
    },
  };
}
