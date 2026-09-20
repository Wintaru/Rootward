import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import "./globals.css";

import { MobileNavMenu } from "@/components/layout/MobileNavMenu";
import { PersonSearchBox } from "@/components/layout/PersonSearchBox";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { isActiveModerator } from "@/lib/auth/access";
import { getCurrentAccount } from "@/lib/auth/current-account";
import { type HeaderNavLink, resolveHeaderNav } from "@/lib/auth/header-nav";
import { getUnreadNotificationCount } from "@/lib/db/notifications";
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
 * Global chrome for a signed-in visitor (SPEC §8.1, #50): the role-gated
 * links `resolveHeaderNav` decides ("Home", "My record", "Import / Export",
 * "Moderation", "Settings" — empty for a pending member, who still needs the
 * sign-out), a person search box for any approved member (#62 — gated on the
 * same "at least one nav link" signal `resolveHeaderNav` already computes,
 * rather than a second approval check), the notification bell for a
 * moderator+ (SPEC §8.5: "moderators subscribe app-wide"), and a sign-out
 * form. A signed-out visitor gets no header at all, no layout shift — they
 * can reach only `/login` and the `/auth/*` handlers.
 *
 * Theme (#75, decision 38): `<html>` carries `data-theme`, the chassis
 * `data-*` switches, and `.dark`, all resolved server-side from the
 * preference cookies so the first paint is already themed. In `system`
 * mode the class is added client-side before paint by `SYSTEM_MODE_SCRIPT`,
 * so the server-rendered `className` and the hydrated one legitimately
 * differ — `suppressHydrationWarning` covers exactly that one element.
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const cookieStore = await cookies();
  const preference = resolveThemePreference(
    (name) => cookieStore.get(name)?.value,
  );
  const theme = themeById(preference.theme);
  const htmlClassName = [
    "h-full antialiased",
    ...FONT_VARIABLE_CLASSES,
    ...(preference.mode === "dark" ? ["dark"] : []),
  ].join(" ");
  const current = await getCurrentAccount();
  const navLinks = current !== null ? resolveHeaderNav(current) : [];
  const showBell = current !== null && isActiveModerator(current.account);
  const unreadCount = showBell
    ? await getUnreadNotificationCount(
        await createSupabaseServerClient(),
        current.userId,
      )
    : 0;

  return (
    <html
      lang="en"
      className={htmlClassName}
      data-theme={theme.id}
      {...chassisAttributes(theme.chassis)}
      suppressHydrationWarning
    >
      {preference.mode === "system" && (
        <head>
          <script dangerouslySetInnerHTML={{ __html: SYSTEM_MODE_SCRIPT }} />
        </head>
      )}
      <body className="bg-background text-foreground flex min-h-full flex-col">
        {current !== null && (
          <header className="border-border flex flex-wrap items-center justify-between gap-4 border-b px-4 py-2">
            {navLinks.length > 0 && <MobileNavMenu links={navLinks} />}
            <NavLinkList
              links={navLinks}
              className="hidden flex-wrap gap-x-4 gap-y-1 sm:flex"
            />
            {navLinks.length > 0 && <PersonSearchBox />}
            <div className="ml-auto flex items-center gap-4">
              {showBell && (
                <NotificationBell
                  accountId={current.userId}
                  initialUnreadCount={unreadCount}
                />
              )}
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="text-muted-foreground text-sm hover:underline"
                >
                  Sign out
                </button>
              </form>
            </div>
          </header>
        )}
        {children}
      </body>
    </html>
  );
}

function NavLinkList({
  links,
  className,
}: {
  readonly links: readonly HeaderNavLink[];
  readonly className: string;
}) {
  return (
    <nav aria-label="Main" className={className}>
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="text-sm font-medium hover:underline"
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
