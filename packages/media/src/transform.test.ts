import { describe, expect, it } from "vitest";

import type { DecodedImage } from "./pipeline.ts";
import {
  applyTransform,
  clampCrop,
  cropImage,
  isIdentityTransform,
  isRotation,
  rotateImage,
  rotatedSize,
} from "./transform.ts";

/** A `width`×`height` image whose pixel (x, y) has R = x, G = y, B = 0, A = 255
 * -- so any output pixel says where it came from. */
function grid(width: number, height: number): DecodedImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = x;
      data[i + 1] = y;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

function sourceOf(image: DecodedImage, x: number, y: number): [number, number] {
  const i = (y * image.width + x) * 4;
  return [image.data[i] ?? -1, image.data[i + 1] ?? -1];
}

describe("rotateImage", () => {
  const img = grid(3, 2); // x ∈ 0..2, y ∈ 0..1

  it("returns the same object for 0", () => {
    expect(rotateImage(img, 0)).toBe(img);
  });

  it("90° clockwise: top-left source ends up top-right", () => {
    const out = rotateImage(img, 90);
    expect([out.width, out.height]).toEqual([2, 3]);
    expect(sourceOf(out, 1, 0)).toEqual([0, 0]); // source (0,0) → (h-1-0, 0)
    expect(sourceOf(out, 0, 0)).toEqual([0, 1]); // source (0,1) → (0, 0)
    expect(sourceOf(out, 1, 2)).toEqual([2, 0]); // source (2,0) → (1, 2)
  });

  it("180°: every pixel is mirrored on both axes", () => {
    const out = rotateImage(img, 180);
    expect([out.width, out.height]).toEqual([3, 2]);
    expect(sourceOf(out, 0, 0)).toEqual([2, 1]);
    expect(sourceOf(out, 2, 1)).toEqual([0, 0]);
  });

  it("270° clockwise: top-left source ends up bottom-left", () => {
    const out = rotateImage(img, 270);
    expect([out.width, out.height]).toEqual([2, 3]);
    expect(sourceOf(out, 0, 2)).toEqual([0, 0]); // source (0,0) → (0, w-1-0)
    expect(sourceOf(out, 1, 0)).toEqual([2, 1]); // source (2,1) → (1, 0)
  });

  it("four quarter turns compose to the identity", () => {
    const once = rotateImage(img, 90);
    const twice = rotateImage(once, 90);
    expect(twice.data).toEqual(rotateImage(img, 180).data);
    const back = rotateImage(rotateImage(twice, 90), 90);
    expect(back.data).toEqual(img.data);
  });

  it("preserves alpha", () => {
    const out = rotateImage(img, 90);
    expect(out.data[3]).toBe(255);
  });
});

describe("rotatedSize / isRotation", () => {
  it("swaps the axes on a quarter turn only", () => {
    expect(rotatedSize({ width: 4, height: 3 }, 90)).toEqual({
      width: 3,
      height: 4,
    });
    expect(rotatedSize({ width: 4, height: 3 }, 270)).toEqual({
      width: 3,
      height: 4,
    });
    expect(rotatedSize({ width: 4, height: 3 }, 180)).toEqual({
      width: 4,
      height: 3,
    });
  });

  it("accepts only the four quarter turns", () => {
    expect(isRotation(90)).toBe(true);
    expect(isRotation(45)).toBe(false);
    expect(isRotation("90")).toBe(false);
  });
});

describe("clampCrop", () => {
  const size = { width: 10, height: 6 };

  it("keeps a rect already inside the image", () => {
    expect(clampCrop({ x: 2, y: 1, width: 3, height: 2 }, size)).toEqual({
      x: 2,
      y: 1,
      width: 3,
      height: 2,
    });
  });

  it("clips a rect that overhangs the edges", () => {
    expect(clampCrop({ x: -2, y: 4, width: 5, height: 10 }, size)).toEqual({
      x: 0,
      y: 4,
      width: 3,
      height: 2,
    });
  });

  it("rounds fractional edges to whole pixels", () => {
    expect(
      clampCrop({ x: 1.4, y: 0.6, width: 2.2, height: 1.1 }, size),
    ).toEqual({
      x: 1,
      y: 1,
      width: 3,
      height: 1,
    });
  });

  it("returns null for a rect wholly outside", () => {
    expect(clampCrop({ x: 20, y: 0, width: 2, height: 2 }, size)).toBeNull();
  });
});

describe("cropImage", () => {
  const img = grid(4, 3);

  it("copies exactly the selected region", () => {
    const out = cropImage(img, { x: 1, y: 1, width: 2, height: 2 });
    expect([out.width, out.height]).toEqual([2, 2]);
    expect(sourceOf(out, 0, 0)).toEqual([1, 1]);
    expect(sourceOf(out, 1, 1)).toEqual([2, 2]);
  });

  it("returns the same object for a full-frame or out-of-range rect", () => {
    expect(cropImage(img, { x: 0, y: 0, width: 4, height: 3 })).toBe(img);
    expect(cropImage(img, { x: 9, y: 9, width: 1, height: 1 })).toBe(img);
  });
});

describe("applyTransform", () => {
  it("rotates first, then crops in the rotated space", () => {
    const img = grid(3, 2);
    const out = applyTransform(img, {
      rotation: 90,
      crop: { x: 0, y: 0, width: 1, height: 1 },
    });
    expect([out.width, out.height]).toEqual([1, 1]);
    expect(sourceOf(out, 0, 0)).toEqual([0, 1]);
  });

  it("identity is a no-op", () => {
    const img = grid(2, 2);
    expect(applyTransform(img, { rotation: 0, crop: null })).toBe(img);
    expect(isIdentityTransform({ rotation: 0, crop: null })).toBe(true);
    expect(isIdentityTransform({ rotation: 90, crop: null })).toBe(false);
  });
});
