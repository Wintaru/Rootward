import { describe, expect, it } from "vitest";

import { normalizePlaceName as gedcomNormalizePlaceName } from "../../../../packages/gedcom/src/reader";

import { normalizePlaceName } from "./place";

/**
 * `place.ts`'s `normalizePlaceName` is a deliberate duplicate of
 * `packages/gedcom`'s (see the comment there for why apps/web does not import
 * `@rootward/gedcom` just for this). Both must produce the same
 * `place.normalized_name` key for the same input, or the edit view's
 * find-or-create (`findOrCreatePlaceId`) and the GEDCOM importer's dedupe
 * would split one real-world place into two `place` rows. This guard fails
 * the moment the two drift, the way the other `*-parity.test.ts` files in
 * this directory guard their own cross-boundary copies.
 */

const FIXTURES = [
  "Boston, Suffolk, Massachusetts",
  "BOSTON, SUFFOLK, MASSACHUSETTS",
  "  Boston , Suffolk ,  Massachusetts  ",
  "Boston; Suffolk; Massachusetts",
  "New York City",
  "St. Louis, Missouri",
  "",
  "   ",
  "Île-de-France",
];

describe("normalizePlaceName parity with packages/gedcom", () => {
  it.each(FIXTURES)("matches for %j", (input) => {
    expect(normalizePlaceName(input)).toBe(gedcomNormalizePlaceName(input));
  });
});
