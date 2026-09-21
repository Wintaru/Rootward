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

export const THEME_IDS = [
  "flexoki",
  "rosepine",
  "gruvbox",
  "everforest",
  "heirloom",
  "hearth",
  "orchard",
  "kodachrome",
] as const;
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
  /** Attribution line for the picker; `null` when there is none to show. */
  readonly credit: string | null;
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
        accent: "#B54C09",
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
  {
    id: "rosepine",
    label: "Rosé Pine",
    tagline: "Soft and rosy — Dawn by day, Moon by night",
    credit: "Palette: Rosé Pine (rosepinetheme.com) — Dawn / Moon variants",
    fonts: { display: "Young Serif", body: "Nunito Sans" },
    chassis: {
      nav: "pill",
      avatar: "ring",
      nameFont: "body",
      mark: "circle",
      ground: "flat",
    },
    preview: {
      light: {
        bg: "#faf4ed",
        surface: "#fffaf3",
        ink: "#575279",
        accent: "#a85855",
        male: "#286983",
        female: "#b4637a",
      },
      dark: {
        bg: "#232136",
        surface: "#2a273f",
        ink: "#e0def4",
        accent: "#ea9a97",
        male: "#3e8fb0",
        female: "#eb6f92",
      },
    },
  },
  {
    id: "gruvbox",
    label: "Gruvbox",
    tagline: "Retro groove — cream and amber, high contrast",
    credit: "Palette: Gruvbox (github.com/morhetz/gruvbox)",
    fonts: { display: "Zilla Slab", body: "Public Sans" },
    chassis: {
      nav: "caps",
      avatar: "fill",
      nameFont: "display",
      mark: "none",
      ground: "flat",
    },
    preview: {
      light: {
        bg: "#fbf1c7",
        surface: "#f9f5d7",
        ink: "#3c3836",
        accent: "#af3a03",
        male: "#076678",
        female: "#8f3f71",
      },
      dark: {
        bg: "#282828",
        surface: "#32302f",
        ink: "#ebdbb2",
        accent: "#fe8019",
        male: "#83a598",
        female: "#d3869b",
      },
    },
  },
  {
    id: "everforest",
    label: "Everforest",
    tagline: "Soft forest — green-grey, gentle contrast",
    credit:
      "Palette: Everforest (github.com/sainnhe/everforest) — medium contrast",
    fonts: { display: "Alegreya", body: "Alegreya Sans" },
    chassis: {
      nav: "underline",
      avatar: "ring",
      nameFont: "body",
      mark: "sprig",
      ground: "flat",
    },
    preview: {
      light: {
        bg: "#efebd4",
        surface: "#fdf6e3",
        ink: "#5c6a72",
        accent: "#62700b",
        male: "#3a94c5",
        female: "#e06d11",
      },
      dark: {
        bg: "#232a2e",
        surface: "#2d353b",
        ink: "#d3c6aa",
        accent: "#a7c080",
        male: "#7fbbb3",
        female: "#e69875",
      },
    },
  },
  {
    id: "heirloom",
    label: "Heirloom",
    tagline: "Archival & editorial — paper, ink, and hairlines",
    credit: null,
    fonts: { display: "Cormorant Garamond", body: "Source Sans 3" },
    chassis: {
      nav: "caps",
      avatar: "tab",
      nameFont: "display",
      mark: "subtitle",
      ground: "flat",
    },
    preview: {
      light: {
        bg: "#f3ecdd",
        surface: "#fbf7ee",
        ink: "#2b241a",
        accent: "#8a3a2f",
        male: "#4f6c88",
        female: "#a5563a",
      },
      dark: {
        bg: "#1a1611",
        surface: "#262019",
        ink: "#efe5d3",
        accent: "#d0715f",
        male: "#86a6c6",
        female: "#d98c6e",
      },
    },
  },
  {
    id: "hearth",
    label: "Hearth",
    tagline: "Modern & tactile — soft stone, terracotta, rounded",
    credit: null,
    fonts: { display: "Instrument Serif", body: "Instrument Sans" },
    chassis: {
      nav: "pill",
      avatar: "ring",
      nameFont: "body",
      mark: "circle",
      ground: "flat",
    },
    preview: {
      light: {
        bg: "#f6f1ea",
        surface: "#ffffff",
        ink: "#241c16",
        accent: "#b0512d",
        male: "#3f7f79",
        female: "#c4633f",
      },
      dark: {
        bg: "#191411",
        surface: "#25201c",
        ink: "#f4ece4",
        accent: "#e0805c",
        male: "#6fb3ac",
        female: "#e0805c",
      },
    },
  },
  {
    id: "orchard",
    label: "Orchard",
    tagline: "Botanical & calm — linen, sage, amber, organic lines",
    credit: null,
    fonts: { display: "DM Serif Display", body: "Karla" },
    chassis: {
      nav: "underline",
      avatar: "fill",
      nameFont: "body",
      mark: "sprig",
      ground: "dots",
    },
    preview: {
      light: {
        bg: "#f2efe4",
        surface: "#faf9f2",
        ink: "#232a1f",
        accent: "#56744c",
        male: "#5f7f96",
        female: "#c18133",
      },
      dark: {
        bg: "#161914",
        surface: "#20241c",
        ink: "#ebeadf",
        accent: "#93b586",
        male: "#8aaabf",
        female: "#e0a35c",
      },
    },
  },
  {
    id: "kodachrome",
    label: "Kodachrome",
    tagline: "The family album — midcentury prints, mustard and teal",
    credit: "Original palette, after 1960s colour prints",
    fonts: { display: "Josefin Sans", body: "Mulish" },
    chassis: {
      nav: "underline",
      avatar: "print",
      nameFont: "body",
      mark: "subtitle",
      ground: "flat",
    },
    preview: {
      light: {
        bg: "#efe3cc",
        surface: "#fbf4e6",
        ink: "#2f2419",
        accent: "#b03f13",
        male: "#2f6f73",
        female: "#b8443f",
      },
      dark: {
        bg: "#1e1913",
        surface: "#2a231b",
        ink: "#f0e4cf",
        accent: "#e8743f",
        male: "#5fa3a6",
        female: "#e06a5e",
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
