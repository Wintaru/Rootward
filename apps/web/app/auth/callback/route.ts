import { NextResponse, type NextRequest } from "next/server";

import { maybeBootstrapAdmin } from "@/lib/auth/bootstrap-admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * `/auth/callback` — the single return point for both sign-in methods
 * (SPEC §9.1). The browser client uses the PKCE flow, so a magic-link click and
 * a Google redirect both arrive here with `?code=`. Exchange it for a session,
 * run the `ADMIN_EMAIL` bootstrap, then send the visitor on.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  // Only ever redirect within the app.
  const nextParam = searchParams.get("next");
  const next = nextParam && nextParam.startsWith("/") ? nextParam : "/";

  if (code === null) {
    return NextResponse.redirect(`${origin}/auth/auth-code-error`);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error !== null || data.user === null) {
    return NextResponse.redirect(`${origin}/auth/auth-code-error`);
  }

  try {
    await maybeBootstrapAdmin({ id: data.user.id, email: data.user.email });
  } catch {
    // The session is valid but the admin promotion failed. Send them to the
    // error page; the next sign-in retries (the promote is idempotent).
    return NextResponse.redirect(`${origin}/auth/auth-code-error`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
