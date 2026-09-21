import { describe, expect, it } from "vitest";

import {
  auditThemes,
  CHECKS,
  contrastRatio,
} from "../../../../scripts/contrast-audit.mjs";
import { THEME_IDS } from "./registry";

/**
 * The contrast audit as a test (#81): every theme × mode meets WCAG AA on
 * every pair the UI draws. `pnpm test` is the gate; the script is the same
 * function with a table. A theme file added later is audited without
 * touching this test, because the script reads the directory.
 */
describe("contrast audit (scripts/contrast-audit.mjs)", () => {
  it("computes the WCAG reference ratios", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  it("covers every registered theme in both modes", () => {
    const rows = auditThemes();
    const covered = new Set(rows.map((row) => `${row.theme}/${row.mode}`));
    for (const id of THEME_IDS) {
      expect(covered.has(`${id}/light`)).toBe(true);
      expect(covered.has(`${id}/dark`)).toBe(true);
    }
    expect(rows.length).toBe(THEME_IDS.length * 2 * CHECKS.length);
  });

  it("passes every pair with no exemptions", () => {
    const failures = auditThemes()
      .filter((row) => !row.pass)
      .map(
        (row) =>
          `${row.theme} ${row.mode}: ${row.fg} ${row.fgValue} on ${row.bg} ${row.bgValue} = ${row.ratio.toFixed(2)}:1 (min ${row.minimum}, ${row.where})`,
      );
    expect(failures).toEqual([]);
  });
});
