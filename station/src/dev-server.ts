import express from "express";
import { readFileSync, statSync, createReadStream } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { handleRequest } from "./core/handler.js";
import type { Track, Voicebank, FeaturedEntry } from "./core/types.js";
import type { HuntConfig } from "./core/hunt.js";
import { createHash, randomUUID } from "crypto";
import { homedir } from "os";
import {
  validateRequest,
  parseBlocklist,
  RateLimiter,
  REASONS,
  publicStatus,
  toInserts,
  type RequestRecord,
} from "./core/request.js";
import { JsonFileStore } from "./request-store.js";
import { schedule } from "./core/schedule.js";
import { Broadcast } from "./broadcast.js";
import { spawnSync } from "child_process";
import { stationDayStart } from "./core/tzoffsets.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = resolve(__dirname, "..", ".."); // src -> station -> repo root (data/ lives there)

const app = express();

// Load data
let library: Track[] = [];
let voicebank: Voicebank = { clips: [] };
let featured: FeaturedEntry[] = [];
let hunt: HuntConfig | undefined;
const epochMs = new Date("2026-10-31T00:00:00Z").getTime();

try {
  const libraryPath = resolve(projectRoot, "data", "library.json");
  library = JSON.parse(readFileSync(libraryPath, "utf-8"));
  console.log(`Loaded ${library.length} songs from library.json`);
} catch (e) {
  console.warn("Could not load library.json");
}

try {
  const voicebankPath = resolve(projectRoot, "data", "voicebank.json");
  voicebank = JSON.parse(readFileSync(voicebankPath, "utf-8"));
  console.log(`Loaded ${voicebank.clips.length} clips from voicebank.json`);
} catch (e) {
  console.warn("Could not load voicebank.json");
}

try {
  const featuredPath = resolve(projectRoot, "data", "featured.json");
  featured = JSON.parse(readFileSync(featuredPath, "utf-8"));
  console.log(`Loaded ${featured.length} featured songs from featured.json`);
} catch (e) {
  console.warn("Could not load featured.json");
}

try {
  const huntPath = resolve(projectRoot, "data", "hunt.json");
  hunt = JSON.parse(readFileSync(huntPath, "utf-8"));
  console.log(`Loaded ${hunt!.stations.length} hidden stations from hunt.json`);
} catch (e) {
  console.warn("Could not load hunt.json");
}

// Get audio directories from environment variables
const libraryOut = process.env.LIBRARY_OUT || "C:\\Users\\machi\\.deadair\\library_mp3";
const voiceOut = process.env.VOICE_OUT || "C:\\Users\\machi\\.deadair\\voice_mp3";

// --- Request line (request-line spec) --------------------------------------
// Queue and rendered reads live outside the repo; the studio worker on this laptop fills them in.
const requestsDir = process.env.REQUESTS_DIR || resolve(homedir(), ".deadair", "requests");
const requestStore = new JsonFileStore(resolve(requestsDir, "requests.json"));
const limiter = new RateLimiter();
let blocklist: string[] = [];
try {
  blocklist = parseBlocklist(readFileSync(resolve(projectRoot, "data", "blocklist.txt"), "utf-8"));
} catch {
  console.warn("Could not load blocklist.txt");
}
const songIds = new Set(library.map((t) => t.id));
const songTitles = new Map(library.map((t) => [t.id, t.title]));
// Callers are told apart by a salted hash of their address; raw IPs are never stored.
const salt = randomUUID();
const callerOf = (req: express.Request) =>
  createHash("sha256").update(salt + String(req.headers["cf-connecting-ip"] || req.ip)).digest("hex").slice(0, 16);

// Route /now and /signal through the shared handler.
async function routeHandler(req: express.Request, res: express.Response) {
  const mockRequest = new Request(
    `http://localhost:8787${req.url}`,
    { method: "GET" }
  );

  const response = await handleRequest(mockRequest, {
    library,
    // Scheduled listener requests are part of the day (they only change what airs after airAt).
    voicebank: { ...voicebank, inserts: toInserts(await requestStore.list()) },
    featured,
    epoch: epochMs,
    hunt,
  });

  res.status(response.status);
  for (const [key, value] of response.headers) {
    res.setHeader(key, value);
  }
  const body = await response.text();
  res.send(body.length ? body : undefined);
}

app.get("/now", routeHandler);
app.get("/signal", routeHandler);

// --- The station as a real radio stream (plays in the background and on the lock screen) ---------
const ffmpeg = process.env.FFMPEG || "C:\\Users\\machi\\Downloads\\ffmpeg-8.0.1-essentials_build_CLEAN\\bin\\ffmpeg.exe";
let streamInserts = toInserts([]);
const refreshInserts = async () => {
  streamInserts = toInserts(await requestStore.list());
};
void refreshInserts();
setInterval(() => void refreshInserts(), 10_000);
const clipLengths = new Map<string, number>();
const broadcast = new Broadcast({
  ffmpeg,
  alwaysOn: process.env.STREAM_ALWAYS_ON === "1",
  segments: (from, to) => schedule(library, { ...voicebank, inserts: streamInserts }, featured, epochMs, from, to),
  localFile: (url) => {
    const name = url.slice(url.lastIndexOf("/") + 1);
    if (url.startsWith("/audio/")) return resolve(libraryOut, name);
    if (url.startsWith("/requests/")) return resolve(requestsDir, name);
    return resolve(voiceOut, name);
  },
  clipSeconds: (file) => {
    if (!clipLengths.has(file)) {
      const r = spawnSync(ffmpeg.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1"),
        ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { windowsHide: true });
      clipLengths.set(file, Number(String(r.stdout).trim()) || 0);
    }
    return clipLengths.get(file)!;
  },
});
app.get("/stream", (_req, res) => broadcast.attach(res));

// Safety net: never let this process eat the laptop. Over the limit, log and exit; PM2 restarts it.
const RSS_LIMIT_MB = Number(process.env.RSS_LIMIT_MB) || 1500;
setInterval(() => {
  const rss = process.memoryUsage().rss / 1e6;
  if (process.env.STREAM_DEBUG) console.log("[mem]", Math.round(rss), "MB", JSON.stringify(broadcast.stats()));
  if (rss > RSS_LIMIT_MB) {
    console.error(`[mem] ${Math.round(rss)} MB over the ${RSS_LIMIT_MB} MB limit, restarting`, JSON.stringify(broadcast.stats()));
    process.exit(1);
  }
}, 5000).unref();

// Song list for the request form (titles are public anyway).
app.get("/songs", (_req, res) => {
  res.setHeader("Cache-Control", "max-age=3600");
  res.json(library.map((t) => ({ id: t.id, title: t.title })));
});

app.post("/request", express.json({ limit: "2kb" }), async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const caller = callerOf(req);
  const now = Date.now();
  const limit = limiter.check(caller, now);
  if (limit !== "ok") return res.status(429).json({ reason: limit === "slow" ? REASONS.slow : REASONS.busy });
  const v = validateRequest(req.body ?? {}, blocklist, songIds);
  if (!v.ok) return res.status(400).json({ reason: v.reason });
  // A song that already aired today can't air again today (no repeats in 24 h), so don't promise it.
  const airedToday = schedule(library, voicebank, featured, epochMs, stationDayStart(now), now)
    .some((s) => s.kind === "song" && s.trackId === v.value.songId);
  if (airedToday) return res.status(400).json({ reason: REASONS.played });
  limiter.accept(caller, now);
  const rec: RequestRecord = {
    ticket: randomUUID(),
    ...v.value,
    songTitle: songTitles.get(v.value.songId) || "",
    createdAt: now,
    status: "queued",
  };
  await requestStore.put(rec);
  res.status(202).json({
    ticket: rec.ticket,
    message: "Got it. Stay tuned to 1714. I'll read it in a few minutes.",
  });
});

app.get("/request/:ticket", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const tz = typeof req.query.tz === "string" ? req.query.tz : undefined;
  res.json(publicStatus(await requestStore.get(req.params.ticket), tz));
});

// Rendered request reads (written by the studio worker).
app.get("/requests/:file", (req, res) => {
  const filePath = resolve(requestsDir, req.params.file);
  if (!filePath.startsWith(requestsDir) || !filePath.endsWith(".mp3")) return res.status(403).send("Forbidden");
  res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) res.status(404).send("Not Found");
  });
});

// GET /audio/<file> endpoint with Range support
app.get("/audio/:file", (req, res) => {
  const filePath = resolve(libraryOut, req.params.file);

  // Security: ensure path is within libraryOut
  if (!filePath.startsWith(libraryOut)) {
    return res.status(403).send("Forbidden");
  }

  try {
    const stat = statSync(filePath);
    const fileSize = stat.size;

    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Length", end - start + 1);
      res.setHeader("Content-Type", "audio/mpeg");

      const stream = createReadStream(filePath, { start, end });
      stream.pipe(res);
    } else {
      res.setHeader("Content-Length", fileSize);
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Accept-Ranges", "bytes");
      const stream = createReadStream(filePath);
      stream.pipe(res);
    }
  } catch (e) {
    res.status(404).send("Not Found");
  }
});

// GET /voice/<file> endpoint with Range support
app.get("/voice/:file", (req, res) => {
  const filePath = resolve(voiceOut, req.params.file);

  // Security: ensure path is within voiceOut
  if (!filePath.startsWith(voiceOut)) {
    return res.status(403).send("Forbidden");
  }

  try {
    const stat = statSync(filePath);
    const fileSize = stat.size;

    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Length", end - start + 1);
      res.setHeader("Content-Type", "audio/mpeg");

      const stream = createReadStream(filePath, { start, end });
      stream.pipe(res);
    } else {
      res.setHeader("Content-Length", fileSize);
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Accept-Ranges", "bytes");
      const stream = createReadStream(filePath);
      stream.pipe(res);
    }
  } catch (e) {
    res.status(404).send("Not Found");
  }
});

// Production: serve the built tuner (web/dist) from the same origin as the API.
// STATIC_DIR=<path to web/dist> PORT=<port> npx tsx src/dev-server.ts
const staticDir = process.env.STATIC_DIR;
if (staticDir) {
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https://cloudflareinsights.com"
    );
    next();
  });
  // Hashed assets can be cached for good; the page itself must always be revalidated, or
  // listeners keep running an old build after a deploy.
  app.use(
    express.static(staticDir, {
      index: "index.html",
      setHeaders: (res, path) => {
        res.setHeader(
          "Cache-Control",
          /[\\/]assets[\\/]/.test(path) ? "public, max-age=31536000, immutable" : "no-cache"
        );
      },
    })
  );
  console.log(`Serving tuner from ${staticDir}`);
}

const port = Number(process.env.PORT) || 8787;
// HOST=127.0.0.1 in production: only the Cloudflare tunnel on this machine can reach it.
const host = process.env.HOST || "::";
const server = app.listen(port, host, () => {
  console.log(`Dev server listening on http://${host}:${port}`);
  console.log(`Audio directory: ${libraryOut}`);
  console.log(`Voice directory: ${voiceOut}`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down");
  server.close(() => {
    process.exit(0);
  });
});
