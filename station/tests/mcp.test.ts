/** The dead-air-station MCP server answers a real MCP client over stdio. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";

const station = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
let client: Client;
// A fresh clone has no data/library.json (gitignored); fall back to a small committed fixture.
const realLibrary = resolve(station, "..", "data", "library.json");
const libraryPath = existsSync(realLibrary) ? realLibrary : resolve(station, "tests", "fixtures", "library.sample.json");

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[] };
  return JSON.parse(r.content[0].text);
};

beforeAll(async () => {
  client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", resolve(station, "src", "mcp-server.ts")], cwd: station, env: { ...(process.env as Record<string, string>), DEAD_AIR_LIBRARY: libraryPath } })
  );
}, 60_000);

afterAll(async () => {
  await client?.close();
});

describe("dead-air-station MCP", () => {
  it("lists its six tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["day_summary", "find_track", "library_stats", "signal_check", "talkup_window", "whats_on"]
    );
  });

  it("whats_on returns a segment and five next", async () => {
    const r = await call("whats_on", { at: "2026-11-02T10:00:00Z" });
    expect(r.now.kind).toBeTruthy();
    expect(r.next).toHaveLength(5);
  });

  it("find_track and talkup_window agree", async () => {
    const hits = await call("find_track", { query: "hey mom" });
    expect(hits.length).toBeGreaterThan(0);
    const w = await call("talkup_window", { id: hits[0].id });
    expect(w.talkup_seconds).toBe(hits[0].talkup_seconds);
  });

  it("day_summary has one EBS and hourly IDs", async () => {
    const d = await call("day_summary", { date: "2026-11-03T20:00:00Z" });
    expect(d.ebs).toBeTruthy();
    expect(d.ids).toBeGreaterThanOrEqual(23);
    expect(d.songs).toBeGreaterThan(300);
  });

  it("signal_check misses on plain static", async () => {
    const r = await call("signal_check", { freq: 1200 });
    expect(r.signal).toBeNull();
  });
});
