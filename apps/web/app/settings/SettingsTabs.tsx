import Link from "next/link";

import { type SettingsTab, settingsTabHref } from "@/lib/settings/tabs";

/**
 * The `/settings` tab bar (#80): links, not client-side tabs, so each tab
 * is its own server render and only the active tab's data is fetched. The
 * active link carries `aria-current="page"`; the look is the header's
 * underline nav, which the `data-nav` chassis restyles the same way.
 */
export function SettingsTabs({
  tabs,
  active,
}: {
  readonly tabs: readonly SettingsTab[];
  readonly active: SettingsTab["id"];
}) {
  return (
    <nav
      aria-label="Settings sections"
      className="rw-nav border-border -mx-2.5 border-b"
    >
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          href={settingsTabHref(tab.id)}
          aria-current={tab.id === active ? "page" : undefined}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
