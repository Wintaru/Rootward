import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

import { NotificationBell } from "@/components/notifications/NotificationBell";
import { isActiveModerator } from "@/lib/auth/access";
import { getCurrentAccount } from "@/lib/auth/current-account";
import { resolveHeaderNav } from "@/lib/auth/header-nav";
import { getUnreadNotificationCount } from "@/lib/db/notifications";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { signOutAction } from "./auth/actions";

export const metadata: Metadata = {
  title: "Rootward",
  description: "An open-source, self-hostable family tree.",
};

/**
 * Global chrome for a signed-in visitor (SPEC §8.1, #50): the role-gated
 * links `resolveHeaderNav` decides ("Home", "My record", "Import",
 * "Moderation", "Settings" — empty for a pending member, who still needs the
 * sign-out), the notification bell for a moderator+ (SPEC §8.5: "moderators
 * subscribe app-wide"), and a sign-out form. A signed-out visitor gets no
 * header at all, no layout shift — they can reach only `/login` and the
 * `/auth/*` handlers.
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const current = await getCurrentAccount();
  const showBell = current !== null && isActiveModerator(current.account);
  const unreadCount = showBell
    ? await getUnreadNotificationCount(
        await createSupabaseServerClient(),
        current.userId,
      )
    : 0;

  return (
    <html lang="en" className="h-full antialiased">
      <body className="bg-background text-foreground flex min-h-full flex-col">
        {current !== null && (
          <header className="border-border flex items-center justify-between gap-4 border-b px-4 py-2">
            <nav aria-label="Main" className="flex flex-wrap gap-x-4 gap-y-1">
              {resolveHeaderNav(current).map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-sm font-medium hover:underline"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
            <div className="flex items-center gap-4">
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
