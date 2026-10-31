/**
 * slug.property.test.ts - Property-based tests for slug generation.
 * REQ-6 using fast-check
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { slugify, buildSlug } from "../src/slug.js";

describe("slug properties", () => {
  it("stability: slugify returns the same result when called twice", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const first = slugify(s, 1);
        const second = slugify(s, 1);
        return first === second;
      })
    );
  });

  it("character set: output matches [a-z0-9]+ with optional hyphens or fallback pattern", () => {
    const pattern = /^[a-z0-9]+(-[a-z0-9]+)*$|^track-\d+$/;
    fc.assert(
      fc.property(fc.string(), (s) => {
        const result = slugify(s, 1);
        return pattern.test(result);
      })
    );
  });

  it("never empty: slugify never returns empty string or only hyphens", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const result = slugify(s, 1);
        return result.length > 0 && result !== "-" && result !== "--";
      })
    );
  });

  it("uniqueness after dedup: N arbitrary titles produce N distinct slugs", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string(), { minLength: 1, maxLength: 100 }),
        (titles) => {
          const used = new Set<string>();
          const slugs = titles.map((t, i) => buildSlug(t, i + 1, used));
          const uniqueSlugs = new Set(slugs);
          return uniqueSlugs.size === slugs.length;
        }
      )
    );
  });

  it("dedup: buildSlug adds every slug to the usedSet", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string(), { minLength: 1, maxLength: 20 }),
        (titles) => {
          const used = new Set<string>();
          for (let i = 0; i < titles.length; i++) {
            buildSlug(titles[i], i + 1, used);
          }
          return used.size === titles.length;
        }
      )
    );
  });

  it("no consecutive hyphens: output never has -- ", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const result = slugify(s, 1);
        return !result.includes("--");
      })
    );
  });

  it("no leading/trailing hyphens: output never starts or ends with -", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const result = slugify(s, 1);
        return !result.startsWith("-") && !result.endsWith("-");
      })
    );
  });
});
