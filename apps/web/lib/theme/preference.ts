import { DEFAULT_THEME, isThemeId, type ThemeId } from "./registry";

/**
 * The member's theme + mode as the server sees it before first paint (#75).
 *
 * Source today: two cookies. #80 adds the account columns and makes the
 * account win when signed in — this module is the one place that rule
 * lands, so the layout never learns where the preference comes from.
 */

export const THEME_COOKIE = "rw-theme";
export const MODE_COOKIE = "rw-mode";

export const COLOR_MODES = ["system", "light", "dark"] as const;
export type ColorMode = (typeof COLOR_MODES)[number];
export const DEFAULT_MODE: ColorMode = "system";

export type ThemePreference = {
  readonly theme: ThemeId;
  readonly mode: ColorMode;
};

export function isColorMode(value: unknown): value is ColorMode {
  return (
    typeof value === "string" &&
    (COLOR_MODES as readonly string[]).includes(value)
  );
}

/**
 * Resolve the preference from a cookie reader. An absent, stale, or
 * tampered value falls back to the default rather than failing the page —
 * an unknown theme id (a theme removed in a later release) must still
 * render.
 */
export function resolveThemePreference(
  readCookie: (name: string) => string | undefined,
): ThemePreference {
  const theme = readCookie(THEME_COOKIE);
  const mode = readCookie(MODE_COOKIE);
  return {
    theme: isThemeId(theme) ? theme : DEFAULT_THEME,
    mode: isColorMode(mode) ? mode : DEFAULT_MODE,
  };
}
