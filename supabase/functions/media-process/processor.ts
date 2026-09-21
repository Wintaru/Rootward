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
 *
 * The validate / strip / derivative work itself lives in `@rootward/media`'s
 * `pipeline.ts` (issue #104 pt. 2), imported below -- a portable package so
 * the browser can run the same pipeline client-side. `gedcom-import`'s bulk
 * GedZip attach (issue #101) no longer runs this pipeline itself; it just
 * writes the already-processed `ReadyMediaFile` the browser produced onto an
 * already-existing `media` row.
 */

import type { GenealogyDateFields } from "@rootward/shared";
import { EXTENSION_FOR_MIME, processMediaBytes } from "@rootward/media";

import { parseExifDateTaken } from "./date.ts";

export type {
  DecodedImage,
  ExifResult,
  ExifTools,
  GpsStripResult,
  ImageCodec,
  TreeMediaSettings,
} from "@rootward/media";
import type {
  ExifTools,
  ImageCodec,
  MediaExifMeta,
  TreeMediaSettings,
} from "@rootward/media";

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

export interface MediaRowInsert {
  readonly id: string;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly storagePathOriginal: string;
  readonly storagePathThumb: string | null;
  readonly storagePathDisplay: string | null;
  readonly date: GenealogyDateFields | null;
  readonly exif: MediaExifMeta;
  readonly uploadedBy: string | null;
}

export interface MediaLinkInsert {
  readonly mediaId: string;
  readonly ownerType: MediaOwner;
  readonly ownerId: string;
  /** Position among the owner's links — one past the highest the owner
   * already has, so the new one lands last. The edit view's Media section
   * compares this against each row's list index; a null here reads as a
   * pending reorder on every load (#116). */
  readonly sortOrder: number;
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
  /** One past the highest `sort_order` among `ownerId`'s links, `0` when it
   * has none — gap-proof, unlike a row count. */
  nextMediaLinkSortOrder(
    ownerType: MediaOwner,
    ownerId: string,
  ): Promise<number>;
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

export async function runMediaProcess(
  input: MediaProcessInput,
  deps: MediaProcessDeps,
): Promise<MediaProcessOutcome> {
  const settings = await deps.gateway.loadTreeSettings();
  const original = await deps.gateway.readObject(input.stagingPath);

  const outcome = await processMediaBytes(
    original,
    settings,
    deps.codec,
    deps.exif,
  );
  if (outcome.status === "rejected") {
    await deps.gateway.removeObject(input.stagingPath);
    return outcome;
  }

  const { result } = outcome;
  const mediaId = deps.newId();
  const extension = EXTENSION_FOR_MIME[result.mimeType] ?? "bin";

  const originalPath = `${mediaId}/original.${extension}`;
  await deps.gateway.writeObject(
    originalPath,
    result.finalBytes,
    result.mimeType,
  );

  let thumbPath: string | null = null;
  let displayPath: string | null = null;
  if (result.derivatives !== null) {
    thumbPath = `${mediaId}/thumb.webp`;
    displayPath = `${mediaId}/display.webp`;
    await Promise.all([
      deps.gateway.writeObject(
        thumbPath,
        result.derivatives.thumb,
        "image/webp",
      ),
      deps.gateway.writeObject(
        displayPath,
        result.derivatives.display,
        "image/webp",
      ),
    ]);
  }

  await deps.gateway.insertMedia({
    id: mediaId,
    originalFilename: input.originalFilename,
    mimeType: result.mimeType,
    sizeBytes: result.finalBytes.byteLength,
    storagePathOriginal: originalPath,
    storagePathThumb: thumbPath,
    storagePathDisplay: displayPath,
    date: parseExifDateTaken(result.dateTaken),
    exif: result.exif,
    uploadedBy: input.uploadedBy,
  });
  await deps.gateway.insertMediaLink({
    mediaId,
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    sortOrder: await deps.gateway.nextMediaLinkSortOrder(
      input.ownerType,
      input.ownerId,
    ),
  });

  await deps.gateway.removeObject(input.stagingPath);

  return {
    status: "processed",
    mediaId,
    hasDerivatives: thumbPath !== null,
    warnings: result.warnings,
  };
}
