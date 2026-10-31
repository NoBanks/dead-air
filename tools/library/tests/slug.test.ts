/**
 * slug.test.ts - Unit tests for slugify() and buildSlug().
 * REQ-6
 */

import { describe, it, expect } from "vitest";
import { slugify, buildSlug } from "../src/slug.js";

describe("slugify", () => {
  it("converts a normal title to a hyphenated lowercase slug", () => {
    expect(slugify("Heal My Mind")).toBe("heal-my-mind");
  });

  it("falls back to track-<n> when all characters are stripped", () => {
    expect(slugify("...!!!", 5)).toBe("track-5");
    expect(slugify("---", 1)).toBe("track-1");
  });

  it("strips accented / diacritical characters", () => {
    expect(slugify("Déjà Vu")).toBe("deja-vu");
    expect(slugify("Café Racer")).toBe("cafe-racer");
  });

  it("collapses consecutive hyphens from multi-space input", () => {
    expect(slugify("A  B")).toBe("a-b");
    expect(slugify("A   Very   Long   Title")).toBe("a-very-long-title");
  });

  it("removes leading and trailing hyphens", () => {
    expect(slugify("-Hello-")).toBe("hello");
    expect(slugify("  Hello  ")).toBe("hello");
  });

  it("handles numbers and mixed case correctly", () => {
    expect(slugify("12 Pre-Roll Blues")).toBe("12-pre-roll-blues");
    expect(slugify("8 Fo' A Hunnit")).toBe("8-fo-a-hunnit");
  });

  it("produces only a-z, 0-9, and hyphens", () => {
    const result = slugify("A$B#C@D!E");
    expect(result).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});

describe("buildSlug", () => {
  it("returns the base slug when it is not in usedSet", () => {
    const used = new Set<string>();
    expect(buildSlug("Heal My Mind", 1, used)).toBe("heal-my-mind");
    expect(used.has("heal-my-mind")).toBe(true);
  });

  it("appends -2 when the base slug is already used", () => {
    const used = new Set(["heal-my-mind"]);
    expect(buildSlug("Heal My Mind", 1, used)).toBe("heal-my-mind-2");
    expect(used.has("heal-my-mind-2")).toBe(true);
  });

  it("increments the suffix until a unique slug is found", () => {
    const used = new Set(["heal-my-mind", "heal-my-mind-2", "heal-my-mind-3"]);
    expect(buildSlug("Heal My Mind", 1, used)).toBe("heal-my-mind-4");
  });

  it("adds every slug to the used set", () => {
    const used = new Set<string>();
    buildSlug("Alpha", 1, used);
    buildSlug("Beta", 2, used);
    buildSlug("Alpha", 3, used);
    expect(used.size).toBe(3);
    expect(used.has("alpha")).toBe(true);
    expect(used.has("beta")).toBe(true);
    expect(used.has("alpha-2")).toBe(true);
  });
});
