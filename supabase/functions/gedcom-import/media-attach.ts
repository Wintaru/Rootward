/**
 * Bulk media attach from a GedZip archive (SPEC §6, issue #101). During the
 * import engine's `media` phase, match a parsed `OBJE` record's `FILE` value
 * against the archive's media files and, on a match, run the shared
 * `_shared/media-pipeline.ts` validate/derivative pipeline -- the same one
 * `media-process` runs for a single hand-uploaded photo -- then update that
 * `media` row's storage columns instead of inserting a new row (the row
 * already exists; `buildMedia` in `importer.ts` wrote it from the GEDCOM
 * record itself).
 *
 * Scope: only top-level `OBJE` records reach this -- an inline `OBJE`
 * synthesised under a person/family attachment has no dedicated media-phase
 * item to hang bytes off of, and stays reference-only as it always has.
 */

import { matchMediaFile } from "@rootward/gedcom";
import type { MediaFileIndex, ParsedMedia } from "@rootward/gedcom";

import {
  EXTENSION_FOR_MIME,
  processMediaBytes,
} from "../_shared/media-pipeline.ts";
import type {
  ExifTools,
  ImageCodec,
  TreeMediaSettings,
} from "../_shared/media-pipeline.ts";

export interface MediaBytesPatch {
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly storagePathOriginal: string;
  readonly storagePathThumb: string | null;
  readonly storagePathDisplay: string | null;
  readonly exif: { readonly hasGps: boolean; readonly gpsStripped: boolean };
}

export interface MediaAttachGateway {
  writeMediaObject(
    path: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<void>;
  updateMediaBytes(mediaId: string, patch: MediaBytesPatch): Promise<void>;
}

export interface AttachMediaDeps {
  readonly gateway: MediaAttachGateway;
  readonly codec: ImageCodec;
  readonly exif: ExifTools;
}

/** The subset of `ImportStats` this needs -- a structural match avoids an
 * import from `importer.ts` (which imports this module) just for one field. */
interface WarnSink {
  warnings: string[];
}

function warn(sink: WarnSink, message: string): void {
  if (sink.warnings.length < 200) {
    sink.warnings.push(message);
  }
}

/**
 * Attempt to attach archive bytes to `mediaId` (already `upsert`ed by
 * `buildMedia` this same batch). A miss -- no matching archive entry, a match
 * rejected by size/MIME, or an unexpected failure partway through (a
 * transient storage error, say) -- is recorded as a warning and leaves the
 * row reference-only, exactly like a plain `.ged` import with no archive at
 * all. One bad photo must not fail the whole import: everything from
 * `processMediaBytes` on is wrapped so a thrown error degrades to a warning
 * instead of propagating out of the media phase's batch loop.
 */
export async function attachMediaFromArchive(
  mediaId: string,
  item: ParsedMedia,
  index: MediaFileIndex,
  claimedByBasename: Set<string>,
  settings: TreeMediaSettings,
  deps: AttachMediaDeps,
  stats: WarnSink,
): Promise<void> {
  const match = matchMediaFile(
    item.original_filename,
    index,
    claimedByBasename,
  );
  if (match === null) {
    warn(
      stats,
      `media ${item.gedcom_xref}: "${
        item.original_filename ?? ""
      }" not found in the uploaded archive`,
    );
    return;
  }

  try {
    const outcome = await processMediaBytes(
      match.bytes,
      settings,
      deps.codec,
      deps.exif,
    );
    if (outcome.status === "rejected") {
      warn(
        stats,
        `media ${item.gedcom_xref}: archive file "${match.path}" rejected (${outcome.reason})`,
      );
      return;
    }

    const { result } = outcome;
    const extension = EXTENSION_FOR_MIME[result.mimeType] ?? "bin";
    const originalPath = `${mediaId}/original.${extension}`;
    await deps.gateway.writeMediaObject(
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
        deps.gateway.writeMediaObject(
          thumbPath,
          result.derivatives.thumb,
          "image/webp",
        ),
        deps.gateway.writeMediaObject(
          displayPath,
          result.derivatives.display,
          "image/webp",
        ),
      ]);
    }

    await deps.gateway.updateMediaBytes(mediaId, {
      mimeType: result.mimeType,
      sizeBytes: result.finalBytes.byteLength,
      storagePathOriginal: originalPath,
      storagePathThumb: thumbPath,
      storagePathDisplay: displayPath,
      exif: result.exif,
    });

    for (const w of result.warnings) {
      warn(stats, `media ${item.gedcom_xref}: ${w}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warn(
      stats,
      `media ${item.gedcom_xref}: archive file "${match.path}" could not be attached (${message})`,
    );
  }
}
