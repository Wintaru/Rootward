/**
 * `@rootward/media` — the portable photo-processing engine: MIME sniffing,
 * EXIF read/strip, and JPEG/PNG/WebP/HEIC decode + WebP thumbnail/display
 * derivatives. Runs unchanged in the `media-process` and `gedcom-import`
 * Deno edge functions and, since issue #104, in the browser itself — the
 * `gedcom-import` edge function's fixed CPU-time/memory budget (a local
 * Supabase worker gets 256 MB and ~1-2s of CPU per invocation, hardcoded,
 * no override) is too tight for decoding and re-encoding a real
 * full-resolution photo through WASM codecs, so the browser now does that
 * work itself before uploading the already-processed derivatives — see
 * `apps/web/lib/import/process-media.ts`.
 *
 * Pure TypeScript. No Node or Deno built-ins (WAYFINDER decision 8).
 */

export {
  EXTENSION_FOR_MIME,
  generateDerivatives,
  processMediaBytes,
} from "./pipeline.ts";
export type {
  DecodedImage,
  MediaDerivatives,
  ExifResult,
  ExifTools,
  GpsStripResult,
  ImageCodec,
  ProcessedMediaBytes,
  ProcessMediaBytesOutcome,
  ReadyMediaFile,
  TreeMediaSettings,
} from "./pipeline.ts";

export { createImageCodec, resizeImage } from "./codec.ts";
export { createExifTools } from "./exif.ts";
export { sniffMimeType } from "./mime.ts";
export { computeTargetSize } from "./image-geometry.ts";
export type { ImageSize } from "./image-geometry.ts";
export {
  applyTransform,
  clampCrop,
  cropImage,
  IDENTITY_TRANSFORM,
  isIdentityTransform,
  isRotation,
  rotatedSize,
  rotateImage,
  ROTATIONS,
} from "./transform.ts";
export type { CropRect, MediaTransform, Rotation } from "./transform.ts";
