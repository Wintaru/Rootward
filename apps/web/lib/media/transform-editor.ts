import {
  clampCrop,
  type CropRect,
  type ImageSize,
  type MediaTransform,
  type Rotation,
} from "@rootward/media";

/**
 * Pure state math for the rotate/crop editor (`MediaTransformEditor.tsx`,
 * SPEC §8.3). The editor keeps its crop in *percent* of the rotated preview
 * -- resolution-independent, so the same value describes the on-screen
 * preview and the full-size original -- and converts to `media.crop_*`
 * pixels only at save time. Unit-tested without a DOM, same split as
 * `view-model.ts`.
 */

/** The originals the browser can decode for editing: `@rootward/media`'s
 * `@jsquash` codecs. HEIC is stubbed out in the browser bundle (issue #104,
 * `next.config.ts`), and GIF/PDF have no codec anywhere, so none of those can
 * be re-derived client-side. */
const EDITABLE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export function isEditableMime(mimeType: string | null): boolean {
  return mimeType !== null && EDITABLE_MIME.has(mimeType);
}

/** A crop as `react-image-crop` reports it with `unit: "%"` -- each field is
 * 0..100 of the displayed raster. */
export interface PercentCrop {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A crop narrower than this on either axis is treated as an accidental
 * click, not a selection. */
const MIN_CROP_PERCENT = 1;

export function isUsableCrop(crop: PercentCrop | null): crop is PercentCrop {
  return (
    crop !== null &&
    crop.width >= MIN_CROP_PERCENT &&
    crop.height >= MIN_CROP_PERCENT
  );
}

export type RotationStep = 90 | -90;

export function stepRotation(current: Rotation, step: RotationStep): Rotation {
  const next = (((current + step) % 360) + 360) % 360;
  switch (next) {
    case 90:
      return 90;
    case 180:
      return 180;
    case 270:
      return 270;
    default:
      return 0;
  }
}

/**
 * Carry a percent crop through a quarter-turn of the raster it sits on, so
 * the selection keeps covering the same pixels after the user rotates. A
 * clockwise turn sends the old top edge to the right edge: `x' = 100 - (y +
 * h)`, `y' = x`, and the sides swap.
 */
export function rotateCropPercent(
  crop: PercentCrop,
  step: RotationStep,
): PercentCrop {
  return step === 90
    ? {
        x: 100 - (crop.y + crop.height),
        y: crop.x,
        width: crop.height,
        height: crop.width,
      }
    : {
        x: crop.y,
        y: 100 - (crop.x + crop.width),
        width: crop.height,
        height: crop.width,
      };
}

/** The stored pixel crop as a percent of `rotatedSize` (the original's size
 * after the stored rotation), for seeding the editor. `null` when the stored
 * rect no longer fits the image at all. */
export function pixelCropToPercent(
  crop: CropRect,
  rotatedSize: ImageSize,
): PercentCrop | null {
  const clamped = clampCrop(crop, rotatedSize);
  if (clamped === null) {
    return null;
  }
  return {
    x: (clamped.x / rotatedSize.width) * 100,
    y: (clamped.y / rotatedSize.height) * 100,
    width: (clamped.width / rotatedSize.width) * 100,
    height: (clamped.height / rotatedSize.height) * 100,
  };
}

/** The percent crop as whole pixels of `rotatedSize`, clamped inside it --
 * what `media.crop_*` stores. `null` when it collapses to nothing, and also
 * when it covers the whole frame: that is no crop, and storing it would
 * make Save look dirty against a stored `null`. */
export function percentCropToPixels(
  crop: PercentCrop,
  rotatedSize: ImageSize,
): CropRect | null {
  const clamped = clampCrop(
    {
      x: (crop.x / 100) * rotatedSize.width,
      y: (crop.y / 100) * rotatedSize.height,
      width: (crop.width / 100) * rotatedSize.width,
      height: (crop.height / 100) * rotatedSize.height,
    },
    rotatedSize,
  );
  const fullFrame =
    clamped !== null &&
    clamped.x === 0 &&
    clamped.y === 0 &&
    clamped.width === rotatedSize.width &&
    clamped.height === rotatedSize.height;
  return fullFrame ? null : clamped;
}

/** Whether saving `current` would change anything -- the editor's Save
 * button stays disabled until it would. */
export function isSameTransform(a: MediaTransform, b: MediaTransform): boolean {
  if (a.rotation !== b.rotation) {
    return false;
  }
  if (a.crop === null || b.crop === null) {
    return a.crop === b.crop;
  }
  return (
    a.crop.x === b.crop.x &&
    a.crop.y === b.crop.y &&
    a.crop.width === b.crop.width &&
    a.crop.height === b.crop.height
  );
}
