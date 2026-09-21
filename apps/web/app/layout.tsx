import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import "@/components/layout/chrome.css";

import { AccountChip } from "@/components/layout/AccountChip";
import { HeaderNav } from "@/components/layout/HeaderNav";
import { MobileNavMenu } from "@/components/layout/MobileNavMenu";
import { PersonSearchBox } from "@/components/layout/PersonSearchBox";
import { Wordmark } from "@/components/layout/Wordmark";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { isActiveModerator } from "@/lib/auth/access";
import { chipIdentity } from "@/lib/auth/account-chip";
import { getCurrentAccount } from "@/lib/auth/current-account";
import { resolveHeaderNav } from "@/lib/auth/header-nav";
import { getUnreadNotificationCount } from "@/lib/db/notifications";
import { getTreeName } from "@/lib/db/tree-settings";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { FONT_VARIABLE_CLASSES } from "@/lib/theme/fonts";
import { SYSTEM_MODE_SCRIPT } from "@/lib/theme/mode-script";
import { resolveThemePreference } from "@/lib/theme/preference";
import { chassisAttributes, themeById } from "@/lib/theme/registry";

import { signOutAction } from "./auth/actions";

export const metadata: Metadata = {
  title: "Rootward",
  description: "An open-source, self-hostable family tree.",
};

/**
 * Global chrome for a signed-in visitor (SPEC §8.1, #50, #79): the wordmark,
 * the role-gated links `resolveHeaderNav` decides ("Home", "My record",
 * "Import / Export", "Moderation", "Settings" — empty for a pending member,
 * who still needs the sign-out), a person search box for any approved member
 * (#62 — gated on the same "at least one nav link" signal `resolveHeaderNav`
 * already computes, rather than a second approval check), the notification
 * bell for a moderator+ (SPEC §8.5: "moderators subscribe app-wide"), and the
 * account chip, whose menu holds "My record" and the sign-out form. A
 * signed-out visitor gets no header at all, no layout shift — they can reach
 * only `/login` and the `/auth/*` handlers.
 *
 * Theme (#75, #80, decision 38): `<html>` carries `data-theme`, the chassis
 * `data-*` switches, and `data-mode`, all resolved server-side — from the
 * account when signed in, else the preference cookies — so the first paint
 * is already themed. The `.dark` class is never in the server `className`:
 * `SYSTEM_MODE_SCRIPT` adds it before first paint from `data-mode` (see
 * that module for why the server must not own it), so the server-rendered
 * `class` and the hydrated one legitimately differ —
 * `suppressHydrationWarning` covers exactly that one element. The
 * Appearance picker writes the same attributes client-side
 * (`lib/theme/apply.ts`) so a pick shows before its save lands.
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [cookieStore, current] = await Promise.all([
    cookies(),
    getCurrentAccount(),
  ]);
  const preference = resolveThemePreference(
    (name) => cookieStore.get(name)?.value,
    current?.appearance ?? null,
  );
  const theme = themeById(preference.theme);
  const htmlClassName = ["h-full antialiased", ...FONT_VARIABLE_CLASSES].join(
    " ",
  );
  const navLinks = current !== null ? resolveHeaderNav(current) : [];
  const showBell = current !== null && isActiveModerator(current.account);
  const supabase = current !== null ? await createSupabaseServerClient() : null;
  const [unreadCount, treeName] = await Promise.all([
    showBell && supabase !== null
      ? getUnreadNotificationCount(supabase, current.userId)
      : Promise.resolve(0),
    // Only the `subtitle` mark shows the tree name, so only that chassis
    // pays the round trip. (`tree_settings` is readable by any signed-in
    // user; the nav-links guard is what keeps it off a pending member's
    // header.)
    supabase !== null &&
    navLinks.length > 0 &&
    theme.chassis.mark === "subtitle"
      ? getTreeName(supabase)
      : Promise.resolve(null),
  ]);

  return (
    <html
      lang="en"
      className={htmlClassName}
      data-theme={theme.id}
      data-mode={preference.mode}
      {...chassisAttributes(theme.chassis)}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: SYSTEM_MODE_SCRIPT }} />
      </head>
      <body className="bg-background text-foreground flex min-h-full flex-col">
        {current !== null && (
          <header className="rw-header">
            {navLinks.length > 0 && <MobileNavMenu links={navLinks} />}
            <Wordmark treeName={treeName} href="/" />
            {navLinks.length > 0 && (
              <HeaderNav links={navLinks} className="rw-header__nav" />
            )}
            <div className="rw-header__actions">
              {navLinks.length > 0 && <PersonSearchBox />}
              {showBell && (
                <NotificationBell
                  accountId={current.userId}
                  initialUnreadCount={unreadCount}
                />
              )}
              <AccountChip
                identity={chipIdentity(current.displayName, current.email)}
                myRecordHref={
                  current.personId === null
                    ? null
                    : `/person/${current.personId}`
                }
                signOutAction={signOutAction}
              />
            </div>
          </header>
        )}
        {children}
      </body>
    </html>
  );
}
