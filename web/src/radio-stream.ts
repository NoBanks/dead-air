// 1714 AM through a plain media element playing the station's live stream (/stream).
// A media element is what phones keep alive in the background, on the lock screen and next to
// other apps; Web Audio is suspended there. The station is mixed on the server, so everyone still
// hears the same moment.

const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

/** The stream reaches ears about this far behind the schedule (server lead + start burst + buffer). */
export const STREAM_DELAY_MS = 4500;

let el: HTMLAudioElement | null = null;
let wanted = false;
let retry: ReturnType<typeof setTimeout> | null = null;

/** Call inside the user's tap: iOS only lets a media element play once a gesture has started it. */
export function unlockRadio(): void {
  if (el) return;
  el = new Audio();
  el.preload = 'none';
  el.src = SILENT_WAV;
  el.play().then(() => el!.pause()).catch(() => undefined);
  // A dropped connection (tunnel hiccup, network switch) comes back by itself.
  const recover = (): void => {
    if (!wanted || retry) return;
    retry = setTimeout(() => {
      retry = null;
      if (wanted) void radioOn();
    }, 2000);
  };
  el.addEventListener('error', recover);
  el.addEventListener('stalled', recover);
  el.addEventListener('ended', recover);
}

export function radioOn(): Promise<void> {
  unlockRadio();
  wanted = true;
  el!.muted = false;
  el!.src = `/stream?t=${Date.now()}`;
  return el!.play().catch((e) => console.warn('Stream play failed:', e));
}

export function radioOff(): void {
  wanted = false;
  if (!el) return;
  el.pause();
  el.removeAttribute('src');
  el.load();
}

/** True once real station audio is coming out. */
export function radioSounding(): boolean {
  return !!el && wanted && !el.paused && el.currentTime > 0.2 && el.readyState >= 3;
}

/** The finale swaps one Emergency Broadcast on this device: the stream goes quiet under it. */
export function radioMute(muted: boolean): void {
  if (el) el.muted = muted;
}
