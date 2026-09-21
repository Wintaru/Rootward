import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";
import type { StoredAppearance, ThemePreference } from "@/lib/theme/preference";

type Db = SupabaseClient<Database>;

/**
 * The per-member appearance columns (SPEC §8.1 `/settings`, decision 38,
 * #80, migration 20260920184900). Reads come back as the raw `text` pair
 * ({@link StoredAppearance}) — `lib/theme/preference.ts` narrows them to a
 * `ThemePreference` with the registry fallback, so a row holding a retired
 * theme id still renders. The one write goes through `set_appearance`, the
 * SECURITY DEFINER RPC that touches exactly these two columns on the
 * caller's own row (`account_update` stays admin-only).
 */

/** The account's stored pair, or `null` when the row does not exist yet. */
export async function getAppearance(
  client: Db,
  accountId: string,
): Promise<StoredAppearance | null> {
  const { data, error } = await client
    .from("account")
    .select("theme, color_mode")
    .eq("id", accountId)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`getAppearance: ${error.message}`);
  }
  return data === null
    ? null
    : { theme: data.theme, colorMode: data.color_mode };
}

/** Save the caller's own preference. Throws on a refused or failed write —
 * the CHECK constraints are the value guard behind the action's own
 * `isThemeId` / `isColorMode` check. */
export async function setAppearance(
  client: Db,
  preference: ThemePreference,
): Promise<void> {
  const { error } = await client.rpc("set_appearance", {
    p_theme: preference.theme,
    p_color_mode: preference.mode,
  });
  if (error !== null) {
    throw new Error(`setAppearance: ${error.message}`);
  }
}
