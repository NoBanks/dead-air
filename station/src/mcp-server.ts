/**
 * dead-air-station MCP server (stdio). Lets Kiro (or any MCP client) ask the station questions
 * while developing: what is on air at a moment, find a track, a track's talk-up window, a day's
 * shape, library stats, and what a hidden frequency carries. Read-only; no network.
 *
 *   npx tsx station/src/mcp-server.ts      (registered in .kiro/settings/mcp.json)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { nowPlaying } from "./core/nowPlaying.js";
import { generateDay } from "./core/day.js";
import { stationDayIndex } from "./core/tzoffsets.js";
import { signalAt, type HuntConfig } from "./core/hunt.js";
import { toInserts, type RequestRecord } from "./core/request.js";
import type { Track, Voicebank, Segment } from "./core/types.js";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const read = <T>(p: string, fallback: T): T => {
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as T;
  } catch {
    return fallback;
  }
};
const library = read<Track[]>(resolve(root, "data", "library.json"), []);
const hunt = read<HuntConfig | undefined>(resolve(root, "data", "hunt.json"), undefined);
const EPOCH = new Date("2026-10-31T00:00:00Z").getTime(); // same epoch as the station server

// Voice bank plus any booked listener requests, re-read per call so it matches the live station.
function voicebank(): Voicebank {
  const vb = read<Voicebank>(resolve(root, "data", "voicebank.json"), { clips: [] });
  const reqs = read<Record<string, RequestRecord>>(resolve(homedir(), ".deadair", "requests", "requests.json"), {});
  return { ...vb, inserts: toInserts(Object.values(reqs)) };
}

const la = (ms: number) =>
  new Date(ms).toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "medium" });

function parseAt(at?: string): number {
  if (!at) return Date.now();
  const n = Number(at);
  if (Number.isFinite(n)) return n;
  const d = Date.parse(at);
  if (!Number.isFinite(d)) throw new Error(`Could not read the time "${at}". Use epoch ms or an ISO date.`);
  return d;
}

function describe(s: Segment): Record<string, unknown> {
  const base = { kind: s.kind, starts: la(s.startMs), seconds: Math.round((s.endMs - s.startMs) / 100) / 10 };
  if (s.kind === "song") return { ...base, title: s.title, trackId: s.trackId, talkup: s.talkup?.text };
  if (s.kind === "voice") return { ...base, clip: s.clipId, clipKind: s.clipKind, text: s.text };
  if (s.kind === "numbers") return { ...base, short: !!s.short };
  return base;
}

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });

const server = new McpServer({ name: "dead-air-station", version: "1.0.0" });

server.registerTool(
  "whats_on",
  {
    description: "What 1714 AM is playing at a moment (default now), plus the next five segments. Times are station time (Los Angeles).",
    inputSchema: { at: z.string().optional().describe("epoch ms or ISO date; default now") },
  },
  async ({ at }) => {
    const t = parseAt(at);
    const r = nowPlaying(library, voicebank(), [], EPOCH, t);
    return text({ at: la(t), now: describe(r.segment), offsetSeconds: Math.round(r.offsetMs / 1000), next: r.next.map(describe) });
  }
);

server.registerTool(
  "find_track",
  {
    description: "Search the 1,101-song library by title. Returns id, length, talk-up window and when the song was made.",
    inputSchema: { query: z.string().min(1) },
  },
  async ({ query }) => {
    const q = query.toLowerCase();
    const hits = library.filter((t) => t.title.toLowerCase().includes(q)).slice(0, 15);
    return text(hits.map((t) => ({ id: t.id, title: t.title, seconds: t.seconds, talkup_seconds: t.talkup_seconds, made_at: t.made_at })));
  }
);

server.registerTool(
  "talkup_window",
  {
    description: "How long Dead John can talk over a song's intro before the music turns (the post), from the library analysis.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const t = library.find((x) => x.id === id);
    if (!t) return text({ error: `No track with id "${id}". Try find_track first.` });
    return text({ title: t.title, talkup_seconds: t.talkup_seconds, seconds: t.seconds, lufs: t.lufs });
  }
);

server.registerTool(
  "day_summary",
  {
    description: "The shape of one station day: songs, breaks, talk-ups, sponsor reads, IDs, numbers readings, the EBS time, and listener requests.",
    inputSchema: { date: z.string().optional().describe("any time inside the day, epoch ms or ISO; default today") },
  },
  async ({ date }) => {
    const t = parseAt(date);
    const day = generateDay(stationDayIndex(t, EPOCH), library, voicebank(), [], EPOCH);
    const voice = day.segments.filter((s) => s.kind === "voice");
    const songs = day.segments.filter((s) => s.kind === "song");
    const count = (k: string) => voice.filter((s) => s.kind === "voice" && s.clipKind === k).length;
    const ebs = day.segments.find((s) => s.kind === "ebs");
    return text({
      day: la(day.startMs),
      hours: Math.round((day.endMs - day.startMs) / 360_000) / 10,
      songs: songs.length,
      talkups: songs.filter((s) => s.kind === "song" && s.talkup).length,
      breaks: voice.length,
      ids: count("id"),
      sponsors: count("sponsor"),
      requests: count("request"),
      numbers: day.segments.filter((s) => s.kind === "numbers").length,
      ebs: ebs ? la(ebs.startMs) : null,
    });
  }
);

server.registerTool(
  "library_stats",
  { description: "Totals for the song library: count, hours of music, average length, talk-up windows." },
  async () => {
    const secs = library.reduce((a, t) => a + t.seconds, 0);
    const tu = library.map((t) => t.talkup_seconds).sort((a, b) => a - b);
    return text({
      songs: library.length,
      hours: Math.round(secs / 360) / 10,
      averageMinutes: Math.round(secs / library.length / 6) / 10,
      talkupSeconds: { min: tu[0], median: tu[Math.floor(tu.length / 2)], max: tu[tu.length - 1] },
    });
  }
);

server.registerTool(
  "signal_check",
  {
    description: "Developer tool for the Hunt: what (if anything) a frequency carries at a moment, exactly as GET /signal would answer.",
    inputSchema: { freq: z.number(), at: z.string().optional() },
  },
  async ({ freq, at }) => {
    if (!hunt) return text({ error: "data/hunt.json not found" });
    const t = parseAt(at);
    return text({ at: la(t), freq, signal: signalAt(hunt, freq, t, EPOCH) });
  }
);

await server.connect(new StdioServerTransport());
console.error("dead-air-station MCP server ready");
