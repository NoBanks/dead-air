/** request-line T-4 (validation), T-5 (blocklist stays server-side), T-9 (rate limits). */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { readFileSync, readdirSync, statSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { validateRequest, parseBlocklist, RateLimiter, REASONS, publicStatus } from "../src/core/request.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const BLOCK = parseBlocklist(readFileSync(resolve(root, "data", "blocklist.txt"), "utf-8"));
const SONGS = new Set(["hey-mom", "sleeper"]);
const ok = { from: "Sam", to: "Dad", message: "Thanks for the late drives home.", songId: "sleeper" };

describe("T-4: validation", () => {
  it("accepts a normal request and tidies whitespace", () => {
    const v = validateRequest({ ...ok, message: "  Thanks   for the late nights.  " }, BLOCK, SONGS);
    expect(v).toEqual({ ok: true, value: { ...ok, message: "Thanks for the late nights." } });
  });

  it.each([
    [{ from: "" }, REASONS.name],
    [{ to: "R2D2" }, REASONS.name],
    [{ from: "A".repeat(21) }, REASONS.name],
    [{ message: "x".repeat(141) }, REASONS.long],
    [{ message: "see https://evil.example" }, REASONS.links],
    [{ message: "go to www.thing.com" }, REASONS.links],
    [{ message: "mail me a@b.co" }, REASONS.links],
    [{ message: "follow @someone" }, REASONS.links],
    [{ message: "call 5551234" }, REASONS.links],
    [{ message: "<script>" }, REASONS.links],
    [{ songId: "nope" }, REASONS.song],
  ])("rejects %j", (patch, reason) => {
    expect(validateRequest({ ...ok, ...patch }, BLOCK, SONGS)).toEqual({ ok: false, reason });
  });

  it("never echoes what the caller typed", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 6, maxLength: 200 }), (msg) => {
        const v = validateRequest({ ...ok, message: msg }, BLOCK, SONGS);
        if (!v.ok) expect(Object.values(REASONS)).toContain(v.reason);
      }),
      { numRuns: 300 }
    );
  });

  it("blocks listed words through spacing and number swaps, but not innocent names", () => {
    expect(validateRequest({ ...ok, message: "you are a b1tch" }, BLOCK, SONGS)).toEqual({ ok: false, reason: REASONS.blocked });
    expect(validateRequest({ ...ok, message: "k y s" }, BLOCK, SONGS)).toEqual({ ok: false, reason: REASONS.blocked }); // spaced letters join back up
    expect(validateRequest({ ...ok, message: "kill your self" }, BLOCK, SONGS)).toEqual({ ok: false, reason: REASONS.blocked });
    expect(validateRequest({ ...ok, from: "Cassie", message: "First class all the way" }, BLOCK, SONGS).ok).toBe(true);
  });

  // A troll's call is read on air in the creator's cloned voice, so the line errs on the side of no.
  it.each([
    "this is fucking great", "fuck-you", "f u c k", "fuuuuck this", "phuck it", "what a shitty day", "bullshit",
    "you dickhead", "he raped", "nazis rule", "sieg heil", "kill yourself", "everyone knows what you did",
    "go get a beer", "you are so stupid", "big boobs",
  ])("blocks %j", (message) => {
    expect(validateRequest({ ...ok, message }, BLOCK, SONGS)).toEqual({ ok: false, reason: REASONS.blocked });
  });

  it.each([
    "call 310 555 0199", "call 310-555-0199", "five five five oh one nine nine", "twitch.tv slash me", "site dot com",
  ])("blocks numbers and links in any shape: %j", (message) => {
    expect(validateRequest({ ...ok, message }, BLOCK, SONGS)).toEqual({ ok: false, reason: REASONS.links });
  });

  it("takes one first name each, never a full name", () => {
    expect(validateRequest({ ...ok, to: "Jake Miller" }, BLOCK, SONGS)).toEqual({ ok: false, reason: REASONS.name });
    expect(validateRequest({ ...ok, from: "Mike Hunt" }, BLOCK, SONGS)).toEqual({ ok: false, reason: REASONS.name });
    expect(validateRequest({ ...ok, from: "Mary-Kate", to: "O'Neil" }, BLOCK, SONGS).ok).toBe(true);
  });

  it.each([
    "This hit me hard on the drive home.", "Happy 40th, you are the best.", "Bobby says hi from the class of the night shift.",
    "Thanks for the swanky dinner and the late show.", "As always, love you.", "Can you play one more for the road?",
    "Hello from the basement studio.", "Grapes and therapists, what a week.",
  ])("lets an ordinary dedication through: %j", (message) => {
    expect(validateRequest({ ...ok, message }, BLOCK, SONGS).ok).toBe(true);
  });
});

describe("T-5: the blocklist never ships to the browser", () => {
  it("no web source or built file contains the blocklist", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = resolve(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else files.push(p);
      }
    };
    for (const d of ["web/src", "web/dist", "web/index.html"].map((p) => resolve(root, p))) {
      try {
        statSync(d).isDirectory() ? walk(d) : files.push(d);
      } catch {
        // not built yet
      }
    }
    for (const f of files) {
      const text = readFileSync(f, "utf-8");
      expect(text.includes("blocklist"), f).toBe(false);
      expect(/\bonlyfans\b/i.test(text), f).toBe(false);
    }
  });
});

describe("T-9: rate limits", () => {
  it("one call per caller per 10 minutes", () => {
    const r = new RateLimiter();
    expect(r.check("a", 0)).toBe("ok");
    r.accept("a", 0);
    expect(r.check("a", 9 * 60_000)).toBe("slow");
    expect(r.check("b", 9 * 60_000)).toBe("ok");
    expect(r.check("a", 10 * 60_000)).toBe("ok");
  });

  it("30 calls per rolling hour station-wide", () => {
    const r = new RateLimiter();
    for (let i = 0; i < 30; i++) r.accept(`c${i}`, i * 1000);
    expect(r.check("new", 31_000)).toBe("busy");
    expect(r.check("new", 60 * 60_000 + 1000)).toBe("ok");
  });
});

describe("REQ-14: public status", () => {
  it("shows queued for rendered, a time for scheduled, and never internals", () => {
    const rec = { ticket: "t", from: "A", to: "B", message: "m", songId: "s", songTitle: "S", createdAt: 0, clipFile: "/requests/t.mp3" };
    expect(publicStatus({ ...rec, status: "rendered" })).toEqual({ status: "queued" });
    expect(publicStatus({ ...rec, status: "dropped" })).toEqual({ status: "dropped" });
    const s = publicStatus({ ...rec, status: "scheduled", airAt: Date.UTC(2026, 10, 2, 10, 41) });
    expect(s).toEqual({ status: "scheduled", airAt: "2:41 AM" });
    expect(publicStatus(undefined)).toEqual({ status: "unknown" });
  });
});
