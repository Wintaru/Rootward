import { describe, expect, it } from "vitest";

import type { DecodedImage } from "./pipeline.ts";
import {
  applyExifOrientation,
  EXIF_ORIENTATIONS,
  flipHorizontal,
  isExifOrientation,
  orientationToApply,
  type ExifOrientation,
} from "./orientation.ts";

/** A 2×2 image from four opaque grey levels, row-major:
 *
 *     [a b]
 *     [c d]
 */
function quad(a: number, b: number, c: number, d: number): DecodedImage {
  const data = new Uint8ClampedArray(2 * 2 * 4);
  [a, b, c, d].forEach((level, i) => {
    data[i * 4] = level;
    data[i * 4 + 1] = level;
    data[i * 4 + 2] = level;
    data[i * 4 + 3] = 255;
  });
  return { width: 2, height: 2, data };
}

function levels(image: DecodedImage): number[] {
  const out: number[] = [];
  for (let i = 0; i < image.width * image.height; i++) {
    out.push(image.data[i * 4] ?? -1);
  }
  return out;
}

const A = 10;
const B = 20;
const C = 30;
const D = 40;

/** The upright picture every case must come back to. */
const UPRIGHT = quad(A, B, C, D);

/**
 * How a camera stores {@link UPRIGHT} under each `Orientation` value --
 * derived by hand from the EXIF definitions (the tag names the transform a
 * viewer applies; the stored raster is its inverse applied to the upright
 * picture):
 *
 * 1 as is · 2 mirrored · 3 turned 180 · 4 flipped top-to-bottom ·
 * 5 transposed · 6 turned 90 CCW (viewer turns 90 CW) · 7 anti-transposed ·
 * 8 turned 90 CW (viewer turns 270 CW)
 */
const STORED: Readonly<Record<ExifOrientation, DecodedImage>> = {
  1: quad(A, B, C, D),
  2: quad(B, A, D, C),
  3: quad(D, C, B, A),
  4: quad(C, D, A, B),
  5: quad(A, C, B, D),
  6: quad(B, D, A, C),
  7: quad(D, B, C, A),
  8: quad(C, A, D, B),
};

describe("applyExifOrientation", () => {
  it.each(EXIF_ORIENTATIONS)(
    "Orientation %i: the stored raster comes back upright",
    (orientation) => {
      const out = applyExifOrientation(STORED[orientation], orientation);
      expect(levels(out)).toEqual(levels(UPRIGHT));
    },
  );

  it("returns the same object for 1", () => {
    expect(applyExifOrientation(UPRIGHT, 1)).toBe(UPRIGHT);
  });

  it("swaps the axes for the four quarter-turn values on a non-square image", () => {
    const wide: DecodedImage = {
      width: 3,
      height: 1,
      data: new Uint8ClampedArray(3 * 4).fill(255),
    };
    for (const orientation of [5, 6, 7, 8] as const) {
      const out = applyExifOrientation(wide, orientation);
      expect([out.width, out.height]).toEqual([1, 3]);
    }
    for (const orientation of [2, 3, 4] as const) {
      const out = applyExifOrientation(wide, orientation);
      expect([out.width, out.height]).toEqual([3, 1]);
    }
  });
});

describe("flipHorizontal", () => {
  it("mirrors each row and keeps the size", () => {
    const out = flipHorizontal(quad(A, B, C, D));
    expect([out.width, out.height]).toEqual([2, 2]);
    expect(levels(out)).toEqual([B, A, D, C]);
  });
});

describe("orientationToApply", () => {
  it("is null for an absent tag and for 1", () => {
    expect(orientationToApply("image/jpeg", null)).toBeNull();
    expect(orientationToApply("image/jpeg", 1)).toBeNull();
  });

  it("passes 2-8 through for formats whose decoder returns the raw raster", () => {
    expect(orientationToApply("image/jpeg", 6)).toBe(6);
    expect(orientationToApply("image/png", 3)).toBe(3);
    expect(orientationToApply("image/webp", 8)).toBe(8);
  });

  it("is null for HEIC -- libheif already applied the file's own turn", () => {
    expect(orientationToApply("image/heic", 6)).toBeNull();
  });
});

describe("isExifOrientation", () => {
  it("accepts 1-8 and nothing else", () => {
    for (const value of EXIF_ORIENTATIONS) {
      expect(isExifOrientation(value)).toBe(true);
    }
    expect(isExifOrientation(0)).toBe(false);
    expect(isExifOrientation(9)).toBe(false);
    expect(isExifOrientation("6")).toBe(false);
    expect(isExifOrientation("Rotate 90 CW")).toBe(false);
    expect(isExifOrientation(null)).toBe(false);
  });
});
