import { describe, expect, it } from "vitest";

import {
  appearanceCookies,
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

describe("resolveThemePreference with an account row", () => {
  it("lets the account win over the cookies", () => {
    expect(
      resolveThemePreference(
        reader({ [THEME_COOKIE]: "gruvbox", [MODE_COOKIE]: "light" }),
        { theme: "hearth", colorMode: "dark" },
      ),
    ).toEqual({ theme: "hearth", mode: "dark" });
  });

  it("falls back per field when the row holds a value the registry no longer knows", () => {
    expect(
      resolveThemePreference(reader({ [THEME_COOKIE]: "gruvbox" }), {
        theme: "retired-theme",
        colorMode: "dark",
      }),
    ).toEqual({ theme: DEFAULT_THEME, mode: "dark" });
  });
});

describe("appearanceCookies", () => {
  it("mirrors the preference into the two cookies", () => {
    expect(appearanceCookies({ theme: "orchard", mode: "system" })).toEqual([
      { name: THEME_COOKIE, value: "orchard" },
      { name: MODE_COOKIE, value: "system" },
    ]);
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
