import express from "express";
import { readFileSync, statSync, createReadStream } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { handleRequest } from "./core/handler.js";
import type { Track, Voicebank, FeaturedEntry } from "./core/types.js";
import type { HuntConfig } from "./core/hunt.js";

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

// Route /now and /signal through the shared handler.
async function routeHandler(req: express.Request, res: express.Response) {
  const mockRequest = new Request(
    `http://localhost:8787${req.url}`,
    { method: "GET" }
  );

  const response = await handleRequest(mockRequest, {
    library,
    voicebank,
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
      "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'"
    );
    next();
  });
  app.use(express.static(staticDir, { index: "index.html", maxAge: "1h" }));
  console.log(`Serving tuner from ${staticDir}`);
}

const port = Number(process.env.PORT) || 8787;
const server = app.listen(port, () => {
  console.log(`Dev server listening on http://localhost:${port}`);
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
