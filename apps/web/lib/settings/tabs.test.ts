import { describe, expect, it } from "vitest";

import {
  resolveSettingsTab,
  SETTINGS_TABS,
  settingsTabHref,
  visibleSettingsTabs,
} from "./tabs";

describe("resolveSettingsTab", () => {
  it("names a tab by its id", () => {
    expect(resolveSettingsTab("roles").id).toBe("roles");
  });

  it("falls back to Appearance for a missing or unknown value", () => {
    expect(resolveSettingsTab(undefined).id).toBe("appearance");
    expect(resolveSettingsTab("privacy").id).toBe("appearance");
  });
});

describe("visibleSettingsTabs", () => {
  it("shows an admin every tab, in order", () => {
    expect(visibleSettingsTabs(true)).toEqual(SETTINGS_TABS);
  });

  it("shows a non-admin only Appearance", () => {
    expect(visibleSettingsTabs(false).map((tab) => tab.id)).toEqual([
      "appearance",
    ]);
  });
});

describe("settingsTabHref", () => {
  it("is the bare route for the default tab and ?tab= otherwise", () => {
    expect(settingsTabHref("appearance")).toBe("/settings");
    expect(settingsTabHref("tree")).toBe("/settings?tab=tree");
  });
});
