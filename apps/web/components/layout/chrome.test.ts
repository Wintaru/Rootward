import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { MARK_STYLES, NAV_STYLES } from "@/lib/theme/registry";

/**
 * Drift guard for `chrome.css` (#79): the registry's `nav` and `mark` chassis
 * values are restated as selectors in the stylesheet, where a missing one
 * renders the base look silently instead of failing.
 */
const CSS = readFileSync(
  fileURLToPath(new URL("./chrome.css", import.meta.url)),
  "utf8",
);

/** Values whose look is the base rule itself, so no selector is expected. */
const BASE_VALUES: Readonly<Record<string, string>> = {
  "data-nav": "underline",
  "data-mark": "none",
};

describe("chrome.css ↔ chassis switches", () => {
  it.each([
    ["data-nav", NAV_STYLES],
    ["data-mark", MARK_STYLES],
  ] as const)("styles every %s value the registry allows", (attr, values) => {
    for (const value of values) {
      if (BASE_VALUES[attr] === value) {
        continue;
      }
      expect(CSS, `${attr}="${value}"`).toContain(`[${attr}="${value}"]`);
    }
  });
});
