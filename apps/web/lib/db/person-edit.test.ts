import { describe, expect, it } from "vitest";

import { computeIsLivingFallback } from "./person-edit";

/**
 * Mirrors `person_is_living()`'s no-override branch (SPEC §5, §4.2, #58) —
 * see `computeIsLivingFallback`'s own doc comment for why this duplicates
 * the SQL function rather than calling it.
 */
describe("computeIsLivingFallback", () => {
  it("is not living when a death event exists, regardless of birth year", () => {
    expect(
      computeIsLivingFallback({
        hasDeathEvent: true,
        earliestBirthYear: 1990,
        livingThresholdYears: 100,
        currentYear: 2026,
      }),
    ).toBe(false);
  });

  it("is living when there is no death event and no birth year", () => {
    expect(
      computeIsLivingFallback({
        hasDeathEvent: false,
        earliestBirthYear: null,
        livingThresholdYears: 100,
        currentYear: 2026,
      }),
    ).toBe(true);
  });

  it("is living when the birth year is within the threshold", () => {
    expect(
      computeIsLivingFallback({
        hasDeathEvent: false,
        earliestBirthYear: 1950,
        livingThresholdYears: 100,
        currentYear: 2026,
      }),
    ).toBe(true);
  });

  it("is not living when the birth year is past the threshold", () => {
    expect(
      computeIsLivingFallback({
        hasDeathEvent: false,
        earliestBirthYear: 1900,
        livingThresholdYears: 100,
        currentYear: 2026,
      }),
    ).toBe(false);
  });

  it("treats a birth year exactly at the threshold as not living", () => {
    expect(
      computeIsLivingFallback({
        hasDeathEvent: false,
        earliestBirthYear: 1926,
        livingThresholdYears: 100,
        currentYear: 2026,
      }),
    ).toBe(false);
  });
});
