import type { Metadata } from "next";
import "./globals.css";

import { NotificationBell } from "@/components/notifications/NotificationBell";
import { isActiveModerator } from "@/lib/auth/access";
import { getCurrentAccount } from "@/lib/auth/current-account";
import { getUnreadNotificationCount } from "@/lib/db/notifications";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Rootward",
  description: "An open-source, self-hostable family tree.",
};

/**
 * The bell is app-wide for a moderator+ (SPEC §8.5: "moderators subscribe
 * app-wide"), the only piece of persistent chrome the app has today. Every
 * other route stays exactly as it renders now -- a viewer or a signed-out
 * visitor gets no header at all, no layout shift.
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
        {showBell && current !== null && (
          <header className="border-border flex justify-end border-b px-4 py-2">
            <NotificationBell
              accountId={current.userId}
              initialUnreadCount={unreadCount}
            />
          </header>
        )}
        {children}
      </body>
    </html>
  );
}
