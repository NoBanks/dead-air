import express from "express";
import { readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { handleRequest } from "./core/handler.js";
import type { Track, Voicebank, FeaturedEntry } from "./core/types.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = resolve(__dirname, "..");

const app = express();

// Load data
let library: Track[] = [];
let voicebank: Voicebank = { clips: [] };
let featured: FeaturedEntry[] = [];
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
  console.log(
    `Loaded ${voicebank.clips.length} clips from voicebank.json`
  );
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

// GET /now endpoint
app.get("/now", async (req, res) => {
  const mockRequest = new Request(
    `http://localhost:8787/now${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`,
    {
      method: "GET",
    }
  );

  const response = await handleRequest(mockRequest, {
    library,
    voicebank,
    featured,
    epoch: epochMs,
  });

  res.status(response.status);
  for (const [key, value] of response.headers) {
    res.setHeader(key, value);
  }
  res.send(await response.text());
});

const port = 8787;
const server = app.listen(port, () => {
  console.log(`Dev server listening on http://localhost:${port}`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down");
  server.close(() => {
    process.exit(0);
  });
});
