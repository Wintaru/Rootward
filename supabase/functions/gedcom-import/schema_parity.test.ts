/**
 * Guard: the enum values this importer writes to Postgres must match the
 * enums the migrations define. `packages/gedcom/src/types.ts` and
 * `@rootward/shared` hand-copy these sets (flagged in-file); `gedcom-import` is
 * the first code that writes them, so a drift is a runtime insert failure, not
 * a type error. This test fails CI the moment the two diverge.
 */

import { assertEquals } from "@std/assert";

const REPO = new URL("../../../", import.meta.url);

async function read(path: string): Promise<string> {
  return await Deno.readTextFile(new URL(path, REPO));
}

/** Every `create type <name> as enum ('a', 'b', …)` in the migrations. */
async function migrationEnums(): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  for await (
    const entry of Deno.readDir(new URL("supabase/migrations/", REPO))
  ) {
    if (!entry.name.endsWith(".sql")) continue;
    const sql = await read(`supabase/migrations/${entry.name}`);
    const re = /create\s+type\s+(\w+)\s+as\s+enum\s*\(([^)]*)\)/gis;
    for (let m = re.exec(sql); m !== null; m = re.exec(sql)) {
      const values = [...m[2].matchAll(/'([^']+)'/g)].map((v) => v[1]);
      out.set(m[1], new Set(values));
    }
  }
  return out;
}

/**
 * String literals of either `export type <Name> = "a" | "b" | …;` or
 * `export const <NAME> = ["a", "b", …]` in a source file.
 */
function tsLiterals(source: string, name: string): Set<string> {
  const typeBody = new RegExp(`export type ${name} =([\\s\\S]*?);`, "m").exec(
    source,
  )?.[1];
  const constBody = new RegExp(
    `export const ${name} =\\s*\\[([\\s\\S]*?)\\]`,
    "m",
  ).exec(source)?.[1];
  const body = typeBody ?? constBody ?? "";
  return new Set([...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]));
}

Deno.test("gedcom TS unions match the Postgres enums", async () => {
  const enums = await migrationEnums();
  const gedcomTypes = await read("packages/gedcom/src/types.ts");
  const sharedDates = await read("packages/shared/src/genealogy-date.ts");

  const pairs: [tsName: string, enumName: string, source: string][] = [
    ["Sex", "sex", gedcomTypes],
    ["NameType", "name_type", gedcomTypes],
    ["PartnerRole", "partner_role", gedcomTypes],
    ["UnionType", "union_type", gedcomTypes],
    ["ChildRelation", "child_relation", gedcomTypes],
    ["EventType", "event_type", gedcomTypes],
    ["FactType", "fact_type", gedcomTypes],
    ["GENEALOGY_DATE_KINDS", "genealogy_date_kind", sharedDates],
    ["CALENDARS", "calendar", sharedDates],
  ];

  for (const [tsName, enumName, source] of pairs) {
    const dbValues = enums.get(enumName);
    assertEquals(
      dbValues !== undefined,
      true,
      `migration enum ${enumName} not found`,
    );
    assertEquals(
      [...tsLiterals(source, tsName)].sort(),
      [...(dbValues ?? [])].sort(),
      `${tsName} (TS) vs ${enumName} (Postgres)`,
    );
  }
});
