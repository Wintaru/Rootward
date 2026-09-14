/**
 * The bytes-processing core shared by `media-process` (a single upload,
 * SPEC §4.4, issue #33), `gedcom-import` (bulk-attaching a GedZip's media,
 * issue #101), and, now, the browser itself (issue #104 -- see this
 * package's own doc comment on `index.ts`). Portable: no Deno or Node
 * built-ins, so it runs unchanged in an edge function or a browser tab.
 */

import { sniffMimeType } from "./mime.ts";

const THUMB_MAX_DIMENSION = 240;
const DISPLAY_MAX_DIMENSION = 1200;

/** Storage-path extension per allowed MIME (SPEC §4.4, `tree_settings.media_allowed_mime`).
 * `"bin"` is unreachable in practice -- `mediaAllowedMime` is drawn from this
 * same set -- but keeps path-building total for any MIME `sniffMimeType` ever
 * returns. */
export const EXTENSION_FOR_MIME: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

export interface TreeMediaSettings {
  readonly mediaMaxBytes: number;
  readonly mediaAllowedMime: readonly string[];
  readonly stripExifGps: boolean;
}

export interface DecodedImage {
  readonly width: number;
  readonly height: number;
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
   * untouched original. */
  readonly stripped: boolean;
}

export interface ExifTools {
  read(bytes: Uint8Array, mimeType: string): Promise<ExifResult>;
  /** Remove GPS tags where this MIME/tooling combination supports it. */
  stripGps(bytes: Uint8Array, mimeType: string): Promise<GpsStripResult>;
}

export interface MediaDerivatives {
  readonly thumb: Uint8Array;
  readonly display: Uint8Array;
}

/** Encode the ~240px `thumb` and ~1200px `display` WebP pair (decision 25)
 * from an already-decoded raster -- the one place both sizes are named, so
 * a first upload and a later rotate/crop regeneration (`transform.ts`)
 * produce derivatives of the same shape. */
export async function generateDerivatives(
  image: DecodedImage,
  codec: ImageCodec,
): Promise<MediaDerivatives> {
  const [thumb, display] = await Promise.all([
    codec.encodeWebp(image, THUMB_MAX_DIMENSION),
    codec.encodeWebp(image, DISPLAY_MAX_DIMENSION),
  ]);
  return { thumb, display };
}

export interface ProcessedMediaBytes {
  readonly mimeType: string;
  /** The original bytes, GPS-stripped when that applied. */
  readonly finalBytes: Uint8Array;
  readonly derivatives: MediaDerivatives | null;
  readonly dateTaken: string | null;
  readonly exif: { readonly hasGps: boolean; readonly gpsStripped: boolean };
  readonly warnings: readonly string[];
}

export type ProcessMediaBytesOutcome =
  | { readonly status: "processed"; readonly result: ProcessedMediaBytes }
  | { readonly status: "rejected"; readonly reason: "size" | "mime" };

/**
 * A {@link ProcessMediaBytesOutcome}, reshaped for storage transport (issue
 * #104 pt. 2): the browser runs {@link processMediaBytes} itself -- the edge
 * runtime's fixed ~1-2s CPU budget routinely can't fit decoding and
 * re-encoding a real full-resolution photo through WASM codecs -- uploads
 * the result under this shape (bytes as separate Storage objects, everything
 * else as a small JSON sidecar), and the edge function reconstructs it on
 * read. Field names differ deliberately from {@link ProcessedMediaBytes} --
 * `originalBytes` rather than `finalBytes` -- so this transport shape can
 * evolve independently of the in-process one it is derived from. */
export type ReadyMediaFile =
  | {
      readonly status: "rejected";
      readonly rejectReason: "size" | "mime";
    }
  | {
      readonly status: "processed";
      readonly mimeType: string;
      readonly originalBytes: Uint8Array;
      readonly derivatives: {
        readonly thumb: Uint8Array;
        readonly display: Uint8Array;
      } | null;
      readonly exif: {
        readonly hasGps: boolean;
        readonly gpsStripped: boolean;
      };
      readonly warnings: readonly string[];
    };

/**
 * Validate `original` against `settings`, strip GPS EXIF when asked for and
 * supported, and generate `thumb`/`display` derivatives when the MIME has a
 * codec. A derivative failure (a malformed-but-allowed-MIME file, or a codec
 * limitation) is reported as a warning, not a rejection -- the original is
 * still usable on its own.
 */
export async function processMediaBytes(
  original: Uint8Array,
  settings: TreeMediaSettings,
  codec: ImageCodec,
  exif: ExifTools,
): Promise<ProcessMediaBytesOutcome> {
  if (original.byteLength > settings.mediaMaxBytes) {
    return { status: "rejected", reason: "size" };
  }

  const mimeType = sniffMimeType(original);
  if (mimeType === null || !settings.mediaAllowedMime.includes(mimeType)) {
    return { status: "rejected", reason: "mime" };
  }

  const warnings: string[] = [];
  const exifResult = await exif.read(original, mimeType);
  const wantsStrip = settings.stripExifGps && exifResult.hasGps;
  let finalBytes = original;
  let gpsStripped = false;
  if (wantsStrip) {
    const stripResult = await exif.stripGps(original, mimeType);
    finalBytes = stripResult.bytes;
    gpsStripped = stripResult.stripped;
    if (!stripResult.stripped) {
      warnings.push(
        `GPS EXIF present but could not be stripped for ${mimeType}; original kept as uploaded`,
      );
    }
  }

  let derivatives: ProcessedMediaBytes["derivatives"] = null;
  try {
    const decoded = await codec.decode(finalBytes, mimeType);
    if (decoded !== null) {
      derivatives = await generateDerivatives(decoded, codec);
    } else {
      warnings.push(`no thumbnail codec for ${mimeType}; stored original only`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warnings.push(`could not generate derivatives: ${message}`);
  }

  return {
    status: "processed",
    result: {
      mimeType,
      finalBytes,
      derivatives,
      dateTaken: exifResult.dateTaken,
      exif: { hasGps: exifResult.hasGps, gpsStripped },
      warnings,
    },
  };
}
