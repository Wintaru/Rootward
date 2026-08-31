import { describe, expect, it } from "vitest";

import {
  MAX_GENERATIONS,
  clampGenerations,
  resolveTreeDepth,
  treeHref,
} from "./tree-view-params";

const DEFAULTS = { up: 2, down: 2 } as const;
const FOCUS = "11111111-1111-1111-1111-111111111111";

describe("resolveTreeDepth", () => {
  it("falls back to the defaults when no params are set", () => {
    expect(resolveTreeDepth({}, DEFAULTS)).toEqual({ up: 2, down: 2 });
  });

  it("reads the override off up / down", () => {
    expect(resolveTreeDepth({ up: "4", down: "1" }, DEFAULTS)).toEqual({
      up: 4,
      down: 1,
    });
  });

  it("treats a blank or non-numeric value as absent", () => {
    expect(resolveTreeDepth({ up: "", down: "abc" }, DEFAULTS)).toEqual({
      up: 2,
      down: 2,
    });
  });

  it("clamps to 0..MAX_GENERATIONS", () => {
    expect(
      resolveTreeDepth(
        { up: "-3", down: String(MAX_GENERATIONS + 5) },
        DEFAULTS,
      ),
    ).toEqual({ up: 0, down: MAX_GENERATIONS });
  });

  it("takes the first value when a param repeats", () => {
    expect(resolveTreeDepth({ up: ["3", "9"] }, DEFAULTS)).toEqual({
      up: 3,
      down: 2,
    });
  });

  it("truncates a fractional value", () => {
    expect(resolveTreeDepth({ up: "3.9" }, DEFAULTS).up).toBe(3);
  });
});

describe("clampGenerations", () => {
  it("bounds both ends and truncates", () => {
    expect(clampGenerations(-1)).toBe(0);
    expect(clampGenerations(2.7)).toBe(2);
    expect(clampGenerations(99)).toBe(MAX_GENERATIONS);
  });
});

describe("treeHref", () => {
  it("is a bare path at the default depth", () => {
    expect(treeHref(FOCUS, { up: 2, down: 2 }, DEFAULTS)).toBe(
      `/tree/${FOCUS}`,
    );
  });

  it("carries only the axis that differs from the default", () => {
    expect(treeHref(FOCUS, { up: 4, down: 2 }, DEFAULTS)).toBe(
      `/tree/${FOCUS}?up=4`,
    );
    expect(treeHref(FOCUS, { up: 2, down: 0 }, DEFAULTS)).toBe(
      `/tree/${FOCUS}?down=0`,
    );
  });

  it("carries both when both differ", () => {
    expect(treeHref(FOCUS, { up: 3, down: 1 }, DEFAULTS)).toBe(
      `/tree/${FOCUS}?up=3&down=1`,
    );
  });
});
