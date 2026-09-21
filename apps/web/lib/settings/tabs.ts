/**
 * The `/settings` tabs (SPEC §8.1, #80). Pure — the page hands in the
 * `?tab=` value and the caller's admin flag and renders whatever comes
 * back, so the routing decision unit-tests without a session.
 *
 * Appearance is every approved member's and comes first; Tree (the
 * `tree_settings` form + wipe) and Roles keep the admin gate, applied per
 * tab inside the page rather than per route. "Privacy" from the redesign
 * canvas is not here: nothing exists to put behind it until decision 31's
 * per-person privacy UI (post-MVP).
 */

export const SETTINGS_TABS = [
  { id: "appearance", label: "Appearance", adminOnly: false },
  { id: "tree", label: "Tree", adminOnly: true },
  { id: "roles", label: "Roles", adminOnly: true },
] as const;

export type SettingsTabId = (typeof SETTINGS_TABS)[number]["id"];
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export const DEFAULT_SETTINGS_TAB: SettingsTabId = "appearance";

/** The tab a `?tab=` value names; anything else is the default. */
export function resolveSettingsTab(param: string | undefined): SettingsTab {
  return (
    SETTINGS_TABS.find((tab) => tab.id === param) ??
    SETTINGS_TABS.find((tab) => tab.id === DEFAULT_SETTINGS_TAB) ??
    SETTINGS_TABS[0]
  );
}

/** The tabs a member may open, in display order. */
export function visibleSettingsTabs(isAdmin: boolean): readonly SettingsTab[] {
  return SETTINGS_TABS.filter((tab) => isAdmin || !tab.adminOnly);
}

/** The route for a tab. The default tab is the bare route, so the nav
 * "Settings" link and the chip's "Appearance" item share one URL and
 * `isActiveHref` needs no special case. */
export function settingsTabHref(id: SettingsTabId): string {
  return id === DEFAULT_SETTINGS_TAB ? "/settings" : `/settings?tab=${id}`;
}
