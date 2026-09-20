import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CHASSIS_ATTRIBUTE,
  chassisAttributes,
  DEFAULT_THEME,
  isThemeId,
  THEME_IDS,
  themeById,
  THEMES,
  type ThemePreview,
} from "./registry";

const THEMES_DIR = fileURLToPath(new URL("../../app/themes/", import.meta.url));

/**
 * `fonts.ts` cannot be imported here (`next/font` runs only inside Next's
 * compiler), and Next requires its `variable` option to be a literal, so
 * the names are read from the source text instead.
 */
const LOADED_FONT_VARIABLES: readonly string[] = [
  ...readFileSync(
    fileURLToPath(new URL("./fonts.ts", import.meta.url)),
    "utf8",
  ).matchAll(/variable: "(--font-[a-z0-9-]+)"/g),
].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));

const GLOBALS_CSS = readFileSync(
  fileURLToPath(new URL("../../app/globals.css", import.meta.url)),
  "utf8",
);

function themeCss(id: string): string {
  return readFileSync(`${THEMES_DIR}${id}.css`, "utf8");
}

/** The declarations of one `{ … }` block, found by its selector line. */
function cssBlock(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  const end = css.indexOf("}", start);
  if (start === -1 || end === -1) {
    throw new Error(`no block for ${selector}`);
  }
  return css.slice(start, end);
}

function tokenValue(block: string, token: string): string | undefined {
  return block.match(new RegExp(`${token}:\\s*([^;]+);`))?.[1]?.trim();
}

/** Registry `preview` key → the theme-file token it must equal. */
const PREVIEW_TOKEN: Readonly<Record<keyof ThemePreview, string>> = {
  bg: "--background",
  surface: "--card",
  ink: "--foreground",
  accent: "--primary",
  male: "--rw-male",
  female: "--rw-female",
};

/**
 * Single-source-of-truth guards (#75): the registry and `app/themes/` must
 * name the same set, and every file must carry both mode blocks on the
 * selector contract, so adding a theme cannot leave one side stale.
 */
describe("theme registry ↔ app/themes/", () => {
  const cssIds = readdirSync(THEMES_DIR)
    .filter((name) => name.endsWith(".css"))
    .map((name) => name.slice(0, -".css".length))
    .sort();

  it("has one CSS file per ThemeId and no orphan file", () => {
    expect(cssIds).toEqual([...THEME_IDS].sort());
  });

  it("has one THEMES entry per ThemeId, in one order", () => {
    expect(THEMES.map((theme) => theme.id)).toEqual([...THEME_IDS]);
  });

  it("imports every theme file from globals.css, and only theme files", () => {
    const imported = [
      ...GLOBALS_CSS.matchAll(/@import "\.\/themes\/([a-z0-9-]+)\.css";/g),
    ]
      .flatMap((match) => (match[1] === undefined ? [] : [match[1]]))
      .sort();
    expect(imported).toEqual([...THEME_IDS].sort());
  });

  it.each([...THEME_IDS])(
    "%s preview hexes equal the theme file's tokens",
    (id) => {
      const css = themeCss(id);
      const { preview } = themeById(id);
      const blocks = {
        light: cssBlock(css, `[data-theme="${id}"]`),
        dark: cssBlock(css, `[data-theme="${id}"].dark`),
      } as const;
      for (const mode of ["light", "dark"] as const) {
        for (const [key, token] of Object.entries(PREVIEW_TOKEN)) {
          expect(
            tokenValue(blocks[mode], token)?.toLowerCase(),
            `${id} ${mode} ${key}`,
          ).toBe(preview[mode][key as keyof ThemePreview].toLowerCase());
        }
      }
    },
  );

  it.each([...THEME_IDS])(
    "%s.css declares a light block and a dark block on the contract",
    (id) => {
      const css = themeCss(id);
      expect(css).toContain(`[data-theme="${id}"] {`);
      expect(css).toContain(`[data-theme="${id}"].dark {`);
    },
  );

  it.each([...THEME_IDS])(
    "%s.css references only font variables a loader provides",
    (id) => {
      expect(LOADED_FONT_VARIABLES.length).toBeGreaterThan(0);
      const referenced = [
        ...themeCss(id).matchAll(/var\((--font-[a-z0-9-]+)\)/g),
      ]
        .flatMap((match) => (match[1] === undefined ? [] : [match[1]]))
        .filter((name) => name !== "--font-display" && name !== "--font-body");
      expect(referenced.length).toBeGreaterThan(0);
      for (const name of referenced) {
        expect(LOADED_FONT_VARIABLES, `${id}.css uses ${name}`).toContain(name);
      }
    },
  );
});

describe("registry helpers", () => {
  it("DEFAULT_THEME is a registered theme", () => {
    expect(isThemeId(DEFAULT_THEME)).toBe(true);
    expect(themeById(DEFAULT_THEME).id).toBe(DEFAULT_THEME);
  });

  it("isThemeId rejects anything not in THEME_IDS", () => {
    expect(isThemeId("neutral")).toBe(false);
    expect(isThemeId("")).toBe(false);
    expect(isThemeId(undefined)).toBe(false);
    expect(isThemeId(42)).toBe(false);
  });

  it("chassisAttributes emits one data-* attribute per switch", () => {
    const chassis = {
      nav: "pill",
      avatar: "ring",
      nameFont: "display",
      mark: "sprig",
      ground: "dots",
    } as const;
    const attributes = chassisAttributes(chassis);
    expect(Object.keys(attributes).sort()).toEqual(
      Object.values(CHASSIS_ATTRIBUTE).sort(),
    );
    for (const [key, name] of Object.entries(CHASSIS_ATTRIBUTE)) {
      expect(attributes[name]).toBe(chassis[key as keyof typeof chassis]);
    }
  });
});
