import type { Track, Voicebank, FeaturedEntry } from "./types.js";
import type { HuntConfig } from "./hunt.js";
import { nowPlaying } from "./nowPlaying.js";
import { signalAt } from "./hunt.js";

// Shared CORS / cache headers for /signal responses.
const SIGNAL_HEADERS_MISS: Record<string, string> = {
  "Cache-Control": "no-store",
};
const SIGNAL_HEADERS_HIT: Record<string, string> = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

// HTTP handler routing /now and /signal
export async function handleRequest(
  request: Request,
  env: {
    library: Track[];
    voicebank: Voicebank;
    featured: FeaturedEntry[];
    epoch: number;
    hunt?: HuntConfig;
  }
): Promise<Response> {
  try {
    const url = new URL(request.url);

    if (url.pathname === "/now") {
      return handleNow(url, env);
    }

    if (url.pathname === "/signal") {
      return handleSignal(url, env);
    }

    return new Response("Not Found", { status: 404 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// ---------------------------------------------------------------------------
// /now
// ---------------------------------------------------------------------------

function handleNow(
  url: URL,
  env: {
    library: Track[];
    voicebank: Voicebank;
    featured: FeaturedEntry[];
    epoch: number;
  }
): Response {
  let at = Date.now();
  const tParam = url.searchParams.get("t");
  if (tParam !== null) {
    const tNum = Number(tParam);
    if (Number.isFinite(tNum)) at = tNum;
  }

  const result = nowPlaying(
    env.library,
    env.voicebank,
    env.featured,
    env.epoch,
    at
  );

  const body = {
    server_time: at,
    segment: result.segment,
    offset_ms: result.offsetMs,
    next: result.next,
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "max-age=5",
    },
  });
}

// ---------------------------------------------------------------------------
// /signal
// ---------------------------------------------------------------------------

function handleSignal(
  url: URL,
  env: {
    hunt?: HuntConfig;
    epoch: number;
  }
): Response {
  if (!env.hunt) {
    // Hunt not loaded; treat every frequency as a miss.
    return new Response(null, { status: 204, headers: SIGNAL_HEADERS_MISS });
  }

  // Parse ?t=
  let atMs = Date.now();
  const tParam = url.searchParams.get("t");
  if (tParam !== null) {
    const tNum = Number(tParam);
    if (Number.isFinite(tNum)) atMs = tNum;
  }

  // Parse ?f=
  const fParam = url.searchParams.get("f");
  const freqKHz = fParam !== null ? Number(fParam) : NaN;

  if (!Number.isFinite(freqKHz)) {
    return new Response(null, { status: 204, headers: SIGNAL_HEADERS_MISS });
  }

  const result = signalAt(env.hunt, freqKHz, atMs, env.epoch);
  if (!result) {
    return new Response(null, { status: 204, headers: SIGNAL_HEADERS_MISS });
  }

  const body = {
    page: result.page,
    clip_id: result.clipId,
    file: result.file,
    offset_ms: result.offsetMs,
    remaining_ms: result.remainingMs,
    strength: result.strength,
    server_time: atMs,
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: SIGNAL_HEADERS_HIT,
  });
}
