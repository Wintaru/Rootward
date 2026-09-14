/**
 * GedZip reading (GEDCOM 7.0's zip-with-media convention; issue #101) — a zip
 * archive bundling the `.ged` text with the files its `FILE` tags point at.
 *
 * `fflate` is a dependency-free, pure-JS (de)compressor (no Node/Deno
 * built-ins), so pulling it in keeps this module portable the same as the
 * rest of the package (WAYFINDER decision 8).
 */

import { unzipSync } from "fflate";

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

/** True when `bytes` starts with the local-file-header signature every zip
 * (and therefore every GedZip) begins with — cheap enough to run on every
 * import without first trying to parse the bytes as GEDCOM text. */
export function isZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= ZIP_SIGNATURE.length &&
    ZIP_SIGNATURE.every((byte, i) => bytes[i] === byte)
  );
}

export interface GedZipContents {
  readonly gedcomText: string;
  /** The archive path the `.ged`/`.gedcom` entry was read from. */
  readonly gedcomEntryName: string;
  /** Every other entry, keyed by its archive path. */
  readonly mediaFiles: ReadonlyMap<string, Uint8Array>;
}

const GEDCOM_EXTENSIONS = [".ged", ".gedcom"];

/**
 * Unpack a GedZip: the first `.ged`/`.gedcom` entry (by extension, first in
 * archive order) becomes {@link GedZipContents.gedcomText}; everything else
 * is a candidate media file. Throws if the archive has no GEDCOM entry — a
 * zip with only photos in it is not a GedZip.
 */
export function readGedZip(bytes: Uint8Array): GedZipContents {
  const entries = unzipSync(bytes);

  let gedcomEntryName: string | null = null;
  let gedcomBytes: Uint8Array | null = null;
  const mediaFiles = new Map<string, Uint8Array>();

  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith("/")) {
      continue; // directory entry
    }
    const lower = name.toLowerCase();
    if (
      gedcomBytes === null &&
      GEDCOM_EXTENSIONS.some((ext) => lower.endsWith(ext))
    ) {
      gedcomEntryName = name;
      gedcomBytes = data;
      continue;
    }
    mediaFiles.set(name, data);
  }

  if (gedcomBytes === null || gedcomEntryName === null) {
    throw new Error("GedZip archive has no .ged/.gedcom entry");
  }

  return {
    gedcomText: new TextDecoder().decode(gedcomBytes),
    gedcomEntryName,
    mediaFiles,
  };
}

export interface MatchedMediaFile {
  /** The archive path the bytes were actually found at. */
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface MediaFileIndex {
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly byLowerPath: ReadonlyMap<string, string>;
  readonly byLowerBasename: ReadonlyMap<string, readonly string[]>;
}

/**
 * Precompute the lookups {@link matchMediaFile} needs so matching an
 * archive's worth of `FILE` values against it is linear, not quadratic — a
 * media phase with hundreds of `OBJE` records against a similarly large
 * archive would otherwise rescan every entry per record.
 */
export function buildMediaFileIndex(
  files: ReadonlyMap<string, Uint8Array>,
): MediaFileIndex {
  const byLowerPath = new Map<string, string>();
  const byLowerBasename = new Map<string, string[]>();
  for (const path of files.keys()) {
    byLowerPath.set(path.toLowerCase(), path);
    const base = basename(path).toLowerCase();
    const list = byLowerBasename.get(base);
    if (list === undefined) {
      byLowerBasename.set(base, [path]);
    } else {
      list.push(path);
    }
  }
  return { files, byLowerPath, byLowerBasename };
}

/**
 * Match a GEDCOM `FILE` value against a GedZip's media files. Exporters vary
 * widely in what they write there — a zip-relative path per the GEDCOM 7.0
 * convention, but often still the exporting machine's absolute local path —
 * so this falls back progressively: exact path, then case-insensitive path,
 * then basename.
 *
 * The basename tier is a guess, not an identification — two different
 * people's `FILE` values with unrelated directories (`C:\Jane\photo1.jpg`,
 * `C:\Bob\photo1.jpg`, the kind of default camera-filename collision a
 * multi-contributor family archive produces) can share a basename without
 * being the same photo. `claimedByBasename` is the caller's running record of
 * archive paths already granted through this tier during the current import;
 * a basename that would resolve to an already-claimed path is left unmatched
 * instead of silently attaching one photo to two people. Reused, unambiguous
 * exact/case-insensitive matches are not affected — the `FILE` value names
 * that file explicitly, so more than one record legitimately pointing at it
 * is not a guess. A `FILE` value that is itself a URL (some exporters write
 * one instead of a local path) never reaches the archive at all — matching
 * its tail filename against unrelated zip contents would be the same guess,
 * against a value that was never meant to name a local file to begin with.
 */
export function matchMediaFile(
  filePath: string | null,
  index: MediaFileIndex,
  claimedByBasename: Set<string>,
): MatchedMediaFile | null {
  if (filePath === null || filePath === "" || hasUriScheme(filePath)) {
    return null;
  }
  const normalized = normalizeFilePath(filePath);

  const exact = index.files.get(normalized);
  if (exact !== undefined) {
    return { path: normalized, bytes: exact };
  }

  const ciPath = index.byLowerPath.get(normalized.toLowerCase());
  if (ciPath !== undefined) {
    const bytes = index.files.get(ciPath);
    if (bytes !== undefined) {
      return { path: ciPath, bytes };
    }
  }

  const target = basename(normalized).toLowerCase();
  if (target === "") {
    return null;
  }
  const candidates = index.byLowerBasename.get(target) ?? [];
  if (candidates.length !== 1) {
    return null;
  }
  const onlyPath = candidates[0] as string;
  if (claimedByBasename.has(onlyPath)) {
    return null;
  }
  const bytes = index.files.get(onlyPath);
  if (bytes === undefined) {
    return null;
  }
  claimedByBasename.add(onlyPath);
  return { path: onlyPath, bytes };
}

/** True for `scheme://...` (`https://`, `ftp://`, …) per RFC 3986's scheme
 * grammar — cheap enough to check before doing any path normalisation. */
function hasUriScheme(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value);
}

/** Strips a Windows drive letter and normalises separators to `/` — zip
 * entries are always forward-slash per the zip spec, so a `FILE` value
 * carrying a local Windows path never matches without this. */
function normalizeFilePath(filePath: string): string {
  return filePath
    .replace(/^[A-Za-z]:[\\/]/, "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
}

function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}
