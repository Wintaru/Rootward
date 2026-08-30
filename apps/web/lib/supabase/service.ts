import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/database.types";

import { requireEnv, supabaseUrl } from "./env";

/** Service-role key — bypasses RLS. Server only, never sent to the browser. */
function supabaseServiceRoleKey(): string {
  return requireEnv("SUPABASE_SERVICE_ROLE_KEY");
}

/**
 * Supabase client with the service-role key. Bypasses RLS, so it is only for
 * server-side paths that deliberately run without a member identity — the
 * onboarding-match RPC and the GEDCOM import/export jobs. Never import this from
 * a Client Component; `server-only` makes that a build error.
 */
export function createSupabaseServiceClient() {
  return createClient<Database>(supabaseUrl(), supabaseServiceRoleKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
