import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/lib/db/database.types";

import { supabaseAnonKey, supabaseUrl } from "./env";

/**
 * Supabase client for use in Client Components. Reads the session from the
 * cookies the server set, so RLS runs as the signed-in member.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient<Database>(supabaseUrl(), supabaseAnonKey());
}
