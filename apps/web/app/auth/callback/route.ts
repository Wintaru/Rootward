import type { Session, User } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { maybeAcceptInvitation } from "@/lib/auth/accept-invitation";
import { maybeBootstrapAdmin } from "@/lib/auth/bootstrap-admin";
import {
  type CallbackFailure,
  type CallbackOutcome,
  describeCaller,
  describeShape,
  describeType,
  isSpeculativeRequest,
  messageOf,
  sanitizeDetail,
} from "@/lib/auth/callback-log";
import { continueSignInHtml } from "@/lib/auth/continue-page";
import { parseEmailOtpType } from "@/lib/auth/email-otp-type";
import { resolveRequestOrigin } from "@/lib/auth/request-origin";
import { getAppearance } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  APPEARANCE_COOKIE_OPTIONS,
  appearanceCookies,
  toThemePreference,
} from "@/lib/theme/preference";

/**
 * `/auth/callback` — the single return point for every sign-in method
 * (SPEC §9.1). It accepts two shapes, because the two families of link carry
 * their proof differently:
 *
 * - Google's redirect arrives with `?code=`, a PKCE authorization code the
 *   browser client's stored verifier redeems.
 * - An emailed link (magic link, signup confirmation, moderator invite)
 *   arrives with `?token_hash=&type=`, which `verifyOtp` redeems server-side.
 *
 * The email shape is not a nicety. A moderator's invite is sent with the
 * service role, so no `code_verifier` exists in any browser and GoTrue falls
 * back to the implicit flow, which returns the session in the URL *fragment* —
 * unreadable by a server route, so every invite died on the error page with a
 * valid session attached. Supabase's `token_hash` templates
 * (`supabase/templates/`) avoid the fragment entirely. They also free a magic
 * link from the browser that asked for it, so a link opened in another browser
 * or a private window now works.
 *
 * Either way: establish the session, run the `ADMIN_EMAIL` bootstrap and the
 * invite-acceptance link (SPEC §9.2), then send the visitor on.
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
  const tokenHash = searchParams.get("token_hash");
  const rawType = searchParams.get("type");
  const otpType = parseEmailOtpType(rawType);

  // Only ever redirect within the app. Keep the redirect below as string
  // concatenation: `new URL(next, origin)` would resolve `//evil.example` to
  // another host and reopen the redirect.
  const nextParam = searchParams.get("next");
  const next = nextParam && nextParam.startsWith("/") ? nextParam : "/";

  // Several distinct failures put the visitor on the same page, and until now
  // the server recorded none of them, so a live report was unfalsifiable
  // without reproducing it. `fail` writes one line and redirects.
  //
  // One shape for every log line, so a fourth outcome cannot invent its own.
  // It carries neither the token nor the address: the arriving shape, the
  // reason and the caller separate a spent link from a wrong `type` from a
  // template that was never updated, which is all the diagnosis this needs.
  const line = (reason: CallbackOutcome, detail?: string): string =>
    `auth/callback: ${reason} [shape=${describeShape(code, tokenHash)} type=${describeType(rawType, otpType)}] ${describeCaller(request.headers)}${detail === undefined ? "" : ` ${sanitizeDetail(detail)}`}`;

  // A factory, not one shared response object: the success path below sets
  // cookies on its own response, and a single shared error response would
  // quietly carry anything a later branch set on it into the other returns.
  const fail = (reason: CallbackFailure, detail?: string): NextResponse => {
    console.error(line(reason, detail));
    return NextResponse.redirect(`${origin}/auth/auth-code-error`);
  };

  // A sign-in link is a one-time credential, so whatever fetches it spends it.
  // A browser prefetch, a prerender, or a link-preview fetcher redeems the
  // token and throws the session away, and the person who then clicks is told
  // their link is invalid.
  //
  // Answer with a page rather than a redirect or a 204. A prefetched redirect
  // can be adopted by the navigation that follows, stranding the visitor on
  // the error page for a link nothing spent. A 204 is worse: the clients that
  // reuse a preload as the navigation would do nothing at all, with no error
  // and no way to tell what happened. A page with one ordinary link is safe
  // whether it is discarded, activated, or reused.
  if (
    isSpeculativeRequest(request.headers) &&
    (code !== null || tokenHash !== null)
  ) {
    // Not an error: this is the guard doing its job, and error-rate alerts
    // should not fire because somebody's browser preloads links.
    console.warn(line("speculative fetch, not redeemed"));
    return new NextResponse(
      continueSignInHtml(`${requestUrl.pathname}${requestUrl.search}`),
      {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-robots-tag": "noindex",
        },
      },
    );
  }

  const supabase = await createSupabaseServerClient();
  let redeemed: { user: User | null; session: Session | null } | null = null;
  if (code !== null) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error !== null) {
      return fail("code exchange failed", error.message);
    }
    redeemed = data;
  } else if (tokenHash !== null && otpType !== null) {
    const { data, error } = await supabase.auth.verifyOtp({
      type: otpType,
      token_hash: tokenHash,
    });
    if (error !== null) {
      return fail("token verification failed", error.message);
    }
    redeemed = data;
  } else if (tokenHash !== null) {
    // A link carrying a token this deployment does not accept. The usual cause
    // is an email template whose `type=` does not match `ACCEPTED_TYPES`.
    return fail("unsupported link type");
  } else {
    // Nothing to redeem. The usual cause is a default GoTrue template, which
    // returns the session in the fragment the browser never sends.
    return fail("no credentials in the callback URL");
  }

  // A user *and* a session. Everything below needs the session: the appearance
  // read runs under RLS, and the final redirect is pointless without the
  // cookie. A user with no session would bounce back to `/login` with the
  // one-time token already spent.
  const user = redeemed.user;
  if (user === null || redeemed.session === null) {
    return fail("redeemed but no session");
  }

  try {
    await maybeBootstrapAdmin({ id: user.id, email: user.email });
  } catch (error: unknown) {
    // The session is valid but the admin promotion failed. Send them to the
    // error page; the next full sign-in retries (the promote is idempotent).
    return fail("admin bootstrap failed", messageOf(error));
  }

  try {
    // Link an invited email to its target person (SPEC §9.2). A `conflict`
    // result (the person is already claimed) is not an error. A thrown failure
    // is not fatal either: the visitor has a valid session, and either nothing
    // changed (they land on `/onboarding`) or the account link already
    // succeeded (they land on the tree) — the invitation row is reconciled from
    // the moderation queue. Do not block sign-in on it.
    await maybeAcceptInvitation({ id: user.id, email: user.email });
  } catch {
    // Fall through to the redirect below.
  }

  // One line per successful sign-in as well. A spent-token report is only
  // answerable if the log also says who spent it, and that request succeeded.
  console.log(line("signed in"));

  const response = NextResponse.redirect(`${origin}${next}`);
  try {
    const stored = await getAppearance(supabase, user.id);
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
    console.error(`auth/callback: appearance cookies: ${messageOf(error)}`);
  }
  return response;
}

/**
 * Next derives `HEAD` from an exported `GET`, which would run the whole
 * redemption for a request that can never carry a session back — a mail
 * scanner, a security appliance, or a link checker. Verified before this
 * existed: one `HEAD` spent the token and the person's own click then failed.
 *
 * Answer without touching Supabase. Nothing legitimate signs in over `HEAD`.
 */
export function HEAD(): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });
}
