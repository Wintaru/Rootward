/**
 * EXIF `Orientation` (issue #108): a phone stores the sensor raster as shot
 * and writes a tag saying how a viewer must turn it. The raw decoders here
 * (`@jsquash/*`) hand back that raster untouched, so a portrait photo came
 * out sideways in every derivative. This module maps the tag to a flip plus
 * a quarter-turn and applies it to the decoded pixels, so everything
 * downstream -- the thumb/display pair, the rotate/crop editor's preview,
 * `media.rotation` itself -- is defined against the upright image.
 * Portable, no DOM (WAYFINDER decision 8).
 */

import type { DecodedImage } from "./pipeline.ts";
import { rotateImage, type Rotation } from "./transform.ts";

export const EXIF_ORIENTATIONS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

/** The EXIF `Orientation` tag value, 1 (upright) to 8. */
export type ExifOrientation = (typeof EXIF_ORIENTATIONS)[number];

export function isExifOrientation(value: unknown): value is ExifOrientation {
  return (EXIF_ORIENTATIONS as readonly unknown[]).includes(value);
}

interface UprightStep {
  /** Mirror left-to-right first ... */
  readonly flipHorizontal: boolean;
  /** ... then turn clockwise. */
  readonly rotation: Rotation;
}

/** The transform that makes a raster stored under each tag value upright.
 * Flip first, then rotate -- the order ExifTool's tag descriptions use
 * ("Mirror horizontal and rotate 270 CW" for 5); the EXIF spec itself
 * defines each value by where the stored 0th row and 0th column sit. The
 * order matters: rotate-then-flip is a different picture for 5 and 7. */
const UPRIGHT_STEP: Readonly<Record<ExifOrientation, UprightStep>> = {
  1: { flipHorizontal: false, rotation: 0 },
  2: { flipHorizontal: true, rotation: 0 },
  3: { flipHorizontal: false, rotation: 180 },
  4: { flipHorizontal: true, rotation: 180 },
  5: { flipHorizontal: true, rotation: 270 },
  6: { flipHorizontal: false, rotation: 90 },
  7: { flipHorizontal: true, rotation: 90 },
  8: { flipHorizontal: false, rotation: 270 },
};

/** Decoders that already honour the file's own orientation data. `heic-decode`
 * (libheif) applies the HEIF `irot` / `imir` boxes itself, and an iPhone
 * HEIC carries the same turn there as in its EXIF tag -- applying the tag
 * again would turn the photo twice. */
const DECODER_APPLIES_ORIENTATION: readonly string[] = ["image/heic"];

/** The tag value a caller should apply to `mimeType`'s decoded raster, or
 * `null` when nothing is to be done -- the tag is absent, says upright, or
 * the decoder for this format already applied it. */
export function orientationToApply(
  mimeType: string,
  orientation: ExifOrientation | null,
): ExifOrientation | null {
  if (orientation === null || orientation === 1) {
    return null;
  }
  return DECODER_APPLIES_ORIENTATION.includes(mimeType) ? null : orientation;
}

const BYTES_PER_PIXEL = 4;

/** Mirror `image` left-to-right. Returns a new raster. */
export function flipHorizontal(image: DecodedImage): DecodedImage {
  const { width, height, data } = image;
  const out = new Uint8ClampedArray(data.length);
  const rowBytes = width * BYTES_PER_PIXEL;
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowBytes;
    for (let x = 0; x < width; x++) {
      const from = rowStart + x * BYTES_PER_PIXEL;
      const to = rowStart + (width - 1 - x) * BYTES_PER_PIXEL;
      out[to] = data[from] ?? 0;
      out[to + 1] = data[from + 1] ?? 0;
      out[to + 2] = data[from + 2] ?? 0;
      out[to + 3] = data[from + 3] ?? 0;
    }
  }
  return { width, height, data: out };
}

/** Turn a raster stored under `orientation` upright. Returns the same
 * object for `1` -- callers may rely on that to skip a copy. */
export function applyExifOrientation(
  image: DecodedImage,
  orientation: ExifOrientation,
): DecodedImage {
  const step = UPRIGHT_STEP[orientation];
  const flipped = step.flipHorizontal ? flipHorizontal(image) : image;
  return rotateImage(flipped, step.rotation);
}
