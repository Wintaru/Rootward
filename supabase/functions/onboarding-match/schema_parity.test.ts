/**
 * Guard: the enum values `onboarding-match` writes to Postgres must exist in
 * the migrations. The engine and gateway hand-write these literals; a drift is
 * a runtime insert/update failure, not a type error. This test fails CI the
 * moment they diverge.
 */

import { assert } from "@std/assert";

const REPO = new URL("../../../", import.meta.url);

/** Every `create type <name> as enum ('a', 'b', …)` across the migrations. */
async function migrationEnums(): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  for await (
    const entry of Deno.readDir(new URL("supabase/migrations/", REPO))
  ) {
    if (!entry.name.endsWith(".sql")) continue;
    const sql = await Deno.readTextFile(
      new URL(`supabase/migrations/${entry.name}`, REPO),
    );
    const re = /create\s+type\s+(\w+)\s+as\s+enum\s*\(([^)]*)\)/gis;
    for (let m = re.exec(sql); m !== null; m = re.exec(sql)) {
      const values = [...m[2].matchAll(/'([^']+)'/g)].map((v) => v[1]);
      out.set(m[1], new Set(values));
    }
  }
  return out;
}

Deno.test("notification types the engine emits exist in notification_type", async () => {
  const enums = await migrationEnums();
  const notificationType = enums.get("notification_type");
  assert(notificationType !== undefined, "notification_type enum not found");

  // Mirrors the NotificationType union in matcher.ts.
  for (const type of ["self_claim_linked", "claim_attempt_cap"]) {
    assert(
      notificationType.has(type),
      `notification.type '${type}' missing from the enum`,
    );
  }
});

Deno.test("literals the gateway filters/writes exist in their enums", async () => {
  const enums = await migrationEnums();

  assert(enums.get("account_status")?.has("active"), "account_status.active");
  assert(enums.get("request_status")?.has("pending"), "request_status.pending");
  assert(enums.get("event_type")?.has("birth"), "event_type.birth");
  assert(enums.get("event_owner")?.has("person"), "event_owner.person");
});
