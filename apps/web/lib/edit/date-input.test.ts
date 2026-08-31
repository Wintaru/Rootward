import { describe, expect, it } from "vitest";

import { interpretDateInput } from "./date-input";

/**
 * One case per `genealogy_date_kind` (SPEC §8.3's "Done when" — a correct
 * interpretation for every kind). `date_kind: "unknown"` is reachable in
 * `parseGenealogyDate` only via a blank input (`packages/shared/src/genealogy-date.ts`),
 * which `interpretDateInput` short-circuits before ever calling the parser —
 * covered by the blank-input case below instead of a parser-level fixture.
 */
describe("interpretDateInput", () => {
  it.each([
    ["", "", false],
    ["   ", "", false],
    ["14 FEB 1750", "14 February 1750", false],
    ["ABT 1850", "About 1850", false],
    ["EST 1850", "Estimated 1850", false],
    ["CAL 1850", "Calculated 1850", false],
    ["BEF 1900", "Before 1900", false],
    ["AFT 1900", "After 1900", false],
    ["BET 1850 AND 1860", "Between 1850 and 1860", false],
    ["FROM 1850 TO 1860", "From 1850 to 1860", false],
    ["INT 1850 (approximate)", "1850 (approximate)", false],
    ["(a family story, no record)", "a family story, no record", true],
    ["sometime last century", "sometime last century", true],
  ] satisfies [string, string, boolean][])(
    "interprets %j",
    (raw, preview, flagged) => {
      expect(interpretDateInput(raw)).toEqual({ preview, flagged });
    },
  );
});
