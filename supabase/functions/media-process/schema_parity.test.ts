/**
 * Guard: `processor.ts`'s `MEDIA_OWNERS` array -- the single source both the
 * `MediaOwner` type and `index.ts`'s runtime request validation derive from
 * -- must match the `media_owner` Postgres enum `media_link.owner_type` is
 * written against. Same deferred-#12 pattern as
 * `gedcom-import/schema_parity.test.ts` / `onboarding-match`'s -- a drift
 * here is a runtime insert failure, not a type error.
 */

import { assertEquals } from "@std/assert";

const REPO = new URL("../../../", import.meta.url);

async function migrationEnum(name: string): Promise<Set<string>> {
  for await (
    const entry of Deno.readDir(new URL("supabase/migrations/", REPO))
  ) {
    if (!entry.name.endsWith(".sql")) continue;
    const sql = await Deno.readTextFile(
      new URL(`supabase/migrations/${entry.name}`, REPO),
    );
    const re = new RegExp(
      `create\\s+type\\s+${name}\\s+as\\s+enum\\s*\\(([^)]*)\\)`,
      "is",
    );
    const m = re.exec(sql);
    if (m !== null) {
      return new Set([...m[1].matchAll(/'([^']+)'/g)].map((v) => v[1]));
    }
  }
  throw new Error(`migration enum ${name} not found`);
}

Deno.test("MEDIA_OWNERS (TS) matches media_owner (Postgres)", async () => {
  const dbValues = await migrationEnum("media_owner");
  const source = await Deno.readTextFile(
    new URL("processor.ts", import.meta.url),
  );
  const body =
    /export const MEDIA_OWNERS = \[([\s\S]*?)\] as const;/m.exec(source)
      ?.[1] ?? "";
  const tsValues = new Set([...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]));

  assertEquals([...tsValues].sort(), [...dbValues].sort());
});
