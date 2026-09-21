import { describe, expect, it } from "vitest";

import { applyThemePreference, isDarkFor, type ThemeRoot } from "./apply";
import { chassisAttributes, themeById } from "./registry";

function fakeRoot() {
  const attributes = new Map<string, string>();
  const classes = new Set<string>();
  const root: ThemeRoot = {
    setAttribute: (name, value) => {
      attributes.set(name, value);
    },
    classList: {
      toggle: (token, force) => {
        if (force) {
          classes.add(token);
        } else {
          classes.delete(token);
        }
        return force;
      },
    },
  };
  return { root, attributes, classes };
}

describe("isDarkFor", () => {
  it("pins light and dark, and follows the device only in system mode", () => {
    expect(isDarkFor("dark", false)).toBe(true);
    expect(isDarkFor("light", true)).toBe(false);
    expect(isDarkFor("system", true)).toBe(true);
    expect(isDarkFor("system", false)).toBe(false);
  });
});

describe("applyThemePreference", () => {
  it("sets data-theme, every chassis switch, data-mode, and .dark", () => {
    const { root, attributes, classes } = fakeRoot();
    applyThemePreference(root, { theme: "rosepine", mode: "dark" }, false);

    expect(attributes.get("data-theme")).toBe("rosepine");
    expect(attributes.get("data-mode")).toBe("dark");
    for (const [name, value] of Object.entries(
      chassisAttributes(themeById("rosepine").chassis),
    )) {
      expect(attributes.get(name)).toBe(value);
    }
    expect(classes.has("dark")).toBe(true);
  });

  it("removes .dark when the new mode is light", () => {
    const { root, classes } = fakeRoot();
    applyThemePreference(root, { theme: "flexoki", mode: "dark" }, false);
    applyThemePreference(root, { theme: "flexoki", mode: "light" }, true);
    expect(classes.has("dark")).toBe(false);
  });
});
