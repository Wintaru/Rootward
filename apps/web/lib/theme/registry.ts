/**
 * Theme registry (SPEC §10 Phase 10, WAYFINDER decision 38, #75).
 *
 * A theme is a token set on one chassis: one CSS file under `app/themes/`
 * with a `[data-theme="<id>"]` block (light) and a `[data-theme="<id>"].dark`
 * block (dark), plus one entry here. `registry.test.ts` holds the two in step
 * both ways — every id has a file, every file has an id — so adding the Nth
 * theme cannot silently leave the other side stale.
 *
 * The chassis switches are the few looks CSS cannot express as a variable
 * (a keyword cannot branch a stylesheet without style container queries,
 * which Firefox does not ship). They become `data-*` attributes on `<html>`
 * that component CSS selects on — never a per-theme JSX branch.
 */

export const THEME_IDS = ["flexoki"] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const NAV_STYLES = ["underline", "pill", "caps"] as const;
export const AVATAR_STYLES = ["ring", "fill", "tab", "print"] as const;
export const NAME_FONTS = ["body", "display"] as const;
export const MARK_STYLES = ["none", "circle", "sprig", "subtitle"] as const;
export const GROUND_STYLES = ["flat", "dots"] as const;

export type ThemeChassis = {
  readonly nav: (typeof NAV_STYLES)[number];
  readonly avatar: (typeof AVATAR_STYLES)[number];
  readonly nameFont: (typeof NAME_FONTS)[number];
  readonly mark: (typeof MARK_STYLES)[number];
  readonly ground: (typeof GROUND_STYLES)[number];
};

/**
 * Six hex values per mode, enough for the picker (#80) to draw a theme's
 * mini card without loading that theme's CSS.
 */
export type ThemePreview = {
  readonly bg: string;
  readonly surface: string;
  readonly ink: string;
  readonly accent: string;
  readonly male: string;
  readonly female: string;
};

export type ThemeDefinition = {
  readonly id: ThemeId;
  readonly label: string;
  readonly tagline: string;
  readonly credit: string;
  /** Display names of the type faces, for the picker card. */
  readonly fonts: { readonly display: string; readonly body: string };
  readonly chassis: ThemeChassis;
  readonly preview: {
    readonly light: ThemePreview;
    readonly dark: ThemePreview;
  };
};

export const THEMES: readonly ThemeDefinition[] = [
  {
    id: "flexoki",
    label: "Flexoki",
    tagline: "Ink on paper — Steph Ango's palette, calibrated light and dark",
    credit: "Palette: Flexoki (stephango.com/flexoki)",
    fonts: { display: "Newsreader", body: "IBM Plex Sans" },
    chassis: {
      nav: "underline",
      avatar: "tab",
      nameFont: "body",
      mark: "none",
      ground: "flat",
    },
    preview: {
      light: {
        bg: "#F2F0E5",
        surface: "#FFFCF0",
        ink: "#100F0F",
        accent: "#BC5215",
        male: "#205EA6",
        female: "#A02F6F",
      },
      dark: {
        bg: "#100F0F",
        surface: "#1C1B1A",
        ink: "#CECDC3",
        accent: "#DA702C",
        male: "#4385BE",
        female: "#CE5D97",
      },
    },
  },
];

export const DEFAULT_THEME: ThemeId = "flexoki";

export function isThemeId(value: unknown): value is ThemeId {
  return (
    typeof value === "string" &&
    (THEME_IDS as readonly string[]).includes(value)
  );
}

export function themeById(id: ThemeId): ThemeDefinition {
  const found = THEMES.find((theme) => theme.id === id);
  if (found === undefined) {
    // `registry.test.ts` asserts THEMES covers THEME_IDS, so this is a
    // programming error, not a runtime state to recover from.
    throw new Error(`Theme "${id}" is in THEME_IDS but has no THEMES entry`);
  }
  return found;
}

/**
 * Attribute name per chassis switch. `satisfies` over `keyof ThemeChassis`
 * makes a switch added to the type without a row here a compile error.
 */
export const CHASSIS_ATTRIBUTE = {
  nav: "data-nav",
  avatar: "data-avatar",
  nameFont: "data-name-font",
  mark: "data-mark",
  ground: "data-ground",
} as const satisfies Record<keyof ThemeChassis, `data-${string}`>;

type ChassisAttributeName =
  (typeof CHASSIS_ATTRIBUTE)[keyof typeof CHASSIS_ATTRIBUTE];

/**
 * The `data-*` attributes `app/layout.tsx` sets on `<html>` for a theme.
 * Keyed by attribute name so the layout spreads them without knowing the
 * switch list.
 */
export function chassisAttributes(
  chassis: ThemeChassis,
): Readonly<Record<ChassisAttributeName, string>> {
  return {
    [CHASSIS_ATTRIBUTE.nav]: chassis.nav,
    [CHASSIS_ATTRIBUTE.avatar]: chassis.avatar,
    [CHASSIS_ATTRIBUTE.nameFont]: chassis.nameFont,
    [CHASSIS_ATTRIBUTE.mark]: chassis.mark,
    [CHASSIS_ATTRIBUTE.ground]: chassis.ground,
  };
}
