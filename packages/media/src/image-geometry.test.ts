import { describe, expect, it } from "vitest";

import { computeTargetSize } from "./image-geometry.ts";

describe("computeTargetSize", () => {
  it("returns the size unchanged when it already fits", () => {
    expect(computeTargetSize({ width: 100, height: 50 }, 240)).toEqual({
      width: 100,
      height: 50,
    });
  });

  it("leaves a size exactly at the cap unchanged", () => {
    expect(computeTargetSize({ width: 240, height: 120 }, 240)).toEqual({
      width: 240,
      height: 120,
    });
  });

  it("scales the longer side down, landscape", () => {
    expect(computeTargetSize({ width: 4000, height: 2000 }, 1200)).toEqual({
      width: 1200,
      height: 600,
    });
  });

  it("scales the longer side down, portrait", () => {
    expect(computeTargetSize({ width: 2000, height: 4000 }, 1200)).toEqual({
      width: 600,
      height: 1200,
    });
  });

  it("never upscales a small image", () => {
    expect(computeTargetSize({ width: 10, height: 10 }, 240)).toEqual({
      width: 10,
      height: 10,
    });
  });

  it("never rounds a dimension to zero", () => {
    const target = computeTargetSize({ width: 10000, height: 1 }, 240);
    expect(target.width).toBe(240);
    expect(target.height >= 1).toBe(true);
  });
});
