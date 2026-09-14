/**
 * The storage-key encoding a GedZip's media files use once they are
 * unzipped client-side and uploaded as individual Storage objects (issue
 * #104), instead of one large archive the edge function would otherwise have
 * to hold in memory. Shared between the browser (which encodes, when
 * uploading) and the `gedcom-import` edge function (which decodes, when
 * listing what is available) so the two sides cannot drift out of the same
 * contract -- exactly the "single source of truth" a duplicated encode/decode
 * pair would risk.
 *
 * Shape: `<index>_<archive path, percent-encoded>`. `index` disambiguates two
 * archive paths that would otherwise percent-encode to the same string (not
 * possible today, but free to guarantee) and keeps listed keys in upload
 * order. The split point is the *first* underscore -- `index` is always a
 * plain digit run, so a literal underscore inside the encoded path never
 * confuses the split.
 */

/** A job's GEDCOM text always lands at `<job storage prefix>/gedcom.ged`. */
export const GEDCOM_OBJECT_NAME = "gedcom.ged";

/** A job's media objects live under `<job storage prefix>/media/`, one
 * folder per archive file, each name produced by
 * {@link encodeMediaStorageKey}. */
export const MEDIA_SUBPREFIX = "media";

/** The name of the small JSON sidecar inside each archive file's own
 * `<job prefix>/media/<key>/` folder (issue #104 pt. 2). */
export const MEDIA_META_OBJECT_NAME = "meta.json";

/**
 * The browser processes a GedZip's media itself (decode, resize, WebP-
 * encode, EXIF-strip -- `@rootward/media`'s `processMediaBytes`) before
 * upload, because the edge function's own fixed CPU-time budget cannot
 * reliably fit that work for a real full-resolution photo. This is the
 * subset of that result which survives a JSON round trip; the actual bytes
 * (`originalBytes`/`derivatives`) live in sibling objects the browser
 * uploads alongside it (`original.<ext>`, `thumb.webp`, `display.webp`),
 * written only when `status` says they exist. Kept in sync by hand with
 * `@rootward/media`'s `ReadyMediaFile`, which this is derived from --
 * deliberately not imported from there, so this package's dependency graph
 * stays about GEDCOM/archive concerns, not photo processing. */
export type MediaMetaJson =
  | { readonly status: "rejected"; readonly rejectReason: "size" | "mime" }
  | {
      readonly status: "processed";
      readonly mimeType: string;
      readonly hasDerivatives: boolean;
      readonly hasGps: boolean;
      readonly gpsStripped: boolean;
      readonly warnings: readonly string[];
    };

/** Rejects an absolute path or a `..` segment. `encodeMediaStorageKey`
 * already percent-encodes the whole path as one opaque token before it
 * becomes part of a Storage key, so there is no path-resolution step here
 * for `..` to exploit today -- this check is defense-in-depth (a future
 * caller that builds a key some other way, and filtering out entries from a
 * GedZip -- externally supplied -- that are not a sensible archive path to
 * begin with). */
export function isSafeArchivePath(archivePath: string): boolean {
  if (archivePath === "" || archivePath.startsWith("/")) {
    return false;
  }
  return archivePath.split("/").every((segment) => segment !== "..");
}

/** Throws if `archivePath` is not {@link isSafeArchivePath} -- keeps a
 * nonsensical archive entry (from a malformed GedZip) out of Storage
 * entirely rather than uploading it under a strange key. */
export function encodeMediaStorageKey(
  index: number,
  archivePath: string,
): string {
  if (!isSafeArchivePath(archivePath)) {
    throw new Error(`unsafe archive path in media storage key: ${archivePath}`);
  }
  return `${String(index)}_${encodeURIComponent(archivePath)}`;
}

export interface DecodedMediaStorageKey {
  readonly index: number;
  readonly archivePath: string;
}

/** The inverse of {@link encodeMediaStorageKey}. Returns `null` for anything
 * that does not match the expected shape -- a Storage listing should not
 * trust arbitrary keys, only ones this module itself produced. */
export function decodeMediaStorageKey(
  key: string,
): DecodedMediaStorageKey | null {
  const underscore = key.indexOf("_");
  if (underscore <= 0) {
    return null;
  }
  const indexPart = key.slice(0, underscore);
  if (!/^\d+$/.test(indexPart)) {
    return null;
  }
  let archivePath: string;
  try {
    archivePath = decodeURIComponent(key.slice(underscore + 1));
  } catch {
    return null;
  }
  if (!isSafeArchivePath(archivePath)) {
    return null;
  }
  return { index: Number.parseInt(indexPart, 10), archivePath };
}
