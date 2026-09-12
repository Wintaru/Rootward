"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Sign out (SPEC §8.1 global chrome, #50). Invoked from a plain `<form>` in
 * the root layout, so it works before hydration and from any authed page.
 *
 * `scope: "local"` ends this browser's session only — a family member who
 * signs out on a shared computer should not be signed out of their phone too.
 * `@supabase/ssr` clears the auth cookies through the client's `setAll`, which
 * a Server Action may write.
 *
 * An error is logged, not thrown: auth-js clears the local session before it
 * reports most server-side failures, so a throw would show an error page to a
 * user who is in fact signed out. If the cookies survived (a failed refresh),
 * the proxy bounces `/login` back to `/` and the user sees they are still in.
 * `redirect()` throws to unwind, so it sits outside any `try`.
 */
export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error !== null) {
    console.error(`signOutAction: ${error.message}`);
  }

  revalidatePath("/", "layout");
  redirect("/login");
}
