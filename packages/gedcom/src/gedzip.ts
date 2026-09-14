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
  /** Every other entry's archive path — bytes are *not* decompressed here.
   * A real GedZip's media can run to tens of megabytes; a caller that only
   * needs a handful of files (one import batch's worth) fetches those
   * through {@link readMediaEntries} instead of paying to inflate the whole
   * archive up front. */
  readonly mediaEntryNames: readonly string[];
}

const GEDCOM_EXTENSIONS = [".ged", ".gedcom"];

/**
 * Read just the GEDCOM text out of a GedZip: the first `.ged`/`.gedcom`
 * entry (by extension, first in archive order). Every other entry is listed
 * by name in {@link GedZipContents.mediaEntryNames} but left compressed —
 * `fflate`'s `unzipSync` inflates an entry only when its `filter` callback
 * accepts it, and the callback here accepts only the winning GEDCOM entry,
 * so this call's cost stays proportional to the archive's entry count, not
 * its total uncompressed size. Throws if the archive has no GEDCOM entry —
 * a zip with only photos in it is not a GedZip.
 */
export function readGedZip(bytes: Uint8Array): GedZipContents {
  let gedcomEntryName: string | null = null;
  const mediaEntryNames: string[] = [];

  const entries = unzipSync(bytes, {
    filter(file) {
      if (file.name.endsWith("/")) {
        return false; // directory entry
      }
      const lower = file.name.toLowerCase();
      if (
        gedcomEntryName === null &&
        GEDCOM_EXTENSIONS.some((ext) => lower.endsWith(ext))
      ) {
        gedcomEntryName = file.name;
        return true;
      }
      mediaEntryNames.push(file.name);
      return false;
    },
  });

  if (gedcomEntryName === null) {
    throw new Error("GedZip archive has no .ged/.gedcom entry");
  }
  const gedcomBytes = entries[gedcomEntryName] as Uint8Array;

  return {
    gedcomText: new TextDecoder().decode(gedcomBytes),
    gedcomEntryName,
    mediaEntryNames,
  };
}

/**
 * Decompress just the named archive entries — the current import batch's
 * worth, typically a handful — instead of the whole archive. Callers first
 * resolve which entries they need (via {@link matchMediaFile} against a
 * {@link MediaFileIndex}), then ask for exactly those bytes.
 */
export function readMediaEntries(
  bytes: Uint8Array,
  paths: ReadonlySet<string>,
): ReadonlyMap<string, Uint8Array> {
  if (paths.size === 0) {
    return new Map();
  }
  const entries = unzipSync(bytes, { filter: (file) => paths.has(file.name) });
  return new Map(Object.entries(entries));
}

export interface MatchedMediaFile {
  /** The archive path the entry was actually found at. */
  readonly path: string;
}

export interface MediaFileIndex {
  readonly paths: ReadonlySet<string>;
  readonly byLowerPath: ReadonlyMap<string, string>;
  readonly byLowerBasename: ReadonlyMap<string, readonly string[]>;
}

/**
 * Precompute the lookups {@link matchMediaFile} needs so matching an
 * archive's worth of `FILE` values against it is linear, not quadratic — a
 * media phase with hundreds of `OBJE` records against a similarly large
 * archive would otherwise rescan every entry per record. Names only — no
 * bytes; a match just says *which* archive entry a `FILE` value resolves
 * to, decompressed later (and only for entries actually matched) via
 * {@link readMediaEntries}.
 */
export function buildMediaFileIndex(names: readonly string[]): MediaFileIndex {
  const paths = new Set(names);
  const byLowerPath = new Map<string, string>();
  const byLowerBasename = new Map<string, string[]>();
  for (const path of names) {
    byLowerPath.set(path.toLowerCase(), path);
    const base = basename(path).toLowerCase();
    const list = byLowerBasename.get(base);
    if (list === undefined) {
      byLowerBasename.set(base, [path]);
    } else {
      list.push(path);
    }
  }
  return { paths, byLowerPath, byLowerBasename };
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

  if (index.paths.has(normalized)) {
    return { path: normalized };
  }

  const ciPath = index.byLowerPath.get(normalized.toLowerCase());
  if (ciPath !== undefined) {
    return { path: ciPath };
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
  claimedByBasename.add(onlyPath);
  return { path: onlyPath };
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
