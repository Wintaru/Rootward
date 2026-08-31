import { describe, expect, it } from "vitest";

import { normalizeText } from "./diff";

describe("normalizeText", () => {
  it("keeps a non-empty value trimmed", () => {
    expect(normalizeText("  Ada  ")).toBe("Ada");
  });

  it("maps an empty string to null", () => {
    expect(normalizeText("")).toBeNull();
  });

  it("maps whitespace-only input to null", () => {
    expect(normalizeText("   ")).toBeNull();
  });
});
