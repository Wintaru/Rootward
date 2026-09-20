import { describe, expect, it } from "vitest";

import {
  isColorMode,
  MODE_COOKIE,
  resolveThemePreference,
  THEME_COOKIE,
} from "./preference";
import { DEFAULT_THEME } from "./registry";

function reader(values: Readonly<Record<string, string>>) {
  return (name: string): string | undefined => values[name];
}

describe("resolveThemePreference", () => {
  it("falls back to the default theme and system mode with no cookies", () => {
    expect(resolveThemePreference(reader({}))).toEqual({
      theme: DEFAULT_THEME,
      mode: "system",
    });
  });

  it("reads a valid theme and mode", () => {
    expect(
      resolveThemePreference(
        reader({ [THEME_COOKIE]: "flexoki", [MODE_COOKIE]: "dark" }),
      ),
    ).toEqual({ theme: "flexoki", mode: "dark" });
  });

  it("ignores an unknown theme id or mode independently", () => {
    expect(
      resolveThemePreference(
        reader({ [THEME_COOKIE]: "neutral", [MODE_COOKIE]: "light" }),
      ),
    ).toEqual({ theme: DEFAULT_THEME, mode: "light" });
    expect(
      resolveThemePreference(
        reader({ [THEME_COOKIE]: "flexoki", [MODE_COOKIE]: "auto" }),
      ),
    ).toEqual({ theme: "flexoki", mode: "system" });
  });
});

describe("isColorMode", () => {
  it("accepts the three modes and nothing else", () => {
    expect(isColorMode("system")).toBe(true);
    expect(isColorMode("light")).toBe(true);
    expect(isColorMode("dark")).toBe(true);
    expect(isColorMode("DARK")).toBe(false);
    expect(isColorMode(null)).toBe(false);
  });
});
