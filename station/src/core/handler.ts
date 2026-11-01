import type { Track, Voicebank, FeaturedEntry } from "./types.js";
import { nowPlaying } from "./nowPlaying.js";

// HTTP handler for GET /now
export async function handleRequest(
  request: Request,
  env: {
    library: Track[];
    voicebank: Voicebank;
    featured: FeaturedEntry[];
    epoch: number;
  }
): Promise<Response> {
  try {
    const url = new URL(request.url);
    let at = Date.now();

    // Check for ?t=<ms> parameter
    const tParam = url.searchParams.get("t");
    if (tParam !== null) {
      const tNum = Number(tParam);
      if (Number.isFinite(tNum)) {
        at = tNum;
      }
      // Non-finite: fall through to Date.now()
    }

    const result = nowPlaying(
      env.library,
      env.voicebank,
      env.featured,
      env.epoch,
      at
    );

    // Format the response
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
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
