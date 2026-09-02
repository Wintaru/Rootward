import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

import { NotificationBell } from "@/components/notifications/NotificationBell";
import { isActiveModerator, isApproved } from "@/lib/auth/access";
import { getCurrentAccount } from "@/lib/auth/current-account";
import { getUnreadNotificationCount } from "@/lib/db/notifications";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Rootward",
  description: "An open-source, self-hostable family tree.",
};

/**
 * Persistent chrome for an approved account: a "Home" link back to `/` (the
 * §8.1 router, which sends an approved viewer to their default tree view —
 * the only way back to it once a re-centred or expanded tree view has no
 * URL a person would think to type by hand) and, for a moderator+, the
 * notification bell (SPEC §8.5: "moderators subscribe app-wide"). A pending
 * or signed-out visitor gets no header at all, no layout shift.
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const current = await getCurrentAccount();
  const showHeader = current !== null && isApproved(current.account);
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
        {showHeader && (
          <header className="border-border flex items-center justify-between border-b px-4 py-2">
            <Link href="/" className="text-sm font-medium hover:underline">
              Home
            </Link>
            {showBell && current !== null && (
              <NotificationBell
                accountId={current.userId}
                initialUnreadCount={unreadCount}
              />
            )}
          </header>
        )}
        {children}
      </body>
    </html>
  );
}
