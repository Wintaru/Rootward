import type { NeighborhoodFamily } from "@/lib/db";

/**
 * Which spouse links the tree should draw as ended (issue #122). `family-chart`
 * 0.9 draws every spouse link the same and exposes no per-link hook, so the
 * tree tags the ended ones itself after each layout — this module is the pure
 * half of that: the set of ended couples from the neighborhood, and the
 * defensive read of a link's d3 datum (same stance as `generation-bands.ts`:
 * the library's shapes are read as `unknown`, never trusted).
 */

/** Order-independent key for a couple — a link's two ends come back in
 * whichever order the layout placed them. */
export function unionKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Keys (see {@link unionKey}) of every two-partner family whose union ended.
 * A single-partner family has no spouse link to tag. */
export function endedUnionKeys(
  families: readonly NeighborhoodFamily[],
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const family of families) {
    if (
      family.ended_by !== null &&
      family.partner1_id !== null &&
      family.partner2_id !== null
    ) {
      keys.add(unionKey(family.partner1_id, family.partner2_id));
    }
  }
  return keys;
}

/**
 * The couple a `family-chart` link datum joins, or `null` for anything that
 * is not a spouse link (parent → child links carry `spouse: false` and an
 * array `source`). The datum is what d3 bound to the `path.link` element:
 * `{ spouse: true, source: <node>, target: <node> }` with each node's
 * `data.id` being our person id.
 */
export function readSpouseLinkKey(datum: unknown): string | null {
  if (typeof datum !== "object" || datum === null) {
    return null;
  }
  const link = datum as {
    spouse?: unknown;
    source?: { data?: { id?: unknown } };
    target?: { data?: { id?: unknown } };
  };
  if (link.spouse !== true) {
    return null;
  }
  const sourceId = link.source?.data?.id;
  const targetId = link.target?.data?.id;
  if (typeof sourceId !== "string" || typeof targetId !== "string") {
    return null;
  }
  return unionKey(sourceId, targetId);
}
