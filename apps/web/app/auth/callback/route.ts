import { NextResponse, type NextRequest } from "next/server";

import { maybeAcceptInvitation } from "@/lib/auth/accept-invitation";
import { maybeBootstrapAdmin } from "@/lib/auth/bootstrap-admin";
import { resolveRequestOrigin } from "@/lib/auth/request-origin";
import { getAppearance } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  APPEARANCE_COOKIE_OPTIONS,
  appearanceCookies,
  toThemePreference,
} from "@/lib/theme/preference";

/**
 * `/auth/callback` — the single return point for both sign-in methods
 * (SPEC §9.1). The browser client uses the PKCE flow, so a magic-link click and
 * a Google redirect both arrive here with `?code=`. Exchange it for a session,
 * run the `ADMIN_EMAIL` bootstrap and the invite-acceptance link (SPEC §9.2),
 * then send the visitor on.
 *
 * Every redirect is built from the origin the visitor used (#110). The
 * session cookie the exchange just wrote is scoped to that host, so sending
 * them to `request.url`'s origin — the one the server bound — would strand
 * them on `/login` with a cookie that does not apply.
 *
 * The final redirect also carries the `rw-theme` / `rw-mode` cookies from
 * the account (#80), so this device's signed-out login page and the
 * pre-paint script match the member who just signed in. A failed read is
 * not fatal: the cookies simply keep whatever they held.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestUrl = new URL(request.url);
  const { searchParams } = requestUrl;
  const origin =
    resolveRequestOrigin(request.headers, {
      defaultProtocol: requestUrl.protocol === "https:" ? "https" : "http",
    }) ?? requestUrl.origin;
  const code = searchParams.get("code");

  // Only ever redirect within the app. Keep the redirect below as string
  // concatenation: `new URL(next, origin)` would resolve `//evil.example` to
  // another host and reopen the redirect.
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

  const response = NextResponse.redirect(`${origin}${next}`);
  try {
    const stored = await getAppearance(supabase, data.user.id);
    if (stored !== null) {
      const preference = toThemePreference(stored.theme, stored.colorMode);
      for (const cookie of appearanceCookies(preference)) {
        response.cookies.set(
          cookie.name,
          cookie.value,
          APPEARANCE_COOKIE_OPTIONS,
        );
      }
    }
  } catch (error: unknown) {
    console.error(
      `auth/callback: appearance cookies: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return response;
}
