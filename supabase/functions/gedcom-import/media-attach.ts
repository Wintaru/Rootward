/**
 * Bulk media attach from a GedZip archive (SPEC §6, issue #101). During the
 * import engine's `media` phase, match a parsed `OBJE` record's `FILE` value
 * against the archive's media files and, on a match, write the already-
 * processed bytes the browser produced to that `media` row's storage columns
 * instead of inserting a new row (the row already exists; `buildMedia` in
 * `importer.ts` wrote it from the GEDCOM record itself).
 *
 * No codec or EXIF work happens here (issue #104 pt. 2): decoding and
 * re-encoding a real full-resolution photo through the WASM codecs routinely
 * exceeded the edge runtime's own fixed CPU-time budget (~1-2s, hardcoded,
 * no override in local dev), so `processMediaBytes` now runs client-side,
 * before upload -- see `apps/web/lib/import/process-media.ts`. This module
 * just writes bytes it already has to Storage and updates the row.
 *
 * Scope: only top-level `OBJE` records reach this -- an inline `OBJE`
 * synthesised under a person/family attachment has no dedicated media-phase
 * item to hang bytes off of, and stays reference-only as it always has.
 */

import { EXTENSION_FOR_MIME } from "@rootward/media";
import type { MatchedMediaFile, ParsedMedia } from "@rootward/gedcom";

import type { ReadyMediaFile } from "./importer.ts";

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
 * Write `ready`'s already-processed bytes to `mediaId` (already `upsert`ed
 * by `buildMedia` this same batch). `match` and `ready` are resolved by the
 * caller: matching (`matchMediaFile`, against every item in the batch, in
 * order) has to happen before any bytes are fetched, because the whole
 * batch's worth of needed archive items gets fetched in one targeted pass
 * (`readReadyMedia`) rather than the whole archive up front -- see
 * `importer.ts`'s media-phase batch loop. A miss -- no matching archive
 * entry, a client-side rejection (size, MIME), or an unexpected failure
 * partway through (a transient storage error, say) -- is recorded as a
 * warning and leaves the row reference-only, exactly like a plain `.ged`
 * import with no archive at all. One bad photo must not fail the whole
 * import: the write is wrapped so a thrown error degrades to a warning
 * instead of propagating out of the media phase's batch loop.
 */
export async function attachMediaFromArchive(
  mediaId: string,
  item: ParsedMedia,
  match: MatchedMediaFile | null,
  ready: ReadyMediaFile | null,
  gateway: MediaAttachGateway,
  stats: WarnSink,
): Promise<void> {
  if (match === null || ready === null) {
    warn(
      stats,
      `media ${item.gedcom_xref}: "${
        item.original_filename ?? ""
      }" not found in the uploaded archive`,
    );
    return;
  }
  if (ready.status === "rejected") {
    warn(
      stats,
      `media ${item.gedcom_xref}: archive file "${match.path}" rejected (${ready.rejectReason})`,
    );
    return;
  }

  try {
    const extension = EXTENSION_FOR_MIME[ready.mimeType] ?? "bin";
    const originalPath = `${mediaId}/original.${extension}`;
    await gateway.writeMediaObject(
      originalPath,
      ready.originalBytes,
      ready.mimeType,
    );

    let thumbPath: string | null = null;
    let displayPath: string | null = null;
    if (ready.derivatives !== null) {
      thumbPath = `${mediaId}/thumb.webp`;
      displayPath = `${mediaId}/display.webp`;
      await Promise.all([
        gateway.writeMediaObject(
          thumbPath,
          ready.derivatives.thumb,
          "image/webp",
        ),
        gateway.writeMediaObject(
          displayPath,
          ready.derivatives.display,
          "image/webp",
        ),
      ]);
    }

    await gateway.updateMediaBytes(mediaId, {
      mimeType: ready.mimeType,
      sizeBytes: ready.originalBytes.byteLength,
      storagePathOriginal: originalPath,
      storagePathThumb: thumbPath,
      storagePathDisplay: displayPath,
      exif: ready.exif,
    });

    for (const w of ready.warnings) {
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
