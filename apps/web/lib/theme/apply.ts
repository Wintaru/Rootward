import { chassisAttributes, themeById } from "./registry";
import type { ColorMode, ThemePreference } from "./preference";

/**
 * Apply a preference to the live document (#80) — what the server does on
 * `<html>` in `app/layout.tsx`, done client-side by the picker so a pick is
 * visible at once, before (and regardless of) the save round trip. The
 * theme CSS keys on `data-theme`, component CSS on the chassis `data-*`
 * switches, and the mode on `.dark`; every font face is already loaded on
 * `<html>` by `FONT_VARIABLE_CLASSES`, so nothing else has to change.
 */

/** The slice of `document.documentElement` this touches — an interface so
 * the logic unit-tests with a fake element, no DOM runtime needed. */
export interface ThemeRoot {
  setAttribute(name: string, value: string): void;
  readonly classList: { toggle(token: string, force: boolean): boolean };
}

/** Whether `.dark` is on for a mode, given the device's own answer — the
 * same rule the inline `SYSTEM_MODE_SCRIPT` applies before first paint. */
export function isDarkFor(mode: ColorMode, prefersDark: boolean): boolean {
  return mode === "dark" || (mode === "system" && prefersDark);
}

export function applyThemePreference(
  root: ThemeRoot,
  preference: ThemePreference,
  prefersDark: boolean,
): void {
  const theme = themeById(preference.theme);
  root.setAttribute("data-theme", theme.id);
  for (const [name, value] of Object.entries(
    chassisAttributes(theme.chassis),
  )) {
    root.setAttribute(name, value);
  }
  root.setAttribute("data-mode", preference.mode);
  root.classList.toggle("dark", isDarkFor(preference.mode, prefersDark));
}
