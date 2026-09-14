import {
  createExifTools,
  createImageCodec,
  processMediaBytes,
  type ReadyMediaFile,
  type TreeMediaSettings,
} from "@rootward/media";

export type { ReadyMediaFile };

/**
 * Run every unzipped GedZip media file through the real validate/EXIF-strip/
 * derivative pipeline, in the browser (issue #104 pt. 2). Sequential, not
 * concurrent -- WASM codec work blocks the JS main thread regardless, so
 * `Promise.all` would not actually parallelize it, only make the "which
 * photo is this" warning-order harder to reason about.
 */
export async function processImportMedia(
  mediaFiles: ReadonlyMap<string, Uint8Array>,
  settings: TreeMediaSettings,
): Promise<Map<string, ReadyMediaFile>> {
  const codec = createImageCodec();
  const exif = createExifTools();
  const results = new Map<string, ReadyMediaFile>();

  for (const [archivePath, bytes] of mediaFiles) {
    const outcome = await processMediaBytes(bytes, settings, codec, exif);
    results.set(
      archivePath,
      outcome.status === "rejected"
        ? { status: "rejected", rejectReason: outcome.reason }
        : {
            status: "processed",
            mimeType: outcome.result.mimeType,
            originalBytes: outcome.result.finalBytes,
            derivatives: outcome.result.derivatives,
            exif: outcome.result.exif,
            warnings: outcome.result.warnings,
          },
    );
  }

  return results;
}
