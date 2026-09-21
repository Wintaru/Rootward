import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { COLOR_MODES, DEFAULT_MODE } from "./preference";
import { DEFAULT_THEME, THEME_IDS } from "./registry";

/**
 * `account.theme` / `account.color_mode` (#80) carry CHECK lists that
 * restate `THEME_IDS` and `COLOR_MODES`, and column defaults that restate
 * `DEFAULT_THEME` / `DEFAULT_MODE`. Nothing forces them to track: a ninth
 * theme added to the registry without a migration would let a member pick
 * it in the UI and get a `check_violation` on save. Same pattern as
 * `tree-depth-parity.test.ts`.
 *
 * A shipped migration is never edited, so the list grows by a later
 * migration that re-creates the constraint. The guard therefore takes the
 * *last* definition of each constraint across every migration, in filename
 * (timestamp) order — a guard pinned to one file would fail for the wrong
 * reason the day the list grows.
 */

const MIGRATIONS_DIR = fileURLToPath(
  new URL("../../../../supabase/migrations/", import.meta.url),
);

const MIGRATIONS_IN_ORDER = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(`${MIGRATIONS_DIR}${name}`, "utf8"));

/** The quoted values of the newest `constraint <name> check (<col> in (…))`. */
function latestCheckList(constraint: string, column: string): string[] {
  const pattern = new RegExp(
    `constraint ${constraint}\\s+check \\(${column} in \\(([^)]*)\\)\\)`,
  );
  const definitions = MIGRATIONS_IN_ORDER.flatMap((sql) => {
    const match = sql.match(pattern);
    return match?.[1] === undefined ? [] : [match[1]];
  });
  const latest = definitions.at(-1);
  if (latest === undefined) {
    throw new Error(`no migration defines ${constraint}`);
  }
  return [...latest.matchAll(/'([^']+)'/g)].flatMap((m) =>
    m[1] === undefined ? [] : [m[1]],
  );
}

/** The newest `add column <col> text not null default '<value>'`. */
function latestDefault(column: string): string {
  const pattern = new RegExp(
    `add column ${column} text not null default '([^']+)'`,
  );
  const defaults = MIGRATIONS_IN_ORDER.flatMap((sql) => {
    const match = sql.match(pattern);
    return match?.[1] === undefined ? [] : [match[1]];
  });
  const latest = defaults.at(-1);
  if (latest === undefined) {
    throw new Error(`no migration adds ${column}`);
  }
  return latest;
}

describe("account appearance columns ↔ the theme registry", () => {
  it("account_theme_check lists exactly THEME_IDS", () => {
    expect([...latestCheckList("account_theme_check", "theme")].sort()).toEqual(
      [...THEME_IDS].sort(),
    );
  });

  it("account_color_mode_check lists exactly COLOR_MODES", () => {
    expect(
      [...latestCheckList("account_color_mode_check", "color_mode")].sort(),
    ).toEqual([...COLOR_MODES].sort());
  });

  it("the column defaults are DEFAULT_THEME and DEFAULT_MODE", () => {
    expect(latestDefault("theme")).toBe(DEFAULT_THEME);
    expect(latestDefault("color_mode")).toBe(DEFAULT_MODE);
  });
});
