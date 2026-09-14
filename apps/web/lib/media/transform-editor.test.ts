import { describe, expect, it } from "vitest";

import {
  isEditableMime,
  isSameTransform,
  isUsableCrop,
  percentCropToPixels,
  pixelCropToPercent,
  rotateCropPercent,
  stepRotation,
} from "./transform-editor";

describe("isEditableMime", () => {
  it("accepts only the browser-decodable originals", () => {
    expect(isEditableMime("image/jpeg")).toBe(true);
    expect(isEditableMime("image/png")).toBe(true);
    expect(isEditableMime("image/webp")).toBe(true);
    expect(isEditableMime("image/heic")).toBe(false);
    expect(isEditableMime("image/gif")).toBe(false);
    expect(isEditableMime("application/pdf")).toBe(false);
    expect(isEditableMime(null)).toBe(false);
  });
});

describe("stepRotation", () => {
  it("wraps around in both directions", () => {
    expect(stepRotation(0, 90)).toBe(90);
    expect(stepRotation(270, 90)).toBe(0);
    expect(stepRotation(0, -90)).toBe(270);
    expect(stepRotation(180, -90)).toBe(90);
  });
});

describe("rotateCropPercent", () => {
  const crop = { x: 10, y: 20, width: 30, height: 40 };

  it("clockwise sends the top edge to the right edge", () => {
    expect(rotateCropPercent(crop, 90)).toEqual({
      x: 40,
      y: 10,
      width: 40,
      height: 30,
    });
  });

  it("counter-clockwise sends the top edge to the left edge", () => {
    expect(rotateCropPercent(crop, -90)).toEqual({
      x: 20,
      y: 60,
      width: 40,
      height: 30,
    });
  });

  it("a clockwise then counter-clockwise turn is the identity", () => {
    expect(rotateCropPercent(rotateCropPercent(crop, 90), -90)).toEqual(crop);
  });

  it("four clockwise turns are the identity", () => {
    const four = [90, 90, 90, 90] as const;
    expect(four.reduce((c, step) => rotateCropPercent(c, step), crop)).toEqual(
      crop,
    );
  });
});

describe("percent ↔ pixel crops", () => {
  const size = { width: 400, height: 200 };

  it("round-trips a whole-pixel crop", () => {
    const px = { x: 40, y: 50, width: 100, height: 100 };
    const pct = pixelCropToPercent(px, size);
    expect(pct).toEqual({ x: 10, y: 25, width: 25, height: 50 });
    expect(percentCropToPixels(pct!, size)).toEqual(px);
  });

  it("clamps a percent crop that overhangs the image", () => {
    expect(
      percentCropToPixels({ x: 90, y: 90, width: 20, height: 20 }, size),
    ).toEqual({ x: 360, y: 180, width: 40, height: 20 });
  });

  it("treats a full-frame selection as no crop", () => {
    expect(
      percentCropToPixels({ x: 0, y: 0, width: 100, height: 100 }, size),
    ).toBeNull();
  });

  it("returns null for a stored crop that no longer fits", () => {
    expect(
      pixelCropToPercent({ x: 500, y: 0, width: 10, height: 10 }, size),
    ).toBeNull();
  });
});

describe("isUsableCrop", () => {
  it("rejects null and a hairline selection", () => {
    expect(isUsableCrop(null)).toBe(false);
    expect(isUsableCrop({ x: 0, y: 0, width: 0.4, height: 50 })).toBe(false);
    expect(isUsableCrop({ x: 0, y: 0, width: 5, height: 5 })).toBe(true);
  });
});

describe("isSameTransform", () => {
  const crop = { x: 1, y: 2, width: 3, height: 4 };

  it("compares rotation and every crop edge", () => {
    expect(
      isSameTransform(
        { rotation: 90, crop },
        { rotation: 90, crop: { ...crop } },
      ),
    ).toBe(true);
    expect(isSameTransform({ rotation: 90, crop }, { rotation: 0, crop })).toBe(
      false,
    );
    expect(
      isSameTransform({ rotation: 0, crop }, { rotation: 0, crop: null }),
    ).toBe(false);
    expect(
      isSameTransform({ rotation: 0, crop: null }, { rotation: 0, crop: null }),
    ).toBe(true);
    expect(
      isSameTransform(
        { rotation: 0, crop },
        { rotation: 0, crop: { ...crop, width: 5 } },
      ),
    ).toBe(false);
  });
});
