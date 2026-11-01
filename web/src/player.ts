import { estimateOffset, correctedNow, startResyncLoop } from './clock.js';
import { scheduleDuck } from './duck.js';
import { PRELOAD_AHEAD_S, DRIFT_THRESHOLD_MS } from './constants.js';
import type {
  NowPlayingResult,
  Segment,
  SongSegment,
  AudioGraph,
} from './types.js';

/**
 * Map a server-clock UTC ms to an AudioContext time.
 * offset = server - local (see clock.ts), so local time of a server instant is serverMs - offset.
 */
function serverToAudioTime(serverMs: number, offset: number, ctx: AudioContext): number {
  return ctx.currentTime + (serverMs - offset - Date.now()) / 1000;
}

/**
 * Decode an MP3 ArrayBuffer
 */
async function decodeAudio(
  ctx: AudioContext,
  buffer: ArrayBuffer
): Promise<AudioBuffer> {
  return ctx.decodeAudioData(buffer);
}

/**
 * Fetch and decode an audio file (from /audio or /voice endpoint)
 */
async function fetchAndDecode(ctx: AudioContext, url: string): Promise<AudioBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return decodeAudio(ctx, await response.arrayBuffer());
}

/** Segment paths from the station are already absolute ("/audio/x.mp3", "/voice/y.mp3"). */
function segmentUrl(seg: Segment, state: PlayerState): string | null {
  if (seg.kind === 'song') return seg.mp3;
  if (seg.kind === 'voice') return seg.file;
  if (seg.kind === 'numbers') return seg.short ? '/voice/numbers_short.mp3' : '/voice/numbers_full.mp3';
  if (seg.kind === 'ebs') return state.ebsUrl?.(seg) ?? '/voice/ebs.mp3';
  return null;
}

export interface PlayerState {
  offset: number;
  currentSegment: Segment | null;
  scheduledNodes: AudioBufferSourceNode[];
  preloadInterval: ReturnType<typeof setInterval> | null;
  resyncStop: (() => void) | null;
  /** Segments known from /now, ordered by startMs, not yet scheduled. */
  queue?: Segment[];
  /** Every segment scheduled or known, used to find what is on air right now. */
  timeline?: Segment[];
  /** Server time up to which audio has been scheduled. */
  scheduledUntil?: number;
  /** Bumped on every join/stop so stale async work is dropped. */
  generation?: number;
  /** Called whenever the on-air segment changes. */
  onSegment?: (seg: Segment | null) => void;
  /** Lets the Hunt swap one Emergency Broadcast for the finale on this device. */
  ebsUrl?: (seg: Segment) => string | null;
}

async function fetchSegments(at: number): Promise<Segment[]> {
  const response = await fetch(`/now?t=${Math.round(at)}`);
  if (!response.ok) throw new Error('Failed to fetch /now');
  const data = (await response.json()) as NowPlayingResult;
  return [data.segment, ...data.next];
}

function track(state: PlayerState, node: AudioBufferSourceNode): void {
  state.scheduledNodes.push(node);
  node.onended = () => {
    state.scheduledNodes = state.scheduledNodes.filter((n) => n !== node);
  };
}

/**
 * Schedule one segment on the audio clock. If it already started (late join),
 * start now at the right position. Songs end exactly at their segment end, so
 * truncated songs stop at midnight.
 */
async function scheduleSegment(
  graph: AudioGraph,
  ctx: AudioContext,
  state: PlayerState,
  seg: Segment,
  gen: number
): Promise<void> {
  const url = segmentUrl(seg, state);
  if (!url) return;
  const buffer = await fetchAndDecode(ctx, url);
  if (gen !== state.generation) return;

  const lead = ctx.currentTime + 0.05;
  let at = serverToAudioTime(seg.startMs, state.offset, ctx);
  let skip = 0;
  if (at < lead) {
    skip = lead - at;
    at = lead;
  }
  const length = Math.min(buffer.duration, (seg.endMs - seg.startMs) / 1000);
  if (skip >= length) return;

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(seg.kind === 'song' ? graph.musicBus : graph.voiceBus);
  source.start(at, skip, length - skip);
  track(state, source);

  await scheduleTalkup(graph, ctx, state, seg, gen);
}

/** Dead John over a song intro, ending exactly on the post, with the music ducked under him. */
async function scheduleTalkup(
  graph: AudioGraph,
  ctx: AudioContext,
  state: PlayerState,
  seg: Segment,
  gen: number
): Promise<void> {
  if (seg.kind !== 'song' || !(seg as SongSegment).talkup) return;
  const talkup = (seg as SongSegment).talkup!;
  const clip = await fetchAndDecode(ctx, talkup.file);
  if (gen !== state.generation) return;
  // The clip ends exactly on the post: song start + startOffsetMs + clip length.
  let clipAt = serverToAudioTime(seg.startMs + talkup.startOffsetMs, state.offset, ctx);
  const post = clipAt + clip.duration;
  const now = ctx.currentTime + 0.05;
  if (post <= now) return;
  let clipSkip = 0;
  if (clipAt < now) {
    clipSkip = now - clipAt;
    clipAt = now;
  }
  const voice = ctx.createBufferSource();
  voice.buffer = clip;
  voice.connect(graph.voiceBus);
  scheduleDuck(graph.musicBus, ctx, clipAt, post);
  voice.start(clipAt, clipSkip);
  track(state, voice);
}

// ---------------------------------------------------------------------------
// Streaming the song that is already on air when you tune in.
// Downloading and decoding a whole 5 to 10 MB song before the first sound takes seconds on a phone,
// so that one song streams through an <audio> element (Range requests: sound in about a second).
// Later songs keep the buffer path above: they are fetched 20 s early and start sample-accurately.
// ---------------------------------------------------------------------------
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
let streamEl: HTMLAudioElement | null = null;

/** Call inside the user's tap (iOS only lets a media element play after a gesture has started it once). */
export function unlockStreaming(ctx: AudioContext, graph: AudioGraph): void {
  if (streamEl) return;
  const el = new Audio();
  el.preload = 'auto';
  el.src = SILENT_WAV;
  el.play().then(() => el.pause()).catch(() => undefined);
  ctx.createMediaElementSource(el).connect(graph.musicBus);
  streamEl = el;
}

function streamSong(state: PlayerState, seg: SongSegment, gen: number): void {
  const el = streamEl!;
  const shim = { stop: () => el.pause() } as unknown as AudioBufferSourceNode;
  const lengthS = (seg.endMs - seg.startMs) / 1000;
  el.src = seg.mp3;
  el.addEventListener(
    'loadedmetadata',
    () => {
      if (gen !== state.generation) return;
      const at = (correctedNow(state.offset) - seg.startMs) / 1000;
      if (at >= lengthS) return;
      el.currentTime = Math.max(0, at);
      el.play()
        .then(() => {
          if (gen === state.generation) state.scheduledNodes.push(shim);
        })
        .catch((e) => console.warn('Stream play failed:', e));
    },
    { once: true }
  );
  // Songs cut at midnight stop exactly at their segment end.
  setTimeout(() => {
    el.pause();
    state.scheduledNodes = state.scheduledNodes.filter((n) => n !== shim);
  }, Math.max(0, seg.endMs - correctedNow(state.offset)));
}

/**
 * Keep audio scheduled PRELOAD_AHEAD_S into the future and keep currentSegment
 * pointing at what is on air. Runs every second until stopPlayback.
 */
async function tick(graph: AudioGraph, ctx: AudioContext, state: PlayerState, gen: number): Promise<void> {
  const now = correctedNow(state.offset);
  const queue = state.queue!;
  if (queue.length === 0) {
    const fresh = await fetchSegments(state.scheduledUntil!);
    if (gen !== state.generation) return;
    queue.push(...fresh.filter((s) => s.startMs >= state.scheduledUntil! - 1));
    state.timeline!.push(...queue);
  }
  while (queue.length && queue[0].startMs < now + PRELOAD_AHEAD_S * 1000) {
    const seg = queue.shift()!;
    state.scheduledUntil = seg.endMs;
    if (seg.endMs <= now) continue;
    await scheduleSegment(graph, ctx, state, seg, gen).catch((e) => console.warn('Segment failed:', e));
    if (gen !== state.generation) return;
  }
  const onAir = state.timeline!.find((s) => s.startMs <= now && now < s.endMs) ?? null;
  state.timeline = state.timeline!.filter((s) => s.endMs > now - 60_000);
  if (onAir !== state.currentSegment) {
    state.currentSegment = onAir;
    state.onSegment?.(onAir);
  }
}

/**
 * Join the broadcast at the current server time and keep it playing.
 */
export async function joinBroadcast(
  graph: AudioGraph,
  ctx: AudioContext,
  state: PlayerState
): Promise<void> {
  stopPlayback(state);
  const gen = state.generation!;

  state.offset = await estimateOffset();
  if (gen !== state.generation) return;
  const now = correctedNow(state.offset);
  const segments = await fetchSegments(now);
  if (gen !== state.generation) return;

  state.queue = segments.filter((s) => s.endMs > now);
  state.timeline = [...state.queue];
  state.scheduledUntil = now;
  state.currentSegment = state.queue[0] ?? null;
  state.onSegment?.(state.currentSegment);

  // The song already on air streams right away; everything after it is scheduled ahead as usual.
  const first = state.queue[0];
  if (first && first.kind === 'song' && streamEl) {
    state.queue.shift();
    state.scheduledUntil = first.endMs;
    streamSong(state, first as SongSegment, gen);
    void scheduleTalkup(graph, ctx, state, first, gen).catch((e) => console.warn('Talk-up failed:', e));
  }

  await tick(graph, ctx, state, gen);
  let busy = false;
  state.preloadInterval = setInterval(() => {
    if (busy) return;
    busy = true;
    tick(graph, ctx, state, gen)
      .catch((e) => console.warn('Tick failed:', e))
      .finally(() => (busy = false));
  }, 1000);

  // Drift over the threshold: rejoin cleanly instead of jumping mid-buffer.
  state.resyncStop = startResyncLoop((newOffset: number) => {
    if (Math.abs(newOffset - state.offset) >= DRIFT_THRESHOLD_MS) {
      joinBroadcast(graph, ctx, state).catch((e) => console.warn('Resync failed:', e));
    }
  });
}

/**
 * Stop playback and clean up
 */
export function stopPlayback(state: PlayerState): void {
  state.generation = (state.generation ?? 0) + 1;
  state.scheduledNodes.forEach((node) => {
    try {
      node.stop();
    } catch (e) {
      // Already stopped
    }
  });
  state.scheduledNodes = [];
  streamEl?.pause();
  if (state.preloadInterval) {
    clearInterval(state.preloadInterval);
    state.preloadInterval = null;
  }
  if (state.resyncStop) {
    state.resyncStop();
    state.resyncStop = null;
  }
  state.queue = [];
  state.timeline = [];
  state.currentSegment = null;
}
