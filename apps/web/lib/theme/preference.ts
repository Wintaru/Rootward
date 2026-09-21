import { DEFAULT_THEME, isThemeId, type ThemeId } from "./registry";

/**
 * The member's theme + mode as the server sees it before first paint (#75,
 * #80).
 *
 * Two sources: the `account` row (`theme` / `color_mode`, migration
 * 20260920184900) when there is a session, else the two cookies. The
 * cookies are a mirror of the row — written on sign-in and on every save
 * (`appearanceCookies`) — so the signed-out login page and the pre-paint
 * script match the last member who signed in on that device. When both
 * exist the account wins; this module is the one place that rule lands, so
 * the layout never learns where the preference comes from.
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

/** The two `account` columns as the database hands them back — `text`, not
 * yet proven to be a registry id or a mode. */
export type StoredAppearance = {
  readonly theme: string;
  readonly colorMode: string;
};

export function isColorMode(value: unknown): value is ColorMode {
  return (
    typeof value === "string" &&
    (COLOR_MODES as readonly string[]).includes(value)
  );
}

/**
 * Narrow two raw values to a preference. An absent, stale, or tampered
 * value falls back to the default rather than failing the page — an unknown
 * theme id (a theme removed in a later release, still in a cookie or a row
 * the migration has not yet rewritten) must still render.
 */
export function toThemePreference(
  theme: unknown,
  mode: unknown,
): ThemePreference {
  return {
    theme: isThemeId(theme) ? theme : DEFAULT_THEME,
    mode: isColorMode(mode) ? mode : DEFAULT_MODE,
  };
}

/**
 * Resolve the preference for a request: the account's columns when the
 * caller passes them (a session exists), else the cookies.
 */
export function resolveThemePreference(
  readCookie: (name: string) => string | undefined,
  stored: StoredAppearance | null = null,
): ThemePreference {
  if (stored !== null) {
    return toThemePreference(stored.theme, stored.colorMode);
  }
  return toThemePreference(readCookie(THEME_COOKIE), readCookie(MODE_COOKIE));
}

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Cookie attributes shared by the sign-in callback and the save action. Not
 * `secure`: a self-hosted Rootward may well run over plain HTTP on a LAN,
 * and the value is a display preference, not a credential. */
export const APPEARANCE_COOKIE_OPTIONS = {
  path: "/",
  sameSite: "lax",
  httpOnly: true,
  maxAge: ONE_YEAR_SECONDS,
} as const;

/** The cookie pair that mirrors a preference, for whichever writer has the
 * response in hand (`cookies().set` in an action, `response.cookies.set` in
 * the callback route). */
export function appearanceCookies(
  preference: ThemePreference,
): readonly { readonly name: string; readonly value: string }[] {
  return [
    { name: THEME_COOKIE, value: preference.theme },
    { name: MODE_COOKIE, value: preference.mode },
  ];
}
