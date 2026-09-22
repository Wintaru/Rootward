import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ACCESS_REQUEST_ONE_PENDING_PER_ACCOUNT } from "@rootward/shared";

/**
 * The constraint names in `db-constraints.ts` are matched against a Postgres
 * error message at run time, so a name that drifts from the schema fails
 * silently: `isUniqueViolationOn` stops matching and an expected collision
 * turns back into an error the user sees.
 *
 * `supabase/tests/schema_guards_test.sql` covers the other direction, but it
 * holds its own copy of the string, so a rename applied to the migration and
 * the pgTAP file together would leave this module stale and every test green.
 * This closes that loop by reading the migrations themselves, the way
 * `onboarding-match/schema_parity.test.ts` and `onboarding-parity.test.ts`
 * already guard their cross-boundary copies.
 *
 * It lives here rather than beside `db-constraints.ts` because
 * `packages/shared` is deliberately free of Node built-ins, so a C# port stays
 * possible (decision 8), and reading a directory needs `node:fs`.
 */

const migrationsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../supabase/migrations",
);

function allMigrationSql(): string {
  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => readFileSync(join(migrationsDir, name), "utf8"))
    .join("\n");
}

/** Every name the application matches on, with the object it must name. */
const NAMED_CONSTRAINTS: readonly {
  readonly constant: string;
  readonly name: string;
}[] = [
  {
    constant: "ACCESS_REQUEST_ONE_PENDING_PER_ACCOUNT",
    name: ACCESS_REQUEST_ONE_PENDING_PER_ACCOUNT,
  },
];

describe("db-constraints parity with the migrations", () => {
  const sql = allMigrationSql();

  it("reads the migrations directory", () => {
    // Guards the guard: a wrong path would make every assertion below vacuous.
    expect(sql.length).toBeGreaterThan(0);
    expect(sql).toContain("create table");
  });

  it.each(NAMED_CONSTRAINTS)(
    "$constant names an index some migration creates",
    ({ name }) => {
      const created = new RegExp(
        `create\\s+unique\\s+index\\s+(?:if\\s+not\\s+exists\\s+)?${name}\\b`,
        "i",
      );
      expect(sql).toMatch(created);
    },
  );
});
