/** QA pass: JsonFileStore round trip, atomic write, corrupt-file recovery. No network. */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { JsonFileStore } from "../src/request-store.js";
import type { RequestRecord } from "../src/core/request.js";

const rec = (ticket: string, over: Partial<RequestRecord> = {}): RequestRecord => ({
  ticket, from: "Ann", to: "Bob", message: "hi", songId: "s1", songTitle: "Song",
  createdAt: 1, status: "queued", ...over,
});

let dir: string;
let file: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "deadair-store-")); file = join(dir, "nested", "requests.json"); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("JsonFileStore", () => {
  it("creates the parent folder and starts empty", async () => {
    const s = new JsonFileStore(file);
    expect(await s.list()).toEqual([]);
    expect(await s.get("nope")).toBeUndefined();
  });

  it("round trips and overwrites by ticket", async () => {
    const s = new JsonFileStore(file);
    await s.put(rec("a"));
    await s.put(rec("b"));
    await s.put(rec("a", { status: "aired" }));
    expect((await s.get("a"))?.status).toBe("aired");
    expect((await s.list()).map((r) => r.ticket).sort()).toEqual(["a", "b"]);
  });

  it("leaves no temp file behind", async () => {
    const s = new JsonFileStore(file);
    await s.put(rec("a"));
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });

  it("treats a corrupt file as empty instead of throwing", async () => {
    const s = new JsonFileStore(file);
    writeFileSync(file, "{not json");
    expect(await s.list()).toEqual([]);
    await s.put(rec("a"));
    expect(await s.get("a")).toBeDefined();
  });
});
