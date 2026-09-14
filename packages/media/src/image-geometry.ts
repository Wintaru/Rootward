/**
 * Pure sizing math for the thumb/display derivatives (SPEC §7 `media-process`,
 * decision 25: "~240px" thumbnail, "~1200px" display). Never upscales.
 */

export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

/** Scale `size` down so its longer side is at most `maxDimension`, preserving
 * aspect ratio. Returns `size` unchanged when it already fits. */
export function computeTargetSize(
  size: ImageSize,
  maxDimension: number,
): ImageSize {
  const longest = Math.max(size.width, size.height);
  if (longest <= maxDimension) {
    return size;
  }
  const scale = maxDimension / longest;
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}
