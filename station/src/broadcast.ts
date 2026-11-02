/**
 * broadcast.ts: 1714 AM as a real continuous radio stream (GET /stream, audio/mpeg).
 *
 * Phones only keep playing in the background or on the lock screen when audio comes from a plain
 * media element, so the station is mixed here, once, for everyone: each scheduled segment is decoded
 * by ffmpeg (talk-ups mixed over the intro with the music ducked 10 dB, like the tuner does), paced
 * out by the wall clock so it never drifts from the schedule, and encoded to one shared MP3 stream.
 * Starts when the first listener connects and stops a minute after the last one leaves.
 */
import { spawn, type ChildProcess } from "child_process";
import type { Response } from "express";
import type { Segment } from "./core/types.js";

const RATE = 44100;
const FRAME = 4; // s16le stereo
const BYTES_PER_MS = (RATE * FRAME) / 1000;
const LEAD_MS = 1500;       // start the mix slightly in the future so the first decode is ready
const KEEP_AHEAD_MS = 25_000;
const BURST_BYTES = 128_000 / 8 * 3; // about 3 s of 128 kbps MP3 for a fast start
const DUCK = 0.316;          // -10 dB
const MAX_CLIENT_BACKLOG = 2_000_000; // bytes queued for one listener before they are dropped
const MAX_PCM_BYTES = 200_000_000;    // decoded audio held ahead (a 10 minute song is ~106 MB)

export interface BroadcastDeps {
  ffmpeg: string;
  /** Segments covering [fromMs, toMs) in order (the live schedule, requests included). */
  segments: (fromMs: number, toMs: number) => Segment[];
  /** Station URL ("/audio/x.mp3", "/voice/y.mp3", "/requests/z.mp3") to a local file. */
  localFile: (url: string) => string;
  /** Clip length in seconds (talk-up files), cached by the caller. */
  clipSeconds: (file: string) => number;
  now?: () => number;
  /** Keep mixing with nobody listening, so a new listener hears the station within a second. */
  alwaysOn?: boolean;
}

function urlOf(seg: Segment): string | null {
  if (seg.kind === "song") return seg.mp3;
  if (seg.kind === "voice") return seg.file;
  if (seg.kind === "numbers") return seg.short ? "/voice/numbers_short.mp3" : "/voice/numbers_full.mp3";
  if (seg.kind === "ebs") return "/voice/ebs.mp3";
  return null;
}

export class Broadcast {
  private clients = new Set<Response>();
  private burst: Buffer[] = [];
  private burstBytes = 0;
  private pcm: Buffer[] = [];
  private pcmBytes = 0;
  private encoder: ChildProcess | null = null;
  private pump: ReturnType<typeof setInterval> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private t0 = 0;           // wall ms where byte 0 of the mix belongs
  private written = 0;      // bytes handed to the encoder
  private decodedUntil = 0; // schedule ms decoded into pcm
  private decoding = false;
  private running = false;
  private now: () => number;

  constructor(private deps: BroadcastDeps) {
    this.now = deps.now ?? Date.now;
    if (deps.alwaysOn) setTimeout(() => this.running || this.start(), 0);
  }

  listeners(): number {
    return this.clients.size;
  }

  stats(): Record<string, number | boolean> {
    return {
      running: this.running,
      listeners: this.clients.size,
      pcmMB: Math.round(this.pcmBytes / 1e5) / 10,
      pcmChunks: this.pcm.length,
      burstKB: Math.round(this.burstBytes / 1000),
      aheadS: Math.round((this.decodedUntil - this.now()) / 1000),
      encoderBufferedKB: Math.round((this.encoder?.stdin?.writableLength ?? 0) / 1000),
    };
  }

  attach(res: Response): void {
    res.writeHead(200, {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store, no-transform",
      "X-Content-Type-Options": "nosniff",
      Connection: "keep-alive",
    });
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (!this.running) this.start();
    for (const b of this.burst) res.write(b);
    this.clients.add(res);
    res.on("close", () => {
      this.clients.delete(res);
      if (this.clients.size === 0 && !this.idleTimer && !this.deps.alwaysOn) {
        this.idleTimer = setTimeout(() => this.stop(), 60_000);
      }
    });
  }

  private start(): void {
    this.running = true;
    this.t0 = this.now() + LEAD_MS;
    this.decodedUntil = this.t0;
    this.written = 0;
    this.pcm = [];
    this.pcmBytes = 0;
    this.burst = [];
    this.burstBytes = 0;
    const enc = spawn(this.deps.ffmpeg, [
      "-hide_banner", "-loglevel", "error",
      "-f", "s16le", "-ar", String(RATE), "-ac", "2", "-i", "pipe:0",
      "-c:a", "libmp3lame", "-b:a", "128k", "-f", "mp3", "-flush_packets", "1", "pipe:1",
    ], { windowsHide: true });
    enc.stdout!.on("data", (chunk: Buffer) => this.broadcast(chunk));
    enc.stderr!.on("data", (d) => console.warn("[stream encoder]", String(d).trim()));
    enc.on("exit", () => {
      if (this.running && this.encoder === enc) {
        console.warn("[stream] encoder exited, restarting");
        this.stop();
        if (this.clients.size) this.start();
      }
    });
    this.encoder = enc;
    void this.fill();
    this.pump = setInterval(() => this.tick(), 50);
    console.log("[stream] on air");
  }

  private stop(): void {
    this.running = false;
    if (this.pump) clearInterval(this.pump);
    this.pump = null;
    const enc = this.encoder;
    this.encoder = null;
    enc?.stdin?.end();
    enc?.kill();
    this.idleTimer = null;
    console.log("[stream] off air (no listeners)");
  }

  private broadcast(chunk: Buffer): void {
    this.burst.push(chunk);
    this.burstBytes += chunk.length;
    while (this.burstBytes > BURST_BYTES && this.burst.length > 1) this.burstBytes -= this.burst.shift()!.length;
    for (const res of this.clients) {
      // A listener who stops reading (frozen tab, dead connection) gets dropped instead of
      // making the server hold an ever-growing backlog for them. They reconnect on their own.
      if (res.writableLength > MAX_CLIENT_BACKLOG) {
        this.clients.delete(res);
        res.destroy();
        continue;
      }
      res.write(chunk);
    }
  }

  /** Hand the encoder exactly the audio the wall clock says is due; silence if a decode is late. */
  private tick(): void {
    if (!this.encoder?.stdin?.writable) return;
    const due = Math.floor(((this.now() - this.t0) * BYTES_PER_MS) / FRAME) * FRAME - this.written;
    if (due <= 0) return;
    let left = due;
    const out: Buffer[] = [];
    while (left > 0 && this.pcm.length) {
      const head = this.pcm[0];
      if (head.length <= left) {
        out.push(head);
        left -= head.length;
        this.pcm.shift();
      } else {
        out.push(head.subarray(0, left));
        this.pcm[0] = head.subarray(left);
        left = 0;
      }
    }
    if (left > 0) out.push(Buffer.alloc(left)); // underrun: dead air, but the clock stays honest
    this.pcmBytes = Math.max(0, this.pcmBytes - (due - left));
    this.written += due;
    this.encoder.stdin.write(Buffer.concat(out));
    if (this.decodedUntil - this.now() < KEEP_AHEAD_MS) void this.fill();
  }

  /** Decode the next segment(s) until the mix is KEEP_AHEAD_MS ahead of the clock. */
  private async fill(): Promise<void> {
    if (this.decoding || !this.running) return;
    this.decoding = true;
    try {
      while (this.running && this.decodedUntil - this.now() < KEEP_AHEAD_MS && this.pcmBytes < MAX_PCM_BYTES) {
        const from = this.decodedUntil;
        const seg = this.deps.segments(from, from + 1).find((s) => s.endMs > from);
        if (!seg) break;
        const ms = seg.endMs - from;
        const bytes = Math.round((ms * BYTES_PER_MS) / FRAME) * FRAME;
        let pcm = await this.decode(seg, from, ms).catch((e) => {
          console.warn("[stream] decode failed", seg.kind, String(e));
          return Buffer.alloc(0);
        });
        // Exact length, so the stream never drifts from the schedule.
        if (pcm.length > bytes) pcm = pcm.subarray(0, bytes);
        else if (pcm.length < bytes) pcm = Buffer.concat([pcm, Buffer.alloc(bytes - pcm.length)]);
        this.pcm.push(pcm);
        this.pcmBytes += pcm.length;
        this.decodedUntil = seg.endMs;
      }
    } finally {
      this.decoding = false;
    }
  }

  private decode(seg: Segment, from: number, ms: number): Promise<Buffer> {
    const url = urlOf(seg);
    if (!url) return Promise.resolve(Buffer.alloc(0));
    const skip = (from - seg.startMs) / 1000;
    const len = ms / 1000;
    const args = ["-hide_banner", "-loglevel", "error", "-ss", skip.toFixed(3), "-t", len.toFixed(3), "-i", this.deps.localFile(url)];
    let filter = `[0]aresample=${RATE},aformat=channel_layouts=stereo[out]`;

    const tu = seg.kind === "song" ? seg.talkup : undefined;
    if (tu) {
      const clipFile = this.deps.localFile(tu.file);
      const clipLen = this.deps.clipSeconds(clipFile);
      const clipAt = (seg.startMs + tu.startOffsetMs - from) / 1000; // relative to this decode
      const post = clipAt + clipLen;
      if (post > 0 && clipAt < len) {
        const cskip = Math.max(0, -clipAt);
        args.push("-ss", cskip.toFixed(3), "-i", clipFile);
        const delay = Math.round(Math.max(0, clipAt) * 1000);
        const a = Math.max(0, clipAt) + 0.25;
        const b = post - 0.6;
        filter =
          `[0]aresample=${RATE},aformat=channel_layouts=stereo` +
          (b > a ? `,volume=${DUCK}:enable='between(t,${a.toFixed(2)},${b.toFixed(2)})'` : "") +
          `[m];[1]aresample=${RATE},aformat=channel_layouts=stereo,adelay=${delay}:all=1[v];` +
          `[m][v]amix=inputs=2:normalize=0:duration=first[out]`;
      }
    }
    args.push("-filter_complex", filter, "-map", "[out]", "-f", "s16le", "-ar", String(RATE), "-ac", "2", "pipe:1");

    return new Promise((resolve, reject) => {
      const p = spawn(this.deps.ffmpeg, args, { windowsHide: true });
      const chunks: Buffer[] = [];
      p.stdout.on("data", (c: Buffer) => chunks.push(c));
      p.stderr.on("data", () => undefined);
      p.on("error", reject);
      p.on("close", () => resolve(Buffer.concat(chunks)));
    });
  }
}
