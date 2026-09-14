/**
 * Non-destructive rotate/crop (SPEC §4.4, §8.3): pure RGBA raster
 * operations applied to the decoded *original* right before the
 * thumb/display derivatives are encoded. The stored original is never
 * rewritten -- `media.rotation` + `media.crop_*` describe this transform and
 * the derivatives are regenerated from it (see DECISIONS.md,
 * 2026-09-14 17:04). Portable, no DOM `canvas` -- the same code runs in a
 * Deno edge function or a browser tab.
 */

import type { DecodedImage } from "./pipeline.ts";
import type { ImageSize } from "./image-geometry.ts";

export const ROTATIONS = [0, 90, 180, 270] as const;

/** Clockwise degrees. */
export type Rotation = (typeof ROTATIONS)[number];

export function isRotation(value: unknown): value is Rotation {
  return (ROTATIONS as readonly unknown[]).includes(value);
}

/** A crop rectangle in the pixel space of the *rotated* image. */
export interface CropRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface MediaTransform {
  readonly rotation: Rotation;
  readonly crop: CropRect | null;
}

export const IDENTITY_TRANSFORM: MediaTransform = { rotation: 0, crop: null };

export function isIdentityTransform(transform: MediaTransform): boolean {
  return transform.rotation === 0 && transform.crop === null;
}

/** The size `size` has after a `rotation` -- a quarter turn swaps the axes. */
export function rotatedSize(size: ImageSize, rotation: Rotation): ImageSize {
  return rotation === 90 || rotation === 270
    ? { width: size.height, height: size.width }
    : size;
}

const BYTES_PER_PIXEL = 4;

/** Rotate `image` clockwise by a quarter-turn multiple. Returns the same
 * object for `0` -- callers may rely on that to skip a copy. */
export function rotateImage(
  image: DecodedImage,
  rotation: Rotation,
): DecodedImage {
  if (rotation === 0) {
    return image;
  }
  const { width, height, data } = image;
  const target = rotatedSize(image, rotation);
  const out = new Uint8ClampedArray(
    target.width * target.height * BYTES_PER_PIXEL,
  );

  // The target pixel index of source (x, y) -- `ty * target.width + tx`,
  // chosen once rather than switched on per pixel (a 48 MP photo is ~48M
  // iterations on the main thread).
  const targetIndex: (x: number, y: number) => number =
    rotation === 90
      ? (x, y) => x * target.width + (height - 1 - y)
      : rotation === 180
        ? (x, y) => (height - 1 - y) * target.width + (width - 1 - x)
        : (x, y) => (width - 1 - x) * target.width + y;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * BYTES_PER_PIXEL;
      const to = targetIndex(x, y) * BYTES_PER_PIXEL;
      out[to] = data[from] ?? 0;
      out[to + 1] = data[from + 1] ?? 0;
      out[to + 2] = data[from + 2] ?? 0;
      out[to + 3] = data[from + 3] ?? 0;
    }
  }

  return { width: target.width, height: target.height, data: out };
}

/**
 * Clamp `rect` to `size` and round its edges to whole pixels. `null` when
 * nothing of the rectangle lies inside the image -- a crop saved against a
 * different original than the one being processed, which the caller treats
 * as "no crop" rather than an error.
 */
export function clampCrop(rect: CropRect, size: ImageSize): CropRect | null {
  const x = Math.max(0, Math.round(rect.x));
  const y = Math.max(0, Math.round(rect.y));
  const right = Math.min(size.width, Math.round(rect.x + rect.width));
  const bottom = Math.min(size.height, Math.round(rect.y + rect.height));
  if (right - x < 1 || bottom - y < 1) {
    return null;
  }
  return { x, y, width: right - x, height: bottom - y };
}

/** Copy the `rect` region of `image` (already clamped -- see
 * {@link clampCrop}). Returns the same object when `rect` covers the whole
 * image. */
export function cropImage(image: DecodedImage, rect: CropRect): DecodedImage {
  const clamped = clampCrop(rect, image);
  if (clamped === null) {
    return image;
  }
  if (
    clamped.x === 0 &&
    clamped.y === 0 &&
    clamped.width === image.width &&
    clamped.height === image.height
  ) {
    return image;
  }

  const out = new Uint8ClampedArray(
    clamped.width * clamped.height * BYTES_PER_PIXEL,
  );
  const rowBytes = clamped.width * BYTES_PER_PIXEL;
  for (let row = 0; row < clamped.height; row++) {
    const from =
      ((clamped.y + row) * image.width + clamped.x) * BYTES_PER_PIXEL;
    out.set(image.data.subarray(from, from + rowBytes), row * rowBytes);
  }
  return { width: clamped.width, height: clamped.height, data: out };
}

/** Rotate first, then crop in the rotated space -- the order
 * `media.crop_*` is defined in. */
export function applyTransform(
  image: DecodedImage,
  transform: MediaTransform,
): DecodedImage {
  const rotated = rotateImage(image, transform.rotation);
  return transform.crop === null ? rotated : cropImage(rotated, transform.crop);
}
