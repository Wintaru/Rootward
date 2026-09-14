import {
  isSafeArchivePath,
  isZip,
  readGedZip,
  readMediaEntries,
} from "@rootward/gedcom";

/**
 * A picked import file, unpacked client-side (issue #104). A GedZip is
 * unzipped in the browser -- which has no fixed memory ceiling worth
 * worrying about -- instead of being handed to the `gedcom-import` edge
 * function as one archive, which crashed a real ~60 MB/128-file upload
 * against that worker's fixed 256 MB cap. `processImportMedia`
 * (`lib/import/process-media.ts`, issue #104 pt. 2) then runs each of
 * {@link mediaFiles} through `@rootward/media`'s real codec/EXIF pipeline
 * client-side, and `uploadImportFiles` (`lib/db/import-jobs.ts`) uploads
 * {@link gedcomText} plus the processed results as their own small Storage
 * objects.
 */
export interface PreparedImport {
  readonly gedcomText: string;
  /** Archive path -> bytes, already filtered to {@link isSafeArchivePath}
   * paths only. Empty for a plain `.ged` upload. */
  readonly mediaFiles: ReadonlyMap<string, Uint8Array>;
  /** Archive entries dropped because their path was unsafe (an absolute
   * path, or a `..` segment) -- never uploaded, surfaced to the caller so it
   * can warn instead of silently dropping a file. */
  readonly unsafePaths: readonly string[];
}

/** Detect and unpack `file` for upload. A plain `.ged`/text file passes
 * through unchanged; a GedZip is fully unzipped here so every media file is
 * ready to upload as its own object. */
export async function prepareImportUpload(file: File): Promise<PreparedImport> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isZip(bytes)) {
    return {
      gedcomText: new TextDecoder().decode(bytes),
      mediaFiles: new Map(),
      unsafePaths: [],
    };
  }

  const zip = readGedZip(bytes);
  const safePaths: string[] = [];
  const unsafePaths: string[] = [];
  for (const name of zip.mediaEntryNames) {
    (isSafeArchivePath(name) ? safePaths : unsafePaths).push(name);
  }

  return {
    gedcomText: zip.gedcomText,
    mediaFiles: readMediaEntries(bytes, new Set(safePaths)),
    unsafePaths,
  };
}
