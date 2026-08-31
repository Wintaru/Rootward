import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CHALLENGE_LABELS, KNOWN_OUTCOMES } from "./onboarding";

/**
 * `supabase/functions/onboarding-match/matcher.ts` is Deno-native and outside
 * the pnpm workspace, so its `CHALLENGE_KEYS` and `VerifyStatus` cannot be
 * imported here — `onboarding.ts` restates them. This guard fails when the two
 * drift, the way `gedcom-import/schema_parity.test.ts` guards its own
 * cross-boundary copy. The `challengeLabel` fallback and the `"unknown"`
 * outcome keep drift from crashing the flow; this keeps it from going unnoticed.
 */

const matcherPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../supabase/functions/onboarding-match/matcher.ts",
);
const matcherSource = readFileSync(matcherPath, "utf8");

function stringLiterals(block: string): string[] {
  const out: string[] = [];
  for (const match of block.matchAll(/"([a-z_]+)"/g)) {
    if (match[1] !== undefined) {
      out.push(match[1]);
    }
  }
  return out;
}

describe("onboarding-match contract parity", () => {
  it("every server challenge key has a label", () => {
    const block = matcherSource.match(/CHALLENGE_KEYS = \[([^\]]+)\]/)?.[1];
    expect(block, "CHALLENGE_KEYS not found in matcher.ts").toBeDefined();

    const serverKeys = stringLiterals(block ?? "");
    expect(serverKeys.length).toBeGreaterThan(0);
    for (const key of serverKeys) {
      expect(
        Object.prototype.hasOwnProperty.call(CHALLENGE_LABELS, key),
        `CHALLENGE_LABELS is missing "${key}"`,
      ).toBe(true);
    }
  });

  it("the recognised verify outcomes match VerifyStatus", () => {
    const block = matcherSource.match(
      /export type VerifyStatus =\s*([^;]+);/,
    )?.[1];
    expect(block, "VerifyStatus not found in matcher.ts").toBeDefined();

    const serverStatuses = new Set(stringLiterals(block ?? ""));
    expect([...serverStatuses].sort()).toEqual([...KNOWN_OUTCOMES].sort());
  });
});
