import {
  applyTransform,
  createExifTools,
  createImageCodec,
  decodeUpright,
  generateDerivatives,
  resizeImage,
  type DecodedImage,
  type MediaDerivatives,
  type MediaTransform,
} from "@rootward/media";

/**
 * The browser half of rotate/crop (SPEC §8.3): fetch the original over its
 * signed URL, decode it with the same `@rootward/media` codecs the upload
 * pipeline uses, and re-encode the thumb/display pair with a transform
 * applied. In the browser, not the edge function, for the reason issue
 * #104 moved upload processing there -- the edge worker's CPU budget does
 * not fit a full-resolution decode + two encodes.
 */

/** Longest side of the raster the editor draws and crops over. Big enough
 * to place a crop precisely, small enough that a quarter-turn is instant. */
const PREVIEW_MAX_DIMENSION = 1000;

export interface EditableOriginal {
  /** Full-resolution and upright (EXIF `Orientation` applied, issue #108)
   * -- what the derivatives are cut from, and what `media.rotation` is on
   * top of. */
  readonly original: DecodedImage;
  /** A downscaled copy for the on-screen preview. */
  readonly preview: DecodedImage;
}

/** `null` when the bytes have no browser decoder (HEIC behind the #104 stub,
 * or a MIME with no codec at all). */
export async function loadEditableOriginal(
  originalUrl: string,
  mimeType: string,
): Promise<EditableOriginal | null> {
  const response = await fetch(originalUrl);
  if (!response.ok) {
    throw new Error(`loadEditableOriginal: HTTP ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const { orientation } = await createExifTools().read(bytes, mimeType);
  const upright = await decodeUpright(
    bytes,
    mimeType,
    orientation,
    createImageCodec(),
  );
  if (upright === null) {
    return null;
  }
  const original = upright.image;
  const preview = await resizeImage(original, PREVIEW_MAX_DIMENSION);
  return { original, preview };
}

export async function regenerateDerivatives(
  original: DecodedImage,
  transform: MediaTransform,
): Promise<MediaDerivatives> {
  return generateDerivatives(
    applyTransform(original, transform),
    createImageCodec(),
  );
}
