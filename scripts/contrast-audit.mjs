// `node scripts/contrast-audit.mjs` — WCAG 2.x contrast for every theme × mode
// (SPEC §10 Phase 10, decision 38, issue #81). Reads the token values out of
// `apps/web/app/themes/*.css` — the files the browser loads, not a copy — and
// checks the pairs the UI actually draws. Prints one table row per pair and
// exits non-zero on any failure. `apps/web/lib/theme/contrast-audit.test.ts`
// runs `auditThemes` under Vitest, so `pnpm test` is the gate.
//
// Thresholds are WCAG 2.2 SC 1.4.3 (text, 4.5:1) and SC 1.4.11 (non-text —
// the sex dots, the focus ring — 3:1):
// https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TEXT_MINIMUM = 4.5;
export const NON_TEXT_MINIMUM = 3;

/**
 * The pairs to check, as `[foreground token, background token, kind]`.
 * `text` pairs must reach {@link TEXT_MINIMUM}, `non-text` pairs
 * {@link NON_TEXT_MINIMUM}. Each row names where the UI draws that pair.
 * This is the #81 list plus the focus ring and the pill/segmented pair; the
 * tinted surfaces (`--accent`, `--muted`, `--secondary` under text and under
 * the avatar's sex colour) are not yet here — issue #123.
 * @type {readonly { fg: string; bg: string; kind: "text" | "non-text"; where: string }[]}
 */
export const CHECKS = [
  { fg: "--foreground", bg: "--background", kind: "text", where: "body text" },
  { fg: "--foreground", bg: "--card", kind: "text", where: "card text" },
  { fg: "--card-foreground", bg: "--card", kind: "text", where: "card text" },
  { fg: "--muted-foreground", bg: "--card", kind: "text", where: "card meta" },
  {
    fg: "--muted-foreground",
    bg: "--background",
    kind: "text",
    where: "page meta",
  },
  {
    fg: "--primary-foreground",
    bg: "--primary",
    kind: "text",
    where: "primary button",
  },
  {
    fg: "--secondary-foreground",
    bg: "--secondary",
    kind: "text",
    where: "pill nav, segmented",
  },
  { fg: "--primary", bg: "--card", kind: "text", where: "links on a card" },
  {
    fg: "--primary",
    bg: "--background",
    kind: "text",
    where: "links on the page",
  },
  { fg: "--rw-male", bg: "--card", kind: "non-text", where: "sex dot" },
  { fg: "--rw-female", bg: "--card", kind: "non-text", where: "sex dot" },
  { fg: "--rw-neutral", bg: "--card", kind: "non-text", where: "sex dot" },
  {
    fg: "--ring",
    bg: "--card",
    kind: "non-text",
    where: "focus ring on a card",
  },
  {
    fg: "--ring",
    bg: "--background",
    kind: "non-text",
    where: "focus ring on the page",
  },
];

const HERE = dirname(fileURLToPath(import.meta.url));
export const THEMES_DIR = resolve(HERE, "../apps/web/app/themes");

/** `#rgb` / `#rrggbb` → linear-light relative luminance (WCAG 2.x). */
export function relativeLuminance(hex) {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (match === null) {
    throw new Error(`not a hex colour: ${hex}`);
  }
  const digits =
    match[1].length === 3 ? [...match[1]].map((d) => d + d).join("") : match[1];
  const channel = (offset) => {
    const srgb = parseInt(digits.slice(offset, offset + 2), 16) / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** WCAG contrast ratio, 1–21, order of the two colours irrelevant. */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [light, dark] = la > lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}

/**
 * The `--token: value;` declarations of one `{ … }` block, found by a
 * selector fragment. The fallback theme's light block is
 * `:where(:root), [data-theme="flexoki"] {`, so the match is "a selector
 * line containing `[data-theme="<id>"]` and ending in `.dark {` or not".
 */
function tokenBlock(css, id, mode) {
  const attribute = `[data-theme="${id}"]`;
  const lines = css.split("\n");
  const start = lines.findIndex((line) => {
    if (!line.includes(attribute) || !line.trimEnd().endsWith("{")) {
      return false;
    }
    return mode === "dark"
      ? line.includes(`${attribute}.dark`)
      : !line.includes(".dark");
  });
  if (start === -1) {
    throw new Error(`${id}.css: no ${mode} block`);
  }
  const end = lines.findIndex((line, i) => i > start && line.trim() === "}");
  const tokens = new Map();
  for (const line of lines.slice(start + 1, end)) {
    const match = /^\s*(--[a-z0-9-]+):\s*([^;]+);/.exec(line);
    if (match !== null) {
      tokens.set(match[1], match[2].trim());
    }
  }
  return tokens;
}

/**
 * Every check for every theme × mode.
 * @returns {{ theme: string; mode: "light" | "dark"; fg: string; bg: string; kind: string; where: string; fgValue: string; bgValue: string; ratio: number; minimum: number; pass: boolean }[]}
 */
export function auditThemes(themesDir = THEMES_DIR) {
  const ids = readdirSync(themesDir)
    .filter((name) => name.endsWith(".css"))
    .map((name) => name.slice(0, -".css".length))
    .sort();
  const rows = [];
  for (const id of ids) {
    const css = readFileSync(join(themesDir, `${id}.css`), "utf8");
    for (const mode of /** @type {const} */ (["light", "dark"])) {
      const tokens = tokenBlock(css, id, mode);
      for (const check of CHECKS) {
        const fgValue = tokens.get(check.fg);
        const bgValue = tokens.get(check.bg);
        if (fgValue === undefined || bgValue === undefined) {
          throw new Error(
            `${id}.css (${mode}): missing ${fgValue === undefined ? check.fg : check.bg}`,
          );
        }
        let ratio;
        try {
          ratio = contrastRatio(fgValue, bgValue);
        } catch (error) {
          throw new Error(
            `${id}.css (${mode}) ${check.fg} on ${check.bg}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        const minimum = check.kind === "text" ? TEXT_MINIMUM : NON_TEXT_MINIMUM;
        rows.push({
          theme: id,
          mode,
          ...check,
          fgValue,
          bgValue,
          ratio,
          minimum,
          pass: ratio >= minimum,
        });
      }
    }
  }
  return rows;
}

function printTable(rows) {
  const widths = {
    theme: Math.max(...rows.map((r) => r.theme.length), 5),
    fg: Math.max(...rows.map((r) => r.fg.length)),
    bg: Math.max(...rows.map((r) => r.bg.length)),
  };
  for (const row of rows) {
    const mark = row.pass ? "ok  " : "FAIL";
    console.log(
      [
        mark,
        row.theme.padEnd(widths.theme),
        row.mode.padEnd(5),
        row.fg.padEnd(widths.fg),
        "on",
        row.bg.padEnd(widths.bg),
        `${row.ratio.toFixed(2).padStart(5)}:1`,
        `(min ${row.minimum})`,
        row.where,
      ].join("  "),
    );
  }
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const rows = auditThemes();
  const failures = rows.filter((row) => !row.pass);
  printTable(process.argv.includes("--all") ? rows : failures);
  console.log(
    `\n${rows.length} pairs checked, ${failures.length} below the minimum` +
      (failures.length === 0 && !process.argv.includes("--all")
        ? " (pass --all to print every row)"
        : ""),
  );
  process.exit(failures.length === 0 ? 0 : 1);
}
