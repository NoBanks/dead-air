/**
 * request.ts: the request line's server rules (request-line spec REQ-06 to REQ-14, REQ-26).
 * Pure: no I/O. Storage lives behind RequestStore so the laptop (JSON file) and Cloudflare (KV)
 * can share this code.
 */

export type RequestStatus = "queued" | "rendered" | "scheduled" | "aired" | "dropped";

export interface RequestRecord {
  ticket: string;
  from: string;
  to: string;
  message: string;
  songId: string;
  songTitle: string;
  createdAt: number;
  status: RequestStatus;
  airAt?: number;
  clipFile?: string;   // "/requests/<ticket>.mp3", internal
  clipSeconds?: number;
}

export interface RequestStore {
  get(ticket: string): Promise<RequestRecord | undefined>;
  put(rec: RequestRecord): Promise<void>;
  list(): Promise<RequestRecord[]>;
}

// Dead John never repeats the caller's words back when he turns a call down (REQ-09).
export const REASONS = {
  name: "I need a first name, and who it's for. Letters only, short and sweet.",
  long: "Keep it short, friend. The line only holds so much.",
  links: "No numbers, no links, no handles. Just names and what you want to say.",
  blocked: "The line crackled and I lost that one. Try saying it another way.",
  song: "I can't find that one in the stack. Pick a song from the list.",
  slow: "One call at a time. Try me again in a few minutes.",
  busy: "Every line's lit up right now. Call back in a little while.",
} as const;

const NAME = /^[A-Za-z][A-Za-z '\-]{0,19}$/;
const URLISH = /(https?:\/\/|www\.|\.(com|net|org|io|ly|gg|xyz)\b)/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const HANDLE = /(^|\s)@\w/;
const DIGITS = /\d{5,}/;
const SAFE_TEXT = /^[A-Za-z0-9 .,!?'"\-:;()&]*$/;

export interface RequestInput {
  from?: unknown;
  to?: unknown;
  message?: unknown;
  songId?: unknown;
}

export type Validation =
  | { ok: true; value: { from: string; to: string; message: string; songId: string } }
  | { ok: false; reason: string };

/** Normalize text for blocklist matching: lowercase, letters only, common swaps undone. */
function squash(s: string): string {
  return s
    .toLowerCase()
    .replace(/[0@]/g, "o").replace(/[1!|]/g, "i").replace(/3/g, "e").replace(/[4]/g, "a").replace(/[5$]/g, "s")
    .replace(/[^a-z]/g, "");
}

export function parseBlocklist(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map(squash)
    .filter(Boolean);
}

export function validateRequest(input: RequestInput, blocklist: string[], songIds: Set<string>): Validation {
  const str = (v: unknown) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "");
  const from = str(input.from);
  const to = str(input.to);
  const message = str(input.message);
  const songId = str(input.songId);

  if (!NAME.test(from) || !NAME.test(to)) return { ok: false, reason: REASONS.name };
  if (message.length > 140) return { ok: false, reason: REASONS.long };
  if (URLISH.test(message) || EMAIL.test(message) || HANDLE.test(message) || DIGITS.test(message)) {
    return { ok: false, reason: REASONS.links };
  }
  if (!SAFE_TEXT.test(message)) return { ok: false, reason: REASONS.links };
  // Short terms match whole words only (so "Cassie" and "class" are fine); longer ones match anywhere.
  const text = `${from} ${to} ${message}`;
  const all = squash(text);
  const words = new Set(text.split(/\s+/).map(squash));
  if (blocklist.some((w) => (w.length <= 4 ? words.has(w) : all.includes(w)))) {
    return { ok: false, reason: REASONS.blocked };
  }
  if (!songIds.has(songId)) return { ok: false, reason: REASONS.song };
  return { ok: true, value: { from, to, message, songId } };
}

/** Per-caller (1 per 10 min) and station-wide (30 per rolling hour) limits (REQ-10, REQ-11). */
export class RateLimiter {
  private perCaller = new Map<string, number>();
  private recent: number[] = [];
  constructor(private callerGapMs = 10 * 60_000, private stationMax = 30, private windowMs = 60 * 60_000) {}

  check(caller: string, now: number): "ok" | "slow" | "busy" {
    const last = this.perCaller.get(caller);
    if (last !== undefined && now - last < this.callerGapMs) return "slow";
    this.recent = this.recent.filter((t) => now - t < this.windowMs);
    if (this.recent.length >= this.stationMax) return "busy";
    return "ok";
  }

  /** Call only when a request is accepted. */
  accept(caller: string, now: number): void {
    this.perCaller.set(caller, now);
    this.recent.push(now);
  }
}

/** What a listener may see about their ticket (REQ-14): never a reason, never internals. */
export function publicStatus(rec: RequestRecord | undefined, tz = "America/Los_Angeles"):
  { status: RequestStatus | "unknown"; airAt?: string } {
  if (!rec) return { status: "unknown" };
  const status = rec.status === "rendered" ? "queued" : rec.status;
  if (status === "scheduled" && rec.airAt) {
    let zone = tz;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: zone });
    } catch {
      zone = "America/Los_Angeles";
    }
    const airAt = new Date(rec.airAt).toLocaleTimeString("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" });
    return { status, airAt };
  }
  return { status };
}

/** Scheduled requests become day inserts (request-line S-2). Aired ones stay so the past never changes. */
export function toInserts(records: RequestRecord[]) {
  return records
    .filter((r) => (r.status === "scheduled" || r.status === "aired") && r.airAt && r.clipFile && r.clipSeconds)
    .map((r) => ({
      airAt: r.airAt!,
      songId: r.songId,
      clip: {
        id: `request-${r.ticket}`,
        kind: "request" as const,
        text: `A request from ${r.from}, for ${r.to}.`,
        seconds: r.clipSeconds!,
        file: r.clipFile!,
      },
    }));
}
