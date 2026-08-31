import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_GENERATIONS_DOWN,
  DEFAULT_GENERATIONS_UP,
  MAX_GENERATIONS,
} from "./neighborhood";

/**
 * The tree-depth constants restate values that live in SQL: the
 * `get_neighborhood` clamp and argument defaults, and the `tree_settings`
 * column defaults. Nothing forces them to track. This guard fails when they
 * drift — same pattern as `onboarding-parity.test.ts` / `schema_parity.test.ts`.
 * Drift here does not crash (the SQL re-clamps), it just makes the depth
 * stepper offer generations that never render, or under-serve — which is
 * exactly the kind of thing that goes unnoticed.
 */

const migrations = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../supabase/migrations",
);

function read(file: string): string {
  return readFileSync(resolve(migrations, file), "utf8");
}

describe("tree-depth constant parity with the migrations", () => {
  const getNeighborhood = read("20260830191012_get_neighborhood.sql");
  const treeSettings = read("20260830171252_accounts_settings_audit.sql");

  it("MAX_GENERATIONS matches the get_neighborhood clamp", () => {
    const caps = [
      ...getNeighborhood.matchAll(
        /least\(greatest\(coalesce\(p_\w+, 0\), 0\), (\d+)\)/g,
      ),
    ].map((m) => Number(m[1]));
    expect(caps.length).toBe(2);
    for (const cap of caps) {
      expect(cap).toBe(MAX_GENERATIONS);
    }
  });

  it("the default generations match the get_neighborhood argument defaults", () => {
    expect(getNeighborhood).toMatch(
      new RegExp(`p_up int default ${DEFAULT_GENERATIONS_UP}\\b`),
    );
    expect(getNeighborhood).toMatch(
      new RegExp(`p_down int default ${DEFAULT_GENERATIONS_DOWN}\\b`),
    );
  });

  it("the default generations match the tree_settings column defaults", () => {
    expect(treeSettings).toMatch(
      new RegExp(
        `default_generations_up smallint not null default ${DEFAULT_GENERATIONS_UP}\\b`,
      ),
    );
    expect(treeSettings).toMatch(
      new RegExp(
        `default_generations_down smallint not null default ${DEFAULT_GENERATIONS_DOWN}\\b`,
      ),
    );
  });
});
