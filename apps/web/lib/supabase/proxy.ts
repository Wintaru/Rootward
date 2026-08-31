import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { decideProxyRedirect } from "@/lib/auth/auth-redirect";

import { supabaseAnonKey, supabaseUrl } from "./env";

/**
 * Refresh the Auth session on every request and enforce the §8.1 access rule.
 *
 * Server Components cannot write cookies, so the proxy is the one place a
 * rotated refresh token can be persisted (Supabase SSR guide). It must:
 *   1. build a request-bound Supabase client whose cookie writes land on both
 *      the forwarded request and the response;
 *   2. call `getClaims()` — never `getSession()` in server code, it does not
 *      revalidate the token;
 *   3. redirect per `decideProxyRedirect`, carrying the refreshed cookies
 *      onto the redirect response so the new session is not dropped.
 */
export async function updateSession(
  request: NextRequest,
): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // A `getClaims()` error (bad/expired cookie, or a transient Auth 5xx) is
  // treated as "no session" — fail closed. The worst case is one bounce to
  // `/login`, where a valid refresh token recovers on the next request.
  const { data } = await supabase.auth.getClaims();
  const hasSession = data?.claims != null;

  const target = decideProxyRedirect({
    hasSession,
    pathname: request.nextUrl.pathname,
  });
  if (target !== null) {
    const url = request.nextUrl.clone();
    url.pathname = target;
    url.search = "";
    const redirect = NextResponse.redirect(url);
    // Carry the refreshed auth cookies onto the redirect.
    for (const cookie of response.cookies.getAll()) {
      redirect.cookies.set(cookie);
    }
    return redirect;
  }

  return response;
}
