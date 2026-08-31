import { MAX_GENERATIONS, clampGenerations } from "@/lib/db/neighborhood";

/**
 * Tree-view URL state (SPEC §8.2, §8.1, issue #23).
 *
 * The focus person is the `[personId]` route segment (WAYFINDER decision 28) —
 * shareable, and the back button walks focus history. The depth override is
 * carried in the `up` / `down` query string, present only when it differs from
 * the deployment default, so the common URL stays a bare `/tree/<id>`.
 *
 * Pure: no router, no `window`. `FamilyTree` builds hrefs with {@link treeHref}
 * and hands them to `router.push`; the page reads them back with
 * {@link resolveTreeDepth}.
 */

/** Generations to show each way from the focus person. */
export interface TreeDepth {
  readonly up: number;
  readonly down: number;
}

export const MIN_GENERATIONS = 0;
export { MAX_GENERATIONS, clampGenerations };

/**
 * Read `?up=` / `?down=` off the tree route, falling back to `defaults` (the
 * `tree_settings` values) when a param is absent, blank, or not a number.
 * Clamps to `0..MAX_GENERATIONS` — the same bound the `get_neighborhood`
 * function enforces.
 */
export function resolveTreeDepth(
  searchParams: Record<string, string | string[] | undefined>,
  defaults: TreeDepth,
): TreeDepth {
  return {
    up: readDepthParam(searchParams.up, defaults.up),
    down: readDepthParam(searchParams.down, defaults.down),
  };
}

function readDepthParam(
  raw: string | string[] | undefined,
  fallback: number,
): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return clampGenerations(parsed);
}

/**
 * The `/tree/<personId>` href for a re-centre or a depth change. `up` / `down`
 * are added only when they differ from `defaults`, so a view at the default
 * depth links to a clean `/tree/<personId>`.
 */
export function treeHref(
  personId: string,
  depth: TreeDepth,
  defaults: TreeDepth,
): string {
  const params = new URLSearchParams();
  if (depth.up !== defaults.up) {
    params.set("up", String(depth.up));
  }
  if (depth.down !== defaults.down) {
    params.set("down", String(depth.down));
  }
  const query = params.toString();
  return query === "" ? `/tree/${personId}` : `/tree/${personId}?${query}`;
}
