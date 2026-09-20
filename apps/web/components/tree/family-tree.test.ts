import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { AVATAR_STYLES, GROUND_STYLES, NAME_FONTS } from "@/lib/theme/registry";

/**
 * Drift guards for `family-tree.css` (#78). The registry's chassis values and
 * `FamilyTree.tsx`'s card box are restated in the stylesheet, where a stale
 * copy renders the default look silently instead of failing.
 */

const here = (name: string) =>
  readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");

const CSS = here("./family-tree.css");
const TSX = here("./FamilyTree.tsx");

/** Values whose look is the base rule itself, so no selector is expected. */
const BASE_VALUES: Readonly<Record<string, string>> = {
  "data-name-font": "body",
  "data-ground": "flat",
};

describe("family-tree.css ↔ chassis switches", () => {
  it.each([
    ["data-avatar", AVATAR_STYLES],
    ["data-name-font", NAME_FONTS],
    ["data-ground", GROUND_STYLES],
  ] as const)("styles every %s value the registry allows", (attr, values) => {
    for (const value of values) {
      if (BASE_VALUES[attr] === value) {
        continue;
      }
      expect(CSS, `${attr}="${value}"`).toContain(`[${attr}="${value}"]`);
    }
  });
});

describe("family-tree.css ↔ FamilyTree.tsx card box", () => {
  const constant = (name: string): number => {
    const match = TSX.match(new RegExp(`const ${name} = (\\d+);`));
    if (match?.[1] === undefined) {
      throw new Error(`${name} not found in FamilyTree.tsx`);
    }
    return Number(match[1]);
  };
  const cardRule = CSS.slice(
    CSS.indexOf("\n.rw-card {"),
    CSS.indexOf("}", CSS.indexOf("\n.rw-card {")),
  );
  const cssPx = (property: string): number => {
    const match = cardRule.match(new RegExp(`\\n\\s*${property}: (\\d+)px;`));
    if (match?.[1] === undefined) {
      throw new Error(`${property} not found on .rw-card`);
    }
    return Number(match[1]);
  };

  it("CARD_WIDTH / CARD_HEIGHT equal .rw-card width / height", () => {
    expect(cssPx("width")).toBe(constant("CARD_WIDTH"));
    expect(cssPx("height")).toBe(constant("CARD_HEIGHT"));
  });
});
