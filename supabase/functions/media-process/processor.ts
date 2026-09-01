/**
 * `media-process` edge function (SPEC §7, §4.4, issue #33, decision 25) -- the
 * portable engine. `index.ts` is the thin `Deno.serve` shell; `gateway.ts`,
 * `codec.ts`, and `exif.ts` are the real (Supabase / jsquash+heic-decode /
 * exifr+piexifjs) implementations of the three injected interfaces below.
 * Driver-free on purpose so the test suite can run every branch with fakes,
 * the same engine/gateway split as `gedcom-import` / `gedcom-export` /
 * `onboarding-match`.
 *
 * Contract: the caller has already uploaded the original to a staging object
 * in the private `media` bucket (`media/staging/<token>.<ext>`, moderator's
 * own session -- mirrors `gedcom-import`'s `imports/<job id>.ged` staging
 * upload). This function reads it back, validates it, generates the `thumb`
 * (~240px) / `display` (~1200px) WebP derivatives for the formats it has a
 * codec for, optionally strips GPS EXIF, writes everything under
 * `media/<media id>/...`, inserts `media` + `media_link`, and removes the
 * staging object.
 */

import type { GenealogyDateFields } from "@rootward/shared";

import { sniffMimeType } from "./mime.ts";
import type { ImageSize } from "./image-geometry.ts";
import { parseExifDateTaken } from "./date.ts";

/** SPEC §4.4 `media_owner` -- guarded against the migration enum by
 * `schema_parity.test.ts`. The single array (not a separate type + a second
 * runtime list) is what `index.ts` validates an incoming `ownerType` against
 * -- one list, so a value can't be in the type but missing from the runtime
 * check (or vice versa). */
export const MEDIA_OWNERS = [
  "person",
  "event",
  "fact",
  "family",
  "source",
  "place",
] as const;

export type MediaOwner = (typeof MEDIA_OWNERS)[number];

const THUMB_MAX_DIMENSION = 240;
const DISPLAY_MAX_DIMENSION = 1200;

export interface MediaProcessInput {
  readonly ownerType: MediaOwner;
  readonly ownerId: string;
  /** Path of the already-uploaded original within the `media` bucket. */
  readonly stagingPath: string;
  readonly originalFilename: string;
  /** `account.id` of the uploader, or `null` when called under the service
   * role with no user in context. */
  readonly uploadedBy: string | null;
}

export interface TreeMediaSettings {
  readonly mediaMaxBytes: number;
  readonly mediaAllowedMime: readonly string[];
  readonly stripExifGps: boolean;
}

export interface DecodedImage extends ImageSize {
  /** Raw RGBA, row-major, `width * height * 4` bytes. */
  readonly data: Uint8ClampedArray;
}

/** Injected so the engine tests never touch the real WASM codecs. */
export interface ImageCodec {
  /** `null` for a MIME with no derivative codec (v1: GIF, PDF -- see
   * `docs/DECISIONS.md`). */
  decode(bytes: Uint8Array, mimeType: string): Promise<DecodedImage | null>;
  /** Resize (longest side to `maxDimension`, never upscaling) and encode
   * WebP. */
  encodeWebp(image: DecodedImage, maxDimension: number): Promise<Uint8Array>;
}

export interface ExifResult {
  /** `YYYY-MM-DD`, already normalized from EXIF's own naive-datetime format,
   * or `null` when absent/unparseable. */
  readonly dateTaken: string | null;
  readonly hasGps: boolean;
}

export interface GpsStripResult {
  readonly bytes: Uint8Array;
  /** `false` when this MIME/tooling combination can't edit GPS tags in place
   * (v1: only `image/jpeg` -- see `docs/DECISIONS.md`) -- `bytes` is then the
   * untouched original. The engine records this, not just "did we try", so
   * `media.exif.gpsStripped` never claims a strip that didn't happen. */
  readonly stripped: boolean;
}

export interface ExifTools {
  read(bytes: Uint8Array, mimeType: string): Promise<ExifResult>;
  /** Remove GPS tags where this MIME/tooling combination supports it. */
  stripGps(bytes: Uint8Array, mimeType: string): Promise<GpsStripResult>;
}

export interface MediaRowInsert {
  readonly id: string;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly storagePathOriginal: string;
  readonly storagePathThumb: string | null;
  readonly storagePathDisplay: string | null;
  readonly date: GenealogyDateFields | null;
  readonly exif: { readonly hasGps: boolean; readonly gpsStripped: boolean };
  readonly uploadedBy: string | null;
}

export interface MediaLinkInsert {
  readonly mediaId: string;
  readonly ownerType: MediaOwner;
  readonly ownerId: string;
}

export interface MediaProcessGateway {
  loadTreeSettings(): Promise<TreeMediaSettings>;
  readObject(path: string): Promise<Uint8Array>;
  writeObject(
    path: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<void>;
  removeObject(path: string): Promise<void>;
  insertMedia(row: MediaRowInsert): Promise<void>;
  insertMediaLink(link: MediaLinkInsert): Promise<void>;
}

export interface MediaProcessDeps {
  readonly gateway: MediaProcessGateway;
  readonly codec: ImageCodec;
  readonly exif: ExifTools;
  /** Injected for deterministic tests; production passes `crypto.randomUUID`. */
  readonly newId: () => string;
}

export type MediaProcessOutcome =
  | {
    readonly status: "processed";
    readonly mediaId: string;
    readonly hasDerivatives: boolean;
    readonly warnings: readonly string[];
  }
  | {
    readonly status: "rejected";
    readonly reason: "size" | "mime";
  };

const EXTENSION_FOR_MIME: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

export async function runMediaProcess(
  input: MediaProcessInput,
  deps: MediaProcessDeps,
): Promise<MediaProcessOutcome> {
  const settings = await deps.gateway.loadTreeSettings();
  const original = await deps.gateway.readObject(input.stagingPath);

  if (original.byteLength > settings.mediaMaxBytes) {
    await deps.gateway.removeObject(input.stagingPath);
    return { status: "rejected", reason: "size" };
  }

  const mimeType = sniffMimeType(original);
  if (mimeType === null || !settings.mediaAllowedMime.includes(mimeType)) {
    await deps.gateway.removeObject(input.stagingPath);
    return { status: "rejected", reason: "mime" };
  }

  const warnings: string[] = [];
  const mediaId = deps.newId();
  const extension = EXTENSION_FOR_MIME[mimeType] ?? "bin";

  const exifResult = await deps.exif.read(original, mimeType);
  const wantsStrip = settings.stripExifGps && exifResult.hasGps;
  let finalOriginal = original;
  let gpsStripped = false;
  if (wantsStrip) {
    const stripResult = await deps.exif.stripGps(original, mimeType);
    finalOriginal = stripResult.bytes;
    gpsStripped = stripResult.stripped;
    if (!stripResult.stripped) {
      warnings.push(
        `GPS EXIF present but could not be stripped for ${mimeType}; original kept as uploaded`,
      );
    }
  }

  const originalPath = `${mediaId}/original.${extension}`;
  await deps.gateway.writeObject(originalPath, finalOriginal, mimeType);

  let thumbPath: string | null = null;
  let displayPath: string | null = null;
  try {
    const decoded = await deps.codec.decode(finalOriginal, mimeType);
    if (decoded !== null) {
      const [thumb, display] = await Promise.all([
        deps.codec.encodeWebp(decoded, THUMB_MAX_DIMENSION),
        deps.codec.encodeWebp(decoded, DISPLAY_MAX_DIMENSION),
      ]);
      thumbPath = `${mediaId}/thumb.webp`;
      displayPath = `${mediaId}/display.webp`;
      await Promise.all([
        deps.gateway.writeObject(thumbPath, thumb, "image/webp"),
        deps.gateway.writeObject(displayPath, display, "image/webp"),
      ]);
    } else {
      warnings.push(`no thumbnail codec for ${mimeType}; stored original only`);
    }
  } catch (err) {
    // A malformed-but-allowed-MIME file (or a codec limitation) must not lose
    // the upload -- the original is already written; just skip derivatives.
    const message = err instanceof Error ? err.message : String(err);
    warnings.push(`could not generate derivatives: ${message}`);
  }

  await deps.gateway.insertMedia({
    id: mediaId,
    originalFilename: input.originalFilename,
    mimeType,
    sizeBytes: finalOriginal.byteLength,
    storagePathOriginal: originalPath,
    storagePathThumb: thumbPath,
    storagePathDisplay: displayPath,
    date: parseExifDateTaken(exifResult.dateTaken),
    exif: { hasGps: exifResult.hasGps, gpsStripped },
    uploadedBy: input.uploadedBy,
  });
  await deps.gateway.insertMediaLink({
    mediaId,
    ownerType: input.ownerType,
    ownerId: input.ownerId,
  });

  await deps.gateway.removeObject(input.stagingPath);

  return {
    status: "processed",
    mediaId,
    hasDerivatives: thumbPath !== null,
    warnings,
  };
}
