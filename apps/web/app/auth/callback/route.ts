import { NextResponse, type NextRequest } from "next/server";

import { maybeAcceptInvitation } from "@/lib/auth/accept-invitation";
import { maybeBootstrapAdmin } from "@/lib/auth/bootstrap-admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * `/auth/callback` — the single return point for both sign-in methods
 * (SPEC §9.1). The browser client uses the PKCE flow, so a magic-link click and
 * a Google redirect both arrive here with `?code=`. Exchange it for a session,
 * run the `ADMIN_EMAIL` bootstrap and the invite-acceptance link (SPEC §9.2),
 * then send the visitor on.
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
    // error page; the next full sign-in retries (the promote is idempotent).
    return NextResponse.redirect(`${origin}/auth/auth-code-error`);
  }

  try {
    // Link an invited email to its target person (SPEC §9.2). A `conflict`
    // result (the person is already claimed) is not an error. A thrown failure
    // is not fatal either: the visitor has a valid session, and either nothing
    // changed (they land on `/onboarding`) or the account link already
    // succeeded (they land on the tree) — the invitation row is reconciled from
    // the moderation queue. Do not block sign-in on it.
    await maybeAcceptInvitation({ id: data.user.id, email: data.user.email });
  } catch {
    // Fall through to the redirect below.
  }

  return NextResponse.redirect(`${origin}${next}`);
}
